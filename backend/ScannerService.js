import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { SMA, ADX } from 'technicalindicators';

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

            // Step 3: Analyze each pair with persistent kline data
            const analyzedPairs = [];
            for (const pair of binancePairs) {
                try {
                    const analysis = await this.analyzePair(pair.symbol, settings);
                    if (analysis) {
                         analyzedPairs.push({
                            ...pair,
                            ...analysis,
                         });
                    }
                } catch (e) {
                    this.log('WARN', `Could not analyze pair ${pair.symbol}: ${e.message}`);
                }
            }
            
            this.log('SCANNER', `Scanner finished. ${analyzedPairs.length} viable pairs analyzed.`);
            return analyzedPairs;

        } catch (error) {
            this.log('ERROR', `Scanner cycle failed unexpectedly: ${error.stack}`);
            return [];
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
            return [];
        }
    }
    
    async analyzePair(symbol, settings) {
        const klines = await this.getPersistentKlines(symbol);
        if (klines.length < 200) {
            this.log('SCANNER', `Skipping ${symbol}: Not enough kline data (${klines.length}/200).`);
            return null; // Not enough data
        }

        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);
        
        const sma50 = SMA.calculate({ period: 50, values: closes });
        const sma200 = SMA.calculate({ period: 200, values: closes });
        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

        const lastSma50 = sma50[sma50.length - 1];
        const lastSma200 = sma200[sma200.length - 1];
        const lastAdx = adxResult[adxResult.length - 1]?.adx || 0;
        
        let marketRegime = 'NEUTRAL';
        if (lastSma50 > lastSma200) marketRegime = 'UPTREND';
        else if (lastSma50 < lastSma200) marketRegime = 'DOWNTREND';

        let trend4h = 'NEUTRAL';
        if (lastAdx > 25) {
            trend4h = lastSma50 > lastSma200 ? 'UP' : 'DOWN';
        }

        // Apply master market regime filter
        if (settings.USE_MARKET_REGIME_FILTER && marketRegime !== 'UPTREND') {
             return { score: 'HOLD', trend_4h: trend4h, marketRegime }; // Return minimal data if filtered out
        }

        return {
            priceDirection: 'neutral',
            trend: 'NEUTRAL', // This will be calculated from 1m data later if needed
            trend_4h: trend4h,
            marketRegime,
            rsi: 50, // Placeholder
            adx: 0, // Placeholder
            score: 'BUY', // Default to BUY if it passes the 4h filters
            volatility: 0, // Placeholder
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
            if (err.code === 'ENOENT') {
                // File doesn't exist, this is normal on first run for a symbol.
            } else {
                this.log('WARN', `Could not read or parse kline file ${symbol}.json. Will refetch all data. Error: ${err.message}`);
                klines = []; // Reset klines if file is corrupt
            }
        }

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
            if (klines.length > 0 && klines[klines.length - 1].timestamp === newKlines[0].timestamp) {
                klines[klines.length - 1] = newKlines.shift();
            }
            klines.push(...newKlines);
            
            if(klines.length > 200) {
                klines = klines.slice(klines.length - 200);
            }

            await fs.writeFile(klineFilePath, JSON.stringify(klines, null, 2));
        }

        return klines;
    }

    async fetchKlinesFromBinance(symbol, startTime = 0) {
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=201`;
        if (startTime > 0) {
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
