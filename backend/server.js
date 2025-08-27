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
import { RSI, ADX, ATR, MACD, SMA, BollingerBands } from 'technicalindicators';


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
    secret: process.env.SESSION_SECRET || 'a_much_more_secure_and_random_secret_string_32_chars_long',
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
    ws.on('error', (error) => {
        log('ERROR', `WebSocket client error: ${error.message}`);
        ws.close();
    });
});
function broadcast(message) {
    const data = JSON.stringify(message);
    if (['SCANNER_UPDATE', 'POSITIONS_UPDATED'].includes(message.type)) {
        log('WEBSOCKET', `Broadcasting ${message.type} to ${clients.size} clients.`);
    }
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
             client.send(data, (err) => {
                if (err) {
                    log('ERROR', `Failed to send message to a client: ${err.message}`);
                }
            });
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
const AUTH_FILE_PATH = path.join(DATA_DIR, 'auth.json');
const KLINE_DATA_DIR = path.join(DATA_DIR, 'klines');

const ensureDataDirs = async () => {
    try { await fs.access(DATA_DIR); } catch { await fs.mkdir(DATA_DIR); }
    try { await fs.access(KLINE_DATA_DIR); } catch { await fs.mkdir(KLINE_DATA_DIR); }
};

// --- Auth Helpers ---
const hashPassword = (password) => {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16).toString('hex');
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            resolve(salt + ":" + derivedKey.toString('hex'));
        });
    });
};

const verifyPassword = (password, hash) => {
    return new Promise((resolve, reject) => {
        const [salt, key] = hash.split(':');
        if (!salt || !key) {
            return reject(new Error('Invalid hash format.'));
        }
        crypto.scrypt(password, salt, 64, (err, derivedKey) => {
            if (err) reject(err);
            try {
                const keyBuffer = Buffer.from(key, 'hex');
                const match = crypto.timingSafeEqual(keyBuffer, derivedKey);
                resolve(match);
            } catch (e) {
                // Handle cases where the key is not valid hex, preventing crashes
                resolve(false);
            }
        });
    });
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
            MIN_VOLUME_USD: parseFloat(process.env.MIN_VOLUME_USD) || 10000000,
            COINGECKO_API_KEY: process.env.COINGECKO_API_KEY || '',
            COINGECKO_SYNC_SECONDS: parseInt(process.env.COINGECKO_SYNC_SECONDS, 10) || 3600, // Scan less often
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
            RSI_OVERBOUGHT_THRESHOLD: 75,
            USE_PARTIAL_TAKE_PROFIT: false,
            PARTIAL_TP_TRIGGER_PCT: 1.5,
            PARTIAL_TP_SELL_QTY_PCT: 50,
            USE_DYNAMIC_POSITION_SIZING: false,
            STRONG_BUY_POSITION_SIZE_PCT: 3.0,
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

    try {
        const authContent = await fs.readFile(AUTH_FILE_PATH, 'utf-8');
        const authData = JSON.parse(authContent);
        if (authData.passwordHash) {
            botState.passwordHash = authData.passwordHash;
        } else {
            throw new Error("Invalid auth file format");
        }
    } catch {
        log("WARN", "auth.json not found or invalid. Initializing from .env.");
        const initialPassword = process.env.APP_PASSWORD;
        if (!initialPassword) {
            log('ERROR', 'CRITICAL: APP_PASSWORD is not set in .env file. Please set it and restart.');
            process.exit(1);
        }
        botState.passwordHash = await hashPassword(initialPassword);
        await fs.writeFile(AUTH_FILE_PATH, JSON.stringify({ passwordHash: botState.passwordHash }, null, 2));
        log('INFO', 'Created auth.json with a new secure password hash.');
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
    } else if (type === 'auth') {
        await fs.writeFile(AUTH_FILE_PATH, JSON.stringify({ passwordHash: botState.passwordHash }, null, 2));
    }
};


