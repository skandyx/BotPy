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
import { RSI, ADX } from 'technicalindicators';


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
            if (data.type === 'SUBSCRIBE' && Array.isArray(data.symbols)) {
                priceFeeder.updateSubscriptions(data.symbols);
            }
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
    // Log important broadcasts for debugging
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
            USE_MULTI_TIMEFRAME_CONFIRMATION: process.env.USE_MULTI_TIMEFRAME_CONFIRMATION === 'true',
            USE_MARKET_REGIME_FILTER: process.env.USE_MARKET_REGIME_FILTER === 'true',
            REQUIRE_STRONG_BUY: process.env.REQUIRE_STRONG_BUY === 'true',
            LOSS_COOLDOWN_HOURS: parseInt(process.env.LOSS_COOLDOWN_HOURS, 10) || 4,
            BINANCE_API_KEY: process.env.BINANCE_API_KEY || '',
            BINANCE_SECRET_KEY: process.env.BINANCE_SECRET_KEY || '',
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
    // After loading settings, update services that depend on them.
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
        this.klineData = new Map();
        this.hydrating = new Set(); // Prevents multiple simultaneous fetches for the same symbol
    }

    updateSettings(newSettings) {
        this.log('INFO', '[Analyzer] Settings updated.');
        this.settings = newSettings;
    }

    async _hydrateKlines(symbol) {
        if (this.hydrating.has(symbol)) return; // Already fetching
        this.hydrating.add(symbol);
        this.log('INFO', `[Analyzer] Hydrating initial 1m kline data for ${symbol}...`);
        try {
            const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=100`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Binance API error: ${response.statusText}`);
            const klines = await response.json();
            if (!Array.isArray(klines)) throw new Error('Invalid response from Binance');

            const formattedKlines = klines.map(k => ({
                close: parseFloat(k[4]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                volume: parseFloat(k[5]),
            }));
            
            this.klineData.set(symbol, formattedKlines);
            this.log('INFO', `[Analyzer] Successfully hydrated ${symbol} with ${formattedKlines.length} klines.`);
        } catch (error) {
            this.log('ERROR', `[Analyzer] Failed to hydrate klines for ${symbol}: ${error.message}`);
            // Set an empty array to prevent re-fetching on every tick
            this.klineData.set(symbol, []); 
        } finally {
            this.hydrating.delete(symbol);
        }
    }

    async handleKline(klineMsg) {
        if (!this.settings || Object.keys(this.settings).length === 0) return;

        const symbol = klineMsg.s;
        
        // Hydrate historical data if this is the first time we see this symbol
        if (!this.klineData.has(symbol)) {
            await this._hydrateKlines(symbol);
        }

        const k = klineMsg.k;
        const pairToUpdate = botState.scannerCache.find(p => p.symbol === symbol);
        if (!pairToUpdate) return;

        const newKline = {
            close: parseFloat(k.c),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            volume: parseFloat(k.v),
        };

        const existingKlines = this.klineData.get(symbol) || [];
        existingKlines.push(newKline);
        if (existingKlines.length > 100) existingKlines.shift();
        this.klineData.set(symbol, existingKlines);
        
        if (existingKlines.length < 20) return; // Not enough data yet

        const closes = existingKlines.map(d => d.close);
        const highs = existingKlines.map(d => d.high);
        const lows = existingKlines.map(d => d.low);
        const volumes = existingKlines.map(d => d.volume);

        const stdDev = this.calculateStdDev(closes);
        const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
        const volatility = avgPrice > 0 ? (stdDev / avgPrice) * 100 : 0;

        let isVolumeConfirmed = !this.settings.USE_VOLUME_CONFIRMATION;
        if (this.settings.USE_VOLUME_CONFIRMATION) {
             if (volumes.length >= 20) {
                const volumeMA20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
                isVolumeConfirmed = newKline.volume >= volumeMA20;
            } else {
                isVolumeConfirmed = false;
            }
        }

        const rsiResult = RSI.calculate({ values: closes, period: 14 });
        const adxResult = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });

        const rsi = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : 50;
        const adx = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 20;

        const sma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        
        let trend = 'NEUTRAL';
        if (adx > 25) {
            trend = newKline.close > sma20 ? 'UP' : 'DOWN';
        }

        // --- SCORING LOGIC WITH MASTER FILTERS ---
        let score = 'HOLD';
        
        const isMarketRegimeOk = !this.settings.USE_MARKET_REGIME_FILTER || pairToUpdate.marketRegime === 'UPTREND';
        const isLongTermTrendConfirmed = !this.settings.USE_MULTI_TIMEFRAME_CONFIRMATION || pairToUpdate.trend_4h === 'UP';

        const hasStrongBuyConditions = isMarketRegimeOk && isLongTermTrendConfirmed && trend === 'UP' && volatility >= this.settings.MIN_VOLATILITY_PCT && isVolumeConfirmed;
        
        // The 'STRONG BUY' score is now much stricter and does not depend on user settings for MTF/Regime.
        const isTrueStrongBuy = pairToUpdate.marketRegime === 'UPTREND' && pairToUpdate.trend_4h === 'UP' && hasStrongBuyConditions;

        if (isTrueStrongBuy) {
            if (rsi > 50 && rsi < 70) {
                score = 'STRONG BUY';
            } else if (rsi > 50) {
                score = 'BUY'; // It's still a very strong setup, just less "perfect" on RSI.
            }
        } else if (hasStrongBuyConditions) { // Check for a normal 'BUY' based on user settings
            if (rsi > 50) {
                score = 'BUY';
            }
        }
        
        // Check for loss cooldown override.
        if (score === 'BUY' || score === 'STRONG BUY') {
            const cooldownInfo = botState.recentlyLostSymbols.get(symbol);
            if (cooldownInfo && Date.now() < cooldownInfo.until) {
                score = 'COOLDOWN';
            }
        }

        pairToUpdate.rsi = rsi;
        pairToUpdate.adx = adx;
        pairToUpdate.trend = trend;
        pairToUpdate.score = score;
        pairToUpdate.volatility = volatility;
        
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
    settings: {},
    balance: 10000,
    activePositions: [],
    tradeHistory: [],
    tradeIdCounter: 1,
    isRunning: true,
    tradingMode: 'VIRTUAL',
    scannerCache: [], // This will now hold real-time data
    recentlyLostSymbols: new Map(),
};
const scannerService = new ScannerService(log, KLINE_DATA_DIR);
const realtimeAnalyzer = new RealtimeAnalyzer(log);

