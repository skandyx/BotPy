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

The process is a multi-stage funnel:

### **Phase 1: Macro Scan & Hotlist Qualification (4h / 15m)**

The bot continuously scans all USDT pairs, looking for those that are "primed" for a potential explosive move. Instead of trading immediately, it adds qualified pairs to a **"Hotlist"** (marked with a 🎯 in the scanner). A pair must pass three strict macro filters to be considered:

1.  **✅ MASTER TREND FILTER (The Context - 4h Chart):** The pair must be in a confirmed, powerful long-term uptrend.
    *   **Condition:** The current price is **above its 50-period Exponential Moving Average (EMA50)**. This ensures we are only trading with the dominant market momentum.

2.  **✅ VOLUME SPIKE FILTER (The Fuel Check - 4h Chart):** The pair must show a significant increase in recent trading activity, signaling institutional interest.
    *   **Condition:** The volume of the most recent 4-hour candle is **greater than 2 times the average volume of the previous 20 candles**. This filters out low-conviction moves and focuses on assets "waking up".

3.  **✅ VOLATILITY COMPRESSION (The Preparation - 15m Chart):** The market must be consolidating and building up energy, like a coiled spring.
    *   **Condition:** The pair is in a **Bollinger Band Squeeze**. This is detected when the width of the bands on the *previous* 15m candle was in the lowest 25% of its values over the last 50 periods. It signals quiet accumulation before a likely expansion in volatility.

If all three conditions are met, the pair is placed on the **Hotlist**. The bot now "zooms in" and proceeds to Phase 2, analyzing every 1-minute candle for this specific pair.

### **Phase 2: Micro Trigger & Safety Checks (1m)**

For pairs on the Hotlist, and *only* for these pairs, the bot waits for the exact moment the breakout begins. The trade is triggered instantly only if all the following micro-conditions and safety checks are met:

1.  **✅ MOMENTUM SHIFT (The Spark - 1m Chart):** The immediate, short-term momentum must flip bullish.
    *   **Condition:** A 1-minute candle **closes above the 9-period Exponential Moving Average (EMA9)**.

2.  **✅ VOLUME CONFIRMATION (The Fuel - 1m Chart):** The breakout must be backed by a surge in buying interest.
    *   **Condition:** The volume of the trigger candle is significantly higher than average (e.g., **> 1.5 times the average of the last 20 minutes**).

3.  **⚠️ SAFETY FILTER 1: RSI CHECK (The Overheating Guard - 1h Chart):** The bot avoids buying into an already over-extended market.
    *   **Condition:** The 1-hour RSI must be **below the configured overbought threshold** (e.g., < 70).

4.  **⚠️ SAFETY FILTER 2: PARABOLIC CHECK (The Fakeout Guard - 1m Chart):** The bot avoids buying into a sudden, vertical price spike which is often a trap.
    *   **Condition:** The price has **not increased by more than a configured percentage** (e.g., 3%) over a short lookback period (e.g., 5 minutes).

If all four conditions are met, the bot enters a `BUY` order immediately and removes the pair from the Hotlist to prevent re-entry.

### **Phase 3: Dynamic Trade Management (Protecting & Maximizing Profits)**

Once a trade is open, the exit management is just as critical and is fully automated.

1.  **STOP LOSS (Initial Protection):**
    *   **Placement:** The initial Stop Loss is placed logically just **below the low of the 1-minute trigger candle**. This provides a tight, structurally sound invalidation point.
    *   **Dynamic Adaptation (ATR):** In `PRUDENT` mode, the Stop Loss distance can be calculated using the Average True Range (ATR), which automatically adapts to the pair's current volatility.