// --- Realtime Analysis Engine (Volatility Breakout Strategy) ---
class RealtimeAnalyzer {
    constructor(log) {
        this.log = log;
        this.settings = {};
        this.klineData = new Map(); // Map<symbol, Map<interval, kline[]>>
        this.hydrating = new Set();
        this.SQUEEZE_PERCENTILE_THRESHOLD = 0.25; // Adjusted threshold
        this.SQUEEZE_LOOKBACK = 50;
        this.SCORE_MAP = {
            'STRONG BUY': 100,
            'BUY': 90, // Not used in this strategy but kept for scale
            'COMPRESSION': 80,
            'HOLD': 50,
            'FAKE_BREAKOUT': 30,
            'COOLDOWN': 10
        };
    }

    updateSettings(newSettings) {
        this.log('INFO', '[Analyzer] Settings updated for Volatility Breakout strategy.');
        this.settings = newSettings;
    }

    analyze15mIndicators(symbolOrPair) {
        const symbol = typeof symbolOrPair === 'string' ? symbolOrPair : symbolOrPair.symbol;
        const pairToUpdate = typeof symbolOrPair === 'string' 
            ? botState.scannerCache.find(p => p.symbol === symbol) 
            : symbolOrPair;

        if (!pairToUpdate) {
            this.log('WARN', `[15m] Could not find pair ${symbol} in cache for analysis.`);
            return;
        }

        const klines15m = this.klineData.get(symbol)?.get('15m');
        if (!klines15m || klines15m.length < this.SQUEEZE_LOOKBACK) {
            this.log('SCANNER', `[15m] Insufficient data for ${symbol} (${klines15m?.length || 0} candles).`);
            return;
        }

        const closes15m = klines15m.map(d => d.close);
        const highs15m = klines15m.map(d => d.high);
        const lows15m = klines15m.map(d => d.low);

        const bbResult = BollingerBands.calculate({ period: 20, values: closes15m, stdDev: 2 });
        const atrResult = ATR.calculate({ high: highs15m, low: lows15m, close: closes15m, period: 14 });
        const lastBB = bbResult[bbResult.length - 1];
        const lastATR = atrResult[atrResult.length - 1];
        if (!lastBB || !lastATR) return;
        
        pairToUpdate.atr_15m = lastATR;
        
        const bbWidthPct = (lastBB.upper - lastBB.lower) / lastBB.middle * 100;
        pairToUpdate.bollinger_bands_15m = { ...lastBB, width_pct: bbWidthPct };

        const historicalWidths = bbResult.slice(0, -1).map(b => (b.upper - b.lower) / b.middle);
        const sortedWidths = [...historicalWidths].sort((a, b) => a - b);
        const squeezeThreshold = sortedWidths[Math.floor(sortedWidths.length * this.SQUEEZE_PERCENTILE_THRESHOLD)];
        
        const currentSqueezeStatus = bbWidthPct <= squeezeThreshold;
        pairToUpdate.is_in_squeeze_15m = currentSqueezeStatus;

        const volumes15m = klines15m.map(k => k.volume);
        const avgVolume = volumes15m.slice(-21, -1).reduce((sum, v) => sum + v, 0) / 20;
        pairToUpdate.volume_20_period_avg_15m = avgVolume;

        // --- Robust State Machine ---
        let currentScore = pairToUpdate.score || 'HOLD';
        let nextScore = currentScore;
        
        // 1. Reset transient states from the previous tick. A signal is a one-time event.
        if (['STRONG BUY', 'FAKE_BREAKOUT'].includes(currentScore)) {
            nextScore = currentSqueezeStatus ? 'COMPRESSION' : 'HOLD';
        }

        // 2. Check for a breakout event IF the score was 'COMPRESSION'.
        if (nextScore === 'COMPRESSION') {
            const wasInSqueeze = bbResult.length > 1 ? (((bbResult[bbResult.length-2].upper - bbResult[bbResult.length-2].lower) / bbResult[bbResult.length-2].middle) <= squeezeThreshold) : false;
            const breakoutCandle = klines15m[klines15m.length - 1];
            const isBreakout = breakoutCandle.close > lastBB.upper;
            
            if (wasInSqueeze && isBreakout) {
                this.log('SCANNER', `[15m] Breakout detected for ${symbol}! Validating conditions...`);
                
                const check1_Trend = pairToUpdate.price_above_ema50_4h === true;
                const check2_Volume = breakoutCandle.volume > (avgVolume * 2);
                const check3_RSI = pairToUpdate.rsi_1h !== undefined && pairToUpdate.rsi_1h < this.settings.RSI_OVERBOUGHT_THRESHOLD;

                this.log('SCANNER', `[${symbol}] Validation: Trend OK? ${check1_Trend}, Volume OK? ${check2_Volume}, RSI OK? ${check3_RSI}`);

                if (check1_Trend && check2_Volume && check3_RSI) {
                    nextScore = 'STRONG BUY';
                    const previousCandle = klines15m[klines15m.length - 2];
                    tradingEngine.evaluateAndOpenTrade(pairToUpdate, previousCandle.low);
                } else {
                    nextScore = 'FAKE_BREAKOUT';
                    this.log('SCANNER', `[${symbol}] Breakout failed validation.`);
                }
            }
        }

        // 3. Handle normal transitions between HOLD and COMPRESSION.
        if (nextScore === 'HOLD' && currentSqueezeStatus) {
            nextScore = 'COMPRESSION';
        } else if (nextScore === 'COMPRESSION' && !currentSqueezeStatus) {
            nextScore = 'HOLD';
        }
        
        // 4. Override with COOLDOWN status if applicable (highest priority)
        const cooldownInfo = botState.recentlyLostSymbols.get(symbol);
        if (cooldownInfo && Date.now() < cooldownInfo.until) {
            nextScore = 'COOLDOWN';
        }

        // Update score and broadcast if it changed
        if (pairToUpdate.score !== nextScore) {
            pairToUpdate.score = nextScore;
            pairToUpdate.score_value = this.SCORE_MAP[nextScore] || 50;
            this.log('SCANNER', `[15m ANALYSIS] ${symbol} - Score updated to: ${nextScore}`);
            broadcast({ type: 'SCANNER_UPDATE', payload: pairToUpdate });
        }
    }

