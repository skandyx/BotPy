# Trading Bot Dashboard "BOTPY"

BOTPY is a comprehensive web-based dashboard designed to monitor, control, and analyze a multi-pair automated crypto trading bot operating on USDT pairs. It provides a real-time, user-friendly interface to track market opportunities, manage active positions, review performance, and fine-tune the trading strategy. It supports a phased approach to live trading with `Virtual`, `Real (Paper)`, and `Real (Live)` modes.

## ✨ Key Features

-   **Multiple Trading Modes**: A safe, phased approach to live trading.
    -   `Virtual`: 100% simulation. Safe for testing and strategy optimization.
    -   `Real (Paper)`: Uses real Binance API keys for a live data feed but **simulates** trades without risking capital. The perfect final test.
    -   `Real (Live)`: Executes trades with real funds on your Binance account.
-   **Real-time Market Scanner**: Automatically identifies high-potential trading pairs based on user-defined criteria like volume.
-   **Advanced & Configurable Strategy**: Implements a powerful "Explosive Wave Hunter" strategy that combines a master trend filter with a volatility breakout trigger.
    -   **Core Indicators**: EMA, Bollinger Bands, RSI, Volume.
    -   **Intelligent Entry**: A multi-stage validation process ensures entries are only taken in high-probability scenarios (correct trend, volatility compression, volume-confirmed breakout).
    -   **Dynamic Risk Management**: Stop Loss is placed logically below the breakout structure, and Take Profit is calculated based on a Risk/Reward ratio for disciplined profit-taking.
-   **Live Dashboard**: Offers an at-a-glance overview of key performance indicators (KPIs) such as balance, open positions, total Profit & Loss (P&L), and win rate.
-   **Detailed Trade History**: Provides a complete log of all past trades with powerful sorting, filtering, and data export (CSV) capabilities.
-   **Fully Configurable**: Every parameter of the strategy is easily adjustable through a dedicated settings page with helpful tooltips.

---

## 🎨 Application Pages & Design

The application is designed with a dark, modern aesthetic (`bg-[#0c0e12]`), using an `Inter` font for readability and `Space Mono` for numerical data. The primary accent color is a vibrant yellow/gold (`#f0b90b`), used for interactive elements and highlights, with green and red reserved for clear financial indicators.

### 🔐 Login Page
-   **Purpose**: Provides secure access to the dashboard.

### 📊 Dashboard
-   **Purpose**: The main control center, providing a high-level summary of the bot's status and performance.
-   **Key Components**: Stat Cards (Balance, Open Positions, P&L), Performance Chart, and an Active Positions Table.

### 📡 Scanner
-   **Purpose**: To display the real-time results of the market analysis, showing which pairs are potential trade candidates based on the new strategy.
-   **Layout**: A data-dense table with sortable columns reflecting the new "Explosive Wave Hunter" strategy.
-   **Key Columns**:
    -   `Symbol`, `Price` (with live green/red flashes).
    -   `Score`: The final strategic score, displayed as a colored badge (`STRONG BUY` is green, `COMPRESSION` is blue).
    -   `Tendance 4h (EMA50)`: Shows if the master trend filter (Price > EMA50) is met.
    -   `RSI 1h`: Displays the 1-hour RSI to check the safety filter condition (< 75).
    -   `Largeur BB 15m`: Shows the current width of the 15-minute Bollinger Bands, highlighting pairs in a "squeeze".

### 📜 History
-   **Purpose**: A dedicated page for reviewing and analyzing the performance of all completed trades.

### ⚙️ Settings
-   **Purpose**: Allows for complete configuration of the bot's strategy and operational parameters. Every setting has a tooltip for explanation.

### 🖥️ Console
-   **Purpose**: Provides a transparent, real-time view into the bot's internal operations with color-coded log levels.

---

## 🧠 Trading Strategy Explained: "The Explosive Wave Hunter"

The bot's goal is to enter a position only when a pair, already in a solid uptrend, shows signs of an imminent acceleration. The logic is divided into two phases: Entry Conditions and Exit Rules.

### Phase 1: Entry Conditions (When to Buy?)

A `STRONG BUY` signal is triggered only if all 5 of the following conditions are met in order:

1.  **TREND FILTER (Context):** The pair must be in a background uptrend.
    *   **Tool:** 4-hour (4h) chart.
    *   **Condition:** The current price is **above its 50-period Exponential Moving Average (EMA50)**.

2.  **PREPARATION (Compression):** The market must show signs of calm before the storm.
    *   **Tool:** Bollinger Bands on the 15-minute (15m) chart.
    *   **Condition:** The Bollinger Bands are tightening ("in a squeeze"), indicating low volatility and an accumulation of energy.

