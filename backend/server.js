import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';
import crypto from 'crypto';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import http from 'http';
import fetch from 'node-fetch';
import { ScannerService } from './ScannerService.js';
import { RSI, ADX, ATR, MACD } from 'technicalindicators';


// --- Basic Setup ---
dotenv.config();
const app = express();
const port = process.env.PORT || 8080;
const server = http.createServer(app);

app.use(cors({
    origin: (origin, callback) => {
        // For development (e.g., Postman) or same-origin, origin is undefined.
        // In production, you might want to restrict this to your frontend's domain.
        callback(null, true);
    },
    credentials: true,
}));
app.use(bodyParser.json());
app.set('trust proxy', 1); // For Nginx

// --- Session Management ---
app.use(session({
    secret: process.env.APP_PASSWORD || 'default_session_secret',
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// --- WebSocket Server for Frontend Communication ---
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    
    if (url.pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});
wss.on('connection', (ws) => {
    clients.add(ws);
    log('WEBSOCKET', 'Frontend client connected.');
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            log('WEBSOCKET', `Received message from client: ${JSON.stringify(data)}`);
            // The frontend no longer dictates subscriptions; the backend pushes all monitored pairs.
        } catch (e) {
            log('ERROR', `Failed to parse message from client: ${message}`);
        }
    });
    ws.on('close', () => {
        clients.delete(ws);
        log('WEBSOCKET', 'Frontend client disconnected.');
    });
});
function broadcast(message) {
    const data = JSON.stringify(message);
    if (['SCANNER_UPDATE', 'POSITIONS_UPDATED'].includes(message.type)) {
        log('WEBSOCKET', `Broadcasting ${message.type} to ${clients.size} clients.`);
    }
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    }
}

// --- Logging Service ---
const log = (level, message) => {
    console.log(`[${level}] ${message}`);
    const logEntry = {
        type: 'LOG_ENTRY',
        payload: {
            timestamp: new Date().toISOString(),
            level,
            message
        }
    };
    broadcast(logEntry);
};

// --- Persistence ---
const DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE_PATH = path.join(DATA_DIR, 'settings.json');
const STATE_FILE_PATH = path.join(DATA_DIR, 'state.json');
const KLINE_DATA_DIR = path.join(DATA_DIR, 'klines');

const ensureDataDirs = async () => {
    try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR); }
    try { await fs.access(KLINE_DATA_DIR); } catch { await fs.mkdir(KLINE_DATA_DIR); }
};

