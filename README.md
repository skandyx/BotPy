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

## 🧠 Trading Strategy Explained: The "Macro-Micro" Precision Hunter

The bot's core philosophy is to combine a high-level **"Macro"** analysis to find high-probability environments with a low-level **"Micro"** analysis to pinpoint the perfect entry moment. This avoids the "noise" of low timeframes while capturing the explosive start of a move with surgical precision.

### Phase 1: The Macro Radar (Finding High-Interest Zones on 15m/4h)

The bot continuously scans all pairs to identify those that are "primed" for a potential explosive move. Instead of trading immediately, it adds these qualified pairs to a **"Hotlist"** (marked with a 🎯 in the scanner). A pair gets on the Hotlist if it meets two strict criteria:

1.  **MASTER TREND FILTER (The Context):** The pair must be in a confirmed, powerful long-term uptrend.
    *   **Tool:** 4-hour (4h) chart.
    *   **Condition:** The current price is **above its 50-period Exponential Moving Average (EMA50)**. This ensures we are only trading with the dominant market momentum.

2.  **VOLATILITY COMPRESSION (The Preparation):** The market must be consolidating and building up energy, like a coiled spring.
    *   **Tool:** Bollinger Bands on the 15-minute (15m) chart.
    *   **Condition:** The pair is in a **Bollinger Band Squeeze**. This is detected when the current width of the bands is in the lowest 25% of its values over the last 50 periods. It signals a period of quiet accumulation before a likely expansion in volatility.

If both conditions are met, the pair is on the **Hotlist**. The bot now "zooms in" and moves to Phase 2.

### Phase 2: The Micro Trigger (Precision Entry on 1m)

For pairs on the Hotlist, and *only* for these pairs, the bot analyzes every single 1-minute candle, waiting for the exact moment the breakout begins. The trade is triggered instantly when these two micro-conditions are met:

1.  **MOMENTUM SHIFT (The Spark):** The immediate, short-term momentum must flip bullish.
    *   **Tool:** 9-period Exponential Moving Average (EMA9) on the 1-minute (1m) chart.
    *   **Condition:** A 1-minute candle **closes above the EMA9**.

2.  **VOLUME CONFIRMATION (The Fuel):** The breakout must be backed by a surge in buying interest.
    *   **Tool:** Trading Volume on the 1-minute (1m) chart.
    *   **Condition:** The volume of the trigger candle is significantly higher than average (e.g., **> 1.5 times the average of the last 20 minutes**).

When this precise combination occurs, the bot enters a `BUY` order immediately, capturing the move far earlier than a strategy based on waiting for a 15-minute candle to close.

### Phase 3: Dynamic Trade Management (Protecting and Maximizing Profits)

Once a trade is open, the exit management is just as critical. It is fully automated and adapts to the chosen risk profile (e.g., `PRUDENT`, `EQUILIBRE`).

1.  **STOP LOSS (Initial Protection):**
    *   **Placement:** The initial Stop Loss is placed logically just **below the low of the 1-minute trigger candle**. This provides a tight, structurally sound invalidation point for the trade.
    *   **Dynamic Adaptation (ATR):** In `PRUDENT` mode, the Stop Loss distance can be calculated using the Average True Range (ATR), which automatically adapts to the pair's current volatility.

2.  **ADVANCED RISK MANAGEMENT (The "Profit Runner" Strategy):**
    As a trade becomes profitable, a sequence of automated actions is triggered to secure gains and let winners run:
    *   **Step 1: Partial Take Profit:** As the trade hits an initial profit target (e.g., +0.8% in PRUDENT mode), the bot sells a portion of the position (e.g., 50%). This secures initial profit and significantly reduces the capital at risk.
    *   **Step 2: Move to Break-even:** Immediately after the partial sale, the Stop Loss is moved to the entry price. At this point, **the trade can no longer become a loss**.
    *   **Step 3: Trailing Stop Loss:** For the remainder of the position, a Trailing Stop Loss is activated. It follows the price as it moves up, locking in more and more profit, but it never moves down. This allows the bot to "ride the wave" and capture the entirety of a strong upward move until the trend shows signs of reversing.

---
# Version Française

## 🧠 Stratégie de Trading : “Le Chasseur de Précision Macro-Micro”

La philosophie du bot est de combiner une analyse **"Macro"** à haute échelle de temps pour trouver des environnements à forte probabilité, avec une analyse **"Micro"** à basse échelle de temps pour identifier le point d'entrée parfait. Cela permet d'éviter le "bruit" des petites unités de temps tout en capturant le début explosif d'un mouvement avec une précision chirurgicale.

### Phase 1 : Le Radar Macro (Détection des Zones d'Intérêt sur 15m/4h)

