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
import { RSI, ADX, ATR, MACD, SMA, BollingerBands, EMA } from 'technicalindicators';


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
            SCANNER_DISCOVERY_INTERVAL_SECONDS: parseInt(process.env.SCANNER_DISCOVERY_INTERVAL_SECONDS, 10) || 3600,
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
            USE_RSI_SAFETY_FILTER: true,
            RSI_OVERBOUGHT_THRESHOLD: 75,
            USE_PARTIAL_TAKE_PROFIT: false,
            PARTIAL_TP_TRIGGER_PCT: 1.5,
            PARTIAL_TP_SELL_QTY_PCT: 50,
            USE_DYNAMIC_POSITION_SIZING: false,
            STRONG_BUY_POSITION_SIZE_PCT: 3.0,
            USE_PARABOLIC_FILTER: true,
            PARABOLIC_FILTER_PERIOD_MINUTES: 5,
            PARABOLIC_FILTER_THRESHOLD_PCT: 3.0,
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


// --- Realtime Analysis Engine (Macro-Micro Strategy) ---
class RealtimeAnalyzer {
    constructor(log) {
        this.log = log;
        this.settings = {};
        this.klineData = new Map(); // Map<symbol, Map<interval, kline[]>>
        this.hydrating = new Set();
        this.SQUEEZE_PERCENTILE_THRESHOLD = 0.25;
        this.SQUEEZE_LOOKBACK = 50;
    }

    updateSettings(newSettings) {
        this.log('INFO', '[Analyzer] Settings updated for Macro-Micro strategy.');
        this.settings = newSettings;
    }

    // Phase 1: 15m analysis to qualify pairs for the Hotlist
    analyze15mIndicators(symbolOrPair) {
        const symbol = typeof symbolOrPair === 'string' ? symbolOrPair : symbolOrPair.symbol;
        const pairToUpdate = typeof symbolOrPair === 'string'
            ? botState.scannerCache.find(p => p.symbol === symbol)
            : symbolOrPair;

        if (!pairToUpdate) return;

        const klines15m = this.klineData.get(symbol)?.get('15m');
        if (!klines15m || klines15m.length < 21) return; // Need at least 20 for BB + 1 previous

        const old_score = pairToUpdate.score;
        const old_hotlist_status = pairToUpdate.is_on_hotlist;

        const closes15m = klines15m.map(d => d.close);
        const highs15m = klines15m.map(d => d.high);
        const lows15m = klines15m.map(d => d.low);

        const bbResult = BollingerBands.calculate({ period: 20, values: closes15m, stdDev: 2 });
        const atrResult = ATR.calculate({ high: highs15m, low: lows15m, close: closes15m, period: 14 });

        if (bbResult.length < 2 || !atrResult.length) return;

        pairToUpdate.atr_15m = atrResult[atrResult.length - 1];
        
        const lastCandle = klines15m[klines15m.length - 1];
        const lastBB = bbResult[bbResult.length - 1];

        // Update pair with CURRENT BB width for display purposes
        const currentBbWidthPct = (lastBB.upper - lastBB.lower) / lastBB.middle * 100;
        pairToUpdate.bollinger_bands_15m = { ...lastBB, width_pct: currentBbWidthPct };

        // --- CORRECTED SQUEEZE LOGIC ---
        const bbWidths = bbResult.map(b => (b.upper - b.lower) / b.middle);
        const previousCandleIndex = bbWidths.length - 2;
        const previousBbWidth = bbWidths[previousCandleIndex];

        const historyForSqueeze = bbWidths.slice(0, previousCandleIndex + 1).slice(-this.SQUEEZE_LOOKBACK);
        
        let wasInSqueeze = false;
        if (historyForSqueeze.length < 20) {
            pairToUpdate.is_in_squeeze_15m = false;
        } else {
            const sortedWidths = [...historyForSqueeze].sort((a, b) => a - b);
            const squeezeThreshold = sortedWidths[Math.floor(sortedWidths.length * this.SQUEEZE_PERCENTILE_THRESHOLD)];
            wasInSqueeze = previousBbWidth <= squeezeThreshold;
            pairToUpdate.is_in_squeeze_15m = wasInSqueeze;
        }
        
        const volumes15m = klines15m.map(k => k.volume);
        const avgVolume = volumes15m.slice(-21, -1).reduce((sum, v) => sum + v, 0) / 20;
        pairToUpdate.volume_20_period_avg_15m = avgVolume;

        const volumeConditionMet = lastCandle.volume > (avgVolume * 2);

        // --- "Hotlist" Logic using the CORRECTED squeeze state ---
        const isTrendOK = pairToUpdate.price_above_ema50_4h === true;
        const isOnHotlist = isTrendOK && wasInSqueeze;
        pairToUpdate.is_on_hotlist = isOnHotlist;

        if (isOnHotlist && !old_hotlist_status) {
            this.log('SCANNER', `[HOTLIST ADDED] ${symbol} now meets macro conditions (Trend OK, Squeeze on previous candle). Watching on 1m.`);
            addSymbolTo1mStream(symbol);
        } else if (!isOnHotlist && old_hotlist_status) {
            this.log('SCANNER', `[HOTLIST REMOVED] ${symbol} no longer meets macro conditions.`);
            removeSymbolFrom1mStream(symbol);
        }

        let finalScore = 'HOLD';
        if (isOnHotlist) finalScore = 'COMPRESSION';

        const isBreakout = lastCandle.close > lastBB.upper;
        if (isBreakout && !wasInSqueeze) {
            finalScore = 'FAKE_BREAKOUT';
        }

        const cooldownInfo = botState.recentlyLostSymbols.get(symbol);
        if (cooldownInfo && Date.now() < cooldownInfo.until) {
            finalScore = 'COOLDOWN';
        }

        const conditions = {
            trend: isTrendOK,
            squeeze: wasInSqueeze,
            safety: pairToUpdate.rsi_1h !== undefined && pairToUpdate.rsi_1h < this.settings.RSI_OVERBOUGHT_THRESHOLD,
            breakout: isBreakout,
            volume: volumeConditionMet,
        };
        const conditionsMetCount = Object.values(conditions).filter(Boolean).length;
        pairToUpdate.conditions = conditions;
        pairToUpdate.conditions_met_count = conditionsMetCount;
        pairToUpdate.score_value = (conditionsMetCount / 5) * 100;
        pairToUpdate.score = finalScore;

        if (pairToUpdate.score !== old_score || pairToUpdate.is_on_hotlist !== old_hotlist_status) {
            broadcast({ type: 'SCANNER_UPDATE', payload: pairToUpdate });
        }
    }
    