const loadData = async () => {
    await ensureDataDirs();
    try {
        const settingsContent = await fs.readFile(SETTINGS_FILE_PATH, 'utf-8');
        botState.settings = JSON.parse(settingsContent);
    } catch {
        log("WARN", "settings.json not found. Loading from .env defaults.");
        botState.settings = {
            INITIAL_VIRTUAL_BALANCE: parseFloat(process.env.INITIAL_VIRTUAL_BALANCE) || 10000,
            MAX_OPEN_POSITIONS: parseInt(process.env.MAX_OPEN_POSITIONS, 10) || 5,
            POSITION_SIZE_PCT: parseFloat(process.env.POSITION_SIZE_PCT) || 2.0,
            TAKE_PROFIT_PCT: parseFloat(process.env.TAKE_PROFIT_PCT) || 4.0,
            STOP_LOSS_PCT: parseFloat(process.env.STOP_LOSS_PCT) || 2.0,
            USE_TRAILING_STOP_LOSS: process.env.USE_TRAILING_STOP_LOSS === 'true',
            TRAILING_STOP_LOSS_PCT: parseFloat(process.env.TRAILING_STOP_LOSS_PCT) || 1.5,
            SLIPPAGE_PCT: parseFloat(process.env.SLIPPAGE_PCT) || 0.05,
            MIN_VOLUME_USD: parseFloat(process.env.MIN_VOLUME_USD) || 400000000,
            MIN_VOLATILITY_PCT: parseFloat(process.env.MIN_VOLATILITY_PCT) || 0.5,
            COINGECKO_API_KEY: process.env.COINGECKO_API_KEY || '',
            COINGECKO_SYNC_SECONDS: parseInt(process.env.COINGECKO_SYNC_SECONDS, 10) || 60,
            EXCLUDED_PAIRS: process.env.EXCLUDED_PAIRS || "USDCUSDT,FDUSDUSDT",
            USE_VOLUME_CONFIRMATION: process.env.USE_VOLUME_CONFIRMATION === 'true',
            USE_MARKET_REGIME_FILTER: process.env.USE_MARKET_REGIME_FILTER === 'true',
            REQUIRE_STRONG_BUY: process.env.REQUIRE_STRONG_BUY === 'true',
            LOSS_COOLDOWN_HOURS: parseInt(process.env.LOSS_COOLDOWN_HOURS, 10) || 4,
            BINANCE_API_KEY: process.env.BINANCE_API_KEY || '',
            BINANCE_SECRET_KEY: process.env.BINANCE_SECRET_KEY || '',
            // Advanced Defaults
            USE_ATR_STOP_LOSS: false,
            ATR_MULTIPLIER: 1.5,
            USE_AUTO_BREAKEVEN: true,
            BREAKEVEN_TRIGGER_R: 1.0,
            USE_RSI_OVERBOUGHT_FILTER: true,
            RSI_OVERBOUGHT_THRESHOLD: 70,
            USE_MACD_CONFIRMATION: true,
            USE_PARTIAL_TAKE_PROFIT: false,
            PARTIAL_TP_TRIGGER_PCT: 1.5,
            PARTIAL_TP_SELL_QTY_PCT: 50,
            USE_DYNAMIC_POSITION_SIZING: false,
            STRONG_BUY_POSITION_SIZE_PCT: 3.0,
            USE_ML_MODEL_FILTER: false,
            USE_CONFLUENCE_FILTER_1M: true,
            USE_CONFLUENCE_FILTER_15M: true,
            USE_CONFLUENCE_FILTER_30M: true,
            USE_CONFLUENCE_FILTER_1H: true,
            USE_CONFLUENCE_FILTER_4H: true,
            USE_CORRELATION_FILTER: false,
            USE_NEWS_FILTER: false,
        };
        await saveData('settings');
    }
    try {
        const stateContent = await fs.readFile(STATE_FILE_PATH, 'utf-8');
        const persistedState = JSON.parse(stateContent);
        botState.balance = persistedState.balance || botState.settings.INITIAL_VIRTUAL_BALANCE;
        botState.activePositions = persistedState.activePositions || [];
        botState.tradeHistory = persistedState.tradeHistory || [];
        botState.tradeIdCounter = persistedState.tradeIdCounter || 1;
        botState.isRunning = persistedState.isRunning !== undefined ? persistedState.isRunning : true;
        botState.tradingMode = persistedState.tradingMode || 'VIRTUAL';
    } catch {
        log("WARN", "state.json not found. Initializing default state.");
        botState.balance = botState.settings.INITIAL_VIRTUAL_BALANCE;
        await saveData('state');
    }
    realtimeAnalyzer.updateSettings(botState.settings);
};

const saveData = async (type) => {
    await ensureDataDirs();
    if (type === 'settings') {
        await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(botState.settings, null, 2));
    } else if (type === 'state') {
        const stateToPersist = {
            balance: botState.balance,
            activePositions: botState.activePositions,
            tradeHistory: botState.tradeHistory,
            tradeIdCounter: botState.tradeIdCounter,
            isRunning: botState.isRunning,
            tradingMode: botState.tradingMode,
        };
        await fs.writeFile(STATE_FILE_PATH, JSON.stringify(stateToPersist, null, 2));
    }
};


// --- Realtime Analysis Engine ---
class RealtimeAnalyzer {
    constructor(log) {
        this.log = log;
        this.settings = {};
        this.klineData = new Map(); // Map<symbol, Map<interval, kline[]>>
        this.hydrating = new Set();
    }

    updateSettings(newSettings) {
        this.log('INFO', '[Analyzer] Settings updated.');
        this.settings = newSettings;
    }
    