    async hydrateSymbol(symbol) {
        if (this.hydrating.has(symbol)) return;
        this.hydrating.add(symbol);
        this.log('INFO', `[Analyzer] Hydrating historical klines for new symbol: ${symbol}`);
        try {
            const klines15m = await scanner.fetchKlinesFromBinance(symbol, '15m');
            if (klines15m.length === 0) throw new Error("No 15m klines fetched.");
            const formattedKlines = klines15m.map(k => ({
                openTime: k[0],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
                closeTime: k[6],
            }));

            if (!this.klineData.has(symbol)) {
                this.klineData.set(symbol, new Map());
            }
            this.klineData.get(symbol).set('15m', formattedKlines);
            
            // Perform an immediate analysis after hydrating
            this.analyze15mIndicators(symbol);

        } catch (error) {
            this.log('ERROR', `Failed to hydrate ${symbol}: ${error.message}`);
        } finally {
            this.hydrating.delete(symbol);
        }
    }

    handleNew15mKline(symbol, kline) {
        log('BINANCE_WS', `[15m KLINE] Received for ${symbol}. Close: ${kline.close}`);
        if (!this.klineData.has(symbol) || !this.klineData.get(symbol).has('15m')) {
            this.log('WARN', `Received 15m kline for un-hydrated symbol ${symbol}. Hydrating now.`);
            this.hydrateSymbol(symbol); // Hydrate if data is missing
            return;
        }

        const klines15m = this.klineData.get(symbol).get('15m');
        klines15m.push(kline);
        if (klines15m.length > 201) { // Keep buffer size manageable
            klines15m.shift();
        }
        this.analyze15mIndicators(symbol);
    }
}
const realtimeAnalyzer = new RealtimeAnalyzer(log);


// --- Binance WebSocket for Real-time Kline Data ---
let binanceWs = null;
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';
const subscribedStreams = new Set();
let reconnectBinanceWsTimeout = null;