const createBinanceFeeder = (id, streamBuilder) => ({
    ws: null,
    id,
    subscribedSymbols: new Set(),
    connect: function() {
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
        }
        if (this.subscribedSymbols.size === 0) {
            log("BINANCE_WS", `[${this.id}] No symbols to subscribe to. Skipping connection.`);
            return;
        }
        const streams = Array.from(this.subscribedSymbols).map(streamBuilder).join('/');
        const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
        this.ws = new WebSocket(url);
        this.ws.on('open', () => log("BINANCE_WS", `[${this.id}] Connected for ${this.subscribedSymbols.size} symbols.`));
        this.ws.on('message', this.handleMessage.bind(this));
        this.ws.on('close', () => {
            if (this.subscribedSymbols.size > 0) {
                log('WARN', `[${this.id}] Disconnected from Binance. Will reconnect in 5s.`);
                setTimeout(() => this.connect(), 5000);
            }
        });
        this.ws.on('error', (err) => log('ERROR', `[${this.id}] Error: ${err.message}`));
    },
    updateSubscriptions: function(newSymbols) {
        const newSet = new Set(newSymbols);
        if (newSet.size === this.subscribedSymbols.size && [...newSet].every(symbol => this.subscribedSymbols.has(symbol))) {
            return; // No change in subscriptions
        }

        this.subscribedSymbols = newSet;
        if (newSet.size === 0) {
            if (this.ws) this.ws.close();
            log("BINANCE_WS", `[${this.id}] No active symbols. Disconnected.`);
            return;
        }
        log("BINANCE_WS", `[${this.id}] Subscriptions updated with ${newSet.size} symbols. Reconnecting.`);
        this.connect();
    },
});