Le bot scanne en permanence toutes les paires pour identifier celles qui sont "prêtes" pour un potentiel mouvement explosif. Au lieu de trader immédiatement, il ajoute ces paires qualifiées à une **"Hotlist"** (marquée par une icône 🎯 dans le scanner). Une paire entre sur la Hotlist si elle remplit deux critères stricts :

1.  **FILTRE DE TENDANCE MAÎTRE (Le Contexte) :** La paire doit être dans une tendance haussière de fond, confirmée et puissante.
    *   **Outil** : Graphique en 4 heures (4h).
    *   **Condition** : Le prix actuel est **au-dessus de sa Moyenne Mobile Exponentielle 50 (MME50)**. Cela garantit que nous ne tradons qu'avec le momentum dominant du marché.

2.  **COMPRESSION DE VOLATILITÉ (La Préparation) :** Le marché doit se consolider et accumuler de l'énergie, comme un ressort que l'on comprime.
    *   **Outil** : Bandes de Bollinger sur le graphique en 15 minutes (15m).
    *   **Condition** : La paire est dans un **"Squeeze" des Bandes de Bollinger**. Ceci est détecté lorsque la largeur actuelle des bandes est dans les 25% les plus bas de ses valeurs sur les 50 dernières périodes. Cela signale une période de calme et d'accumulation avant une expansion probable de la volatilité.

Si ces deux conditions sont remplies, la paire est ajoutée à la **Hotlist**. Le bot "zoome" alors et passe à la Phase 2.

### Phase 2 : Le Déclencheur Micro (Entrée de Précision sur 1m)

Pour les paires sur la Hotlist, et *uniquement* pour celles-ci, le bot analyse chaque bougie de 1 minute, attendant le moment exact où la cassure commence. Le trade est déclenché instantanément lorsque ces deux micro-conditions sont réunies :

1.  **CHANGEMENT DE MOMENTUM (L'Étincelle) :** Le momentum immédiat à très court terme doit basculer à la hausse.
    *   **Outil** : Moyenne Mobile Exponentielle 9 (MME9) sur le graphique en 1 minute (1m).
    *   **Condition** : Une bougie de 1 minute **clôture au-dessus de la MME9**.

2.  **CONFIRMATION PAR LE VOLUME (Le Carburant) :** La cassure doit être soutenue par une vague d'intérêt acheteur.
    *   **Outil** : Volume sur le graphique en 1 minute (1m).
    *   **Condition** : Le volume de la bougie de déclenchement est significativement supérieur à la moyenne (ex: **> 1.5 fois la moyenne des 20 dernières minutes**).

Lorsque cette combinaison précise se produit, le bot ouvre un ordre d'achat (`BUY`) immédiatement, capturant le mouvement bien plus tôt qu'une stratégie qui attendrait la clôture d'une bougie de 15 minutes.

### Phase 3 : Gestion Dynamique du Trade (Protéger et Maximiser les Gains)

Une fois qu'un trade est ouvert, la gestion de la sortie est tout aussi critique. Elle est entièrement automatisée et s'adapte au profil de risque choisi (ex: `PRUDENT`, `EQUILIBRE`).

1.  **STOP LOSS (Protection Initiale)** :
    *   **Placement** : Le Stop Loss initial est placé logiquement juste **en dessous du point bas de la bougie de 1 minute qui a déclenché le trade**. Cela fournit un point d'invalidation serré et structurellement solide.
    *   **Adaptation Dynamique (ATR)** : En mode `PRUDENT`, la distance du Stop Loss peut être calculée via l'Average True Range (ATR), qui s'adapte automatiquement à la volatilité actuelle de la paire.

2.  **GESTION AVANCÉE DU RISQUE (La Stratégie "Profit Runner")** :
    Dès qu'un trade devient profitable, une séquence d'actions automatiques est déclenchée pour sécuriser les gains et laisser les gagnants courir :
    *   **Étape 1 : Prise de Profit Partielle** : Lorsque le trade atteint un premier objectif (ex: +0.8% en mode PRUDENT), le bot vend une partie de la position (ex: 50%). Cela sécurise un gain initial et réduit considérablement le capital à risque.
    *   **Étape 2 : Mise à Seuil de Rentabilité (Break-even)** : Immédiatement après la vente partielle, le Stop Loss est déplacé au prix d'entrée. À ce stade, **le trade ne peut plus devenir perdant**.
    *   **Étape 3 : Stop Loss Suiveur (Trailing Stop Loss)** : Pour le reste de la position, un Stop Loss suiveur est activé. Il suit le prix à la hausse, verrouillant de plus en plus de profit, mais ne descend jamais. Cela permet au bot de "surfer la vague" et de capturer l'intégralité d'un fort mouvement haussier jusqu'à ce que la tendance montre des signes d'inversion.
