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
    scannerCache: [], recentlyLostSymbols: new Map(), passwordHash: '',
};
const scannerService = new ScannerService(log, KLINE_DATA_DIR);
const realtimeAnalyzer = new RealtimeAnalyzer(log);
let scannerInterval = null;
let binanceWsClient = null;


// --- Trading Engine ---
const tradingEngine = {
    async evaluateAndOpenTrade(pair) {
        if (!botState.isRunning) return;
        if (botState.activePositions.length >= botState.settings.MAX_OPEN_POSITIONS) return;
        if (botState.activePositions.some(p => p.symbol === pair.symbol)) return;

        const { settings } = botState;
        const requiredScore = settings.REQUIRE_STRONG_BUY ? 'STRONG BUY' : 'BUY';
        if (pair.score !== requiredScore && pair.score !== 'STRONG BUY') return;
        
        const cooldownInfo = botState.recentlyLostSymbols.get(pair.symbol);
        if (cooldownInfo && Date.now() < cooldownInfo.until) {
            log('TRADE', `Skipping trade for ${pair.symbol} due to recent loss cooldown.`);
            return;
        }

        log('TRADE', `Valid trade signal found for ${pair.symbol} with score ${pair.score}. Opening position...`);
        this.openPosition(pair);
    },

    async openPosition(pair) {
        const { settings } = botState;
        let positionSizePct = settings.POSITION_SIZE_PCT;
        if (settings.USE_DYNAMIC_POSITION_SIZING && pair.score === 'STRONG BUY') {
            positionSizePct = settings.STRONG_BUY_POSITION_SIZE_PCT;
        }
        const positionSizeUSD = botState.balance * (positionSizePct / 100);
        const quantity = positionSizeUSD / pair.price;

        // Calculate Stop Loss
        let stopLossPrice;
        if (settings.USE_ATR_STOP_LOSS && pair.atr_15m > 0) {
            stopLossPrice = pair.price - (pair.atr_15m * settings.ATR_MULTIPLIER);
        } else {
            stopLossPrice = pair.price * (1 - settings.STOP_LOSS_PCT / 100);
        }

        const newTrade = {
            id: botState.tradeIdCounter++,
            mode: botState.tradingMode,
            symbol: pair.symbol,
            side: 'BUY',
            entry_price: pair.price,
            quantity,
            initial_quantity: quantity,
            stop_loss: stopLossPrice,
            take_profit: pair.price * (1 + settings.TAKE_PROFIT_PCT / 100),
            highest_price_since_entry: pair.price,
            entry_time: new Date().toISOString(),
            status: 'PENDING', // Will be FILLED once executed
            pnl: 0,
            pnl_pct: 0,
            entry_snapshot: { ...pair } // Deep copy of the scanner state at entry
        };
        
        // --- TODO: REAL TRADING LOGIC ---
        // if (botState.tradingMode === 'REAL_LIVE') { ... call binance api ... }
        // For now, we simulate instant fill
        newTrade.status = 'FILLED';

        botState.activePositions.push(newTrade);
        log('TRADE', `Opened new ${botState.tradingMode} position for ${quantity.toFixed(4)} ${pair.symbol} @ $${pair.price}.`);
        
        broadcast({ type: 'POSITIONS_UPDATED' });
        await saveData('state');
    },

    monitorPositions(priceUpdate) {
        if (!botState.isRunning) return;
        botState.activePositions.forEach(pos => {
            if (pos.symbol === priceUpdate.symbol) {
                const currentPrice = priceUpdate.price;
                pos.highest_price_since_entry = Math.max(pos.highest_price_since_entry, currentPrice);

                const pnl = (currentPrice - pos.entry_price) * pos.quantity;
                const pnl_pct = (pnl / (pos.entry_price * pos.quantity)) * 100;

                // --- Risk Management Logic ---
                // 1. Trailing Stop Loss
                if (botState.settings.USE_TRAILING_STOP_LOSS) {
                    const trailingStopPrice = pos.highest_price_since_entry * (1 - botState.settings.TRAILING_STOP_LOSS_PCT / 100);
                    pos.stop_loss = Math.max(pos.stop_loss, trailingStopPrice);
                }

                // 2. Auto Break-even
                if (botState.settings.USE_AUTO_BREAKEVEN && !pos.is_at_breakeven && pnl_pct >= botState.settings.BREAKEVEN_TRIGGER_PCT) {
                    pos.stop_loss = pos.entry_price;
                    pos.is_at_breakeven = true;
                    log('TRADE', `Moved Stop Loss to break-even for ${pos.symbol}.`);
                }

                // --- Exit Condition Checks ---
                if (currentPrice <= pos.stop_loss) {
                    log('TRADE', `${pos.symbol} hit Stop Loss at $${currentPrice}. Closing position.`);
                    this.closePosition(pos.id, currentPrice, 'STOP_LOSS');
                } else if (currentPrice >= pos.take_profit) {
                    log('TRADE', `${pos.symbol} hit Take Profit at $${currentPrice}. Closing position.`);
                    this.closePosition(pos.id, currentPrice, 'TAKE_PROFIT');
                }
            }
        });
    },

    async closePosition(tradeId, exitPrice, reason = 'MANUAL') {
        const tradeIndex = botState.activePositions.findIndex(p => p.id === tradeId);
        if (tradeIndex === -1) return null;
        
        const trade = botState.activePositions[tradeIndex];
        const pnl = (exitPrice - trade.entry_price) * trade.quantity;

        const closedTrade = {
            ...trade,
            exit_price: exitPrice,
            exit_time: new Date().toISOString(),
            status: 'CLOSED',
            pnl,
            pnl_pct: (pnl / (trade.entry_price * trade.quantity)) * 100
        };

        botState.balance += pnl;
        botState.tradeHistory.push(closedTrade);
        botState.activePositions.splice(tradeIndex, 1);

        if (pnl < 0 && botState.settings.LOSS_COOLDOWN_HOURS > 0) {
            const cooldownUntil = Date.now() + botState.settings.LOSS_COOLDOWN_HOURS * 60 * 60 * 1000;
            botState.recentlyLostSymbols.set(trade.symbol, { until: cooldownUntil });
            log('TRADE', `[COOLDOWN] ${trade.symbol} is on cooldown until ${new Date(cooldownUntil).toLocaleTimeString()}`);
        }
        
        log('TRADE', `Closed position for ${trade.symbol}. Reason: ${reason}. PnL: $${pnl.toFixed(2)}.`);
        
        broadcast({ type: 'POSITIONS_UPDATED' });
        await saveData('state');
        return closedTrade;
    }
};