    async hydrateSymbol(symbol) {
        if (this.hydrating.has(symbol) || this.klineData.has(symbol)) return;
        this.hydrating.add(symbol);
        this.log('INFO', `[Analyzer] Hydrating initial kline data for ${symbol} across all timeframes...`);
        try {
            const timeframes = ['1m', '15m', '30m', '1h', '4h'];
            const symbolData = new Map();
            const pairToUpdate = botState.scannerCache.find(p => p.symbol === symbol);

            for (const tf of timeframes) {
                const klines = await scannerService.fetchKlinesFromBinance(symbol, tf, 0, 200);
                const formattedKlines = klines.map(k => ({
                    close: parseFloat(k[4]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    volume: parseFloat(k[5]),
                }));
                symbolData.set(tf, formattedKlines);

                // Initial trend calculation after fetching
                if (pairToUpdate && formattedKlines.length > 25) {
                    const trendResult = scannerService._calculateTrend(formattedKlines);
                    const trendKey = tf === '1m' ? 'trend' : `trend_${tf}`;
                    pairToUpdate[trendKey] = trendResult.trend;
                }
            }
            this.klineData.set(symbol, symbolData);
            this.log('INFO', `[Analyzer] Successfully hydrated ${symbol} and performed initial trend analysis.`);

        } catch (error) {
            this.log('ERROR', `[Analyzer] Failed to hydrate klines for ${symbol}: ${error.message}`);
        } finally {
            this.hydrating.delete(symbol);
        }
    }

    _calculateMlScore(indicators) {
        const { rsi, adx, trend1m, trend15m, trend30m, trend1h, trend4h, marketRegime, macdHistogram } = indicators;
        let score = 0;
        const MAX_SCORE = 100;
    
        const WEIGHTS = {
            REGIME: 30, TREND_4H: 10, TREND_1H: 10, TREND_30M: 5,
            TREND_15M: 5, TREND_1M: 5, RSI: 15, MACD: 10, ADX: 10,
        };
    
        if (marketRegime === 'UPTREND') score += WEIGHTS.REGIME;
        else if (marketRegime === 'DOWNTREND') score -= WEIGHTS.REGIME * 1.5;
    
        const trends = [
            { trend: trend4h, weight: WEIGHTS.TREND_4H }, { trend: trend1h, weight: WEIGHTS.TREND_1H },
            { trend: trend30m, weight: WEIGHTS.TREND_30M }, { trend: trend15m, weight: WEIGHTS.TREND_15M },
            { trend: trend1m, weight: WEIGHTS.TREND_1M },
        ];
        
        let allTrendsUp = true;
        for (const { trend, weight } of trends) {
            if (trend === 'UP') score += weight;
            else {
                allTrendsUp = false;
                score -= trend === 'DOWN' ? weight * 1.2 : weight * 0.5;
            }
        }
        
        if (marketRegime === 'UPTREND' && allTrendsUp) score += 5;
    
        if (rsi > 50 && rsi < 80) score += ((rsi - 50) / 30) * WEIGHTS.RSI;
        else if (rsi <= 40) score -= WEIGHTS.RSI / 2;
    
        if (adx > 25) score += WEIGHTS.ADX;
        if (macdHistogram > 0) score += WEIGHTS.MACD;
        else score -= WEIGHTS.MACD;
    
        const normalizedScore = Math.max(0, Math.min(MAX_SCORE, score));
        let prediction = normalizedScore > 65 ? 'UP' : (normalizedScore < 35 ? 'DOWN' : 'NEUTRAL');
    
        return { score: normalizedScore, prediction };
    }

    async handleKline(klineMsg, interval) {
        if (!this.settings || Object.keys(this.settings).length === 0) return;

        const symbol = klineMsg.s;
        if (!this.klineData.has(symbol)) await this.hydrateSymbol(symbol);
        
        const symbolKlines = this.klineData.get(symbol);
        if (!symbolKlines) return;

        const k = klineMsg.k;
        const newKline = { close: parseFloat(k.c), high: parseFloat(k.h), low: parseFloat(k.l), volume: parseFloat(k.v) };

        const intervalKlines = symbolKlines.get(interval) || [];
        intervalKlines.push(newKline);
        if (intervalKlines.length > 200) intervalKlines.shift();
        symbolKlines.set(interval, intervalKlines);
        
        const pairToUpdate = botState.scannerCache.find(p => p.symbol === symbol);
        if (!pairToUpdate) return;

        const newTrend = scannerService._calculateTrend(intervalKlines).trend;
        const trendKey = interval === '1m' ? 'trend' : `trend_${interval}`;
        if (pairToUpdate[trendKey] !== newTrend) {
            this.log('SCANNER', `[${interval}] Trend for ${symbol} updated to ${newTrend}.`);
            pairToUpdate[trendKey] = newTrend;
        }
        
        if (interval !== '1m') return;
        
        const closes = intervalKlines.map(d => d.close);
        const highs = intervalKlines.map(d => d.high);
        const lows = intervalKlines.map(d => d.low);
        const volumes = intervalKlines.map(d => d.volume);

        if (closes.length < 26) return;

        const stdDev = this.calculateStdDev(closes);
        const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
        pairToUpdate.volatility = avgPrice > 0 ? (stdDev / avgPrice) * 100 : 0;

        let isVolumeConfirmed = !this.settings.USE_VOLUME_CONFIRMATION || (volumes.length >= 20 && newKline.volume >= (volumes.slice(-20).reduce((a, b) => a + b, 0) / 20));

        pairToUpdate.rsi = RSI.calculate({ values: closes, period: 14 }).pop() || 50;
        pairToUpdate.adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }).pop()?.adx || 20;
        pairToUpdate.atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }).pop() || 0;
        pairToUpdate.macd = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }).pop() || { histogram: 0 };

        let score = 'HOLD';
        const isMarketRegimeOk = !this.settings.USE_MARKET_REGIME_FILTER || pairToUpdate.marketRegime === 'UPTREND';
        const isFullConfluenceOk = (!this.settings.USE_CONFLUENCE_FILTER_4H || pairToUpdate.trend_4h === 'UP') &&
                                   (!this.settings.USE_CONFLUENCE_FILTER_1H || pairToUpdate.trend_1h === 'UP') &&
                                   (!this.settings.USE_CONFLUENCE_FILTER_30M || pairToUpdate.trend_30m === 'UP') &&
                                   (!this.settings.USE_CONFLUENCE_FILTER_15M || pairToUpdate.trend_15m === 'UP') &&
                                   (!this.settings.USE_CONFLUENCE_FILTER_1M || pairToUpdate.trend === 'UP');
        const isMacdConfirmed = !this.settings.USE_MACD_CONFIRMATION || (pairToUpdate.macd && pairToUpdate.macd.histogram > 0);
        const isRsiOk = pairToUpdate.rsi > 50 && (!this.settings.USE_RSI_OVERBOUGHT_FILTER || pairToUpdate.rsi < this.settings.RSI_OVERBOUGHT_THRESHOLD);

        const mlResult = this._calculateMlScore({
            rsi: pairToUpdate.rsi, adx: pairToUpdate.adx, trend1m: pairToUpdate.trend, trend15m: pairToUpdate.trend_15m,
            trend30m: pairToUpdate.trend_30m, trend1h: pairToUpdate.trend_1h, trend4h: pairToUpdate.trend_4h,
            marketRegime: pairToUpdate.marketRegime, macdHistogram: pairToUpdate.macd.histogram,
        });
        pairToUpdate.ml_score = mlResult.score;
        pairToUpdate.ml_prediction = mlResult.prediction;

        const isMlConfirmed = !this.settings.USE_ML_MODEL_FILTER || (mlResult.prediction === 'UP' && mlResult.score > 65);
        const hasBaseBuyConditions = isMarketRegimeOk && isFullConfluenceOk && pairToUpdate.volatility >= this.settings.MIN_VOLATILITY_PCT && isVolumeConfirmed && isMacdConfirmed && isMlConfirmed;
        
        if (hasBaseBuyConditions && isRsiOk) {
            score = (pairToUpdate.rsi > 50 && pairToUpdate.rsi < 70) ? 'STRONG BUY' : 'BUY';
        }
        
        const cooldownInfo = botState.recentlyLostSymbols.get(symbol);
        if ((score === 'BUY' || score === 'STRONG BUY') && cooldownInfo && Date.now() < cooldownInfo.until) {
            score = 'COOLDOWN';
        }
        pairToUpdate.score = score;
        
        broadcast({ type: 'SCANNER_UPDATE', payload: pairToUpdate });
    }
    
    calculateStdDev(arr) {
        const n = arr.length;
        if (n === 0) return 0;
        const mean = arr.reduce((a, b) => a + b) / n;
        return Math.sqrt(arr.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b) / n);
    }
}


