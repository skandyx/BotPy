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
import { ScannerService } from './ScannerService.js';

// --- Basic Setup ---
dotenv.config();
const app = express();
const port = process.env.PORT || 8080;
const server = http.createServer(app);

app.use(cors({
    origin: '*',
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
    // This function is called when a client attempts to upgrade the connection to WebSocket.
    // We hand off the upgrade request to the WebSocket server.
    const { pathname } = new URL(request.url, `http://${request.headers.host}`);
    
    if (pathname === '/ws') {
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
            COINGECKO_SYNC_SECONDS: parseInt(process.env.COINGECKO_SYNC_SECONDS, 10) || 900,
            EXCLUDED_PAIRS: process.env.EXCLUDED_PAIRS || "USDCUSDT,FDUSDUSDT",
            USE_VOLUME_CONFIRMATION: process.env.USE_VOLUME_CONFIRMATION === 'true',
            USE_MULTI_TIMEFRAME_CONFIRMATION: process.env.USE_MULTI_TIMEFRAME_CONFIRMATION === 'true',
            USE_MARKET_REGIME_FILTER: process.env.USE_MARKET_REGIME_FILTER === 'true',
            LOSS_COOLDOWN_HOURS: parseInt(process.env.LOSS_COOLDOWN_HOURS, 10) || 4,
            BINANCE_API_KEY: process.env.BINANCE_API_KEY || '',
            BINANCE_SECRET_KEY: process.env.BINANCE_SECRET_KEY || '',
        };
        await saveData('settings');
    }
    try {
        const stateContent = await fs.readFile(STATE_FILE_PATH, 'utf-8');
        const persistedState = JSON.parse(stateContent);
        Object.assign(botState, persistedState);
    } catch {
        log("WARN", "state.json not found. Initializing default state.");
        botState.balance = botState.settings.INITIAL_VIRTUAL_BALANCE;
        await saveData('state');
    }
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
        };
        await fs.writeFile(STATE_FILE_PATH, JSON.stringify(stateToPersist, null, 2));
    }
};

// --- Bot State & Services ---
let botState = {
    settings: {},
    balance: 10000,
    activePositions: [],
    tradeHistory: [],
    tradeIdCounter: 1,
    isRunning: true,
    scannerCache: [],
    recentlyLostSymbols: new Map(),
};
const scannerService = new ScannerService(log, KLINE_DATA_DIR);

// --- Price Feeder (Connects to Binance WS) ---
const priceFeeder = {
    ws: null,
    latestPrices: new Map(),
    subscribedSymbols: new Set(),
    connect: function() {
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
        }
        if (this.subscribedSymbols.size === 0) {
            log("BINANCE_WS", "No symbols to subscribe to. Skipping connection.");
            return;
        }
        const streams = Array.from(this.subscribedSymbols).map(s => `${s.toLowerCase()}@miniTicker`).join('/');
        const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
        this.ws = new WebSocket(url);
        this.ws.on('open', () => log("BINANCE_WS", `Connected to Binance for ${this.subscribedSymbols.size} symbols.`));
        this.ws.on('message', (data) => {
            const message = JSON.parse(data.toString());
            if (message.data && message.data.e === '24hrMiniTicker') {
                const symbol = message.data.s;
                const price = parseFloat(message.data.c);
                this.latestPrices.set(symbol, price);
                broadcast({ type: 'PRICE_UPDATE', payload: { symbol, price } });
            }
        });
        this.ws.on('close', () => {
            if (this.subscribedSymbols.size > 0) {
                log('WARN', '[PriceFeeder] Disconnected from Binance. Will reconnect in 5s.');
                setTimeout(() => this.connect(), 5000);
            }
        });
        this.ws.on('error', (err) => log('ERROR', `[PriceFeeder] Error: ${err.message}`));
    },
    updateSubscriptions: function(newSymbols) {
        let needsReconnect = false;
        const newSet = new Set(newSymbols);
        if (newSet.size === 0 && this.subscribedSymbols.size > 0) {
            this.subscribedSymbols = new Set();
            if (this.ws) {
                this.ws.close();
                log("BINANCE_WS", "No active symbols. Disconnected from Binance Price Feeder.");
            }
            return;
        }
        if (newSet.size !== this.subscribedSymbols.size) {
            needsReconnect = true;
        } else {
            for (const symbol of newSet) {
                if (!this.subscribedSymbols.has(symbol)) {
                    needsReconnect = true;
                    break;
                }
            }
        }
        if (needsReconnect) {
            this.subscribedSymbols = newSet;
            log("BINANCE_WS", `Subscriptions updated with ${newSet.size} symbols. Reconnecting to Binance.`);
            this.connect();
        }
    }
};

// --- Main Scanner Loop ---
const runScannerLoop = async () => {
    log("SCANNER", "Running main scanner task...");
    try {
        const scannedPairs = await scannerService.runScan(botState.settings);
        botState.scannerCache = scannedPairs;
        const symbolsToWatch = scannedPairs.map(p => p.symbol);
        priceFeeder.updateSubscriptions(symbolsToWatch);
    } catch (error) {
        log("ERROR", `Error during scanner run: ${error.message}`);
    }
};

// --- Trading Engine ---
// ... (Trading Engine logic will be added here in a future step)
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
        // Mock logic for now
    },
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
app.get('/api/settings', isAuthenticated, (req, res) => res.json(botState.settings));
app.post('/api/settings', isAuthenticated, async (req, res) => {
    botState.settings = { ...botState.settings, ...req.body };
    await saveData('settings');
    log('INFO', 'Bot settings have been updated.');
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
app.get('/api/history', isAuthenticated, (req, res) => res.json(botState.tradeHistory));
app.get('/api/status', isAuthenticated, (req, res) => {
    res.json({
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
server.listen(port, async () => {
    await loadData();
    log('INFO', `Backend server running on http://localhost:${port}`);
    setInterval(runScannerLoop, botState.settings.COINGECKO_SYNC_SECONDS * 1000);
    await runScannerLoop();
    if (botState.isRunning) {
        tradingEngine.start();
    }
    const initialSymbols = botState.activePositions.map(p => p.symbol);
    priceFeeder.updateSubscriptions(initialSymbols);
});
