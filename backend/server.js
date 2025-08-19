import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';
import crypto from 'crypto';
import { SMA, ADX } from 'technicalindicators';

// --- Basic Setup ---
dotenv.config();
const app = express();
const port = process.env.PORT || 8080;

app.use(cors({
    origin: '*', // This is acceptable as Nginx will proxy requests, making them same-origin.
    credentials: true,
}));
app.use(bodyParser.json());

// --- Session Management ---
app.use(session({
    secret: process.env.APP_PASSWORD || 'default_session_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production (requires HTTPS)
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
}));

// --- Mock Backend State ---
const SETTINGS_FILE_PATH = path.join(process.cwd(), 'settings.json');
let settings = {};
let activePositions = [];
let tradeHistory = [];
let balance = 10000;
let tradeIdCounter = 1;
let scannerCache = { data: [], timestamp: 0 };

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

// --- Binance API Helpers ---
const createSignature = (queryString, secretKey) => {
    return crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
};

const signedRequest = async (endpoint, params, apiKey, secretKey) => {
    params.set('timestamp', Date.now().toString());
    const queryString = params.toString();
    const signature = createSignature(queryString, secretKey);
    params.set('signature', signature);
    
    const url = `https://api.binance.com${endpoint}?${params.toString()}`;
    
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'X-MBX-APIKEY': apiKey,
        },
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Binance API Error: ${data.msg || 'Unknown error'} (Code: ${data.code})`);
    }
    return data;
};

// --- Scanner Logic ---
const runScanner = async () => {
    console.log("Running market scanner...");
    try {
        const coingeckoUrl = 'https://api.coingecko.com/api/v3/exchanges/binance/tickers?include_exchange_logo=false&page=1&depth=false&order=volume_desc';
        const response = await fetch(coingeckoUrl);
        if (!response.ok) throw new Error(`CoinGecko API request failed with status ${response.status}`);
        const data = await response.json();
        const tickers = data.tickers;

        const excluded = settings.EXCLUDED_PAIRS.split(',');
        const filtered = tickers
            .filter(t => t.target === 'USDT' && !t.base.includes('DOWN') && !t.base.includes('UP') && !t.is_stale)
            .filter(t => !excluded.includes(t.base + t.target))
            .filter(t => t.converted_volume.usd > settings.MIN_VOLUME_USD)
            .slice(0, 100); // Limit to top 100 by volume to avoid rate limits

        const enrichedPairs = [];
        for (const ticker of filtered) {
            try {
                const symbol = ticker.base + ticker.target;
                const klinesUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=4h&limit=200`;
                const klineRes = await fetch(klinesUrl);
                if (!klineRes.ok) continue;
                const klines = await klineRes.json();
                
                if (klines.length < 200) continue;

                const closes = klines.map(k => parseFloat(k[4]));
                const highs = klines.map(k => parseFloat(k[2]));
                const lows = klines.map(k => parseFloat(k[3]));

                const sma50 = SMA.calculate({ period: 50, values: closes });
                const sma200 = SMA.calculate({ period: 200, values: closes });
                const sma20 = SMA.calculate({ period: 20, values: closes });
                const adxResult = ADX.calculate({ period: 14, high: highs, low: lows, close: closes });

                const lastSma50 = sma50[sma50.length - 1];
                const lastSma200 = sma200[sma200.length - 1];
                const lastSma20 = sma20[sma20.length-1];
                const lastAdx = adxResult.length > 0 ? adxResult[adxResult.length - 1].adx : 0;
                const lastClose = closes[closes.length-1];

                let marketRegime = 'NEUTRAL';
                if (lastSma50 > lastSma200) marketRegime = 'UPTREND';
                else if (lastSma50 < lastSma200) marketRegime = 'DOWNTREND';
                
                let trend_4h = 'NEUTRAL';
                if (lastAdx > 25) {
                    trend_4h = lastClose > lastSma20 ? 'UP' : 'DOWN';
                }

                enrichedPairs.push({
                    symbol,
                    volume: ticker.converted_volume.usd,
                    price: ticker.last,
                    priceDirection: 'neutral', trend: 'NEUTRAL', trend_4h, marketRegime,
                    rsi: 50, adx: 20, score: 'HOLD', volatility: 0,
                });
            } catch (e) {
                console.error(`Failed to process symbol ${ticker.base + ticker.target}: ${e.message}`);
            }
        }
        
        scannerCache = { data: enrichedPairs, timestamp: Date.now() };
        console.log(`Scanner finished. Found ${enrichedPairs.length} potential pairs.`);
    } catch (error) {
        console.error(`Error in runScanner: ${error.message}`);
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
    console.warn("SECURITY WARNING: Password change requested. This is a placeholder. For this version, password must be changed manually in the .env file and the server restarted.");
    res.json({ success: true, message: 'Password change acknowledged. Restart server after manual .env update.' });
});