// --- Combined handler for Price Updates ---
const handlePriceUpdate = (priceUpdate) => {
    // 1. Monitor active positions for exits/risk management
    tradingEngine.monitorPositions(priceUpdate);

    // 2. Broadcast the price update to all connected frontend clients
    broadcast({
        type: 'PRICE_UPDATE',
        payload: priceUpdate
    });
};


// --- Binance WebSocket Client for Price and Kline Streams ---
class BinanceWsClient {
    constructor(log, onKline, onPrice) {
        this.log = log;
        this.baseUrl = 'wss://stream.binance.com:9443/stream?streams=';
        this.ws = null;
        this.subscriptions = new Set();
        this.onKline = onKline;
        this.onPrice = onPrice;
    }

    connect(symbols) {
        if (this.ws) {
            this.log('BINANCE_WS', 'Already connected. Attempting to update subscriptions...');
            this.updateSubscriptions(symbols);
            return;
        }
        if (symbols.length === 0) {
             this.log('BINANCE_WS', 'No symbols to monitor. Skipping connection.');
             return;
        }

        const streams = [];
        const timeframes = ['1m', '15m', '30m'];
        symbols.forEach(s => {
            streams.push(`${s.toLowerCase()}@aggTrade`); // Realtime price
            timeframes.forEach(tf => streams.push(`${s.toLowerCase()}@kline_${tf}`));
        });

        const url = this.baseUrl + streams.join('/');
        this.log('BINANCE_WS', `Connecting to Binance stream with ${streams.length} streams...`);
        this.ws = new WebSocket(url);

        this.ws.on('open', () => {
            this.log('BINANCE_WS', 'Successfully connected to Binance WebSocket stream.');
            this.subscriptions = new Set(streams);
        });
        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                if (message.stream.includes('@kline')) {
                    if (message.data.k.x) { // k.x is true if the kline is closed
                        const interval = message.data.k.i;
                        this.onKline(message.data, interval);
                    }
                } else if (message.stream.includes('@aggTrade')) {
                    this.onPrice({ symbol: message.data.s, price: parseFloat(message.data.p) });
                }
            } catch (error) {
                this.log('ERROR', `Failed to process Binance WS message: ${error.message}`);
            }
        });
        this.ws.on('close', () => {
            this.log('WARN', 'Binance WebSocket disconnected. Will reconnect on next cycle.');
            this.ws = null;
            this.subscriptions.clear();
        });
        this.ws.on('error', (err) => {
            this.log('ERROR', `Binance WebSocket error: ${err.message}`);
        });
    }
    
    updateSubscriptions(newSymbols) {
        const newStreams = new Set();
        const timeframes = ['1m', '15m', '30m'];
        newSymbols.forEach(s => {
            newStreams.add(`${s.toLowerCase()}@aggTrade`);
            timeframes.forEach(tf => newStreams.add(`${s.toLowerCase()}@kline_${tf}`));
        });
        
        const streamsToAdd = [...newStreams].filter(s => !this.subscriptions.has(s));
        const streamsToRemove = [...this.subscriptions].filter(s => !newStreams.has(s));

        if (streamsToAdd.length === 0 && streamsToRemove.length === 0) return;

        this.log('BINANCE_WS', `Updating subscriptions: Adding ${streamsToAdd.length}, Removing ${streamsToRemove.length}`);
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
             if (streamsToRemove.length > 0) {
                this.ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: streamsToRemove, id: 2 }));
             }
             if (streamsToAdd.length > 0) {
                 this.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: streamsToAdd, id: 1 }));
             }
            this.subscriptions = newStreams;
        } else {
             this.log('WARN', 'Cannot update subscriptions, WS not connected. Re-connecting with new symbols.');
             this.disconnect();
             this.connect(newSymbols);
        }
    }

    disconnect() {
        if (this.ws) {
            this.log('BINANCE_WS', 'Disconnecting from Binance WebSocket stream.');
            this.ws.close();
            this.ws = null;
            this.subscriptions.clear();
        }
    }
}


