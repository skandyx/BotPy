# Trading Bot Dashboard "BOTPY"

BOTPY is a comprehensive web-based dashboard designed to monitor, control, and analyze a multi-pair automated crypto trading bot operating on USDT pairs. It provides a real-time, user-friendly interface to track market opportunities, manage active positions, review performance, and fine-tune the trading strategy. It supports a phased approach to live trading with `Virtual`, `Real (Paper)`, and `Real (Live)` modes.

## ✨ Key Features

-   **Multiple Trading Modes**: A safe, phased approach to live trading.
    -   `Virtual`: 100% simulation. Safe for testing and strategy optimization.
    -   `Real (Paper)`: Uses real Binance API keys for a live data feed but **simulates** trades without risking capital. The perfect final test.
    -   `Real (Live)`: Executes trades with real funds on your Binance account.
-   **Real-time Market Scanner**: Automatically identifies high-potential trading pairs based on user-defined criteria like volume and volatility.
-   **Advanced & Configurable Strategy**: Implements a multi-filter, trend-following strategy with a suite of professional-grade tools:
    -   **Core Indicators**: RSI, ADX, Volatility, Volume.
    -   **Advanced Filters**: A powerful **Full Multi-Timeframe Confluence** filter (1m, 15m, 30m, 1h, 4h), a master **Market Regime Filter**, and **MACD Confirmation**.
    -   **Intelligent Risk Management**: **ATR-based Stop Loss**, **Auto Break-even**, and **Partial Take Profit**.
    -   **ML-Enhanced Scoring**: An optional, built-in machine learning model that provides a confidence score (0-100) for potential trades, adding a powerful layer of predictive analysis.
-   **Live Dashboard**: Offers an at-a-glance overview of key performance indicators (KPIs) such as balance, open positions, total Profit & Loss (P&L), and win rate.
-   **Detailed Trade History**: Provides a complete log of all past trades with powerful sorting, filtering, and data export (CSV) capabilities.
-   **Fully Configurable**: Every parameter of the basic and advanced strategies is easily adjustable through a dedicated settings page with helpful tooltips.
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
    -   `Score`: The final strategic score, displayed as a colored badge (`STRONG BUY`/`BUY` are **green**).
    -   `ML Prediction` & `ML Score`: The output of the machine learning model, showing its predicted trend and confidence level.
    -   `Trend 1m`, `15m`, `30m`, `1h`, `4h`: The trend on each timeframe, visualized with icons and colors: `▲ UP` (**green**), `▼ DOWN` (**red**), `- NEUTRAL` (**gray**).
    -   `Market Regime`: The long-term market structure (`UPTREND`, `DOWNTREND`), providing critical context.
    -   `RSI`: Colored **yellow** if > 70 (overbought) or **purple** if < 30 (oversold).
    -   `ADX`: **Blue and bold** if > 25, indicating a strong trend.


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
    -   **Trading Parameters**: Core settings like `Position Size`, `Take Profit`, `Stop Loss`, and **Trailing Stop Loss**.
    -   **Market Scanner & Strategy Filters**: `Min Volume`, `Min Volatility`, and toggles for foundational filters.
    -   **Advanced Strategy & Risk Management**: A dedicated section to configure expert-level tools like **ATR Stop Loss**, **Auto Break-even**, **MACD Confirmation**, **Partial Take Profit**, and the **ML Model Filter**.
    -   **API Credentials & Data Management**: Securely manage API keys, test connections, and clear trade data.

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
4.  **Initial Analysis**: For each remaining pair, it fetches historical data (up to 200 candles) for the **4h, 1h, 30m, and 15m** timeframes to establish a baseline for trend and the overall market regime.

### Step 2: Real-time Scoring (The Decision Engine)

For each filtered pair, the bot connects via WebSocket and performs a continuous, real-time analysis on every 1-minute candle close. The final `Score` is determined by passing a series of strict checks:

| Score | Condition | Description |
| :--- | :--- | :--- |
| **HOLD** | **Default State** or Any Failed Check | This is the starting score. If any of the following checks fail, the score remains `HOLD`. |
| ... | 1. **Market Regime Filter** | *(Master Filter)* If enabled, is the long-term **Market Regime `UPTREND`** (e.g., SMA50 > SMA200 on the 4h chart)? If not, all buy signals are discarded. The bot will not trade against the primary market structure. |
| ... | 2. **Multi-Timeframe Confluence** | *(Powerful Filter)* This is a series of checks, one for each timeframe (4h, 1h, 30m, 15m, 1m). If the corresponding toggle is **enabled** in settings, the trend for that timeframe **must be `UP`**. If any required timeframe is not `UP`, the signal is discarded (`HOLD`). This is the core of the confluence strategy. |
| ... | 3. **Volatility Check** | Is the calculated **Volatility > `Min Volatility (%)`**? If not, `HOLD`. This avoids entering flat, directionless markets. |
| ... | 4. **Volume Confirmation** | If enabled, is the volume of the last 1-minute candle **greater than its recent average**? If not, `HOLD`. This confirms market interest is backing the move. |
| ... | 5. **MACD Confirmation** | If enabled, does the **1m MACD histogram have a positive value**? This confirms bullish momentum is present. If not, `HOLD`. |
| ... | 6. **RSI Overbought Filter** | Is the **RSI between 50 and the overbought threshold (e.g., 70)**? If RSI is too high, the market is considered overheated and the signal is discarded (`HOLD`). |
| ... | 7. **ML Model Filter (Optional)** | If enabled, does the **ML Model predict `UP` with a confidence score above the required threshold (e.g., 65)**? This provides an advanced, final layer of confirmation. |
| **BUY** | All applicable checks passed AND **RSI > 50** | The pair is in a confirmed, volatile uptrend with positive momentum, and aligned with all required timeframes. This is a valid signal. |
| **STRONG BUY** | All applicable checks passed AND **50 < RSI < 70** | This is the "sweet spot". The momentum is strong but not yet in the "overbought" territory, suggesting the trend has room to run. This is the highest quality signal. |


### Step 3: Trade Execution & Management

1.  **Entry**: When a pair's score becomes `BUY` or `STRONG BUY`, the engine initiates a trade.
2.  **Anti-Churn Filter**: Before entry, the bot checks if the pair is on a **cooldown** from a recent loss. If so, it skips the trade to avoid re-entering unfavorable conditions.
3.  **Position Sizing**:
    *   **Standard**: The trade size is calculated based on the `Position Size (%)` of the total account balance.
    *   **Dynamic (Optional)**: If enabled, the bot can use a larger size (`Strong Buy Position Size %`) for `STRONG BUY` signals.
4.  **Risk Management & Exit Strategy**:
    *   **Initial Stop Loss (SL)**: Calculated upon entry. Can be a **fixed percentage** or a dynamic value based on market volatility using the **Average True Range (ATR)**.
    *   **Take Profit (TP) & Partial Sells**:
        *   An initial TP level is set.
        *   If **Partial Take Profit** is enabled, the bot will sell a fraction of the position at a preliminary target to secure gains, letting the rest run.
    *   **Auto Break-even (Optional)**: Once a trade is sufficiently in profit (e.g., profit equals initial risk), the bot can automatically move the Stop Loss to the entry price, eliminating the risk of loss.
    *   **Trailing Stop Loss (Optional)**: If enabled, the bot uses a dynamic exit strategy. It continuously adjusts the Stop Loss upwards as the price rises, locking in profits while letting winners run.

---

## 🔬 In-Depth Strategy Analysis

### ✅ Strengths