    // Phase 2: 1m analysis to find the precision entry for pairs on the Hotlist
    analyze1mIndicators(symbol, kline) {
        const pair = botState.scannerCache.find(p => p.symbol === symbol);
        if (!pair || !pair.is_on_hotlist) return;

        const klines1m = this.klineData.get(symbol)?.get('1m');
        if (!klines1m || klines1m.length < 21) return; // Need enough for EMA and avg volume

        const closes1m = klines1m.map(k => k.close);
        const volumes1m = klines1m.map(k => k.volume);

        const lastEma9 = EMA.calculate({ period: 9, values: closes1m }).pop();
        const avgVolume = volumes1m.slice(-21, -1).reduce((sum, v) => sum + v, 0) / 20;

        if (lastEma9 === undefined) return;
        
        const triggerCandle = klines1m[klines1m.length - 1];
        const isEntrySignal = triggerCandle.close > lastEma9 && triggerCandle.volume > avgVolume * 1.5;

        if (isEntrySignal) {
            this.log('TRADE', `[1m TRIGGER] Precision entry signal detected for ${symbol}!`);
            pair.score = 'STRONG BUY'; // Update score to reflect the trigger
            broadcast({ type: 'SCANNER_UPDATE', payload: pair });
            
            const tradeOpened = tradingEngine.evaluateAndOpenTrade(pair, triggerCandle.low);
            
            // Once triggered, remove from hotlist to prevent re-entry ONLY if trade was successful
            if (tradeOpened) {
                pair.is_on_hotlist = false;
                removeSymbolFrom1mStream(symbol);
                broadcast({ type: 'SCANNER_UPDATE', payload: pair });
            }
        }
    }