3.  **TRIGGER (Breakout):** The price must break through its immediate resistance.
    *   **Tool:** Bollinger Bands on the 15-minute (15m) chart.
    *   **Condition:** A 15-minute candle **closes above the upper Bollinger Band**.

4.  **CONFIRMATION (Fuel):** The breakout must be supported by strong buying interest.
    *   **Tool:** Trading Volume on the 15-minute (15m) chart.
    *   **Condition:** The volume of the breakout candle is significantly higher than average (e.g., **> 2 times the average of the last 20 candles**).

5.  **SAFETY (Anti-Overheating):** We avoid buying a move that is already at its peak.
    *   **Tool:** RSI on the 1-hour (1h) chart.
    *   **Condition:** The RSI is **below 75**, indicating the market is not yet in an extreme overbought zone.


### Phase 2: Exit Rules (When to Sell?)

Exit management is crucial and is divided into two parts:

1.  **STOP LOSS (Protection):** If the trade goes wrong, we limit the loss.
    *   **Placement:** Placed just **below the low of the candle that preceded the breakout candle**. This invalidates the initial breakout scenario if hit.

2.  **TAKE PROFIT (Securing Gains):** We secure profits in a disciplined manner.
    *   **Method:** A Risk/Reward Ratio is used. The risk (distance between the entry and the Stop Loss) is calculated, and the profit target is set at a multiple of that risk (e.g., **2 times the risk**).

---

### ✅ Strengths of the Strategy

1.  **High-Probability Setups**: By combining trend, volatility, and volume, the strategy is highly selective and focuses only on setups with a statistical edge.
2.  **Context-Aware**: The master trend filter prevents the bot from trading against the primary market direction, avoiding many losing trades in bearish conditions.
3.  **Clear Invalidation**: The Stop Loss placement is not arbitrary; it's based on the price structure of the breakout, providing a logical point where the trade idea is proven wrong.
4.  **Disciplined Exits**: Using a fixed Risk/Reward ratio enforces a consistent and disciplined approach to taking profits.

---
# Version Française

## 🧠 Stratégie de Trading : “Le Chasseur de Vagues Explosives”

L’objectif est de n’entrer en position que lorsqu’une paire, déjà dans une tendance haussière solide, montre des signes d’une accélération imminente.

### Phase 1 : Les Conditions d’Entrée (Quand acheter ?)

Un signal d’achat `STRONG BUY` est déclenché uniquement si les 5 conditions suivantes sont remplies dans l’ordre :

1.  **FILTRE DE TENDANCE (Contexte)** : La paire doit être dans une tendance haussière de fond.
    *   **Outil** : Graphique en 4 heures (4h).
    *   **Condition** : Le prix actuel est au-dessus de sa **Moyenne Mobile Exponentielle 50 (MME50)**.

2.  **PRÉPARATION (Compression)** : Le marché doit montrer des signes de calme avant la tempête.
    *   **Outil** : Bandes de Bollinger sur le graphique en 15 minutes (15m).
    *   **Condition** : Les Bandes de Bollinger se resserrent ("squeeze"), indiquant une faible volatilité.

3.  **DÉCLENCHEUR (Cassure)** : Le prix doit casser sa résistance immédiate.
    *   **Outil** : Bandes de Bollinger sur le graphique en 15 minutes (15m).
    *   **Condition** : Une bougie **clôture au-dessus de la bande de Bollinger supérieure**.

4.  **CONFIRMATION (Carburant)** : La cassure doit être soutenue par un fort intérêt acheteur.
    *   **Outil** : Volume des transactions sur le graphique en 15 minutes (15m).
    *   **Condition** : Le volume de la bougie de cassure est nettement supérieur à la moyenne (ex: **> 2 fois la moyenne des 20 dernières bougies**).

5.  **SÉCURITÉ (Anti-Surchauffe)** : On évite d’acheter un mouvement déjà à son sommet.
    *   **Outil** : RSI sur le graphique en 1 heure (1h).
    *   **Condition** : Le **RSI est inférieur à 75**.

### Phase 2 : Les Règles de Sortie (Quand vendre ?)

1.  **STOP LOSS (Protection)** :
    *   **Placement** : Juste en **dessous du point le plus bas de la bougie qui précède la cassure**.

2.  **TAKE PROFIT (Prise de Gains)** :
    *   **Méthode** : Utiliser un **ratio Risque/Récompense** (par exemple, 2:1). On calcule le risque (distance entre l’entrée et le Stop Loss) et on vise un gain qui est un multiple de ce risque.