function connectToBinanceStreams() {
    if (binanceWs && (binanceWs.readyState === WebSocket.OPEN || binanceWs.readyState === WebSocket.CONNECTING)) {
        return;
    }
    if (reconnectBinanceWsTimeout) clearTimeout(reconnectBinanceWsTimeout);

    log('BINANCE_WS', 'Connecting to Binance streams...');
    binanceWs = new WebSocket(BINANCE_WS_URL);

    binanceWs.on('open', () => {
        log('BINANCE_WS', 'Connected. Subscribing to streams...');
        if (subscribedStreams.size > 0) {
            const streams = Array.from(subscribedStreams);
            const payload = { method: "SUBSCRIBE", params: streams, id: 1 };
            binanceWs.send(JSON.stringify(payload));
            log('BINANCE_WS', `Resubscribed to ${streams.length} streams.`);
        }
    });

    binanceWs.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.e === 'kline') {
                const { s: symbol, k: kline } = msg;
                if (kline.i === '15m' && kline.x) { // is closed kline
                     const formattedKline = {
                        openTime: kline.t,
                        open: parseFloat(kline.o),
                        high: parseFloat(kline.h),
                        low: parseFloat(kline.l),
                        close: parseFloat(kline.c),
                        volume: parseFloat(kline.v),
                        closeTime: kline.T,
                    };
                    realtimeAnalyzer.handleNew15mKline(symbol, formattedKline);
                }
            } else if (msg.e === '24hrTicker') {
                const updatedPair = botState.scannerCache.find(p => p.symbol === msg.s);
                if (updatedPair) {
                    const newPrice = parseFloat(msg.c);
                    const oldPrice = updatedPair.price;
                    updatedPair.price = newPrice;
                    updatedPair.priceDirection = newPrice > oldPrice ? 'up' : newPrice < oldPrice ? 'down' : (updatedPair.priceDirection || 'neutral');
                    broadcast({ type: 'SCANNER_UPDATE', payload: updatedPair });
                }
            }
        } catch (e) {
            log('ERROR', `Error processing Binance WS message: ${e.message}`);
        }
    });

    binanceWs.on('close', () => {
        log('WARN', 'Binance WebSocket disconnected. Reconnecting in 5s...');
        binanceWs = null;
        reconnectBinanceWsTimeout = setTimeout(connectToBinanceStreams, 5000);
    });
    binanceWs.on('error', (err) => log('ERROR', `Binance WebSocket error: ${err.message}`));
}

function updateBinanceSubscriptions(symbolsToMonitor) {
    const newStreams = new Set(symbolsToMonitor.flatMap(s => [`${s.toLowerCase()}@kline_15m`, `${s.toLowerCase()}@ticker`]));
    const streamsToUnsub = [...subscribedStreams].filter(s => !newStreams.has(s));
    const streamsToSub = [...newStreams].filter(s => !subscribedStreams.has(s));

    if (binanceWs && binanceWs.readyState === WebSocket.OPEN) {
        if (streamsToUnsub.length > 0) {
            binanceWs.send(JSON.stringify({ method: "UNSUBSCRIBE", params: streamsToUnsub, id: 2 }));
            log('BINANCE_WS', `Unsubscribed from ${streamsToUnsub.length} streams.`);
        }
        if (streamsToSub.length > 0) {
            binanceWs.send(JSON.stringify({ method: "SUBSCRIBE", params: streamsToSub, id: 3 }));
            log('BINANCE_WS', `Subscribed to ${streamsToSub.length} new streams.`);
        }
    }

    subscribedStreams.clear();
    newStreams.forEach(s => subscribedStreams.add(s));
}

// --- Bot State & Core Logic ---
let botState = {
    settings: {},
    balance: 10000,
    activePositions: [],
    tradeHistory: [],
    tradeIdCounter: 1,
    scannerCache: [], // Holds the latest state of all scanned pairs
    isRunning: true,
    tradingMode: 'VIRTUAL', // VIRTUAL, REAL_PAPER, REAL_LIVE
    passwordHash: '',
    recentlyLostSymbols: new Map(), // symbol -> { until: timestamp }
};

