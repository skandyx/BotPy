# Trading Bot Dashboard "BOTPY"

BOTPY is a comprehensive web-based dashboard designed to monitor, control, and analyze a multi-pair automated crypto trading bot operating on USDT pairs. It provides a real-time, user-friendly interface to track market opportunities, manage active positions, review performance, and fine-tune the trading strategy. It supports a phased approach to live trading with `Virtual`, `Real (Paper)`, and `Real (Live)` modes.

## ✨ Key Features

-   **Multiple Trading Modes**: A safe, phased approach to live trading.
    -   `Virtual`: 100% simulation. Safe for testing and strategy optimization.
    -   `Real (Paper)`: Uses real Binance API keys for a live data feed but **simulates** trades without risking capital. The perfect final test.
    -   `Real (Live)`: Executes trades with real funds on your Binance account.
-   **Real-time Market Scanner**: Automatically identifies high-potential trading pairs based on user-defined criteria like volume, volatility, and exclusion lists.
-   **Advanced Trading Strategy**: Implements a multi-filter, trend-following strategy using indicators like RSI, ADX, Volatility, Volume Confirmation, **Multi-Timeframe Confirmation**, and an intelligent **Market Regime Filter**.
-   **Live Dashboard**: Offers an at-a-glance overview of key performance indicators (KPIs) such as balance, open positions, total Profit & Loss (P&L), and win rate.
-   **Detailed Trade History**: Provides a complete log of all past trades with powerful sorting, filtering, and data export (CSV) capabilities.
-   **Fully Configurable**: Every parameter of the trading strategy is easily adjustable through a dedicated settings page with helpful tooltips.
-   **Binance API Integration**: Securely test your Binance API key connectivity directly from the settings page.

---

## 🎨 Application Pages & Design

The application is designed with a dark, modern aesthetic (`bg-[#0c0e12]`), using an `Inter` font for readability and `Space Mono` for numerical data. The primary accent color is a vibrant yellow/gold (`#f0b90b`), used for interactive elements and highlights, with green and red reserved for clear financial indicators.

### 🔐 Login Page

-   **Purpose**: Provides secure access to the dashboard.
-   **Design**: A minimalist, centered form featuring the "BOTPY" logo.
-   **Functionality**: A single password field (configured on the backend).

### 📊 Dashboard

-   **Purpose**: The main control center, providing a high-level summary of the bot's status and performance.
-   **Layout**: A responsive grid of informative widgets.
-   **Key Components**:
    -   **Stat Cards**: Four prominent cards display the most critical KPIs: Balance, Open Positions, Total P&L, and Monitored Pairs.
    -   **Performance Chart**: A smooth `AreaChart` visualizes the P&L history over time, generated from **real trade history**.
    -   **Active Positions Table**: A detailed list of all open trades, with real-time price flashes and color-coded P&L. Each position can be closed manually.

### 📡 Scanner

-   **Purpose**: To display the real-time results of the market analysis, showing which pairs are potential trade candidates.
-   **Layout**: A full-width, data-dense table with sortable columns.
-   **Columns & Color-Coding**:
    -   `Symbol`, `Price` (with live green/red flashes), `Volume`, `Volatility`.
    -   `Trend 1m` & `Trend 4h`: The short-term and long-term trends, visualized with icons and colors: `▲ UP` (**green**), `▼ DOWN` (**red**), `- NEUTRAL` (**gray**).
    -   `Market Regime`: The long-term market structure (`UPTREND`, `DOWNTREND`), providing critical context.
    -   `RSI`: Colored **yellow** if > 70 (overbought) or **purple** if < 30 (oversold).
    -   `ADX`: **Blue and bold** if > 25, indicating a strong trend.
    -   `Score`: The final strategic score, displayed as a colored badge (`STRONG BUY`/`BUY` are **green**).

### 📜 History

-   **Purpose**: A dedicated page for reviewing and analyzing the performance of all completed trades.
-   **Key Components**:
    -   **Performance Summaries**: Stat cards for `P&L Total`, `Trades (Win/Loss)`, and `Win Rate` that update based on filters.
    -   **Data Controls**: Includes filtering by symbol and an "Export CSV" button.

### ⚙️ Settings

-   **Purpose**: Allows for complete configuration of the bot's strategy and operational parameters.
-   **Layout**: A clean, well-organized form divided into logical sections.
-   **User-Friendly**: Every single setting has a **tooltip icon** (❓) next to it, providing a clear explanation of its purpose on mouse hover.
-   **Key Sections**:
    -   **Trading Parameters**: `Initial Virtual Balance`, `Max Open Positions`, `Position Size (%)`, `Take Profit (%)`, `Stop Loss (%)`, and the advanced **Trailing Stop Loss** settings.
    -   **Market Scanner & Strategy Filters**: `Min Volume (USD)`, `Min Volatility (%)`, toggles for advanced filters like **`Market Regime Filter`**, and the **`Loss Cooldown`** period.
    -   **API Credentials**: Securely input your Binance API Key and Secret Key, with a button to **Test Connection**.
    -   **Data Management**: A `Clear All Trade Data` button to reset the bot's history and balance to the configured initial value.

### 🖥️ Console

-   **Purpose**: Provides a transparent, real-time view into the bot's internal operations.
-   **Key Components**: Color-coded log levels and filter tabs, including dedicated tabs for **`SCANNER`**, **`BINANCE API`**, and **`BINANCE WS`** messages.

