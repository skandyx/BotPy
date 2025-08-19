import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';

// --- Basic Setup ---
dotenv.config();
const app = express();
const port = process.env.PORT || 8080;

app.use(cors({
    origin: '*', // In production, you might want to restrict this to your frontend's domain
    credentials: true,
}));
app.use(bodyParser.json());

// --- Session Management (Replaces JWT) ---
app.use(session({
    secret: process.env.APP_PASSWORD || 'default_session_secret', // Use a strong secret
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true if you're using HTTPS
}));

// --- Mock Backend State ---
const SETTINGS_FILE_PATH = path.join(process.cwd(), 'settings.json');
let settings = {};
let activePositions = [];
let tradeHistory = [];
let balance = 10000;
let tradeIdCounter = 1;

// --- Helper Functions ---
const loadSettings = async () => {
    try {
        const fileContent = await fs.readFile(SETTINGS_FILE_PATH, 'utf-8');
        settings = JSON.parse(fileContent);
        console.log("Settings loaded from settings.json");
    } catch (error) {
        console.log("settings.json not found. Loading from .env defaults.");
        settings = {
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
        await saveSettings();
    }
    balance = settings.INITIAL_VIRTUAL_BALANCE;
};

const saveSettings = async () => {
    try {
        await fs.writeFile(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2));
        console.log("Settings saved to settings.json");
    } catch (error) {
        console.error("Failed to save settings.json:", error);
    }
};

// --- Auth Middleware ---
const isAuthenticated = (req, res, next) => {
    if (req.session.isAuthenticated) {
        return next();
    }
    res.status(401).json({ message: 'Unauthorized' });
};

// --- API Endpoints ---
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.APP_PASSWORD) {
        req.session.isAuthenticated = true;
        res.json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true, message: 'Logged out' });
});

app.get('/api/check-session', (req, res) => {
    res.json({ isAuthenticated: !!req.session.isAuthenticated });
});

app.post('/api/change-password', isAuthenticated, async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }
    // This is NOT secure for production. It's a placeholder.
    // Changing .env requires restarting the process.
    console.warn("SECURITY WARNING: Password change requested. In a production environment, this should be handled securely and the process should be restarted to load the new .env value.");
    res.json({ success: true, message: 'Password change endpoint reached. NOTE: For this version, password must be changed manually in the .env file and the server restarted.' });
});

app.get('/api/settings', isAuthenticated, (req, res) => res.json(settings));
app.post('/api/settings', isAuthenticated, async (req, res) => {
    settings = { ...settings, ...req.body };
    await saveSettings();
    res.json({ success: true });
});

app.get('/api/status', isAuthenticated, (req, res) => {
    // This should be dynamic from the real trading engine in the future
    res.json({
        balance,
        positions: activePositions.length,
        monitored_pairs: 0, 
        top_pairs: [],
        max_open_positions: settings.MAX_OPEN_POSITIONS
    });
});

app.get('/api/positions', isAuthenticated, (req, res) => res.json(activePositions));
app.get('/api/history', isAuthenticated, (req, res) => res.json(tradeHistory));

app.post('/api/clear-data', isAuthenticated, async (req, res) => {
    await loadSettings(); 
    activePositions = [];
    tradeHistory = [];
    balance = settings.INITIAL_VIRTUAL_BALANCE;
    tradeIdCounter = 1;
    console.log(`Trade data cleared. Balance reset to ${balance}`);
    res.json({ success: true });
});

// Mock scanner for now
app.get('/api/scanner', isAuthenticated, (req, res) => {
    res.json([]);
});

app.get('/api/performance-stats', isAuthenticated, (req, res) => {
    const winning_trades = tradeHistory.filter(t => (t.pnl || 0) > 0).length;
    const total_pnl = tradeHistory.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalTrades = tradeHistory.length;
    res.json({
        total_trades: totalTrades,
        winning_trades,
        losing_trades: totalTrades - winning_trades,
        total_pnl,
        win_rate: totalTrades > 0 ? (winning_trades / totalTrades) * 100 : 0,
    });
});


// MOCK Trade execution
app.post('/api/open-trade', isAuthenticated, (req, res) => {
    const { symbol, price, mode } = req.body;
    
    if (!symbol || typeof price !== 'number' || !mode) {
        return res.status(400).json({ message: 'Missing required parameters for opening a trade.' });
    }

    const positionSize = balance * (settings.POSITION_SIZE_PCT / 100);

    if (positionSize > balance) {
        return res.status(400).json({ message: 'Insufficient balance to open trade.' });
    }

    const quantity = positionSize / price;
    
    // Simulate slippage for entry price
    const entryPriceWithSlippage = price * (1 + (settings.SLIPPAGE_PCT / 100));

    balance -= positionSize; // Deduct capital for the new position

    const newTrade = {
        id: tradeIdCounter++,
        mode: mode,
        symbol: symbol,
        side: 'BUY', // Strategy is long-only for now
        entry_price: entryPriceWithSlippage,
        current_price: entryPriceWithSlippage,
        priceDirection: 'neutral',
        exit_price: null,
        quantity: quantity,
        stop_loss: entryPriceWithSlippage * (1 - (settings.STOP_LOSS_PCT / 100)),
        take_profit: entryPriceWithSlippage * (1 + (settings.TAKE_PROFIT_PCT / 100)),
        highest_price_since_entry: entryPriceWithSlippage,
        entry_time: new Date().toISOString(),
        exit_time: null,
        pnl: 0,
        pnl_pct: 0,
        status: 'FILLED',
    };

    activePositions.push(newTrade);
    console.log(`[Trade Opened] ${quantity.toFixed(4)} ${symbol} @ ${entryPriceWithSlippage.toFixed(4)}. New balance: ${balance.toFixed(2)}`);
    res.status(201).json(newTrade);
});

app.post('/api/close-trade/:id', isAuthenticated, (req, res) => {
    const tradeId = parseInt(req.params.id, 10);
    const tradeIndex = activePositions.findIndex(t => t.id === tradeId);
    if (tradeIndex === -1) return res.status(404).json({ message: 'Trade not found' });
    const trade = activePositions.splice(tradeIndex, 1)[0];
    trade.exit_price = trade.current_price || trade.entry_price; // Use last known price
    trade.exit_time = new Date().toISOString();
    trade.status = 'CLOSED';
    const pnl = (trade.exit_price - trade.entry_price) * trade.quantity;
    trade.pnl = pnl;
    balance += (trade.entry_price * trade.quantity) + pnl;
    tradeHistory.push(trade);
    res.json(trade);
});


// This would be the real test connection logic
app.post('/api/test-connection', isAuthenticated, (req, res) => {
    const { apiKey, secretKey } = req.body;
    console.log("Received connection test request for API Key:", apiKey);
    if (apiKey && secretKey) {
        // Mock success for now, as real connection requires crypto libraries and is complex
        res.json({ success: true, message: "Connection successful (mock)." });
    } else {
        res.status(400).json({ success: false, message: "API Key or Secret Key missing." });
    }
});


// --- Start Server and Trading Logic ---
app.listen(port, async () => {
    await loadSettings();
    console.log(`Backend server running on http://localhost:${port}`);
    // TODO: Initialize and start the real trading engine here
});