// --- Main Application Logic ---
const runScannerCycle = async () => {
    try {
        const analyzedPairs = await scannerService.runScan(botState.settings);
        
        const oldSymbols = new Set(botState.scannerCache.map(p => p.symbol));
        const newSymbols = new Set(analyzedPairs.map(p => p.symbol));

        // Update cache
        botState.scannerCache = analyzedPairs;

        // Hydrate kline data for newly discovered pairs
        analyzedPairs.forEach(p => {
             if (!oldSymbols.has(p.symbol)) {
                 realtimeAnalyzer.hydrateSymbol(p.symbol);
             }
        });

        // Update WebSocket subscriptions if the list of monitored pairs has changed
        if (binanceWsClient) {
            binanceWsClient.connect(Array.from(newSymbols));
        } else {
            binanceWsClient = new BinanceWsClient(log, realtimeAnalyzer.handleKline.bind(realtimeAnalyzer), handlePriceUpdate);
            binanceWsClient.connect(Array.from(newSymbols));
        }
        
    } catch (error) {
        log('ERROR', `Scanner cycle failed: ${error.message}`);
    } finally {
        const syncTime = (botState.settings.COINGECKO_SYNC_SECONDS || 60) * 1000;
        scannerInterval = setTimeout(runScannerCycle, syncTime);
    }
};

const startBot = () => {
    if (scannerInterval) clearTimeout(scannerInterval);
    log('INFO', 'Bot started. Running initial scanner cycle...');
    runScannerCycle();
    botState.isRunning = true;
    saveData('state');
    broadcast({ type: 'BOT_STATUS_UPDATE', payload: { isRunning: true } });
};

