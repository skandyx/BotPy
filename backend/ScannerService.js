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
            // Step 1: Discover pairs from CoinGecko
            const coingeckoPairs = await this.discoverPairsFromCoinGecko(settings);

            // Step 2: Filter with Binance volume data
            const binancePairs = await this.filterPairsWithBinanceVolume(coingeckoPairs, settings);
            
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
            this.log('ERROR', `Scanner cycle failed: ${error.message}`);
            return [];
        }
    }

    async discoverPairsFromCoinGecko(settings) {
        this.log('COINGECKO', 'Fetching high-volume pairs from CoinGecko...');
        const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false';
        const response = await fetch(url);
        if (!response.ok) throw new Error(`CoinGecko API error! status: ${response.status}`);
        const markets = await response.json();
        
        const usdtPairs = markets
            .filter(m => m.symbol.toLowerCase() !== 'usdt')
            .map(m => ({
                symbol: `${m.symbol.toUpperCase()}USDT`,
                price: m.current_price, // Initial price from CoinGecko
            }));
        
        this.log('COINGECKO', `Discovered ${usdtPairs.length} potential USDT pairs.`);
        return usdtPairs;
    }

    async filterPairsWithBinanceVolume(pairs, settings) {
        this.log('BINANCE_API', 'Fetching 24hr ticker data from Binance for volume filtering...');
        const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
        if (!response.ok) throw new Error(`Binance API error! status: ${response.status}`);
        const allTickers = await response.json();

        const binanceVolumeMap = new Map();
        allTickers.forEach(t => {
            binanceVolumeMap.set(t.symbol, {
                volume: parseFloat(t.quoteVolume),
                price: parseFloat(t.lastPrice)
            });
        });

        const excluded = settings.EXCLUDED_PAIRS.split(',').map(p => p.trim());
        const result = [];

        for (const pair of pairs) {
            const binanceData = binanceVolumeMap.get(pair.symbol);
            if (binanceData && binanceData.volume > settings.MIN_VOLUME_USD && !excluded.includes(pair.symbol)) {
                result.push({
                    symbol: pair.symbol,
                    volume: binanceData.volume,
                    price: binanceData.price,
                });
            }
        }
        return result;
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

        return {
            priceDirection: 'neutral',
            trend: 'NEUTRAL',
            trend_4h: trend4h,
            marketRegime,
            rsi: 50,
            adx: 0,
            score: 'HOLD',
            volatility: 0,
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
        } catch {
            this.log('SCANNER', `No kline data found for ${symbol}. Fetching initial history.`);
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
            // If we had existing klines, the first new kline might be an update to the last saved one.
            if (klines.length > 0 && klines[klines.length - 1].timestamp === newKlines[0].timestamp) {
                klines[klines.length - 1] = newKlines.shift(); // Replace last element
            }
            klines.push(...newKlines);
            
            // Keep the array at a max of 200 candles for analysis
            if(klines.length > 200) {
                klines = klines.slice(klines.length - 200);
            }

            await fs.writeFile(klineFilePath, JSON.stringify(klines, null, 2));
        }

        return klines;
    }

    async fetchKlinesFromBinance(symbol, startTime = 0) {
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=200`;
        if (startTime > 0) {
            // Fetch klines since the last one we have
            url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${startTime}`;
        }
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch klines for ${symbol}`);
        return response.json();
    }
}