    async hydrateSymbol(symbol, interval = '15m') {
        const klineLimit = interval === '1m' ? 50 : 201;
        if (this.hydrating.has(`${symbol}-${interval}`)) return;
        this.hydrating.add(`${symbol}-${interval}`);
        this.log('INFO', `[Analyzer] Hydrating ${interval} klines for: ${symbol}`);
        try {
            const klines = await scanner.fetchKlinesFromBinance(symbol, interval, 0, klineLimit);
            if (klines.length === 0) throw new Error(`No ${interval} klines fetched.`);
            const formattedKlines = klines.map(k => ({
                openTime: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
                low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
                closeTime: k[6],
            }));

            if (!this.klineData.has(symbol)) this.klineData.set(symbol, new Map());
            this.klineData.get(symbol).set(interval, formattedKlines);
            
            if (interval === '15m') this.analyze15mIndicators(symbol);

        } catch (error) {
            this.log('ERROR', `Failed to hydrate ${symbol} (${interval}): ${error.message}`);
        } finally {
            this.hydrating.delete(`${symbol}-${interval}`);
        }
    }

    handleNewKline(symbol, interval, kline) {
        log('BINANCE_WS', `[${interval} KLINE] Received for ${symbol}. Close: ${kline.close}`);
        if (!this.klineData.has(symbol) || !this.klineData.get(symbol).has(interval)) {
            this.hydrateSymbol(symbol, interval);
            return;
        }

        const klines = this.klineData.get(symbol).get(interval);
        klines.push(kline);
        if (klines.length > 201) klines.shift();
        
        if (interval === '15m') {
            this.analyze15mIndicators(symbol);
        } else if (interval === '1m') {
            this.analyze1mIndicators(symbol, kline);
        }
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
                if (kline.x) { // is closed kline
                     const formattedKline = {
                        openTime: kline.t, open: parseFloat(kline.o), high: parseFloat(kline.h),
                        low: parseFloat(kline.l), close: parseFloat(kline.c), volume: parseFloat(kline.v),
                        closeTime: kline.T,
                    };
                    realtimeAnalyzer.handleNewKline(symbol, kline.i, formattedKline);
                }
            } else if (msg.e === '24hrTicker') {
                const symbol = msg.s;
                const newPrice = parseFloat(msg.c);

                // 1. Update the central price cache for all tickers received
                botState.priceCache.set(symbol, { price: newPrice });

                // 2. Update the scanner cache if the pair exists there (for UI display)
                const updatedPair = botState.scannerCache.find(p => p.symbol === symbol);
                if (updatedPair) {
                    const oldPrice = updatedPair.price;
                    updatedPair.price = newPrice;
                    updatedPair.priceDirection = newPrice > oldPrice ? 'up' : newPrice < oldPrice ? 'down' : (updatedPair.priceDirection || 'neutral');
                }

                // 3. Broadcast the price update for UI reactivity (positions, scanner, etc.)
                broadcast({ type: 'PRICE_UPDATE', payload: {symbol: symbol, price: newPrice } });
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

function updateBinanceSubscriptions(baseSymbols) {
    const symbolsFromScanner = new Set(baseSymbols);
    const symbolsFromPositions = new Set(botState.activePositions.map(p => p.symbol));

    // Union of both sets to ensure we get price updates for all relevant pairs
    const allSymbolsForTickers = new Set([...symbolsFromScanner, ...symbolsFromPositions]);

    const newStreams = new Set();
    
    // Ticker stream for ALL monitored symbols (scanner + positions)
    allSymbolsForTickers.forEach(s => {
        newStreams.add(`${s.toLowerCase()}@ticker`);
    });

    // 15m kline stream ONLY for pairs in the active scanner
    symbolsFromScanner.forEach(s => {
        newStreams.add(`${s.toLowerCase()}@kline_15m`);
    });
    
    // 1m kline stream ONLY for pairs on the hotlist
    botState.hotlist.forEach(s => {
        newStreams.add(`${s.toLowerCase()}@kline_1m`);
    });

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

function addSymbolTo1mStream(symbol) {
    botState.hotlist.add(symbol);
    const streamName = `${symbol.toLowerCase()}@kline_1m`;
    if (!subscribedStreams.has(streamName)) {
        subscribedStreams.add(streamName);
        if (binanceWs && binanceWs.readyState === WebSocket.OPEN) {
            binanceWs.send(JSON.stringify({ method: "SUBSCRIBE", params: [streamName], id: Date.now() }));
            log('BINANCE_WS', `Dynamically subscribed to 1m stream for ${symbol}.`);
        }
        realtimeAnalyzer.hydrateSymbol(symbol, '1m');
    }
}

function removeSymbolFrom1mStream(symbol) {
    botState.hotlist.delete(symbol);
    const streamName = `${symbol.toLowerCase()}@kline_1m`;
    if (subscribedStreams.has(streamName)) {
        subscribedStreams.delete(streamName);
        if (binanceWs && binanceWs.readyState === WebSocket.OPEN) {
            binanceWs.send(JSON.stringify({ method: "UNSUBSCRIBE", params: [streamName], id: Date.now() }));
            log('BINANCE_WS', `Dynamically unsubscribed from 1m stream for ${symbol}.`);
        }
    }
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
    hotlist: new Set(), // Symbols ready for 1m precision entry
    priceCache: new Map(), // symbol -> { price: number }
};

const scanner = new ScannerService(log, KLINE_DATA_DIR);
let scannerInterval = null;

async function runScannerCycle() {
    if (!botState.isRunning) return;
    try {
        const discoveredPairs = await scanner.runScan(botState.settings);
        if (discoveredPairs.length === 0) {
            this.log('WARN', 'No pairs found meeting volume/exclusion criteria.');
            return [];
        }
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
            await Promise.all(newPairsToHydrate.map(symbol => realtimeAnalyzer.hydrateSymbol(symbol, '15m')));
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
        if (!botState.isRunning) return false;
        const s = botState.settings;
        
        // --- RSI Safety Filter ---
        if (s.USE_RSI_SAFETY_FILTER) {
            if (pair.rsi_1h === undefined || pair.rsi_1h === null) {
                log('TRADE', `[RSI FILTER] Skipped trade for ${pair.symbol}. 1h RSI data not available.`);
                return false;
            }
            if (pair.rsi_1h >= s.RSI_OVERBOUGHT_THRESHOLD) {
                log('TRADE', `[RSI FILTER] Skipped trade for ${pair.symbol}. 1h RSI (${pair.rsi_1h.toFixed(2)}) is >= threshold (${s.RSI_OVERBOUGHT_THRESHOLD}).`);
                return false;
            }
        }

        // --- Parabolic Filter Check ---
        if (s.USE_PARABOLIC_FILTER) {
            const klines1m = realtimeAnalyzer.klineData.get(pair.symbol)?.get('1m');
            if (klines1m && klines1m.length >= s.PARABOLIC_FILTER_PERIOD_MINUTES) {
                const checkPeriodKlines = klines1m.slice(-s.PARABOLIC_FILTER_PERIOD_MINUTES);
                const startingPrice = checkPeriodKlines[0].open;
                const currentPrice = pair.price;
                const priceIncreasePct = ((currentPrice - startingPrice) / startingPrice) * 100;

                if (priceIncreasePct > s.PARABOLIC_FILTER_THRESHOLD_PCT) {
                    log('TRADE', `[PARABOLIC FILTER] Skipped trade for ${pair.symbol}. Price increased by ${priceIncreasePct.toFixed(2)}% in the last ${s.PARABOLIC_FILTER_PERIOD_MINUTES} minutes, exceeding threshold of ${s.PARABOLIC_FILTER_THRESHOLD_PCT}%.`);
                    return false; // Abort trade
                }
            }
        }
        
        const cooldownInfo = botState.recentlyLostSymbols.get(pair.symbol);
        if (cooldownInfo && Date.now() < cooldownInfo.until) {
            log('TRADE', `Skipping trade for ${pair.symbol} due to recent loss cooldown.`);
            pair.score = 'COOLDOWN'; // Ensure state reflects this
            return false;
        }

        if (botState.activePositions.length >= s.MAX_OPEN_POSITIONS) {
            log('TRADE', `Skipping trade for ${pair.symbol}: Max open positions (${s.MAX_OPEN_POSITIONS}) reached.`);
            return false;
        }

        if (botState.activePositions.some(p => p.symbol === pair.symbol)) {
            log('TRADE', `Skipping trade for ${pair.symbol}: Position already open.`);
            return false;
        }

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
            log('ERROR', `Calculated risk is zero or negative for ${pair.symbol}. SL: ${stopLoss}, Entry: ${entryPrice}. Aborting trade.`);
            return false;
        }
        
        // --- DIVISION BY ZERO PROTECTION ---
        if (!s.USE_ATR_STOP_LOSS && (!s.STOP_LOSS_PCT || s.STOP_LOSS_PCT <= 0)) {
            log('ERROR', `STOP_LOSS_PCT is zero or invalid (${s.STOP_LOSS_PCT}%) while not using ATR stop loss for ${pair.symbol}. Aborting trade.`);
            return false;
        }
        const riskRewardRatio = s.TAKE_PROFIT_PCT / s.STOP_LOSS_PCT;
        const takeProfit = entryPrice + (riskPerUnit * riskRewardRatio);

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
        return true;
    },

    monitorAndManagePositions() {
        if (!botState.isRunning) return;

        const positionsToClose = [];
        botState.activePositions.forEach(pos => {
            const priceData = botState.priceCache.get(pos.symbol);

            // If we don't have a price (e.g., connection issue), we must not assume anything.
            // We just skip this cycle for this position. The position remains managed.
            if (!priceData) {
                log('WARN', `No price data available for active position ${pos.symbol}. Skipping management check for this cycle.`);
                return;
            }

            const currentPrice = priceData.price;
            
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
            broadcast({ type: 'POSITIONS_UPDATED' });
        }
    },

    closeTrade(tradeId, exitPrice, reason = 'Manual Close') {
        const tradeIndex = botState.activePositions.findIndex(t => t.id === tradeId);
        if (tradeIndex === -1) {
            log('WARN', `Could not find trade with ID ${tradeId} to close.`);
            return null;
        }
        const [trade] = botState.activePositions.splice(tradeIndex, 1);
        
        trade.exit_price = exitPrice;
        trade.exit_time = new Date().toISOString();
        trade.status = 'CLOSED';

        const entryValue = trade.entry_price * trade.initial_quantity;
        const exitValue = exitPrice * trade.initial_quantity;
        const pnl = (exitValue - entryValue) + (trade.realized_pnl || 0);

        trade.pnl = pnl;
        trade.pnl_pct = (pnl / entryValue) * 100;

        botState.balance += entryValue + pnl;
        
        botState.tradeHistory.push(trade);
        
        if (pnl < 0 && botState.settings.LOSS_COOLDOWN_HOURS > 0) {
            const cooldownUntil = Date.now() + botState.settings.LOSS_COOLDOWN_HOURS * 60 * 60 * 1000;
            botState.recentlyLostSymbols.set(trade.symbol, { until: cooldownUntil });
            log('TRADE', `[${trade.symbol}] placed on cooldown until ${new Date(cooldownUntil).toLocaleString()}`);
        }
        
        log('TRADE', `<<< TRADE CLOSED >>> [${reason}] Closed ${trade.symbol} at $${exitPrice.toFixed(4)}. PnL: $${pnl.toFixed(2)} (${trade.pnl_pct.toFixed(2)}%)`);
        return trade;
    },
    
    executePartialSell(position, currentPrice) {
        const s = botState.settings;
        const sellQty = position.initial_quantity * (s.PARTIAL_TP_SELL_QTY_PCT / 100);
        const pnlFromSale = (currentPrice - position.entry_price) * sellQty;

        position.quantity -= sellQty;
        position.realized_pnl = (position.realized_pnl || 0) + pnlFromSale;
        position.partial_tp_hit = true;
        
        log('TRADE', `[PARTIAL TP] Sold ${s.PARTIAL_TP_SELL_QTY_PCT}% of ${position.symbol} at $${currentPrice}. Realized PnL: $${pnlFromSale.toFixed(2)}`);
        
        // This doesn't save state or broadcast, as it's part of the main loop's modifications
    }
};

// --- Main Application Loop ---
const startBot = () => {
    if (scannerInterval) clearInterval(scannerInterval);
    
    // Initial scan, then set interval
    runScannerCycle(); 
    scannerInterval = setInterval(runScannerCycle, botState.settings.SCANNER_DISCOVERY_INTERVAL_SECONDS * 1000);
    
    setInterval(() => {
        if (botState.isRunning) {
            tradingEngine.monitorAndManagePositions();
        }
    }, 1000); // Manage positions every second for high-frequency checks
    
    connectToBinanceStreams();
    log('INFO', 'Bot started. Initializing scanner and position manager...');
};

// --- API Endpoints ---
const requireAuth = (req, res, next) => {
    if (req.session && req.session.isAuthenticated) {
        next();
    } else {
        res.status(401).json({ message: 'Unauthorized' });
    }
};

// --- AUTH ---
app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    try {
        const isValid = await verifyPassword(password, botState.passwordHash);
        if (isValid) {
            req.session.isAuthenticated = true;
            res.json({ success: true, message: 'Login successful.' });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }
    } catch (error) {
        log('ERROR', `Login attempt failed: ${error.message}`);
        res.status(500).json({ success: false, message: 'Internal server error during login.' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ message: 'Could not log out.' });
        }
        res.clearCookie('connect.sid');
        res.status(204).send();
    });
});