// --- Bot State & Services ---
let botState = {
    settings: {}, balance: 10000, activePositions: [], tradeHistory: [],
    tradeIdCounter: 1, isRunning: true, tradingMode: 'VIRTUAL',
    scannerCache: [], recentlyLostSymbols: new Map(),
};
const scannerService = new ScannerService(log, KLINE_DATA_DIR);
const realtimeAnalyzer = new RealtimeAnalyzer(log);

const createBinanceFeeder = (id, streamBuilder) => ({
    ws: null, id, subscribedSymbols: new Set(),
    connect: function() {
        if (this.ws) { this.ws.removeAllListeners(); this.ws.close(); }
        if (this.subscribedSymbols.size === 0) return;
        const streams = Array.from(this.subscribedSymbols).map(streamBuilder).join('/');
        const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
        this.ws = new WebSocket(url);
        this.ws.on('open', () => log("BINANCE_WS", `[${this.id}] Connected for ${this.subscribedSymbols.size} symbols.`));
        this.ws.on('message', this.handleMessage.bind(this));
        this.ws.on('close', () => { if (this.subscribedSymbols.size > 0) setTimeout(() => this.connect(), 5000); });
        this.ws.on('error', (err) => log('ERROR', `[${this.id}] Error: ${err.message}`));
    },
    updateSubscriptions: function(newSymbols) {
        const newSet = new Set(newSymbols);
        if (newSet.size === this.subscribedSymbols.size && [...newSet].every(symbol => this.subscribedSymbols.has(symbol))) return;
        this.subscribedSymbols = newSet;
        if (newSet.size === 0 && this.ws) this.ws.close(); else this.connect();
    },
});