const stopBot = () => {
    if (scannerInterval) {
        clearTimeout(scannerInterval);
        scannerInterval = null;
    }
    if (binanceWsClient) {
        binanceWsClient.disconnect();
        binanceWsClient = null;
    }
    log('INFO', 'Bot stopped.');
    botState.isRunning = false;
    saveData('state');
    broadcast({ type: 'BOT_STATUS_UPDATE', payload: { isRunning: false } });
};


// --- API Routes ---
// --- Auth Middleware ---
const isAuthenticated = (req, res, next) => {
    if (req.session.isAuthenticated) {
        return next();
    }
    res.status(401).json({ message: 'Unauthorized: Please log in.' });
};

// --- PUBLIC AUTH ROUTES ---
app.post('/api/login', async (req, res) => {
    const { password } = req.body;
    if (!password) {
        return res.status(400).json({ success: false, message: 'Password is required.' });
    }
    try {
        const isValid = await verifyPassword(password, botState.passwordHash);
        if (isValid) {
            req.session.isAuthenticated = true;
            log('INFO', 'User successfully authenticated.');
            res.json({ success: true, message: 'Login successful.' });
        } else {
            log('WARN', 'Failed login attempt.');
            res.status(401).json({ success: false, message: 'Invalid password.' });
        }
    } catch (error) {
        log('ERROR', `Login process failed: ${error.message}`);
        res.status(500).json({ success: false, message: 'Internal server error during authentication.' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            log('ERROR', `Failed to destroy session: ${err.message}`);
            return res.status(500).send('Could not log out.');
        }
        res.status(204).send();
    });
});

app.get('/api/check-session', (req, res) => {
    res.json({ isAuthenticated: !!req.session.isAuthenticated });
});

// --- PROTECTED ROUTES ---
app.post('/api/change-password', isAuthenticated, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }
    try {
        botState.passwordHash = await hashPassword(newPassword);
        await saveData('auth');
        log('INFO', 'Password has been updated successfully.');
        res.json({ success: true, message: 'Password updated successfully.' });
    } catch (error) {
        log('ERROR', `Failed to change password: ${error.message}`);
        res.status(500).json({ success: false, message: 'Internal server error.' });
    }
});

// Settings
app.get('/api/settings', isAuthenticated, async (req, res) => {
    res.json(botState.settings);
});

app.post('/api/settings', isAuthenticated, async (req, res) => {
    botState.settings = { ...botState.settings, ...req.body };
    realtimeAnalyzer.updateSettings(botState.settings);
    await saveData('settings');
    log('INFO', 'Bot settings updated.');
    res.json({ success: true });
});

// Data
app.get('/api/status', isAuthenticated, (req, res) => {
    res.json({
        mode: botState.tradingMode,
        balance: botState.balance,
        positions: botState.activePositions.length,
        monitored_pairs: botState.scannerCache.length,
        top_pairs: botState.scannerCache.slice(0, 10).map(p => p.symbol),
        max_open_positions: botState.settings.MAX_OPEN_POSITIONS,
    });
});

app.get('/api/positions', isAuthenticated, (req, res) => {
    res.json(botState.activePositions);
});

app.get('/api/history', isAuthenticated, (req, res) => {
    res.json(botState.tradeHistory);
});

app.get('/api/performance-stats', isAuthenticated, (req, res) => {
    const total_trades = botState.tradeHistory.length;
    const winning_trades = botState.tradeHistory.filter(t => t.pnl > 0).length;
    const losing_trades = total_trades - winning_trades;
    const total_pnl = botState.tradeHistory.reduce((sum, t) => sum + t.pnl, 0);
    const total_pnl_pct = botState.tradeHistory.reduce((sum, t) => sum + t.pnl_pct, 0);
    
    res.json({
        total_trades,
        winning_trades,
        losing_trades,
        total_pnl,
        avg_pnl_pct: total_trades > 0 ? total_pnl_pct / total_trades : 0,
        win_rate: total_trades > 0 ? (winning_trades / total_trades) * 100 : 0,
    });
});

app.get('/api/scanner', isAuthenticated, (req, res) => {
    res.json(botState.scannerCache);
});