const scanner = new ScannerService(log, KLINE_DATA_DIR);
let scannerInterval = null;

async function runScannerCycle() {
    if (!botState.isRunning) return;
    try {
        const discoveredPairs = await scanner.runScan(botState.settings);
        const newPairsToHydrate = [];
        const discoveredSymbols = new Set(discoveredPairs.map(p => p.symbol));
        const existingPairsMap = new Map(botState.scannerCache.map(p => [p.symbol, p]));

        // 1. Update existing pairs from the new scan data, and identify brand new pairs.
        for (const discoveredPair of discoveredPairs) {
            const existingPair = existingPairsMap.get(discoveredPair.symbol);
            if (existingPair) {
                // The pair already exists in our cache. We update ONLY the background
                // indicators from the fresh scan, preserving all real-time data
                // (like score, BB width, etc.) that the RealtimeAnalyzer has calculated.
                existingPair.volume = discoveredPair.volume;
                existingPair.price = discoveredPair.price;
                existingPair.price_above_ema50_4h = discoveredPair.price_above_ema50_4h;
                existingPair.rsi_1h = discoveredPair.rsi_1h;
            } else {
                // This is a new pair not seen before. Add it to the main cache
                // and mark it for historical data hydration.
                botState.scannerCache.push(discoveredPair);
                newPairsToHydrate.push(discoveredPair.symbol);
            }
        }

        // 2. Remove pairs that are no longer valid (i.e., they were not in the latest scan results)
        botState.scannerCache = botState.scannerCache.filter(p => discoveredSymbols.has(p.symbol));

        // 3. Asynchronously hydrate the new pairs to get their 15m kline data
        if (newPairsToHydrate.length > 0) {
            log('INFO', `New symbols detected by scanner: [${newPairsToHydrate.join(', ')}]. Hydrating...`);
            await Promise.all(newPairsToHydrate.map(symbol => realtimeAnalyzer.hydrateSymbol(symbol)));
        }

        // 4. Update WebSocket subscriptions to match the new final list of monitored pairs
        updateBinanceSubscriptions(botState.scannerCache.map(p => p.symbol));
        
    } catch (error) {
        log('ERROR', `Scanner cycle failed: ${error.message}`);
    }
}