2.  **ADVANCED RISK MANAGEMENT (The "Profit Runner" Strategy):**
    As a trade becomes profitable, a sequence of automated actions is triggered to secure gains and let winners run:
    *   **Step 1: Partial Take Profit:** As the trade hits an initial profit target (e.g., +0.8% in PRUDENT mode), the bot sells a portion of the position (e.g., 50%). This secures initial profit and significantly reduces the capital at risk.
    *   **Step 2: Move to Break-even:** Immediately after the partial sale, the Stop Loss is moved to the entry price. At this point, **the trade can no longer become a loss**.
    *   **Step 3: Trailing Stop Loss:** For the remainder of the position, a Trailing Stop Loss is activated. It follows the price as it moves up, locking in more and more profit, but it never moves down. This allows the bot to "ride the wave" and capture the entirety of a strong upward move until the trend shows signs of reversing.

### Adaptive Behavior Profiles

To maximize effectiveness across various market conditions, the bot features three distinct trading profiles. Each profile not only adjusts risk but fundamentally alters the trade management philosophy to adapt to a specific market environment.

#### 1. "The Sniper" Profile (Prudent)
-   **Philosophy:** Never lose money. Wait for the perfect A+++ setup. Absolute quality over quantity.
-   **Ideal for:** A market with a clear, strong trend where avoiding any false signals is paramount.
-   **Key Settings:**
    -   **Strict Filters:** `REQUIRE_STRONG_BUY` is enabled. `USE_RSI_SAFETY_FILTER` and `USE_PARABOLIC_FILTER` are activated with very sensitive settings for maximum safety.
    -   **Trade Management:** Utilizes the full "Profit Runner" sequence. A **very fast partial take-profit** to secure initial gains, an immediate move to break-even, and a **very wide trailing stop** to let winners run and capture the entire trend.

#### 2. "The Scalper" Profile (Balanced)
-   **Philosophy:** Take small, quick, and consistent profits. Accumulate small wins repeatedly.
-   **Ideal for:** A less directional, ranging market where major trends are rare but small, predictable movements occur.
-   **Key Settings:**
    -   **Moderate Filters:** Safety filters are slightly more lenient to allow for more entry opportunities.
    -   **Trade Management:** The goal is a quick, binary exit. A **very tight Take Profit** (e.g., 1.5%). **NO partial take-profit and NO trailing stop.** The bot has a single objective and sticks to it.

#### 3. "The Volatility Hunter" Profile (Aggressive)
-   **Philosophy:** The opportunity lies in the explosion of volatility. Accept a higher initial risk for a potentially much larger reward.
-   **Ideal for:** A highly volatile market (e.g., after a major economic announcement) where 5-10% moves can happen quickly.
-   **Key Settings:**
    -   **Loose Filters:** Safety filters like `RSI` and `Parabolic` are disabled to allow entry into powerful, already-in-progress moves.
    -   **Trade Management:** The **initial Stop Loss is wider** (based on ATR) to survive the volatility of a breakout. Once the trade is in profit, an **aggressive, tight trailing stop** is activated to secure gains very quickly, as volatility can reverse just as fast.

---
# Version Française

## 🧠 Stratégie de Trading : “Le Chasseur de Précision Macro-Micro”

La philosophie du bot est de combiner une analyse **"Macro"** à haute échelle de temps pour trouver des environnements à forte probabilité, avec une analyse **"Micro"** à basse échelle de temps pour identifier le point d'entrée parfait. Cela permet d'éviter le "bruit" des petites unités de temps tout en capturant le début explosif d'un mouvement avec une précision chirurgicale.

Le processus est un entonnoir en plusieurs étapes :

### **Phase 1 : Scan Macro & Qualification sur la Hotlist (4h / 15m)**

Le bot scanne en permanence toutes les paires USDT, à la recherche de celles qui sont "prêtes" pour un potentiel mouvement explosif. Au lieu de trader immédiatement, il ajoute les paires qualifiées à une **"Hotlist"** (marquée par un `🎯` dans le scanner). Une paire doit passer trois filtres macro stricts pour être considérée :

1.  **✅ FILTRE DE TENDANCE MAÎTRE (Le Contexte - Graphique 4h) :** La paire doit être dans une tendance haussière de fond, confirmée et puissante.
    *   **Condition :** Le prix actuel est **au-dessus de sa Moyenne Mobile Exponentielle 50 (MME50)**. Cela garantit que nous ne tradons qu'avec le momentum dominant du marché.