// Actions
app.post('/api/open-trade', isAuthenticated, async (req, res) => {
    const { symbol, price, mode } = req.body; // For manual trades if needed
    // This endpoint is less used now that the engine is automated, but good to have
    const pairData = botState.scannerCache.find(p => p.symbol === symbol);
    if (pairData) {
        await tradingEngine.openPosition(pairData);
        res.status(200).json({ success: true });
    } else {
        res.status(404).json({ success: false, message: "Pair not found in scanner cache." });
    }
});

app.post('/api/close-trade/:tradeId', isAuthenticated, async (req, res) => {
    const tradeId = parseInt(req.params.tradeId, 10);
    const trade = botState.activePositions.find(p => p.id === tradeId);
    if (!trade) return res.status(404).json({ message: "Trade not found" });

    // Fetch current price to close
    try {
        const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${trade.symbol}`);
        const data = await response.json();
        const exitPrice = parseFloat(data.price);
        const closedTrade = await tradingEngine.closePosition(tradeId, exitPrice);
        res.json(closedTrade);
    } catch (e) {
        res.status(500).json({ message: "Could not fetch current price to close trade." });
    }
});

app.post('/api/clear-data', isAuthenticated, async (req, res) => {
    botState.balance = botState.settings.INITIAL_VIRTUAL_BALANCE;
    botState.activePositions = [];
    botState.tradeHistory = [];
    botState.tradeIdCounter = 1;
    await saveData('state');
    log('WARN', 'All trade data has been cleared.');
    res.json({ success: true });
});

app.post('/api/test-connection', isAuthenticated, async (req, res) => {
    const { apiKey, secretKey } = req.body; // In a real app, use the saved ones
    // NOTE: A proper test would make a signed API call. This is a basic check.
    try {
        const response = await fetch('https://api.binance.com/api/v3/ping');
        if (response.ok) {
            res.json({ success: true, message: 'Binance API connection successful.' });
        } else {
            res.status(response.status).json({ success: false, message: 'Binance API connection failed.' });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: 'Connection test failed.' });
    }
});

app.post('/api/test-coingecko', isAuthenticated, async (req, res) => {
    const { apiKey } = req.body;
    const url = apiKey 
        ? `https://api.coingecko.com/api/v3/ping?x_cg_demo_api_key=${apiKey}`
        : 'https://api.coingecko.com/api/v3/ping';
    try {
        const response = await fetch(url);
        if (response.ok) {
            res.json({ success: true, message: 'CoinGecko API connection successful.' });
        } else {
            const data = await response.text();
            res.status(response.status).json({ success: false, message: `CoinGecko API connection failed: ${data}` });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: `Connection test failed: ${e.message}` });
    }
});

// Bot Control
app.get('/api/bot/status', isAuthenticated, (req, res) => {
    res.json({ isRunning: botState.isRunning });
});
app.post('/api/bot/start', isAuthenticated, (req, res) => {
    if (!botState.isRunning) {
        startBot();
    }
    res.json({ success: true });
});
app.post('/api/bot/stop', isAuthenticated, (req, res) => {
    if (botState.isRunning) {
        stopBot();
    }
    res.json({ success: true });
});

app.get('/api/mode', isAuthenticated, (req, res) => {
    res.json({ mode: botState.tradingMode });
});
app.post('/api/mode', isAuthenticated, async (req, res) => {
    const { mode } = req.body;
    if (['VIRTUAL', 'REAL_PAPER', 'REAL_LIVE'].includes(mode)) {
        if (botState.activePositions.length > 0) {
            return res.status(400).json({ success: false, message: 'Cannot change mode with active positions.' });
        }
        botState.tradingMode = mode;
        await saveData('state');
        log('INFO', `Trading mode changed to ${mode}`);
        res.json({ success: true, mode });
    } else {
        res.status(400).json({ success: false, message: 'Invalid mode specified.' });
    }
});

// --- Static File Serving ---
const __dirname = path.resolve();
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

// --- Start Server ---
(async () => {
    await loadData();
    if (botState.isRunning) {
        startBot();
    }
    server.listen(port, () => {
        log('INFO', `Server is running on http://localhost:${port}`);
    });
})();