const priceFeeder = {
    ...createBinanceFeeder('PriceTicker', (s) => `${s.toLowerCase()}@miniTicker`),
    latestPrices: new Map(),
    handleMessage: function(data) {
        const message = JSON.parse(data.toString());
        if (message.data?.e === '24hrMiniTicker') {
            const { s: symbol, c: priceStr } = message.data;
            const price = parseFloat(priceStr);
            this.latestPrices.set(symbol, price);
            broadcast({ type: 'PRICE_UPDATE', payload: { symbol, price } });
        }
    }
};

const createKlineFeeder = (interval) => ({
    ...createBinanceFeeder(`KlineFeeder_${interval}`, (s) => `${s.toLowerCase()}@kline_${interval}`),
    handleMessage: async function(data) {
        const message = JSON.parse(data.toString());
        if (message.data?.e === 'kline' && message.data.k.x) {
            await realtimeAnalyzer.handleKline(message.data, interval);
        }
    }
});

const allKlineFeeders = ['1m', '15m', '30m', '1h', '4h'].map(createKlineFeeder);


// --- Main Scanner Loop ---
const runScannerLoop = async () => {
    log("SCANNER", "Starting new market discovery cycle...");
    try {
        const discoveredPairs = await scannerService.runScan(botState.settings);
        const discoveredMap = new Map(discoveredPairs.map(p => [p.symbol, p]));
        const currentCacheMap = new Map(botState.scannerCache.map(p => [p.symbol, p]));
        const mergedCache = [];

        for (const [symbol, discoveredPair] of discoveredMap.entries()) {
            const existingPair = currentCacheMap.get(symbol);
            if (existingPair) {
                Object.assign(existingPair, {
                    marketRegime: discoveredPair.marketRegime,
                    volume: discoveredPair.volume,
                    macd_4h: discoveredPair.macd_4h,
                    trend_4h: discoveredPair.trend_4h,
                });
                mergedCache.push(existingPair);
            } else {
                mergedCache.push(discoveredPair);
            }
        }
        
        botState.scannerCache = mergedCache.filter(p => discoveredMap.has(p.symbol));
        log("SCANNER", `Discovery finished. Now monitoring ${botState.scannerCache.length} pairs in real-time.`);

        for (const pair of botState.scannerCache) {
            if (!realtimeAnalyzer.klineData.has(pair.symbol)) {
                realtimeAnalyzer.hydrateSymbol(pair.symbol);
            }
        }

        const symbolsToWatch = new Set([...botState.scannerCache.map(p => p.symbol), ...botState.activePositions.map(p => p.symbol)]);
        const symbolsArray = Array.from(symbolsToWatch);
        priceFeeder.updateSubscriptions(symbolsArray);
        allKlineFeeders.forEach(feeder => feeder.updateSubscriptions(symbolsArray));

    } catch (error) {
        log("ERROR", `Error during discovery run: ${error.message}.`);
    }
};