const priceFeeder = {
    ...createBinanceFeeder('PriceTicker', (s) => `${s.toLowerCase()}@miniTicker`),
    latestPrices: new Map(),
    handleMessage: function(data) {
        const message = JSON.parse(data.toString());
        if (message.data && message.data.e === '24hrMiniTicker') {
            const symbol = message.data.s;
            const price = parseFloat(message.data.c);
            this.latestPrices.set(symbol, price);
            broadcast({ type: 'PRICE_UPDATE', payload: { symbol, price } });
        }
    }
};

const klineFeeder = {
    ...createBinanceFeeder('KlineFeeder', (s) => `${s.toLowerCase()}@kline_1m`),
    handleMessage: async function(data) {
        const message = JSON.parse(data.toString());
        if (message.data && message.data.e === 'kline') {
            const kline = message.data;
            if (kline.k.x) { // Is candle closed?
                log('BINANCE_WS', `1m Kline closed for ${kline.s}: C=${kline.k.c} V=${kline.k.v}`);
                await realtimeAnalyzer.handleKline(kline);
            }
        }
    }
};


// --- Main Scanner Loop ---
const runScannerLoop = async () => {
    log("SCANNER", "Starting new market scan cycle...");
    try {
        const newScannedPairs = await scannerService.runScan(botState.settings);

        // Create maps for efficient merging
        const newPairsMap = new Map(newScannedPairs.map(p => [p.symbol, p]));
        const currentCacheMap = new Map(botState.scannerCache.map(p => [p.symbol, p]));
        const mergedCache = [];

        // Iterate over the new list of pairs from the scan
        for (const [symbol, newPair] of newPairsMap.entries()) {
            const existingPair = currentCacheMap.get(symbol);
            if (existingPair) {
                // Pair already exists. Merge data.
                // Keep the real-time data from the existing pair (rsi, adx, price, score, etc.)
                // and update it with the long-term data from the new scan.
                existingPair.trend_4h = newPair.trend_4h;
                existingPair.marketRegime = newPair.marketRegime;
                existingPair.volume = newPair.volume; // Volume also updates periodically
                mergedCache.push(existingPair);
            } else {
                // This is a brand new pair that wasn't in the cache before.
                mergedCache.push(newPair);
            }
        }
        
        botState.scannerCache = mergedCache;
        log("SCANNER", `Market scan finished. Merged results. Now monitoring ${botState.scannerCache.length} pairs.`);

        const symbolsToWatch = new Set([...botState.scannerCache.map(p => p.symbol), ...botState.activePositions.map(p => p.symbol)]);
        const symbolsArray = Array.from(symbolsToWatch);
        priceFeeder.updateSubscriptions(symbolsArray);
        klineFeeder.updateSubscriptions(symbolsArray);

    } catch (error) {
        log("ERROR", `Error during scanner run: ${error.message}. Maintaining previous state.`);
        // Do not clear scannerCache on error, preserving the last known good state.
    }
};