app.get('/api/check-session', (req, res) => {
    if (req.session && req.session.isAuthenticated) {
        res.json({ isAuthenticated: true });
    } else {
        res.json({ isAuthenticated: false });
    }
});

app.post('/api/change-password', requireAuth, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ success: false, message: 'Password must be at least 8 characters long.' });
    }
    try {
        botState.passwordHash = await hashPassword(newPassword);
        await saveData('auth');
        log('INFO', 'User password has been successfully updated.');
        res.json({ success: true, message: 'Password updated successfully.' });
    } catch (error) {
        log('ERROR', `Failed to update password: ${error.message}`);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});


// --- SETTINGS ---
app.get('/api/settings', requireAuth, (req, res) => {
    res.json(botState.settings);
});

app.post('/api/settings', requireAuth, async (req, res) => {
    const oldSettings = { ...botState.settings };
    
    // Update settings in memory
    botState.settings = { ...botState.settings, ...req.body };
    
    // If virtual balance setting is changed while in VIRTUAL mode, update the current balance.
    if (botState.tradingMode === 'VIRTUAL' && botState.settings.INITIAL_VIRTUAL_BALANCE !== oldSettings.INITIAL_VIRTUAL_BALANCE) {
        botState.balance = botState.settings.INITIAL_VIRTUAL_BALANCE;
        log('INFO', `Virtual balance was adjusted to match new setting: $${botState.balance}`);
        await saveData('state'); // Persist the new balance
        // Trigger a refresh on the frontend to show the new balance.
        broadcast({ type: 'POSITIONS_UPDATED' });
    }

    await saveData('settings');
    realtimeAnalyzer.updateSettings(botState.settings);
    
    // Restart scanner interval only if the timing changed
    if (botState.settings.SCANNER_DISCOVERY_INTERVAL_SECONDS !== oldSettings.SCANNER_DISCOVERY_INTERVAL_SECONDS) {
        log('INFO', `Scanner interval updated to ${botState.settings.SCANNER_DISCOVERY_INTERVAL_SECONDS} seconds.`);
        if (scannerInterval) clearInterval(scannerInterval);
        scannerInterval = setInterval(runScannerCycle, botState.settings.SCANNER_DISCOVERY_INTERVAL_SECONDS * 1000);
    }
    
    res.json({ success: true });
});