// --- Trading Engine ---
const tradingEngine = {
    interval: null,
    start: function() {
        if (this.interval) return;
        log('TRADE', 'Trading Engine starting...');
        botState.isRunning = true;
        this.interval = setInterval(this.tick.bind(this), 5000);
        saveData('state');
        broadcast({ type: 'BOT_STATUS_UPDATE', payload: { isRunning: true } });
    },
    stop: function() {
        if (!this.interval) return;
        log('TRADE', 'Trading Engine stopping...');
        clearInterval(this.interval);
        this.interval = null;
        botState.isRunning = false;
        saveData('state');
        broadcast({ type: 'BOT_STATUS_UPDATE', payload: { isRunning: false } });
    },
    tick: async function() {
        if (!botState.isRunning) return;
        let positionsWereUpdated = false;

        for (const position of [...botState.activePositions]) {
            const currentPrice = priceFeeder.latestPrices.get(position.symbol);
            if (!currentPrice) continue;
            
            const pnlOnRemaining = (currentPrice - position.entry_price) * position.quantity;
            const totalPnl = (position.realized_pnl || 0) + pnlOnRemaining;
            const entryValue = position.entry_price * (position.initial_quantity || position.quantity);
            position.pnl = totalPnl;
            position.pnl_pct = entryValue !== 0 ? (totalPnl / entryValue) * 100 : 0;

            if (currentPrice > position.highest_price_since_entry) {
                position.highest_price_since_entry = currentPrice;
                if (botState.settings.USE_TRAILING_STOP_LOSS) {
                    const newStopLoss = currentPrice * (1 - botState.settings.TRAILING_STOP_LOSS_PCT / 100);
                    if (newStopLoss > position.stop_loss) {
                        position.stop_loss = newStopLoss;
                        log('TRADE', `Trailing SL for ${position.symbol} updated to ${newStopLoss.toFixed(4)}`);
                    }
                }
            }

            if (botState.settings.USE_AUTO_BREAKEVEN && !position.is_at_breakeven && totalPnl >= (position.initial_risk_usd * botState.settings.BREAKEVEN_TRIGGER_R)) {
                position.stop_loss = position.entry_price;
                position.is_at_breakeven = true;
                log('TRADE', `AUTO-BREAKEVEN: Moved SL to entry for ${position.symbol}`);
            }
            
            if (botState.settings.USE_PARTIAL_TAKE_PROFIT && !position.partial_tp_hit && position.pnl_pct >= botState.settings.PARTIAL_TP_TRIGGER_PCT) {
                const sellQty = position.initial_quantity * (botState.settings.PARTIAL_TP_SELL_QTY_PCT / 100);
                position.realized_pnl = (position.realized_pnl || 0) + (currentPrice - position.entry_price) * sellQty;
                position.quantity -= sellQty;
                botState.balance += sellQty * currentPrice;
                position.partial_tp_hit = true;
                log('TRADE', `PARTIAL TP: Sold ${sellQty.toFixed(4)} ${position.symbol}`);
            }

            if (currentPrice <= position.stop_loss || (!botState.settings.USE_TRAILING_STOP_LOSS && currentPrice >= position.take_profit)) {
                const reason = currentPrice <= position.stop_loss ? 'Stop Loss hit' : 'Take Profit hit';
                this.closeTrade(position.id, currentPrice, reason);
                positionsWereUpdated = true;
            }
        }

        if (positionsWereUpdated) await saveData('state');
        
        if (botState.activePositions.length >= botState.settings.MAX_OPEN_POSITIONS) return;

        for (const pair of botState.scannerCache) {
            const isSignal = pair.score === 'STRONG BUY' || (!botState.settings.REQUIRE_STRONG_BUY && pair.score === 'BUY');
            if (isSignal && !botState.activePositions.some(p => p.symbol === pair.symbol)) {
                this.openTrade(pair);
                if (botState.activePositions.length >= botState.settings.MAX_OPEN_POSITIONS) break;
            }
        }
    },
    openTrade: function(pair) {
        const { settings, balance } = botState;
        const currentPrice = priceFeeder.latestPrices.get(pair.symbol);
        if (!currentPrice || !pair.atr) return;

        let sizePct = settings.USE_DYNAMIC_POSITION_SIZING && pair.score === 'STRONG BUY' ? settings.STRONG_BUY_POSITION_SIZE_PCT : settings.POSITION_SIZE_PCT;
        const positionSizeUSD = balance * (sizePct / 100);
        const quantity = positionSizeUSD / currentPrice;
        const entryPrice = currentPrice * (1 + settings.SLIPPAGE_PCT / 100);
        const cost = entryPrice * quantity;
        
        if (balance < cost) return log('WARN', `Insufficient balance for ${pair.symbol}.`);

        let stopLossPrice = settings.USE_ATR_STOP_LOSS ? entryPrice - (pair.atr * settings.ATR_MULTIPLIER) : entryPrice * (1 - settings.STOP_LOSS_PCT / 100);
        const initialRiskUSD = (entryPrice - stopLossPrice) * quantity;

        botState.balance -= cost;
        const newTrade = {
            id: botState.tradeIdCounter++, mode: botState.tradingMode, symbol: pair.symbol, side: 'BUY',
            entry_price: entryPrice, quantity: quantity, initial_quantity: quantity, stop_loss: stopLossPrice,
            take_profit: entryPrice * (1 + settings.TAKE_PROFIT_PCT / 100), highest_price_since_entry: entryPrice,
            entry_time: new Date().toISOString(), status: 'FILLED', initial_risk_usd: initialRiskUSD,
            is_at_breakeven: false, partial_tp_hit: false, realized_pnl: 0,
            entry_snapshot: { ...pair }
        };
        botState.activePositions.push(newTrade);
        priceFeeder.updateSubscriptions(new Set([...priceFeeder.subscribedSymbols, newTrade.symbol]));
        log('TRADE', `OPENED LONG: ${pair.symbol} | Qty: ${quantity.toFixed(4)} @ ${entryPrice.toFixed(4)} | Value: $${cost.toFixed(2)}`);
        saveData('state');
        broadcast({ type: 'POSITIONS_UPDATED' });
    },
    closeTrade: function(tradeId, exitPrice, reason) {
        const tradeIndex = botState.activePositions.findIndex(t => t.id === tradeId);
        if (tradeIndex === -1) return null;

        const trade = botState.activePositions[tradeIndex];
        const pnl = ((trade.realized_pnl || 0) + (exitPrice - trade.entry_price) * trade.quantity);
        botState.balance += exitPrice * trade.quantity;
        Object.assign(trade, {
            exit_price: exitPrice, exit_time: new Date().toISOString(), status: 'CLOSED', pnl,
            pnl_pct: (pnl / (trade.entry_price * trade.initial_quantity)) * 100
        });
        
        botState.tradeHistory.push(trade);
        botState.activePositions.splice(tradeIndex, 1);

        if (pnl < 0 && botState.settings.LOSS_COOLDOWN_HOURS > 0) {
            const cooldownUntil = Date.now() + botState.settings.LOSS_COOLDOWN_HOURS * 3600000;
            botState.recentlyLostSymbols.set(trade.symbol, { until: cooldownUntil });
            log('TRADE', `${trade.symbol} is on cooldown until ${new Date(cooldownUntil).toLocaleTimeString()}.`);
        }

        log('TRADE', `CLOSED: ${trade.symbol} @ ${exitPrice.toFixed(4)} | PnL: $${pnl.toFixed(2)} (${trade.pnl_pct.toFixed(2)}%) | Reason: ${reason}`);
        saveData('state');
        broadcast({ type: 'POSITIONS_UPDATED' });
        return trade;
    }
};