2.  **✅ FILTRE DE PIC DE VOLUME (La Vérification du Carburant - Graphique 4h) :** La paire doit montrer une augmentation significative de son activité récente, signalant un intérêt institutionnel.
    *   **Condition :** Le volume de la plus récente bougie de 4 heures est **supérieur à 2 fois le volume moyen des 20 bougies précédentes**. Cela élimine les mouvements sans conviction et concentre le bot sur les actifs qui "se réveillent".

3.  **✅ COMPRESSION DE VOLATILITÉ (La Préparation - Graphique 15m) :** Le marché doit se consolider et accumuler de l'énergie, comme un ressort que l'on comprime.
    *   **Condition :** La paire est dans un **"Squeeze" des Bandes de Bollinger**. Ceci est détecté lorsque la largeur des bandes sur la bougie de 15m *précédente* était dans les 25% les plus bas de ses valeurs sur les 50 dernières périodes. Cela signale une accumulation calme avant une expansion probable de la volatilité.

Si ces trois conditions sont remplies, la paire est placée sur la **Hotlist**. Le bot "zoome" alors et passe à la Phase 2, analysant chaque bougie de 1 minute pour cette paire spécifique.

### **Phase 2 : Déclencheur Micro & Vérifications de Sécurité (1m)**

Pour les paires sur la Hotlist, et *uniquement* pour celles-ci, le bot attend le moment exact où la cassure commence. Le trade est déclenché instantanément seulement si toutes les micro-conditions et vérifications de sécurité suivantes sont remplies :