1.  **Rigorous Filtering**: The multi-stage filtering (Volume, Exclusion List, Volatility) effectively removes illiquid or undesirable pairs.
2.  **Confluence of Indicators**: By requiring confirmation from multiple indicators across different timeframes (RSI, ADX, MACD, MAs), the strategy significantly reduces the probability of acting on false signals.
3.  **Patience & Context-Awareness**: With the **Market Regime Filter**, the bot knows when to stay out of the market entirely, avoiding many losing trades in unfavorable conditions.
4.  **Adaptive Risk Management**: The ability to use **ATR-based stops**, **auto break-even**, and **partial take profits** allows for sophisticated, professional-grade risk management that adapts to market conditions.

### ⚠️ Weaknesses & Risks

1.  **Lagging Nature of Indicators**: Moving averages, which form the basis of the Market Regime filter, are lagging indicators. This means the bot might be late to enter a new uptrend and late to stop trading when a trend reverses.
2.  **Sudden Market Events ("Black Swans")**: The strategy is technical and cannot account for sudden news events (e.g., regulatory changes, hacks) that can cause extreme market volatility and invalidate technical signals.
3.  **Absence of Micro-Structure Analysis**: The bot does not analyze the order book or liquidity depth, making it blind to certain forms of market manipulation like spoofing.

### 🔧 Implemented & Future Improvements

Many of the initial "suggested improvements" have now been integrated as optional features!

*   **✅ [Implemented] Dynamic Stop Loss based on Volatility (ATR)**
*   **✅ [Implemented] Advanced Profit-Taking Strategy (Partial Take Profit)**
*   **✅ [Implemented] Auto Break-even**
*   **✅ [Implemented] ML Model Filter for enhanced signal confirmation**
*   **✅ [Implemented] Full Multi-Timeframe Confluence Filter**
*   **Next Steps**:
    *   **Short-Selling Strategy**: Develop a parallel strategy to take `SELL` positions when the Market Regime is `DOWNTREND`, allowing the bot to be profitable in both bull and bear markets.
    *   **Correlation Filter**: Implement logic to prevent opening simultaneous trades on highly correlated assets (e.g., BTC and ETH) to better diversify risk.
    *   **News Filter**: Integrate an economic calendar API to automatically pause trading around major news events.
---
# Version Française

## ✨ Fonctionnalités Clés

-   **Modes de Trading Multiples**: Approche sécurisée et progressive.
    -   `Virtuel`: Simulation à 100%.
    -   `Réel (Papier)`: Utilise les clés API réelles de Binance pour des données en direct mais **simule** les transactions.
    -   `Réel (Live)`: Exécute des transactions avec des fonds réels.
-   **Scanner de Marché en Temps Réel**: Identifie automatiquement les paires à fort potentiel.
-   **Stratégie Avancée et Configurable**:
    -   **Indicateurs Clés**: RSI, ADX, Volatilité, Volume.
    -   **Filtres Avancés**: Un puissant filtre de **Confluence Multi-Timeframe** (1m, 15m, 30m, 1h, 4h), un **Filtre de Régime de Marché**, et **Confirmation MACD**.
    -   **Gestion des Risques Intelligente**: **Stop Loss basé sur l'ATR**, **Mise à Breakeven Automatique**, et **Prise de Profit Partielle**.
    -   **Scoring Amélioré par ML**: Un modèle de machine learning intégré (optionnel) qui fournit un score de confiance (0-100), ajoutant une couche d'analyse prédictive.
-   **Tableau de Bord en Direct**: Vue d'ensemble des indicateurs clés (solde, positions, P&L, etc.).
-   **Historique des Transactions Détaillé**: Journal complet de tous les trades passés avec tri, filtre et exportation CSV.
-   **Entièrement Configurable**: Chaque paramètre est ajustable via la page des paramètres avec des infobulles utiles.

## 🧠 Stratégie de Trading Expliquée

Le bot utilise une stratégie de suivi de tendance multi-filtres conçue pour identifier des points d'entrée à haute probabilité.

### Étape 1 : Filtrage du Marché (L'Entonnoir)