app.get('/api/settings', isAuthenticated, (req, res) => res.json(settings));
app.post('/api/settings', isAuthenticated, async (req, res) => {
    settings = { ...settings, ...req.body };
    await saveSettings();
    res.json({ success: true });
});

app.get('/api/status', isAuthenticated, (req, res) => {
    res.json({
        balance,
        positions: activePositions.length,
        monitored_pairs: scannerCache.data.length,
        top_pairs: scannerCache.data.slice(0, 10).map(p => p.symbol),
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

app.get('/api/scanner', isAuthenticated, async (req, res) => {
    const CACHE_DURATION = (settings.COINGECKO_SYNC_SECONDS * 1000) / 2;
    if (Date.now() - scannerCache.timestamp > CACHE_DURATION || scannerCache.data.length === 0) {
        await runScanner();
    }
    res.json(scannerCache.data);
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
    const entryPriceWithSlippage = price * (1 + (settings.SLIPPAGE_PCT / 100));
    balance -= positionSize;

    const newTrade = {
        id: tradeIdCounter++,
        mode: mode, symbol: symbol, side: 'BUY',
        entry_price: entryPriceWithSlippage, current_price: entryPriceWithSlippage,
        priceDirection: 'neutral', exit_price: null, quantity: quantity,
        stop_loss: entryPriceWithSlippage * (1 - (settings.STOP_LOSS_PCT / 100)),
        take_profit: entryPriceWithSlippage * (1 + (settings.TAKE_PROFIT_PCT / 100)),
        highest_price_since_entry: entryPriceWithSlippage,
        entry_time: new Date().toISOString(), exit_time: null,
        pnl: 0, pnl_pct: 0, status: 'FILLED',
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
    trade.exit_price = trade.current_price || trade.entry_price;
    trade.exit_time = new Date().toISOString();
    trade.status = 'CLOSED';
    const pnl = (trade.exit_price - trade.entry_price) * trade.quantity;
    trade.pnl = pnl;
    balance += (trade.entry_price * trade.quantity) + pnl;
    tradeHistory.push(trade);
    res.json(trade);
});

app.post('/api/test-connection', isAuthenticated, async (req, res) => {
    const { apiKey, secretKey } = req.body;
    console.log("Received connection test request.");
    if (!apiKey || !secretKey) {
        return res.status(400).json({ success: false, message: "API Key and Secret Key must be provided." });
    }
    try {
        const params = new URLSearchParams();
        const accountInfo = await signedRequest('/api/v3/account', params, apiKey, secretKey);
        if (accountInfo && accountInfo.canTrade) {
            res.json({ success: true, message: "Connection successful. API keys are valid." });
        } else {
            res.json({ success: false, message: "Connection succeeded, but trading is not enabled for this API key." });
        }
    } catch (error) {
        console.error(`Binance connection test failed: ${error.message}`);
        res.status(500).json({ success: false, message: `Connection failed: ${error.message}` });
    }
});

// --- Start Server ---
app.listen(port, async () => {
    await loadSettings();
    console.log(`Backend server running on http://localhost:${port}`);
    await runScanner(); // Initial scan on startup
});