---

## 🧠 Trading Strategy Explained

The bot employs a conservative, multi-filter, trend-following strategy designed to identify high-probability entry points and manage risk systematically.

### Step 1: Market Filtering (The Funnel)

This initial stage runs periodically to select a universe of relevant pairs to analyze.

1.  **Fetch Tickers**: Retrieves all USDT-based pairs directly from the Binance 24hr Ticker API.
2.  **Volume Filter**: Discards any pair with a 24-hour trading volume below the `Min Volume (USD)` threshold.
3.  **Exclusion Filter**: Removes any pairs manually listed in the `Exclude Pairs` setting.
4.  **Initial Analysis**: For each remaining pair, it fetches historical data (up to 200 candles on the 4h timeframe) to establish a baseline for trend, volatility, and the overall market regime.

### Step 2: Real-time Scoring (The Decision Engine)

For each filtered pair, the bot connects via WebSocket and performs a continuous, real-time analysis on every 1-minute candle close. The final `Score` is determined by passing a series of strict checks:

| Score | Condition | Description |
| :--- | :--- | :--- |
| **HOLD** | **Default State** or Any Failed Check | This is the starting score. If any of the following checks fail, the score remains `HOLD`. |
| ... | 1. **Market Regime Filter** | *(Master Filter)* If enabled, is the long-term **Market Regime `UPTREND`** (e.g., SMA50 > SMA200 on the 4h chart)? If not, all buy signals are discarded. The bot will not trade against the primary market structure. |
| ... | 2. **Multi-Timeframe Confirmation** | If enabled, is the shorter-term **Trend 4h `UP`**? If not, the signal is discarded (`HOLD`). This aligns the trade with the more immediate long-term trend. |
| ... | 3. **Short-Term Trend Check** | Is the **Trend 1m `UP`** (ADX > 25 and price > SMA20)? If not, `HOLD`. |
| ... | 4. **Volatility Check** | Is the calculated **Volatility > `Min Volatility (%)`**? If not, `HOLD`. This avoids entering flat, directionless markets. |
| ... | 5. **Volume Confirmation** | If enabled, is the volume of the last 1-minute candle **greater than its recent average**? If not, `HOLD`. This confirms market interest is backing the move. |
| **BUY** | All above checks passed AND **RSI > 50** | The pair is in a confirmed, volatile uptrend with positive momentum, and aligned with the long-term market direction. This is a valid signal. |
| **STRONG BUY** | All above checks passed AND **50 < RSI < 70** | This is the "sweet spot". The momentum is strong but not yet in the "overbought" territory (>70), suggesting the trend has room to run. This is the highest quality signal. |

### Step 3: Trade Execution & Management

1.  **Entry**: When a pair's score becomes `BUY` or `STRONG BUY`, the engine initiates a trade.
2.  **Anti-Churn Filter**: Before entry, the bot checks if the pair is on a **cooldown** from a recent loss. If so, it skips the trade to avoid re-entering unfavorable conditions.
3.  **Position Sizing**: The trade size is calculated based on the `Position Size (%)` of the total account balance.
4.  **Risk Management & Exit Strategy**:
    *   **Initial Stop Loss (SL) & Take Profit (TP)**: A static TP and SL level are calculated upon entry.
    *   **Trailing Stop Loss (Optional)**: If enabled, the bot uses a dynamic exit strategy to maximize gains. It continuously adjusts the Stop Loss upwards as the price rises, locking in profits while letting winners run.

---

## 🔬 In-Depth Strategy Analysis

### ✅ Strengths

1.  **Rigorous Filtering**: The multi-stage filtering (Volume, Exclusion List, Volatility) effectively removes illiquid or undesirable pairs.
2.  **Solid Technical Foundation**: The use of standard, proven indicators like RSI, ADX, and long-term Moving Averages provides a solid base for analysis.
3.  **Patience & Context-Awareness**: With the **Market Regime Filter**, the bot knows when to stay out of the market entirely, avoiding many losing trades in unfavorable conditions.
4.  **Systematic Risk Management**: The use of predefined Stop Loss, Take Profit, an advanced Trailing Stop Loss, and an **Anti-Churn Cooldown** enforces disciplined trading.

### ⚠️ Weaknesses & Risks

1.  **Lagging Nature of Indicators**: Moving averages, which form the basis of the Market Regime filter, are lagging indicators. This means the bot might be late to enter a new uptrend and late to stop trading when a trend reverses.
2.  **Sudden Market Events ("Black Swans")**: The strategy is technical and cannot account for sudden news events (e.g., regulatory changes, hacks) that can cause extreme market volatility and invalidate technical signals.
3.  **Absence of Micro-Structure Analysis**: The bot does not analyze the order book or liquidity depth, making it blind to certain forms of market manipulation like spoofing.

### 🔧 Suggested Improvements (For Future Versions)

*   **Dynamic Stop Loss based on Volatility (ATR)**: Use the Average True Range (ATR) to set the initial Stop Loss. This would place stops wider in volatile markets and tighter in calm markets, adapting the risk to the asset's current behavior.
*   **Profit-Taking Strategy**: Implement a more dynamic profit-taking strategy, such as selling a partial position at a first target (e.g., 1.5R) and letting the rest run with the trailing stop.
*   **Short-Selling Strategy**: Develop a parallel strategy to take `SELL` positions when the Market Regime is `DOWNTREND`, allowing the bot to be profitable in both bull and bear markets.