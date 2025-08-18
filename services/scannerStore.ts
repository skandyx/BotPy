import { ScannedPair, BotSettings } from '../types';
import { RSI, ADX } from 'technicalindicators';
import { logService } from './logService';

// Simplified kline type for indicator calculation
interface Kline {
  close: number;
  high: number;
  low: number;
  volume: number;
}

type ScannerStoreSubscriber = (pairs: ScannedPair[]) => void;

class ScannerStore {
    private pairs = new Map<string, ScannedPair>();
    private klineData = new Map<string, Kline[]>();
    private subscribers = new Set<ScannerStoreSubscriber>();
    private isInitialized = false;
    private settings: BotSettings | null = null;

    // --- Observable Store Methods ---
    public subscribe(callback: ScannerStoreSubscriber): () => void {
        this.subscribers.add(callback);
        // Immediately provide the current list to the new subscriber
        callback(this.getScannedPairs());
        return () => this.unsubscribe(callback);
    }

    public unsubscribe(callback: ScannerStoreSubscriber): void {
        this.subscribers.delete(callback);
    }

    private notify(): void {
        const pairsArray = this.getScannedPairs();
        this.subscribers.forEach(callback => callback(pairsArray));
    }

    // --- Core Logic ---
    public initialize(): void {
        if (this.isInitialized) return;
        logService.log('INFO', '[ScannerStore] Initializing...');
        this.isInitialized = true;
    }

    public updateSettings(newSettings: BotSettings): void {
        logService.log('INFO', '[ScannerStore] Settings updated.');
        this.settings = newSettings;
    }
    
    public updatePairList(newPairs: ScannedPair[]): void {
        logService.log('INFO', `[ScannerStore] Updating scanner list with ${newPairs.length} pairs.`);
        
        const newSymbols = new Set(newPairs.map(p => p.symbol));

        const newPairsMap = new Map<string, ScannedPair>();
        newPairs.forEach(pair => {
            // Preserve the price direction from the old state if it exists, to prevent UI flicker
            const oldPair = this.pairs.get(pair.symbol);
            const updatedPair = { ...pair };
            if (oldPair) {
                updatedPair.priceDirection = oldPair.priceDirection;
            }
            newPairsMap.set(pair.symbol, updatedPair);
        });
        this.pairs = newPairsMap;

        // Clean up kline data for symbols that are no longer tracked
        for (const symbol of this.klineData.keys()) {
            if (!newSymbols.has(symbol)) {
                this.klineData.delete(symbol);
            }
        }
        
        this.notify();
    }
    
    public getScannedPairs(): ScannedPair[] {
        return Array.from(this.pairs.values());
    }

    public handleKlineUpdate(klineMsg: any): void {
        if (!this.isInitialized || !this.settings) return;

        const symbol = klineMsg.s;
        const k = klineMsg.k;

        const pairToUpdate = this.pairs.get(symbol);
        if (!pairToUpdate) return; // Not a pair we are tracking

        const newKline: Kline = {
            close: parseFloat(k.c),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            volume: parseFloat(k.v),
        };

        // Update kline data for the symbol
        const existingKlines = this.klineData.get(symbol) || [];
        existingKlines.push(newKline);
        if (existingKlines.length > 100) {
            existingKlines.shift(); // Keep array at a max length of 100 for performance
        }
        this.klineData.set(symbol, existingKlines);
        
        // Recalculate indicators if we have enough data
        if (existingKlines.length < 20) {
            // Not enough data yet to calculate reliable indicators from 1m candles
            return;
        }

        const closes = existingKlines.map(d => d.close);
        const highs = existingKlines.map(d => d.high);
        const lows = existingKlines.map(d => d.low);
        const volumes = existingKlines.map(d => d.volume);

        // Volatility Calculation
        const stdDev = this.calculateStdDev(closes);
        const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
        const volatility = avgPrice > 0 ? (stdDev / avgPrice) * 100 : 0;

        // Volume Confirmation
        let isVolumeConfirmed = !this.settings.USE_VOLUME_CONFIRMATION; // Default to true if disabled
        if (this.settings.USE_VOLUME_CONFIRMATION) {
             if (volumes.length >= 20) {
                const volumeMA20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
                isVolumeConfirmed = newKline.volume >= volumeMA20;
            } else {
                isVolumeConfirmed = false; // Not enough data
            }
        }

        const rsiResult = RSI.calculate({ values: closes, period: 14 });
        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

        const rsi = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : 50;
        const adx = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 20;

        const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        
        let trend: ScannedPair['trend'] = 'NEUTRAL';
        if (adx > 25) {
            trend = newKline.close > sma20 ? 'UP' : 'DOWN';
        }

        // Multi-Timeframe Confirmation Check
        const isLongTermTrendConfirmed = !this.settings.USE_MULTI_TIMEFRAME_CONFIRMATION || pairToUpdate.trend_4h === 'UP';

        let score: ScannedPair['score'] = 'HOLD';
        if (trend === 'UP' && volatility >= this.settings.MIN_VOLATILITY_PCT && isVolumeConfirmed && isLongTermTrendConfirmed) {
            if (rsi > 50 && rsi < 70) {
                score = 'STRONG BUY';
            } else if (rsi > 50) {
                score = 'BUY';
            }
        }

        // Update the pair object with new indicator values
        pairToUpdate.rsi = rsi;
        pairToUpdate.adx = adx;
        pairToUpdate.trend = trend;
        pairToUpdate.score = score;
        pairToUpdate.volatility = volatility;
        
        this.pairs.set(symbol, pairToUpdate);

        // Notify all subscribers (like ScannerPage) about the change
        this.notify();
    }

    private calculateStdDev(arr: number[]): number {
        const n = arr.length;
        if (n === 0) return 0;
        const mean = arr.reduce((a, b) => a + b) / n;
        return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
    }
}

export const scannerStore = new ScannerStore();