// --- DATA & STATUS ---
app.get('/api/status', requireAuth, (req, res) => {
    res.json({
        mode: botState.tradingMode,
        balance: botState.balance,
        positions: botState.activePositions.length,
        monitored_pairs: botState.scannerCache.length,
        top_pairs: botState.scannerCache
            .sort((a, b) => (b.score_value || 0) - (a.score_value || 0))
            .slice(0, 15)
            .map(p => p.symbol),
        max_open_positions: botState.settings.MAX_OPEN_POSITIONS
    });
});

app.get('/api/positions', requireAuth, (req, res) => {
    // Augment positions with current price from scanner cache for frontend display
    const augmentedPositions = botState.activePositions.map(pos => {
        const priceData = botState.priceCache.get(pos.symbol);
        const currentPrice = priceData ? priceData.price : pos.entry_price;
        const pnl = (currentPrice - pos.entry_price) * pos.quantity;
        const entryValue = pos.entry_price * pos.quantity;
        const pnl_pct = entryValue > 0 ? (pnl / entryValue) * 100 : 0;

        return {
            ...pos,
            current_price: currentPrice,
            pnl: pnl,
            pnl_pct: pnl_pct,
        };
    });
    res.json(augmentedPositions);
});

app.get('/api/history', requireAuth, (req, res) => {
    res.json(botState.tradeHistory);
});