1.  **Récupération des Tickers**: Obtient toutes les paires basées sur l'USDT depuis l'API de Binance.
2.  **Filtre de Volume**: Écarte les paires dont le volume est inférieur au seuil `Min Volume (USD)`.
3.  **Filtre d'Exclusion**: Retire les paires listées dans le paramètre `Exclude Pairs`.
4.  **Analyse Initiale**: Pour chaque paire restante, récupère les données historiques (4h, 1h, 30m, 15m) pour établir les tendances de fond et le régime de marché.

### Étape 2 : Scoring en Temps Réel (Le Moteur de Décision)

Pour chaque paire filtrée, le bot analyse en continu chaque bougie de 1 minute. Le `Score` final est déterminé par une série de vérifications strictes :

| Score | Condition | Description |
| :--- | :--- | :--- |
| **HOLD** | **État par Défaut** ou Échec d'une Vérification | Si l'un des contrôles suivants échoue, le score reste `HOLD`. |
| ... | 1. **Filtre de Régime de Marché** | *(Filtre Maître)* Si activé, le **Régime de Marché** à long terme est-il `UPTREND` (Tendance Haussière) ? Sinon, tous les signaux d'achat sont ignorés. |
| ... | 2. **Confluence Multi-Timeframe** | *(Filtre Puissant)* Une série de vérifications pour chaque unité de temps (4h, 1h, 30m, 15m, 1m). Si l'interrupteur correspondant est **activé**, la tendance pour cette unité de temps **doit être `UP`**. Si une seule tendance requise n'est pas `UP`, le signal est ignoré (`HOLD`). |
| ... | 3. **Vérification de la Volatilité** | La **Volatilité > `Min Volatility (%)`** ? Sinon, `HOLD`. |
| ... | 4. **Confirmation par le Volume** | Si activé, le volume de la dernière bougie de 1 minute est-il **supérieur à sa moyenne récente** ? Sinon, `HOLD`. |
| ... | 5. **Confirmation MACD** | Si activé, l'histogramme du **MACD 1m a-t-il une valeur positive** ? Sinon, `HOLD`. |
| ... | 6. **Filtre de Surchat RSI** | Le **RSI est-il entre 50 et le seuil de surachat (ex: 70)** ? Si le RSI est trop élevé, le signal est ignoré (`HOLD`). |
| ... | 7. **Filtre du Modèle ML (Optionnel)** | Si activé, le **Modèle ML prédit-il `UP` (HAUSSE) avec un score de confiance supérieur au seuil requis (ex: 65)** ? |
| **BUY** | Toutes les vérifications applicables sont passées ET **RSI > 50** | Le signal est valide. |
| **STRONG BUY** | Toutes les vérifications applicables sont passées ET **50 < RSI < 70** | Le "sweet spot". Le momentum est fort mais pas encore en "surchat". C'est le signal de la plus haute qualité. |

### Étape 3 : Exécution et Gestion des Transactions

1.  **Entrée**: Lorsqu'une paire atteint le score `BUY` ou `STRONG BUY`.
2.  **Filtre Anti-Churn**: Le bot vérifie si la paire est en **cooldown** suite à une perte récente.
3.  **Dimensionnement de la Position**:
    *   **Standard**: Basé sur le `Position Size (%)`.
    *   **Dynamique (Optionnel)**: Taille plus grande pour les signaux `STRONG BUY`.
4.  **Gestion des Risques**:
    *   **Stop Loss (SL) Initial**: Peut être un **pourcentage fixe** ou dynamique basé sur l'**ATR**.
    *   **Take Profit (TP) & Ventes Partielles**: Un TP initial est fixé. Si la **Prise de Profit Partielle** est activée, le bot vend une fraction de la position à une cible préliminaire.
    *   **Auto Break-even (Optionnel)**: Une fois en profit, le SL est déplacé au prix d'entrée, éliminant le risque.
    *   **Trailing Stop Loss (Optionnel)**: Ajuste continuellement le SL à la hausse pour sécuriser les gains.