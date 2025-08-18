import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// --- Basic Setup ---
// Correctly load .env file from the current directory (backend/)
dotenv.config();
const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());

// --- Mimic Frontend Services in Backend ---
// This is a simplified backend. A real implementation would use a proper database.
// For now, we persist settings to a JSON file.
const SETTINGS_FILE_PATH = path.join(process.cwd(), 'backend', 'settings.json');

let activePositions = []; // In-memory
let tradeHistory = []; // In-memory
let balance = 10000; // In-memory
let tradeIdCounter = 1;

let settings = {};

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
            SLIPPAGE_PCT: parseFloat(process.env.SLIPPAGE_PCT) || 0.05,
            USE_TRAILING_STOP_LOSS: process.env.USE_TRAILING_STOP_LOSS === 'true',
            TRAILING_STOP_LOSS_PCT: parseFloat(process.env.TRAILING_STOP_LOSS_PCT) || 1.5,
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
        await saveSettings(); // Create the file
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

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key-for-jwt-change-it';

// --- API Endpoints ---

// Security
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.APP_PASSWORD) {
        const token = jwt.sign({ user: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid password' });
    }
});

app.post('/api/change-password', (req, res) => {
    // This is a simplified implementation. In a real app, you would hash the password
    // and might require the old password for verification.
    // This also doesn't persist the password change on the .env file, which requires more complex file editing.
    // For now, this is a placeholder to show the concept.
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long.' });
    }
    // In a real app: update the .env file or a secure config store.
    // process.env.APP_PASSWORD = newPassword;
    console.log("Password change requested. In a real app, you would need to securely update the .env file and restart the server.");
    res.json({ success: true, message: 'Password change endpoint reached. NOTE: For this version, password must be changed manually in the .env file.' });
});


// Data fetching
app.get('/api/settings', (req, res) => {
    res.json(settings);
});

app.post('/api/settings', async (req, res) => {
    settings = { ...settings, ...req.body };
    await saveSettings();
    res.json({ success: true });
});

app.get('/api/status', (req, res) => {
    res.json({
        balance: balance,
        positions: activePositions.length,
        monitored_pairs: 0, // Mocked for now
        top_pairs: [], // Mocked for now
        max_open_positions: settings.MAX_OPEN_POSITIONS
    });
});

app.get('/api/positions', (req, res) => {
    res.json(activePositions);
});

app.get('/api/history', (req, res) => {
    res.json(tradeHistory);
});

app.get('/api/performance-stats', (req, res) => {
    const winning_trades = tradeHistory.filter(t => (t.pnl || 0) > 0).length;
    const total_pnl = tradeHistory.reduce((sum, t) => sum + (t.pnl || 0), 0);
    res.json({
        total_trades: tradeHistory.length,
        winning_trades,
        losing_trades: tradeHistory.length - winning_trades,
        total_pnl,
        win_rate: (winning_trades / (tradeHistory.length || 1)) * 100,
    });
});


// Actions
app.post('/api/open-trade', (req, res) => {
    const { symbol, price, mode } = req.body;

    if (activePositions.length >= settings.MAX_OPEN_POSITIONS) {
        return res.status(400).json({ success: false, message: 'Max open positions reached' });
    }

    const positionSize = balance * (settings.POSITION_SIZE_PCT / 100);

    if (balance < positionSize) {
        return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    const quantity = positionSize / price;

    const newTrade = {
        id: tradeIdCounter++,
        mode: mode,
        symbol: symbol,
        side: "BUY", // Mocking BUY side only for now
        entry_price: price,
        current_price: price,
        quantity: quantity,
        stop_loss: price * (1 - settings.STOP_LOSS_PCT / 100),
        take_profit: price * (1 + settings.TAKE_PROFIT_PCT / 100),
        highest_price_since_entry: price,
        entry_time: new Date().toISOString(),
        exit_time: undefined,
        pnl: 0,
        pnl_pct: 0,
        status: "PENDING",
    };
    
    // Simulate slippage
    const slippageAmount = newTrade.entry_price * (settings.SLIPPAGE_PCT / 100);
    newTrade.entry_price += slippageAmount;
    newTrade.status = "FILLED";
    
    balance -= positionSize;
    activePositions.push(newTrade);
    
    console.log(`[Trade Opened] ${newTrade.symbol} | Qty: ${newTrade.quantity.toFixed(4)} | Entry: ${newTrade.entry_price.toFixed(4)}`);
    res.status(201).json(newTrade);
});

app.post('/api/close-trade/:id', (req, res) => {
    const tradeId = parseInt(req.params.id, 10);
    const tradeIndex = activePositions.findIndex(t => t.id === tradeId);
    
    if (tradeIndex === -1) {
        return res.status(404).json({ success: false, message: 'Trade not found' });
    }

    const trade = activePositions[tradeIndex];
    // This is a mock, in reality we'd get the current price from a live feed.
    // Let's simulate a random-ish exit price for mock purposes
    const priceMovement = (Math.random() - 0.45) * 0.1; // Random movement between -4.5% and +5.5%
    const exitPrice = trade.entry_price * (1 + priceMovement); 

    trade.exit_price = exitPrice;
    trade.exit_time = new Date().toISOString();
    trade.status = 'CLOSED';
    const pnl = (trade.exit_price - trade.entry_price) * trade.quantity * (trade.side === "BUY" ? 1 : -1);
    trade.pnl = pnl;
    const entryValue = trade.entry_price * trade.quantity;
    trade.pnl_pct = entryValue !== 0 ? (pnl / entryValue) * 100 : 0;

    balance += (entryValue + pnl);
    
    activePositions.splice(tradeIndex, 1);
    tradeHistory.push(trade);
    
    console.log(`[Trade Closed] ${trade.symbol} | PnL: ${pnl.toFixed(2)}`);
    res.json(trade);
});


app.post('/api/clear-data', async (req, res) => {
    await loadSettings(); // Reload settings to get the latest initial balance
    activePositions = [];
    tradeHistory = [];
    balance = settings.INITIAL_VIRTUAL_BALANCE;
    tradeIdCounter = 1;
    console.log(`Trade data cleared. Balance reset to ${balance}`);
    res.json({ success: true });
});

// Mock scanner for now
app.get('/api/scanner', (req, res) => {
    // This should eventually come from a real scanning process on the backend
    // For now, returning an empty array is fine as the frontend is driven by another service.
    res.json([]);
});

// Test connection endpoint
app.post('/api/test-connection', (req, res) => {
    const { apiKey, secretKey } = req.body;
    // In a real app, this would use the node-binance-api or similar library
    console.log("Received connection test request for API Key:", apiKey);
    if (apiKey && secretKey) {
        // Mock success
        res.json({ success: true, message: "Connection successful (mock)." });
    } else {
        res.status(400).json({ success: false, message: "API Key or Secret Key missing." });
    }
});


// --- Serve Frontend ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, '..', 'dist');

app.use(express.static(frontendPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});


// --- Start Server ---
app.listen(port, async () => {
    await loadSettings();
    console.log(`Backend server running on http://localhost:${port}`);
    // Here you would start the actual trading engine logic
    // tradingEngine.start();
});