app.get('/api/performance-stats', requireAuth, (req, res) => {
    const total_trades = botState.tradeHistory.length;
    const winning_trades = botState.tradeHistory.filter(t => (t.pnl || 0) > 0).length;
    const losing_trades = botState.tradeHistory.filter(t => (t.pnl || 0) < 0).length;
    const total_pnl = botState.tradeHistory.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const win_rate = total_trades > 0 ? (winning_trades / total_trades) * 100 : 0;
    
    const pnlPcts = botState.tradeHistory.map(t => t.pnl_pct).filter(p => p !== undefined && p !== null);
    const avg_pnl_pct = pnlPcts.length > 0 ? pnlPcts.reduce((a, b) => a + b, 0) / pnlPcts.length : 0;

    res.json({ total_trades, winning_trades, losing_trades, total_pnl, win_rate, avg_pnl_pct });
});

app.get('/api/scanner', requireAuth, (req, res) => {
    res.json(botState.scannerCache);
});


// --- ACTIONS ---
app.post('/api/open-trade', requireAuth, (req, res) => {
    // Manual trade opening logic can be added here if needed
    res.status(501).json({ message: 'Manual trade opening not implemented.' });
});

app.post('/api/close-trade/:id', requireAuth, (req, res) => {
    const tradeId = parseInt(req.params.id, 10);
    const trade = botState.activePositions.find(t => t.id === tradeId);
    if (!trade) return res.status(404).json({ message: 'Trade not found.' });

    const priceData = botState.priceCache.get(trade.symbol);
    const exitPrice = priceData ? priceData.price : trade.entry_price;

    const closedTrade = tradingEngine.closeTrade(tradeId, exitPrice, 'Manual Close');
    if (closedTrade) {
        saveData('state');
        broadcast({ type: 'POSITIONS_UPDATED' });
        res.json(closedTrade);
    } else {
        res.status(404).json({ message: 'Trade not found during close operation.' });
    }
});

