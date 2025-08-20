import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { SMA, ADX, MACD } from 'technicalindicators';

export class ScannerService {
    constructor(log, klineDataDir) {
        this.log = log;
        this.klineDataDir = klineDataDir;
    }

    async runScan(settings) {
        this.log('SCANNER', 'Starting new scan cycle...');
        try {
            // Step 1 & 2 Combined: Discover and filter pairs directly from Binance
            const binancePairs = await this.discoverAndFilterPairsFromBinance(settings);
            if (binancePairs.length === 0) {
                this.log('WARN', 'No pairs found on Binance meeting the volume and exclusion criteria. Ending scan cycle.');
                return [];
            }
            
            this.log('SCANNER', `Found ${binancePairs.length} pairs after volume and exclusion filters.`);

            // Step 3: Analyze each pair in parallel for maximum performance
            const analysisPromises = binancePairs.map(pair =>
                this.analyzePair(pair.symbol, settings)
                    .then(analysis => analysis ? { ...pair, ...analysis } : null)
                    .catch(e => {
                        this.log('WARN', `Could not analyze pair ${pair.symbol}: ${e.message}`);
                        return null; // Return null on error so Promise.all doesn't fail
                    })
            );

            const results = await Promise.all(analysisPromises);
            const analyzedPairs = results.filter(p => p !== null); // Filter out nulls from errors or filters
            
            this.log('SCANNER', `Scanner finished. ${analyzedPairs.length} viable pairs analyzed.`);
            return analyzedPairs;

        } catch (error) {
            // This error is now caught by runScannerLoop in server.js, which preserves the last good state.
            this.log('ERROR', `Scanner cycle failed: ${error.message}. The previous list of pairs will be maintained.`);
            throw error; // Propagate error so the server knows the scan failed.
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
                // Filter for USDT pairs only
                if (ticker.symbol.endsWith('USDT')) {
                    const volume = parseFloat(ticker.quoteVolume);
                    const price = parseFloat(ticker.lastPrice);
                    
                    // Check against volume and exclusion list
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
            throw error; // Propagate the error instead of returning an empty array
        }
    }
    
    async analyzePair(symbol, settings) {
        const klines = await this.getPersistentKlines(symbol);
        if (klines.length < 200) {
            // Not enough data to form a long-term opinion
            return null;
        }

        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        
        const sma50 = SMA.calculate({ period: 50, values: closes });
        const sma200 = SMA.calculate({ period: 200, values: closes });
        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
        const macdResult = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });

        const lastSma50 = sma50[sma50.length - 1];
        const lastSma200 = sma200[sma200.length - 1];
        const lastAdx = adxResult[adxResult.length - 1]?.adx || 0;
        const lastMacd = macdResult[macdResult.length - 1];

        let marketRegime = 'NEUTRAL';
        if (lastSma50 > lastSma200) marketRegime = 'UPTREND';
        else if (lastSma50 < lastSma200) marketRegime = 'DOWNTREND';

        let trend4h = 'NEUTRAL';
        if (lastAdx > 25) {
            trend4h = lastSma50 > lastSma200 ? 'UP' : 'DOWN';
        }

        // Apply master market regime filter
        if (settings.USE_MARKET_REGIME_FILTER && marketRegime !== 'UPTREND') {
             return null; // If filtered out by regime, don't include it in the final list at all.
        }

        return {
            priceDirection: 'neutral',
            trend: 'NEUTRAL', // Placeholder, will be calculated by 1m klines
            trend_4h: trend4h,
            marketRegime,
            rsi: 50, // Placeholder, will be updated by 1m klines
            adx: 0, // Placeholder
            score: 'HOLD', // Default to HOLD, will be updated by 1m klines
            volatility: 0, // Placeholder
            atr: 0, // Placeholder
            macd: null, // Placeholder
            macd_4h: lastMacd,
        };
    }

    async getPersistentKlines(symbol) {
        const klineFilePath = path.join(this.klineDataDir, `${symbol}.json`);
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
                this.log('WARN', `Could not read or parse kline file ${symbol}.json. Will refetch all data. Error: ${err.message}`);
                klines = []; // Reset klines if file is corrupt
            }
        }
        
        // Only fetch if data is incomplete or stale (e.g., more than 4 hours old)
        const isDataStale = (Date.now() - lastTimestamp) > (4 * 60 * 60 * 1000);
        if(klines.length < 200 || isDataStale) {
            const binanceKlines = await this.fetchKlinesFromBinance(symbol, lastTimestamp);
            const newKlines = binanceKlines.map(k => ({
                timestamp: k[0],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
            }));

            if (newKlines.length > 0) {
                // If the last kline we have matches the first new one, it's an update to the current candle.
                if (klines.length > 0 && klines[klines.length - 1].timestamp === newKlines[0].timestamp) {
                    klines[klines.length - 1] = newKlines.shift();
                }
                klines.push(...newKlines);
                
                // Keep only the last 200 candles to save space and improve performance
                if(klines.length > 200) {
                    klines = klines.slice(klines.length - 200);
                }

                await fs.writeFile(klineFilePath, JSON.stringify(klines));
            }
        }
        
        return klines;
    }

    async fetchKlinesFromBinance(symbol, startTime = 0) {
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=201`;
        if (startTime > 0) {
            // Fetch everything since the last candle
            url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${startTime + 1}`;
        }
        
        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Failed to fetch klines for ${symbol} from Binance. Status: ${response.status} - ${errorBody}`);
            }
            const klines = await response.json();
            if (!Array.isArray(klines)) {
                throw new Error(`Binance klines response for ${symbol} is not an array.`);
            }
            return klines;
        } catch (error) {
            this.log('WARN', `Could not fetch klines for ${symbol}: ${error.message}`);
            return [];
        }
    }
}
