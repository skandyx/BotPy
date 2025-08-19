import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';
import crypto from 'crypto';
import { SMA, ADX } from 'technicalindicators';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import http from 'http';

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

// --- Trust proxy (Nginx) ---
app.set('trust proxy', 1);

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
const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', (ws) => {
    clients.add(ws);
    log('INFO', 'Frontend client connected.');
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
        log('INFO', 'Frontend client disconnected.');
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

const ensureDataDir = async () => {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR);
    }
};

const loadData = async () => {
    await ensureDataDir();
    try {
        // Load Settings
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
        // Load State
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
    await ensureDataDir();
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

// --- Bot State ---
let botState = {
    settings: {},
    balance: 10000,
    activePositions: [],
    tradeHistory: [],
    tradeIdCounter: 1,
    isRunning: true,
    scannerCache: { data: [], timestamp: 0 },
    recentlyLostSymbols: new Map(), // Not persisted, reset on start
};

// --- Price Feeder (Connects to Binance WS) ---
const priceFeeder = {
    ws: null,
    latestPrices: new Map(),
    subscribedSymbols: new Set(),
    connect: function() {
        if (this.ws) this.ws.close();
        
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
                // Relay to frontend
                broadcast({ type: 'PRICE_UPDATE', payload: { symbol, price } });
            }
        });
        this.ws.on('close', () => {
            log('WARN', '[PriceFeeder] Disconnected from Binance. Will reconnect in 5s.');
            setTimeout(() => this.connect(), 5000);
        });
        this.ws.on('error', (err) => log('ERROR', `[PriceFeeder] Error: ${err.message}`));
    },
    updateSubscriptions: function(newSymbols) {
        let needsReconnect = false;
        const newSet = new Set(newSymbols);
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

// --- Scanner Logic ---
const runScanner = async () => {
    log("SCANNER", "Running market scanner...");
    try {
        const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
        if (!response.ok) {
            throw new Error(`Binance API error! status: ${response.status}`);
        }
        const allTickers = await response.json();
        
        const excluded = botState.settings.EXCLUDED_PAIRS.split(',').map(p => p.trim());
        
        const filteredTickers = allTickers.filter(ticker => 
            ticker.symbol.endsWith('USDT') &&
            !excluded.includes(ticker.symbol) &&
            (parseFloat(ticker.quoteVolume) > botState.settings.MIN_VOLUME_USD)
        );

        log("SCANNER", `Found ${filteredTickers.length} pairs after volume and exclusion filters.`);

        const scannedPairs = [];
        for (const ticker of filteredTickers) {
            const klinesResponse = await fetch(`https://api.binance.com/api/v3/klines?symbol=${ticker.symbol}&interval=4h&limit=200`);
            const klines = await klinesResponse.json();

            if (klines.length < 200) continue; // Not enough data

            const closes = klines.map(k => parseFloat(k[4]));
            const highs = klines.map(k => parseFloat(k[2]));
            const lows = klines.map(k => parseFloat(k[3]));
            
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
                trend4h = lastSma50 > lastSma200 ? 'UP' : 'DOWN'; // Simplified trend based on MAs
            }

            scannedPairs.push({
                symbol: ticker.symbol,
                volume: parseFloat(ticker.quoteVolume),
                price: parseFloat(ticker.lastPrice),
                priceDirection: 'neutral',
                trend: 'NEUTRAL', // 1m trend will be calculated elsewhere
                trend_4h: trend4h,
                marketRegime: marketRegime,
                rsi: 50, // Placeholder
                adx: 0, // Placeholder
                score: 'HOLD', // Placeholder
                volatility: 0, // Placeholder
            });
        }
        
        botState.scannerCache = { data: scannedPairs, timestamp: Date.now() };
        log("SCANNER", `Scanner finished. Found ${scannedPairs.length} viable pairs.`);
        
        // Update price feeder with the new list of symbols
        const symbolsToWatch = scannedPairs.map(p => p.symbol);
        priceFeeder.updateSubscriptions(symbolsToWatch);

    } catch (error) {
        log("ERROR", `Error during scanner run: ${error.message}`);
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
        // Mock logic for now
        // await this.checkExits();
        // await this.checkEntries();
    },
    // ... other trading engine methods
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

app.get('/api/scanner', isAuthenticated, (req, res) => {
    // Add latest prices to the scanner data before sending
    const dataWithPrices = botState.scannerCache.data.map(pair => {
        const latestPrice = priceFeeder.latestPrices.get(pair.symbol);
        return {
            ...pair,
            price: latestPrice || pair.price, // Use latest price if available
        };
    });
    res.json(dataWithPrices);
});

app.get('/api/positions', isAuthenticated, (req, res) => res.json(botState.activePositions));
app.get('/api/history', isAuthenticated, (req, res) => res.json(botState.tradeHistory));

app.get('/api/status', isAuthenticated, (req, res) => {
    res.json({
        balance: botState.balance,
        positions: botState.activePositions.length,
        monitored_pairs: botState.scannerCache.data.length,
        top_pairs: botState.scannerCache.data.slice(0, 10).map(p => p.symbol),
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
app.post('/api/close-trade/:id', isAuthenticated, async (req, res) => {
    // Mock implementation
    const tradeId = parseInt(req.params.id, 10);
     const index = botState.activePositions.findIndex(t => t.id === tradeId);
    if (index === -1) return res.status(404).json({ message: 'Trade not found' });
    const [closedTrade] = botState.activePositions.splice(index, 1);
    botState.tradeHistory.push(closedTrade);
    await saveData('state');
    res.json(closedTrade);
});

app.post('/api/test-connection', isAuthenticated, async (req, res) => {
    const { apiKey, secretKey } = req.body;
    if (!apiKey || !secretKey) {
        log('WARN', 'API connection test failed: Keys not provided.');
        return res.status(400).json({ success: false, message: 'API Key and Secret Key are required.' });
    }
    log('BINANCE_API', 'Testing Binance API connection...');
    try {
        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
        
        const url = `https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'X-MBX-APIKEY': apiKey }
        });

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


// Bot Control Endpoints
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
    // Start scanner loop
    setInterval(runScanner, botState.settings.COINGECKO_SYNC_SECONDS * 1000);
    await runScanner();
    if (botState.isRunning) {
        tradingEngine.start();
    }
    const initialSymbols = botState.activePositions.map(p => p.symbol);
    priceFeeder.updateSubscriptions(initialSymbols);
});