// --- Trading Engine ---
const tradingEngine = {
    interval: null,
    tradedSymbolsThisCandle: new Set(),
    currentCandleTimestamp: null,
    start: function() {
        if (this.interval) return;
        log('TRADE', 'Trading Engine starting...');
        botState.isRunning = true;
        this.interval = setInterval(this.tick.bind(this), 5000); // Check every 5 seconds
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

        // Anti-Churn: Track the current 1-minute candle
        const now = new Date();
        const candleTimestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).getTime();
        if (this.currentCandleTimestamp !== candleTimestamp) {
            this.tradedSymbolsThisCandle.clear();
            this.currentCandleTimestamp = candleTimestamp;
        }

        // 1. Manage existing positions
        for (const position of [...botState.activePositions]) {
            const currentPrice = priceFeeder.latestPrices.get(position.symbol);
            if (!currentPrice) continue;

            const pnl = (currentPrice - position.entry_price) * position.quantity;
            const entryValue = position.entry_price * position.quantity;
            const pnl_pct = entryValue !== 0 ? (pnl / entryValue) * 100 : 0;
            
            position.current_price = currentPrice;
            position.pnl = pnl;
            position.pnl_pct = pnl_pct;

            if (currentPrice > position.highest_price_since_entry) {
                position.highest_price_since_entry = currentPrice;
                positionsWereUpdated = true;
                if (botState.settings.USE_TRAILING_STOP_LOSS) {
                    const newStopLoss = currentPrice * (1 - botState.settings.TRAILING_STOP_LOSS_PCT / 100);
                    if (newStopLoss > position.stop_loss) {
                        position.stop_loss = newStopLoss;
                        log('TRADE', `Trailing Stop Loss for ${position.symbol} updated to ${newStopLoss.toFixed(4)}`);
                    }
                }
            }

            // --- EXIT LOGIC ---
            if (botState.settings.USE_TRAILING_STOP_LOSS) {
                if (currentPrice <= position.stop_loss) {
                    this.closeTrade(position.id, currentPrice, 'Trailing Stop Loss hit');
                    continue;
                }
            } else {
                if (currentPrice >= position.take_profit) {
                    this.closeTrade(position.id, currentPrice, 'Take Profit hit');
                    continue;
                }
                if (currentPrice <= position.stop_loss) {
                    this.closeTrade(position.id, currentPrice, 'Stop Loss hit');
                    continue;
                }
            }
        }

        if (positionsWereUpdated) {
            await saveData('state');
            broadcast({ type: 'POSITIONS_UPDATED' });
        }
        
        // 2. Look for new positions
        if (botState.activePositions.length >= botState.settings.MAX_OPEN_POSITIONS) {
            return;
        }

        for (const pair of botState.scannerCache) {
            const isStrongBuyRequired = botState.settings.REQUIRE_STRONG_BUY;
            const isBuySignal = pair.score === 'BUY';
            const isStrongBuySignal = pair.score === 'STRONG BUY';
            
            if (isStrongBuySignal || (!isStrongBuyRequired && isBuySignal)) {
                const alreadyInPosition = botState.activePositions.some(p => p.symbol === pair.symbol);
                if (alreadyInPosition) continue;
                
                // Anti-Churn Rule: Only one trade per symbol per 1-minute candle
                if (this.tradedSymbolsThisCandle.has(pair.symbol)) continue;

                const cooldownInfo = botState.recentlyLostSymbols.get(pair.symbol);
                if (cooldownInfo && Date.now() < cooldownInfo.until) {
                    continue;
                }

                this.openTrade(pair);

                if (botState.activePositions.length >= botState.settings.MAX_OPEN_POSITIONS) {
                    break;
                }
            }
        }
    },
    openTrade: function(pair) {
        const { settings, balance, tradingMode } = botState;
        const currentPrice = priceFeeder.latestPrices.get(pair.symbol);
        if (!currentPrice) {
            log('WARN', `Cannot open trade for ${pair.symbol}, latest price not available.`);
            return;
        }

        const positionSizeUSD = balance * (settings.POSITION_SIZE_PCT / 100);
        const quantity = positionSizeUSD / currentPrice;
        
        const entryPrice = currentPrice * (1 + settings.SLIPPAGE_PCT / 100);
        const cost = entryPrice * quantity;
        
        if (balance < cost) {
            log('WARN', `Insufficient balance to open trade for ${pair.symbol}.`);
            return;
        }

        botState.balance -= cost;
        const newTrade = {
            id: botState.tradeIdCounter++,
            mode: tradingMode,
            symbol: pair.symbol,
            side: 'BUY',
            entry_price: entryPrice,
            quantity: quantity,
            stop_loss: entryPrice * (1 - settings.STOP_LOSS_PCT / 100),
            take_profit: entryPrice * (1 + settings.TAKE_PROFIT_PCT / 100),
            highest_price_since_entry: entryPrice,
            entry_time: new Date().toISOString(),
            status: 'FILLED',
        };
        botState.activePositions.push(newTrade);
        this.tradedSymbolsThisCandle.add(newTrade.symbol); // Register trade for this candle

        priceFeeder.updateSubscriptions([...priceFeeder.subscribedSymbols, newTrade.symbol]);
        
        log('TRADE', `OPENED LONG: ${pair.symbol} | Qty: ${quantity.toFixed(4)} @ ${entryPrice.toFixed(4)} | Value: $${cost.toFixed(2)}`);
        saveData('state');
        broadcast({ type: 'POSITIONS_UPDATED' });
    },
    closeTrade: function(tradeId, exitPrice, reason) {
        const tradeIndex = botState.activePositions.findIndex(t => t.id === tradeId);
        if (tradeIndex === -1) return null;

        const trade = botState.activePositions[tradeIndex];
        const exitValue = exitPrice * trade.quantity;
        const entryValue = trade.entry_price * trade.quantity;
        const pnl = exitValue - entryValue;

        botState.balance += exitValue;

        trade.exit_price = exitPrice;
        trade.exit_time = new Date().toISOString();
        trade.status = 'CLOSED';
        trade.pnl = pnl;
        trade.pnl_pct = (pnl / entryValue) * 100;
        
        botState.tradeHistory.push(trade);
        botState.activePositions.splice(tradeIndex, 1);

        if (pnl < 0 && botState.settings.LOSS_COOLDOWN_HOURS > 0) {
            const cooldownUntil = Date.now() + botState.settings.LOSS_COOLDOWN_HOURS * 60 * 60 * 1000;
            botState.recentlyLostSymbols.set(trade.symbol, { until: cooldownUntil });
            log('TRADE', `${trade.symbol} is on cooldown until ${new Date(cooldownUntil).toLocaleTimeString()} due to loss.`);
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

app.get('/api/mode', isAuthenticated, (req, res) => {
    res.json({ mode: botState.tradingMode });
});
app.post('/api/mode', isAuthenticated, async (req, res) => {
    const { mode } = req.body;
    if (mode && ['VIRTUAL', 'REAL_PAPER', 'REAL_LIVE'].includes(mode)) {
        botState.tradingMode = mode;
        await saveData('state');
        log('INFO', `Trading mode switched to ${mode}`);
        res.json({ success: true, mode: botState.tradingMode });
    } else {
        res.status(400).json({ success: false, message: 'Invalid trading mode specified.' });
    }
});

app.get('/api/settings', isAuthenticated, (req, res) => res.json(botState.settings));
app.post('/api/settings', isAuthenticated, async (req, res) => {
    const oldSyncSeconds = botState.settings.COINGECKO_SYNC_SECONDS;
    botState.settings = { ...botState.settings, ...req.body };
    realtimeAnalyzer.updateSettings(botState.settings); // Update the analyzer with new settings
    await saveData('settings');
    log('INFO', 'Bot settings have been updated.');
    
    // Trigger an immediate scan after saving settings
    runScannerLoop();

    // If sync interval changed, we need to restart the scanner loop
    if (oldSyncSeconds !== botState.settings.COINGECKO_SYNC_SECONDS) {
        log('INFO', 'Scanner interval updated. Restarting scanner loop.');
        clearInterval(scannerInterval);
        scannerInterval = setInterval(runScannerLoop, botState.settings.COINGECKO_SYNC_SECONDS * 1000);
    }
    res.json({ success: true });
});
app.post('/api/clear-data', isAuthenticated, async (req, res) => {
    log('WARN', 'Clearing all trade data and kline history...');
    botState.activePositions = [];
    botState.tradeHistory = [];
    botState.balance = botState.settings.INITIAL_VIRTUAL_BALANCE;
    botState.tradeIdCounter = 1;
    await saveData('state');
    try {
        await fs.rm(KLINE_DATA_DIR, { recursive: true, force: true });
        await fs.mkdir(KLINE_DATA_DIR);
        log('INFO', 'Kline data directory cleared.');
    } catch (error) {
        log('ERROR', `Could not clear kline data directory: ${error.message}`);
    }
    res.json({ success: true, message: 'All trade data cleared.' });
});
app.get('/api/scanner', isAuthenticated, (req, res) => {
    const dataWithPrices = botState.scannerCache.map(pair => {
        const latestPrice = priceFeeder.latestPrices.get(pair.symbol);
        return { ...pair, price: latestPrice || pair.price };
    });
    res.json(dataWithPrices);
});
app.get('/api/positions', isAuthenticated, (req, res) => res.json(botState.activePositions));
app.post('/api/close-trade/:tradeId', isAuthenticated, (req, res) => {
    const tradeId = parseInt(req.params.tradeId, 10);
    const position = botState.activePositions.find(p => p.id === tradeId);
    if (!position) {
        return res.status(404).json({ success: false, message: 'Position not found' });
    }
    const currentPrice = priceFeeder.latestPrices.get(position.symbol) || position.entry_price;
    const closedTrade = tradingEngine.closeTrade(tradeId, currentPrice, 'Manual Close');
    if (closedTrade) {
        res.json(closedTrade);
    } else {
        res.status(500).json({ success: false, message: 'Failed to close trade' });
    }
});
app.get('/api/history', isAuthenticated, (req, res) => res.json(botState.tradeHistory));
app.get('/api/status', isAuthenticated, (req, res) => {
    res.json({
        mode: botState.tradingMode,
        balance: botState.balance,
        positions: botState.activePositions.length,
        monitored_pairs: botState.scannerCache.length,
        top_pairs: botState.scannerCache.slice(0, 10).map(p => p.symbol),
        max_open_positions: botState.settings.MAX_OPEN_POSITIONS
    });
});
app.get('/api/performance-stats', isAuthenticated, (req, res) => {
    const winning_trades = botState.tradeHistory.filter(t => (t.pnl || 0) > 0).length;
    const total_pnl = botState.tradeHistory.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalTrades = botState.tradeHistory.length;
    res.json({
        total_trades: totalTrades,
        winning_trades,
        losing_trades: totalTrades - winning_trades,
        total_pnl,
        win_rate: totalTrades > 0 ? (winning_trades / totalTrades) * 100 : 0,
    });
});
app.post('/api/test-connection', isAuthenticated, async (req, res) => {
    const { apiKey, secretKey } = req.body;
    if (!apiKey || !secretKey) {
        return res.status(400).json({ success: false, message: 'API Key and Secret Key are required.' });
    }
    log('BINANCE_API', 'Testing Binance API connection...');
    try {
        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
        const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;
        const response = await fetch(url, { headers: { 'X-MBX-APIKEY': apiKey } });
        const data = await response.json();
        if (response.ok) {
            log('BINANCE_API', 'Binance API connection successful!');
            res.json({ success: true, message: 'Connection successful!' });
        } else {
            log('ERROR', `Binance API Error: ${data.msg} (Code: ${data.code})`);
            res.status(response.status).json({ success: false, message: `Binance API Error: ${data.msg} (Code: ${data.code})` });
        }
    } catch (error) {
        log("ERROR", `Test connection failed: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to connect to Binance API.' });
    }
});
app.post('/api/test-coingecko', isAuthenticated, async (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) {
        return res.status(400).json({ success: false, message: 'CoinGecko API Key is required.' });
    }
    log('COINGECKO', 'Testing CoinGecko API connection...');
    try {
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&x_cg_demo_api_key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        if (response.ok && data.bitcoin && data.bitcoin.usd) {
            log('COINGECKO', 'CoinGecko API connection successful!');
            res.json({ success: true, message: 'CoinGecko API connection successful!' });
        } else {
            const errorMessage = data.error || `Received status ${response.status}. Invalid key or API issue.`;
            log('ERROR', `CoinGecko API Error: ${errorMessage}`);
            res.status(response.status).json({ success: false, message: `CoinGecko API Error: ${errorMessage}` });
        }
    } catch (error) {
        log("ERROR", `CoinGecko test connection failed: ${error.message}`);
        res.status(500).json({ success: false, message: 'Failed to connect to CoinGecko API.' });
    }
});
app.get('/api/bot/status', isAuthenticated, (req, res) => res.json({ isRunning: botState.isRunning }));
app.post('/api/bot/start', isAuthenticated, (req, res) => {
    tradingEngine.start();
    res.json({ success: true, message: 'Bot started' });
});
app.post('/api/bot/stop', isAuthenticated, (req, res) => {
    tradingEngine.stop();
    res.json({ success: true, message: 'Bot stopped' });
});

// --- Startup ---
let scannerInterval;
const startServer = async () => {
    await loadData();
    log('INFO', `Backend server running on http://localhost:${port}`);
    scannerInterval = setInterval(runScannerLoop, botState.settings.COINGECKO_SYNC_SECONDS * 1000);
    await runScannerLoop();
    if (botState.isRunning) {
        tradingEngine.start();
    }
};

server.listen(port, () => {
    startServer().catch(err => {
        log('ERROR', `FATAL: Server failed to start: ${err.stack}`);
        process.exit(1);
    });
});