// --- Trading Engine ---
const tradingEngine = {
    evaluateAndOpenTrade(pair, slPriceReference) {
        if (!botState.isRunning) return;
        
        const cooldownInfo = botState.recentlyLostSymbols.get(pair.symbol);
        if (cooldownInfo && Date.now() < cooldownInfo.until) {
            log('TRADE', `Skipping trade for ${pair.symbol} due to recent loss cooldown.`);
            pair.score = 'COOLDOWN'; // Ensure state reflects this
            return;
        }

        if (botState.activePositions.length >= botState.settings.MAX_OPEN_POSITIONS) {
            log('TRADE', `Skipping trade for ${pair.symbol}: Max open positions (${botState.settings.MAX_OPEN_POSITIONS}) reached.`);
            return;
        }

        if (botState.activePositions.some(p => p.symbol === pair.symbol)) {
            log('TRADE', `Skipping trade for ${pair.symbol}: Position already open.`);
            return;
        }

        const s = botState.settings;
        const entryPrice = pair.price;
        let positionSizePct = s.POSITION_SIZE_PCT;
        if (s.USE_DYNAMIC_POSITION_SIZING && pair.score === 'STRONG BUY') {
            positionSizePct = s.STRONG_BUY_POSITION_SIZE_PCT;
        }

        const positionSizeUSD = botState.balance * (positionSizePct / 100);
        const quantity = positionSizeUSD / entryPrice;

        let stopLoss;
        if (s.USE_ATR_STOP_LOSS && pair.atr_15m) {
            stopLoss = entryPrice - (pair.atr_15m * s.ATR_MULTIPLIER);
        } else {
            stopLoss = slPriceReference * (1 - s.STOP_LOSS_PCT / 100);
        }

        const riskPerUnit = entryPrice - stopLoss;
        if (riskPerUnit <= 0) {
            log('ERROR', `Calculated risk is zero or negative for ${pair.symbol}. Aborting trade.`);
            return;
        }
        const takeProfit = entryPrice + (riskPerUnit * (s.TAKE_PROFIT_PCT / s.STOP_LOSS_PCT));

        const newTrade = {
            id: botState.tradeIdCounter++,
            mode: botState.tradingMode,
            symbol: pair.symbol,
            side: 'BUY',
            entry_price: entryPrice,
            quantity: quantity,
            initial_quantity: quantity,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            highest_price_since_entry: entryPrice,
            entry_time: new Date().toISOString(),
            status: 'PENDING', // Will be FILLED immediately in virtual mode
            entry_snapshot: { ...pair },
            initial_risk_usd: positionSizeUSD * (s.STOP_LOSS_PCT / 100),
            is_at_breakeven: false,
            partial_tp_hit: false,
            realized_pnl: 0,
        };

        log('TRADE', `>>> FIRING TRADE <<< Opening ${botState.tradingMode} trade for ${pair.symbol}: Qty=${quantity.toFixed(4)}, Entry=$${entryPrice}, SL=$${stopLoss.toFixed(4)}, TP=$${takeProfit.toFixed(4)}`);
        
        newTrade.status = 'FILLED'; // Simulate immediate fill
        botState.activePositions.push(newTrade);
        botState.balance -= positionSizeUSD; // In reality, this would be margin
        
        saveData('state');
        broadcast({ type: 'POSITIONS_UPDATED' });
    },

    monitorAndManagePositions() {
        if (!botState.isRunning) return;

        const positionsToClose = [];
        botState.activePositions.forEach(pos => {
            const currentPairState = botState.scannerCache.find(p => p.symbol === pos.symbol);
            if (!currentPairState) return; // Skip if pair is no longer scanned

            const currentPrice = currentPairState.price;
            
            // Update highest price for trailing stop
            if (currentPrice > pos.highest_price_since_entry) {
                pos.highest_price_since_entry = currentPrice;
            }

            // Check for Stop Loss
            if (currentPrice <= pos.stop_loss) {
                positionsToClose.push({ trade: pos, exitPrice: pos.stop_loss, reason: 'Stop Loss' });
                return;
            }

            // Check for Take Profit
            if (currentPrice >= pos.take_profit) {
                positionsToClose.push({ trade: pos, exitPrice: pos.take_profit, reason: 'Take Profit' });
                return;
            }

            // --- Advanced Risk Management ---
            const s = botState.settings;
            const pnlPct = ((currentPrice - pos.entry_price) / pos.entry_price) * 100;
            
            // Partial Take Profit
            if (s.USE_PARTIAL_TAKE_PROFIT && !pos.partial_tp_hit && pnlPct >= s.PARTIAL_TP_TRIGGER_PCT) {
                this.executePartialSell(pos, currentPrice);
            }

            // Auto Break-even
            if (s.USE_AUTO_BREAKEVEN && !pos.is_at_breakeven && pnlPct >= s.BREAKEVEN_TRIGGER_PCT) {
                pos.stop_loss = pos.entry_price;
                pos.is_at_breakeven = true;
                log('TRADE', `[${pos.symbol}] Stop Loss moved to Break-even at $${pos.entry_price}.`);
            }
            
            // Trailing Stop Loss
            if (s.USE_TRAILING_STOP_LOSS && pos.is_at_breakeven) { // Often combined with break-even
                const newTrailingSL = pos.highest_price_since_entry * (1 - s.TRAILING_STOP_LOSS_PCT / 100);
                if (newTrailingSL > pos.stop_loss) {
                    pos.stop_loss = newTrailingSL;
                    log('TRADE', `[${pos.symbol}] Trailing Stop Loss updated to $${newTrailingSL.toFixed(4)}.`);
                }
            }
        });

        if (positionsToClose.length > 0) {
            positionsToClose.forEach(({ trade, exitPrice, reason }) => {
                this.closeTrade(trade.id, exitPrice, reason);
            });
            saveData('state');