1.  **✅ CHANGEMENT DE MOMENTUM (L'Étincelle - Graphique 1m) :** Le momentum immédiat à très court terme doit basculer à la hausse.
    *   **Condition :** Une bougie de 1 minute **clôture au-dessus de la Moyenne Mobile Exponentielle 9 (MME9)**.

2.  **✅ CONFIRMATION PAR LE VOLUME (Le Carburant - Graphique 1m) :** La cassure doit être soutenue par une vague d'intérêt acheteur.
    *   **Condition :** Le volume de la bougie de déclenchement est significativement supérieur à la moyenne (ex: **> 1.5 fois la moyenne des 20 dernières minutes**).

3.  **⚠️ FILTRE DE SÉCURITÉ 1 : VÉRIFICATION RSI (Le Garde-fou Anti-Surchauffe - Graphique 1h) :** Le bot évite d'acheter sur un marché déjà sur-étendu.
    *   **Condition :** Le RSI 1 heure doit être **inférieur au seuil de surachat configuré** (ex: < 70).

4.  **⚠️ FILTRE DE SÉCURITÉ 2 : VÉRIFICATION PARABOLIQUE (Le Garde-fou Anti-Fausse Cassure - Graphique 1m) :** Le bot évite d'acheter sur un pic de prix soudain et vertical qui est souvent un piège.
    *   **Condition :** Le prix n'a **pas augmenté de plus d'un pourcentage configuré** (ex: 3%) sur une courte période de temps (ex: 5 minutes).

Si ces quatre conditions sont remplies, le bot ouvre un ordre d'achat (`BUY`) immédiatement et retire la paire de la Hotlist pour éviter une nouvelle entrée.

### **Phase 3 : Gestion Dynamique du Trade (Protéger & Maximiser les Gains)**

Une fois qu'un trade est ouvert, la gestion de la sortie est tout aussi critique et est entièrement automatisée.

1.  **STOP LOSS (Protection Initiale)** :
    *   **Placement** : Le Stop Loss initial est placé logiquement juste **en dessous du point bas de la bougie de 1 minute qui a déclenché le trade**. Cela fournit un point d'invalidation serré et structurellement solide.
    *   **Adaptation Dynamique (ATR)** : En mode `PRUDENT`, la distance du Stop Loss peut être calculée via l'Average True Range (ATR), qui s'adapte automatiquement à la volatilité actuelle de la paire.

2.  **GESTION AVANCÉE DU RISQUE (La Stratégie "Profit Runner")** :
    Dès qu'un trade devient profitable, une séquence d'actions automatiques est déclenchée pour sécuriser les gains et laisser les gagnants courir :
    *   **Étape 1 : Prise de Profit Partielle** : Lorsque le trade atteint un premier objectif (ex: +0.8% en mode PRUDENT), le bot vend une partie de la position (ex: 50%). Cela sécurise un gain initial et réduit considérablement le capital à risque.
    *   **Étape 2 : Mise à Seuil de Rentabilité (Break-even)** : Immédiatement après la vente partielle, le Stop Loss est déplacé au prix d'entrée. À ce stade, **le trade ne peut plus devenir perdant**.
    *   **Étape 3 : Stop Loss Suiveur (Trailing Stop Loss)** : Pour le reste de la position, un Stop Loss suiveur est activé. Il suit le prix à la hausse, verrouillant de plus en plus de profit, mais ne descend jamais. Cela permet au bot de "surfer la vague" et de capturer l'intégralité d'un fort mouvement haussier jusqu'à ce que la tendance montre des signes d'inversion.

### Profils de Comportement Adaptatifs

Pour maximiser l'efficacité dans diverses conditions de marché, le bot propose trois profils de trading distincts. Chaque profil ajuste non seulement le risque, mais modifie fondamentalement la philosophie de gestion des trades pour s'adapter à un environnement de marché spécifique.

#### 1. Profil "Le Sniper" (Prudent)
-   **Philosophie :** Ne jamais perdre d'argent. Attendre la configuration A+++ parfaite. Qualité absolue sur la quantité.
-   **Idéal pour :** Un marché avec une tendance claire et forte, où l'on veut éviter tout faux signal.
-   **Paramètres Clés :**
    -   **Filtres Stricts :** `REQUIRE_STRONG_BUY` est activé, `USE_RSI_SAFETY_FILTER` et `USE_PARABOLIC_FILTER` sont activés avec des réglages très sensibles pour une sécurité maximale.
    -   **Gestion du Trade :** Utilise la séquence complète du "Profit Runner". Prise de profit partielle **très rapide** pour sécuriser les gains, mise à break-even immédiate, et **Stop suiveur très large** pour laisser les gagnants courir et capturer toute la tendance.

#### 2. Profil "Le Scalpeur" (Équilibré)
-   **Philosophie :** Prendre des petits profits rapides et constants. Accumuler les petits gains de manière répétée.
-   **Idéal pour :** Un marché moins directionnel, en "range", où les grandes tendances sont rares mais où de petits mouvements prévisibles se produisent.
-   **Paramètres Clés :**
    -   **Filtres Modérés :** Les filtres de sécurité sont un peu plus souples pour permettre plus d'entrées.
    -   **Gestion du Trade :** L'objectif est de sortir rapidement et de manière binaire. **Take Profit très serré** (ex: 1.5%). **PAS de prise de profit partielle ni de stop suiveur.** Le bot a un objectif unique et s'y tient.

#### 3. Profil "Le Chasseur de Volatilité" (Agressif)
-   **Philosophie :** L'opportunité est dans l'explosion de volatilité. Accepter un risque initial plus élevé pour un gain potentiel beaucoup plus grand.
-   **Idéal pour :** Un marché très volatil (par exemple, après une annonce économique majeure) où des mouvements de 5-10% peuvent se produire rapidement.
-   **Paramètres Clés :**
    -   **Filtres Larges :** Les filtres de sécurité comme le `RSI` et `Parabolique` sont désactivés pour permettre d'entrer dans des mouvements déjà en cours et puissants.
    -   **Gestion du Trade :** Le **Stop Loss initial est plus large** (basé sur l'ATR) pour survivre à la volatilité d'une cassure. Une fois que le trade est en profit, un **Stop suiveur agressif et serré** est activé pour sécuriser les gains très rapidement, car la volatilité peut se retourner tout aussi vite.