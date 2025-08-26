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
import { RSI, ADX, ATR, MACD, SMA } from 'technicalindicators';


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
            RSI_MIN_THRESHOLD: parseFloat(process.env.RSI_MIN_THRESHOLD) || 50,
            ADX_MIN_THRESHOLD: parseFloat(process.env.ADX_MIN_THRESHOLD) || 25,
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
            BREAKEVEN_TRIGGER_PCT: parseFloat(process.env.BREAKEVEN_TRIGGER_PCT) || 0.5,
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
                    open: parseFloat(k[1]),
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

    async handleKline(klineMsg, interval) {
        this.log('BINANCE_WS', `[${interval}] Bougie clôturée reçue pour ${klineMsg.s}. Traitement...`);
        if (!this.settings || Object.keys(this.settings).length === 0) return;

        const symbol = klineMsg.s;
        if (!this.klineData.has(symbol)) await this.hydrateSymbol(symbol);
        
        const symbolKlines = this.klineData.get(symbol);
        if (!symbolKlines) return;

        const k = klineMsg.k;
        const newKline = { open: parseFloat(k.o), close: parseFloat(k.c), high: parseFloat(k.h), low: parseFloat(k.l), volume: parseFloat(k.v) };

        const intervalKlines = symbolKlines.get(interval) || [];
        intervalKlines.push(newKline);
        if (intervalKlines.length > 200) intervalKlines.shift();
        symbolKlines.set(interval, intervalKlines);
        
        const pairToUpdate = botState.scannerCache.find(p => p.symbol === symbol);
        if (!pairToUpdate) return;
        
        // --- Update indicators for the current timeframe ---
        const closes = intervalKlines.map(d => d.close);
        const highs = intervalKlines.map(d => d.high);
        const lows = intervalKlines.map(d => d.low);

        const newTrend = scannerService._calculateTrend(intervalKlines).trend;
        const trendKey = interval === '1m' ? 'trend' : `trend_${interval}`;
        if (pairToUpdate[trendKey] !== newTrend) {
            this.log('SCANNER', `[${interval}] Trend for ${symbol} updated to ${newTrend}.`);
            pairToUpdate[trendKey] = newTrend;
        }

        if (['15m', '30m'].includes(interval) && closes.length >= 14) {
            const rsiKey = `rsi_${interval}`;
            pairToUpdate[rsiKey] = RSI.calculate({ values: closes, period: 14 }).pop() || 50;
        }
        if (interval === '15m' && closes.length >= 14) {
            pairToUpdate.atr_15m = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 }).pop() || 0;
        }

        // Only do the full scoring on the 1m interval
        if (interval !== '1m') return;
        
        // --- 1M ANALYSIS AND SCORING ---
        if (closes.length < 26) return; // Need enough data for all indicators
        
        const lookbackPeriod = 20;
        if (intervalKlines.length >= lookbackPeriod) {
            const recentKlines = intervalKlines.slice(-lookbackPeriod);
            const highestHigh = Math.max(...recentKlines.map(k => k.high));
            const lowestLow = Math.min(...recentKlines.map(k => k.low));
            pairToUpdate.volatility = lowestLow > 0 ? ((highestHigh - lowestLow) / lowestLow) * 100 : 0;
        }

        pairToUpdate.rsi = RSI.calculate({ values: closes, period: 14 }).pop() || 50;
        pairToUpdate.adx = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 }).pop()?.adx || 20;
        
        const macdOutput = MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false }).pop();
        if (macdOutput) {
            pairToUpdate.macd = { MACD: macdOutput.MACD, signal: macdOutput.signal, histogram: macdOutput.histogram };
        }

        let score = 'HOLD';
        const { settings } = this;

        // --- Gatekeeper Checks ---
        const check1_MarketRegime = !settings.USE_MARKET_REGIME_FILTER || pairToUpdate.marketRegime === 'UPTREND';
        const check2_Confluence = (
            (!settings.USE_CONFLUENCE_FILTER_4H || pairToUpdate.trend_4h === 'UP') &&
            (!settings.USE_CONFLUENCE_FILTER_1H || pairToUpdate.trend_1h === 'UP') &&
            (!settings.USE_CONFLUENCE_FILTER_30M || pairToUpdate.trend_30m === 'UP') &&
            (!settings.USE_CONFLUENCE_FILTER_15M || pairToUpdate.trend_15m === 'UP') &&
            (!settings.USE_CONFLUENCE_FILTER_1M || pairToUpdate.trend === 'UP')
        );
        const check3_Volatility = pairToUpdate.volatility >= settings.MIN_VOLATILITY_PCT;
        const check4_Adx = pairToUpdate.adx >= settings.ADX_MIN_THRESHOLD;
        const check5_RsiRange = pairToUpdate.rsi >= settings.RSI_MIN_THRESHOLD && (!settings.USE_RSI_OVERBOUGHT_FILTER || pairToUpdate.rsi <= settings.RSI_OVERBOUGHT_THRESHOLD);
        const check6_Macd = !settings.USE_MACD_CONFIRMATION || (pairToUpdate.macd && pairToUpdate.macd.histogram > 0);
        const avgVolume = intervalKlines.length > 1 ? intervalKlines.slice(-20, -1).reduce((sum, k) => sum + k.volume, 0) / 19 : 0;
        const check7_Volume = !settings.USE_VOLUME_CONFIRMATION || (avgVolume > 0 && newKline.volume > avgVolume);

        if (check1_MarketRegime && check2_Confluence && check3_Volatility && check4_Adx && check5_RsiRange && check6_Macd && check7_Volume) {
            score = 'BUY';

            const isAdxStrong = pairToUpdate.adx > (settings.ADX_MIN_THRESHOLD + 5);
            const isRsiIdeal = pairToUpdate.rsi < (settings.RSI_OVERBOUGHT_THRESHOLD - 5);
            if (isAdxStrong && isRsiIdeal) {
                score = 'STRONG BUY';
            }
        }
        
        const cooldownInfo = botState.recentlyLostSymbols.get(symbol);
        if ((score === 'BUY' || score === 'STRONG BUY') && cooldownInfo && Date.now() < cooldownInfo.until) {
            score = 'COOLDOWN';
        }

        pairToUpdate.score = score;
        
        broadcast({ type: 'SCANNER_UPDATE', payload: pairToUpdate });
    }
}


// --- Bot State & Services ---
let botState = {
    settings: {}, balance: 10000, activePositions: [], tradeHistory: [],
    tradeIdCounter: 1, isRunning: true, tradingMode: 'VIRTUAL',
    scannerCache: [], recentlyLostSymbols: new Map(),
};
const scannerService = new ScannerService(log, KLINE_DATA_