app.post('/api/clear-data', requireAuth, async (req, res) => {
    log('WARN', 'User initiated data clear. Resetting all trade history and balance.');
    botState.balance = botState.settings.INITIAL_VIRTUAL_BALANCE;
    botState.activePositions = [];
    botState.tradeHistory = [];
    botState.tradeIdCounter = 1;
    await saveData('state');
    broadcast({ type: 'POSITIONS_UPDATED' });
    res.json({ success: true });
});

// --- CONNECTION TESTS ---
app.post('/api/test-connection', requireAuth, async (req, res) => {
    // This just tests if the Binance API is reachable, not the key validity
    try {
        const response = await fetch('https://api.binance.com/api/v3/ping');
        if (response.ok) {
            res.json({ success: true, message: 'Connexion à Binance réussie !' });
        } else {
            throw new Error(`Status: ${response.status}`);
        }
    } catch (error) {
        res.status(500).json({ success: false, message: `Échec de la connexion à Binance : ${error.message}` });
    }
});


// --- BOT CONTROL ---
app.get('/api/bot/status', requireAuth, (req, res) => {
    res.json({ isRunning: botState.isRunning });
});
app.post('/api/bot/start', requireAuth, async (req, res) => {
    botState.isRunning = true;
    await saveData('state');
    log('INFO', 'Bot has been started via API.');
    res.json({ success: true });
});
app.post('/api/bot/stop', requireAuth, async (req, res) => {
    botState.isRunning = false;
    await saveData('state');
    log('INFO', 'Bot has been stopped via API.');
    res.json({ success: true });
});
app.get('/api/mode', requireAuth, (req, res) => {
    res.json({ mode: botState.tradingMode });
});
app.post('/api/mode', requireAuth, async (req, res) => {
    const { mode } = req.body;
    if (['VIRTUAL', 'REAL_PAPER', 'REAL_LIVE'].includes(mode)) {
        botState.tradingMode = mode;
        await saveData('state');
        log('INFO', `Trading mode switched to ${mode}.`);
        res.json({ success: true, mode: botState.tradingMode });
    } else {
        res.status(400).json({ success: false, message: 'Invalid mode.' });
    }
});

// --- Serve Frontend ---
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// --- Initialize and Start Server ---
(async () => {
    try {
        await loadData();
        startBot();
        server.listen(port, () => {
            log('INFO', `Server running on http://localhost:${port}`);
        });
    } catch (error) {
        log('ERROR', `Failed to initialize and start server: ${error.message}`);
        process.exit(1);
    }
})();