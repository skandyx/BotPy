import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
import { SMA, ADX, MACD } from 'technicalindicators';

export class ScannerService {
    constructor(log, klineDataDir) {
        this.log = log;
        this.klineDataDir = klineDataDir;
        this.cache = new Map(); // Cache in-memory pour les tendances 4h
        this.cacheTTL = 4 * 60 * 60 * 1000; // 4 heures
    }

    async runScan(settings) {
        this.log('SCANNER', 'Starting new discovery cycle...');
        try {
            const binancePairs = await this.discoverAndFilterPairsFromBinance(settings);
            if (binancePairs.length === 0) {
                this.log('WARN', 'No pairs found meeting volume/exclusion criteria.');
                return [];
            }
            this.log('SCANNER', `Found ${binancePairs.length} pairs after initial filters.`);

            const analysisPromises = binancePairs.map(pair => this.analyzePair(pair.symbol, settings)
                .then(analysis => analysis ? { ...pair, ...analysis } : null)
                .catch(e => {
                    this.log('WARN', `Could not analyze ${pair.symbol}: ${e.message}`);
                    return null;
                })
            );

            const results = await Promise.all(analysisPromises);
            const analyzedPairs = results.filter(p => p !== null);
            
            this.log('SCANNER', `Discovery finished. ${analyzedPairs.length} pairs passed long-term analysis.`);
            return analyzedPairs;

        } catch (error) {
            this.log('ERROR', `Discovery cycle failed: ${error.message}.`);
            throw error;
        }
    }

    async discoverAndFilterPairsFromBinance(settings) {
        this.log('BINANCE_API', 'Fetching all 24hr ticker data from Binance...');
        try {
            const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
            if (!response.ok) throw new Error(`Binance API error! status: ${response.status}`);
            const allTickers = await response.json();
            if (!Array.isArray(allTickers)) throw new Error('Binance API did not return an array.');

            const excluded = settings.EXCLUDED_PAIRS.split(',').map(p => p.trim());
            return allTickers
                .filter(ticker => 
                    ticker.symbol.endsWith('USDT') &&
                    parseFloat(ticker.quoteVolume) > settings.MIN_VOLUME_USD &&
                    !excluded.includes(ticker.symbol)
                )
                .map(ticker => ({
                    symbol: ticker.symbol,
                    volume: parseFloat(ticker.quoteVolume),
                    price: parseFloat(ticker.lastPrice),
                }));
        } catch (error) {
            this.log('ERROR', `Failed to discover pairs from Binance: ${error.message}`);
            throw error;
        }
    }

    _calculateTrend(klines) {
        if (klines.length < 25) return { trend: 'NEUTRAL' };
        const closes = klines.map(k => k.close);
        const highs = klines.map(k => k.high);
        const lows = klines.map(k => k.low);

        const lastSma20 = SMA.calculate({ period: 20, values: closes }).pop();
        const lastAdx = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }).pop()?.adx || 0;
        
        return { trend: lastAdx > 25 ? (closes[closes.length - 1] > lastSma20 ? 'UP' : 'DOWN') : 'NEUTRAL' };
    }

    async analyzePair(symbol, settings) {
        const cached = this.cache.get(symbol);
        if (cached && cached.timestamp > Date.now() - this.cacheTTL) {
            return cached.data;
        }

        const klines4h = await this.fetchKlinesFromBinance(symbol, '4h', 0, 201);
        if (klines4h.length < 200) return null;

        const formattedKlines = klines4h.map(k => ({ close: parseFloat(k[4]), high: parseFloat(k[2]), low: parseFloat(k[3]) }));
        const closes4h = formattedKlines.map(k => k.close);
        
        const lastSma50 = SMA.calculate({ period: 50, values: closes4h }).pop();
        const lastSma200 = SMA.calculate({ period: 200, values: closes4h }).pop();
        
        let marketRegime = 'NEUTRAL';
        if (lastSma50 > lastSma200) marketRegime = 'UPTREND';
        else if (lastSma50 < lastSma200) marketRegime = 'DOWNTREND';
        
        if (settings.USE_MARKET_REGIME_FILTER && marketRegime !== 'UPTREND') {
             return null;
        }
        
        const trend_4h = this._calculateTrend(formattedKlines).trend;
        const macd_4h = MACD.calculate({ values: closes4h, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }).pop();

        const analysisData = {
            priceDirection: 'neutral', trend_4h, marketRegime, macd_4h,
            rsi: 50, adx: 0, score: 'HOLD', volatility: 0, atr: 0,
            macd: null, ml_score: 50, ml_prediction: 'NEUTRAL',
        };

        this.cache.set(symbol, { timestamp: Date.now(), data: analysisData });
        return analysisData;
    }

    async fetchKlinesFromBinance(symbol, interval, startTime = 0, limit = 201) {
        let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        if (startTime > 0) url += `&startTime=${startTime + 1}`;
        
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch klines for ${symbol} (${interval}). Status: ${response.status}`);
            const klines = await response.json();
            if (!Array.isArray(klines)) throw new Error(`Binance klines response for ${symbol} is not an array.`);
            return klines;
        } catch (error) {
            this.log('WARN', `Could not fetch klines for ${symbol} (${interval}): ${error.message}`);
            return [];
        }
    }
}