// --- Auth Middleware & API Endpoints ---
const isAuthenticated = (req, res, next) => {
    if (req.session.isAuthenticated) return next();
    res.status(401).json({ message: 'Unauthorized' });
};
app.post('/api/login', (req, res) => {
    if (req.body.password === process.env.APP_PASSWORD) {
        req.session.isAuthenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});
app.get('/api/check-session', (req, res) => res.json({ isAuthenticated: !!req.session.isAuthenticated }));

app.get('/api/mode', isAuthenticated, (req, res) => res.json({ mode: botState.tradingMode }));
app.post('/api/mode', isAuthenticated, async (req, res) => {
    const { mode } = req.body;
    if (['VIRTUAL', 'REAL_PAPER', 'REAL_LIVE'].includes(mode)) {
        botState.tradingMode = mode;
        await saveData('state');
        log('INFO', `Trading mode switched to ${mode}`);
        res.json({ success: true, mode: botState.tradingMode });
    } else {
        res.status(400).json({ success: false, message: 'Invalid mode.' });
    }
});

app.get('/api/settings', isAuthenticated, (req, res) => res.json(botState.settings));
app.post('/api/settings', isAuthenticated, async (req, res) => {
    const oldSyncSeconds = botState.settings.COINGECKO_SYNC_SECONDS;
    botState.settings = { ...botState.settings, ...req.body };
    realtimeAnalyzer.updateSettings(botState.settings);
    await saveData('settings');
    log('INFO', 'Bot settings updated.');
    runScannerLoop();
    if (oldSyncSeconds !== botState.settings.COINGECKO_SYNC_SECONDS) {
        log('INFO', 'Scanner interval updated. Restarting scanner loop.');
        clearInterval(scannerInterval);
        scannerInterval = setInterval(runScannerLoop, botState.settings.COINGECKO_SYNC_SECONDS * 1000);
    }
    res.json({ success: true });
});
app.post('/api/clear-data', isAuthenticated, async (req, res) => {
    log('WARN', 'Clearing all trade data...');
    Object.assign(botState, {
        activePositions: [], tradeHistory: [], tradeIdCounter: 1,
        balance: botState.settings.INITIAL_VIRTUAL_BALANCE,
    });
    await saveData('state');
    try {
        await fs.rm(KLINE_DATA_DIR, { recursive: true, force: true });
        await fs.mkdir(KLINE_DATA_DIR);
    } catch (error) { log('ERROR', `Could not clear kline data: ${error.message}`); }
    res.json({ success: true });
});
app.get('/api/scanner', isAuthenticated, (req, res) => {
    const dataWithPrices = botState.scannerCache.map(pair => ({
        ...pair,
        price: priceFeeder.latestPrices.get(pair.symbol) || pair.price
    }));
    res.json(dataWithPrices);
});
app.get('/api/positions', isAuthenticated, (req, res) => res.json(botState.activePositions));
app.post('/api/close-trade/:tradeId', isAuthenticated, (req, res) => {
    const tradeId = parseInt(req.params.tradeId, 10);
    const position = botState.activePositions.find(p => p.id === tradeId);
    if (!position) return res.status(404).json({ message: 'Position not found' });
    const currentPrice = priceFeeder.latestPrices.get(position.symbol) || position.entry_price;
    const closedTrade = tradingEngine.closeTrade(tradeId, currentPrice, 'Manual Close');
    res.json(closedTrade || { success: false });
});
app.get('/api/history', isAuthenticated, (req, res) => res.json(botState.tradeHistory));
app.get('/api/status', isAuthenticated, (req, res) => {
    res.json({
        mode: botState.tradingMode, balance: botState.balance,
        positions: botState.activePositions.length, monitored_pairs: botState.scannerCache.length,
        top_pairs: botState.scannerCache.slice(0, 10).map(p => p.symbol),
        max_open_positions: botState.settings.MAX_OPEN_POSITIONS
    });
});
app.get('/api/performance-stats', isAuthenticated, (req, res) => {
    const totalTrades = botState.tradeHistory.length;
    const winning_trades = botState.tradeHistory.filter(t => (t.pnl || 0) > 0).length;
    res.json({
        total_trades: totalTrades, winning_trades,
        losing_trades: totalTrades - winning_trades,
        total_pnl: botState.tradeHistory.reduce((sum, t) => sum + (t.pnl || 0), 0),
        win_rate: totalTrades > 0 ? (winning_trades / totalTrades) * 100 : 0,
    });
});
app.post('/api/test-connection', isAuthenticated, async (req, res) => {
    const { apiKey, secretKey } = req.body;
    try {
        const timestamp = Date.now();
        const signature = crypto.createHmac('sha256', secretKey).update(`timestamp=${timestamp}`).digest('hex');
        const response = await fetch(`https://api.binance.com/api/v3/account?timestamp=${timestamp}&signature=${signature}`, { headers: { 'X-MBX-APIKEY': apiKey } });
        const data = await response.json();
        res.status(response.status).json(response.ok ? { success: true, message: 'Connection successful!' } : { success: false, message: `Binance Error: ${data.msg}` });
    } catch (error) { res.status(500).json({ success: false, message: 'Connection failed.' }); }
});
app.post('/api/test-coingecko', isAuthenticated, async (req, res) => {
    const { apiKey } = req.body;
    try {
        const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&x_cg_demo_api_key=${apiKey}`);
        const data = await response.json();
        res.status(response.status).json(response.ok && data.bitcoin ? { success: true, message: 'Connection successful!' } : { success: false, message: `CoinGecko Error: ${data.error}` });
    } catch (error) { res.status(500).json({ success: false, message: 'Connection failed.' }); }
});
app.get('/api/bot/status', isAuthenticated, (req, res) => res.json({ isRunning: botState.isRunning }));
app.post('/api/bot/start', isAuthenticated, (req, res) => { tradingEngine.start(); res.json({ success: true }); });
app.post('/api/bot/stop', isAuthenticated, (req, res) => { tradingEngine.stop(); res.json({ success: true }); });

// --- Startup ---
let scannerInterval;
const startServer = async () => {
    await loadData();
    log('INFO', `Backend server running on http://localhost:${port}`);
    scannerInterval = setInterval(runScannerLoop, botState.settings.COINGECKO_SYNC_SECONDS * 1000);
    await runScannerLoop();
    if (botState.isRunning) tradingEngine.start();
};

server.listen(port, () => {
    startServer().catch(err => {
        log('ERROR', `FATAL: Server failed to start: ${err.stack}`);
        process.exit(1);
    });
});