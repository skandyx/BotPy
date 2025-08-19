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
  stop_loss: number;
  take_profit: number;
  highest_price_since_entry: number; // For Trailing Stop Loss
  entry_time: string;
  exit_time?: string;
  pnl?: number;
  pnl_pct?: number;
  status: OrderStatus;
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
    score: 'STRONG BUY' | 'BUY' | 'HOLD';
    volatility: number; // Volatility as a percentage
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
    INITIAL_VIRTUAL_BALANCE: number;
    MIN_VOLUME_USD: number;
    MAX_OPEN_POSITIONS: number;
    POSITION_SIZE_PCT: number;
    TAKE_PROFIT_PCT: number;
    STOP_LOSS_PCT: number;
    SLIPPAGE_PCT: number;
    VOLUME_SPIKE_FACTOR: number;
    COINGECKO_API_KEY: string;
    COINGECKO_SYNC_SECONDS: number;
    EXCLUDED_PAIRS: string;
    MIN_VOLATILITY_PCT: number;
    USE_VOLUME_CONFIRMATION: boolean;
    USE_MULTI_TIMEFRAME_CONFIRMATION: boolean;
    USE_MARKET_REGIME_FILTER: boolean;
    LOSS_COOLDOWN_HOURS: number;
    USE_TRAILING_STOP_LOSS: boolean;
    TRAILING_STOP_LOSS_PCT: number;
    BINANCE_API_KEY: string;
    BINANCE_SECRET_KEY: string;
}