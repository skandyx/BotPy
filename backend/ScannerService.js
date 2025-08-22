import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { SMA, ADX, MACD } from 'technicalindicators';

export class ScannerService {
    constructor(log, klineDataDir) {
        this.log = log;
        this.klineDataDir = klineDataDir;
        // The 4h is the only one needed for the main periodic scan (market regime)
        // Others are now handled by real-time websockets.
        this.timeframes = ['4h'];
    }

    async runScan(settings) {
        this.log('SCANNER', 'Starting new scan cycle...');
        try {
            const binancePairs = await this.discoverAndFilterPairsFromBinance(settings);
            if (binancePairs.length === 0) {
                this.log('WARN', 'No pairs found on Binance meeting the volume and exclusion criteria. Ending scan cycle.');
                return [];
            }
            
            this.log('SCANNER', `Found ${binancePairs.length} pairs after volume and exclusion filters.`);

            const analysisPromises = binancePairs.map(pair =>
                this.analyzePair(pair.symbol, settings)
                    .then(analysis => analysis ? { ...pair, ...analysis } : null)
                    .catch(e => {
                        this.log('WARN', `Could not analyze pair ${pair.symbol}: ${e.message}`);
                        return null;
                    })
            );

            const results = await Promise.all(analysisPromises);
            const analyzedPairs = results.filter(p => p !== null);
            
            this.log('SCANNER', `Scanner finished. ${analyzedPairs.length} viable pairs analyzed for market regime.`);
            return analyzedPairs;

        } catch (error) {
            this.log('ERROR', `Scanner cycle failed: ${error.message}. The previous list of pairs will be maintained.`);
            throw error;
        }
    }

    async discoverAndFilterPairsFromBinance(settings) {
        this.log('BINANCE_API', 'Fetching all 24hr ticker data from Binance to discover and filter pairs...');
        try {
            const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Binance API error! status: ${response.status} - ${errorBody}`);
            }
            const allTickers = await response.json();
            if (!Array.isArray(allTickers)) {
                throw new Error('Binance API did not return an array for 24hr ticker.');
            }

            const excluded = settings.EXCLUDED_PAIRS.split(',').map(p => p.trim());
            const result = [];

            for (const ticker of allTickers) {
                if (ticker.symbol.endsWith('USDT')) {
                    const volume = parseFloat(ticker.quoteVolume);
                    const price = parseFloat(ticker.lastPrice);
                    
                    if (volume > settings.MIN_VOLUME_USD && !excluded.includes(ticker.symbol)) {
                        result.push({
                            symbol: ticker.symbol,
                            volume: volume,
                            price: price,
                        });
                    }
                }
            }
            return result;
        } catch (error) {
            this.log('ERROR', `Failed to discover pairs from Binance ticker API: ${error.message}`);
            throw error;
        }
    }

    _calculateTrend(klines) {
        if (klines.length < 25) return { trend: 'NEUTRAL' }; // ADX needs at least 2*period -1
        
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);

        const sma20 = SMA.calculate({ period: 20, values: closes });
        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

        const lastSma20 = sma20[sma20.length - 1];
        const lastAdx = adxResult[adxResult.length - 1]?.adx || 0;
        const lastClose = closes[closes.length - 1];

        let trend = 'NEUTRAL';
        if (lastAdx > 25) {
            trend = lastClose > lastSma20 ? 'UP' : 'DOWN';
        }
        return { trend };
    }

    async analyzePair(symbol, settings) {
        const klines4h = await this.getPersistentKlines(symbol, '4h', 200);
        if (klines4h.length < 200) return null; // Need full 4h data for regime filter

        const closes4h = klines4h.map(k => k.close);
        const sma50_4h = SMA.calculate({ period: 50, values: closes4h });
        const sma200_4h = SMA.calculate({ period: 200, values: closes4h });
        const lastSma50 = sma50_4h[sma50_4h.length - 1];
        const lastSma200 = sma200_4h[sma200_4h.length - 1];
        
        let marketRegime = 'NEUTRAL';
        if (lastSma50 > lastSma200) marketRegime = 'UPTREND';
        else if (lastSma50 < lastSma200) marketRegime = 'DOWNTREND';
        
        // This is a pre-filter. The main server can decide to ignore this pair
        // even if it passes here, based on real-time data.
        if (settings.USE_MARKET_REGIME_FILTER && marketRegime !== 'UPTREND') {
             return null;
        }
        
        const trend_4h = this._calculateTrend(klines4h).trend;

        return {
            priceDirection: 'neutral',
            trend: 'NEUTRAL', // 1m trend will be populated by websocket
            trend_4h,
            marketRegime,
            rsi: 50,
            adx: 0,
            score: 'HOLD',
            volatility: 0,
            atr: 0,
            macd: null,
            macd_4h: MACD.calculate({ values: closes4h, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }).pop(),
            ml_score: 50,
            ml_prediction: 'NEUTRAL',
        };
    }

    async getPersistentKlines(symbol, interval, requiredLength) {
        const klineFilePath = path.join(this.klineDataDir, `${symbol}-${interval}.json`);
        let klines = [];
        let lastTimestamp = 0;

        try {
            const fileContent = await fs.readFile(klineFilePath, 'utf-8');
            klines = JSON.parse(fileContent);
            if (klines.length > 0) {
                lastTimestamp = klines[klines.length - 1].timestamp;
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                this.log('WARN', `Could not read/parse ${klineFilePath}. Refetching. Error: ${err.message}`);
                klines = [];
            }
        }
        
        const intervalMs = this._intervalToMs(interval);
        const isDataStale = (Date.now() - lastTimestamp) > intervalMs;

        if(klines.length < requiredLength || isDataStale) {
            const limit = requiredLength > 200 ? requiredLength : 201; // Fetch a bit more to be safe
            const binanceKlines = await this.fetchKlinesFromBinance(symbol, interval, lastTimestamp, limit);
            const newKlines = binanceKlines.map(k => ({
                timestamp: k[0],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
            }));

            if (newKlines.length > 0) {
                if (klines.length > 0 && klines[klines.length - 1].timestamp === newKlines[0].timestamp) {
                    klines[klines.length - 1] = newKlines.shift();
                }
                klines.push(...newKlines);
                
                if(klines.length > requiredLength) {
                    klines = klines.slice(klines.length - requiredLength);
                }

                await fs.writeFile(klineFilePath, JSON.stringify(klines));
            }
        }
        
        return klines;
    }

    async fetchKlinesFromBinance(symbol, interval, startTime = 0, limit = 201) {
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        if (startTime > 0) {
            url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime + 1}&limit=${limit}`;
        }
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Failed to fetch klines for ${symbol} (${interval}) from Binance. Status: ${response.status} - ${errorBody}`);
            }
            const klines = await response.json();
            if (!Array.isArray(klines)) {
                throw new Error(`Binance klines response for ${symbol} (${interval}) is not an array.`);
            }
            return klines;
        } catch (error) {
            this.log('WARN', `Could not fetch klines for ${symbol} (${interval}): ${error.message}`);
            return [];
        }
    }

    _intervalToMs(interval) {
        const unit = interval.slice(-1);
        const value = parseInt(interval.slice(0, -1));
        switch(unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            default: return 0;
        }
    }
}