export enum TradingMode {
  VIRTUAL = "VIRTUAL",
  REAL_PAPER = "REAL_PAPER",
  REAL_LIVE = "REAL_LIVE"
}

export enum OrderSide {
  BUY = "BUY",
  SELL = "SELL",
}

export enum OrderStatus {
  PENDING = "PENDING",
  FILLED = "FILLED",
  CANCELLED = "CANCELLED",
  CLOSED = "CLOSED",
}

export enum WebSocketStatus {
    CONNECTING = "CONNECTING",
    CONNECTED = "CONNECTED",
    DISCONNECTED = "DISCONNECTED",
}

export interface Trade {
  id: number;
  mode: TradingMode;
  symbol: string;
  side: OrderSide;
  entry_price: number;
  current_price?: number;
  priceDirection?: 'up' | 'down' | 'neutral';
  exit_price?: number;
  quantity: number;
  initial_quantity?: number; // For tracking partial sells
  stop_loss: number;
  take_profit: number;
  highest_price_since_entry: number; // For Trailing Stop Loss
  entry_time: string;
  exit_time?: string;
  pnl?: number;
  pnl_pct?: number;
  status: OrderStatus;
  initial_risk_usd?: number; // The initial $ amount at risk
  is_at_breakeven?: boolean;
  partial_tp_hit?: boolean;
}

export interface ScannedPair {
    symbol: string;
    volume: number;
    price: number;
    priceDirection: 'up' | 'down' | 'neutral';
    trend: 'UP' | 'DOWN' | 'NEUTRAL';
    trend_4h?: 'UP' | 'DOWN' | 'NEUTRAL'; // For multi-timeframe confirmation
    marketRegime?: 'UPTREND' | 'DOWNTREND' | 'NEUTRAL'; // For market regime filter
    rsi: number;
    adx: number;
    atr?: number;
    macd?: { MACD: number; signal: number; histogram: number; };
    score: 'STRONG BUY' | 'BUY' | 'HOLD' | 'COOLDOWN';
    volatility: number; // Volatility as a percentage
    macd_4h?: { MACD: number; signal: number; histogram: number; };
}


export interface PerformanceStats {
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    total_pnl: number;
    avg_pnl_pct: number;
    win_rate: number;
}

export interface BotStatus {
    mode: TradingMode;
    balance: number;
    positions: number;
    monitored_pairs: number;
    top_pairs: string[];
    max_open_positions: number;
}

export interface LogEntry {
    timestamp: string;
    level: 'INFO' | 'WARN' | 'ERROR' | 'TRADE' | 'WEBSOCKET' | 'SCANNER' | 'BINANCE_API' | 'BINANCE_WS' | 'API_CLIENT' | 'COINGECKO';
    message: string;
}

export interface BotSettings {
    // Trading Parameters
    INITIAL_VIRTUAL_BALANCE: number;
    MAX_OPEN_POSITIONS: number;
    POSITION_SIZE_PCT: number;
    TAKE_PROFIT_PCT: number;
    STOP_LOSS_PCT: number;
    SLIPPAGE_PCT: number;
    USE_TRAILING_STOP_LOSS: boolean;
    TRAILING_STOP_LOSS_PCT: number;
    
    // Market Scanner & Strategy Filters
    MIN_VOLUME_USD: number;
    MIN_VOLATILITY_PCT: number;
    COINGECKO_API_KEY: string; // Not used for scanner, but for general context
    COINGECKO_SYNC_SECONDS: number;
    EXCLUDED_PAIRS: string;
    USE_VOLUME_CONFIRMATION: boolean;
    USE_MULTI_TIMEFRAME_CONFIRMATION: boolean;
    USE_MARKET_REGIME_FILTER: boolean;
    REQUIRE_STRONG_BUY: boolean;
    LOSS_COOLDOWN_HOURS: number;
    
    // API Credentials
    BINANCE_API_KEY: string;
    BINANCE_SECRET_KEY: string;

    // --- ADVANCED STRATEGY & RISK MANAGEMENT ---
    // ATR Stop Loss
    USE_ATR_STOP_LOSS: boolean;
    ATR_MULTIPLIER: number;
    
    // Auto Break-even
    USE_AUTO_BREAKEVEN: boolean;
    BREAKEVEN_TRIGGER_R: number; // R-multiple to trigger break-even
    
    // RSI Overbought Filter
    USE_RSI_OVERBOUGHT_FILTER: boolean;
    RSI_OVERBOUGHT_THRESHOLD: number;
    
    // MACD Confirmation
    USE_MACD_CONFIRMATION: boolean;

    // Partial Take Profit
    USE_PARTIAL_TAKE_PROFIT: boolean;
    PARTIAL_TP_TRIGGER_PCT: number; // PnL % to trigger the partial sell
    PARTIAL_TP_SELL_QTY_PCT: number; // % of original position to sell

    // Dynamic Position Sizing
    USE_DYNAMIC_POSITION_SIZING: boolean;
    STRONG_BUY_POSITION_SIZE_PCT: number;

    // Future-proofing (UI only for now)
    USE_CORRELATION_FILTER: boolean;
    USE_NEWS_FILTER: boolean;
}
