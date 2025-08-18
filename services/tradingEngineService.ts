
import { api } from './mockApi';
import { websocketService } from './websocketService';
import { logService } from './logService';
import { Trade, OrderSide, TradingMode } from '../types';
import { priceStore } from './priceStore';
import { positionService } from './positionService';
import { scannerStore } from './scannerStore';

let engineInterval: number | null = null;
const ENGINE_TICK_RATE = 5000; // 5 seconds

// Using a class to better manage state and dependencies
class TradingEngine {
    private activePositions: Trade[] = []; // Local copy, updated via subscription
    private isRunning = false;
    private notifyUI: () => void = () => {};
    private positionStoreUnsubscribe: (() => void) | null = null;
    private recentlyLostSymbols = new Map<string, number>(); // symbol -> cooldownEndTime (timestamp)
    private currentMode: TradingMode = TradingMode.VIRTUAL; // Internal state for the mode

    public start(onTradeActivity: () => void) {
        if (this.isRunning) return;
        this.isRunning = true;
        this.notifyUI = onTradeActivity;

        // Subscribe to the central position store to keep our local list in sync
        this.positionStoreUnsubscribe = positionService.subscribe(this.handlePositionUpdate);
        
        engineInterval = window.setInterval(() => this.tick(), ENGINE_TICK_RATE);
        logService.log('INFO', `[Trading Engine] Started in ${this.currentMode} mode.`);
    }

    public stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        if (engineInterval) {
            clearInterval(engineInterval);
            engineInterval = null;
        }

        this.positionStoreUnsubscribe?.();
        this.positionStoreUnsubscribe = null;
        this.recentlyLostSymbols.clear();

        // Clean up its WebSocket subscriptions
        websocketService.registerOwner('engine', []);

        this.activePositions = [];
        logService.log('INFO', "[Trading Engine] Stopped.");
    }

    public setMode(mode: TradingMode) {
        if (this.currentMode !== mode) {
            this.currentMode = mode;
            logService.log('INFO', `[Trading Engine] Mode switched to ${mode}.`);
        }
    }

    // This method is called by the positionService whenever positions change
    private handlePositionUpdate = (positions: Trade[]) => {
        this.activePositions = positions;
        const symbols = positions.map(p => p.symbol);
        websocketService.registerOwner('engine', symbols);
    };

    /**
     * Called when a trade is closed, either by logic or manually.
     * Registers a cooldown period for the symbol if the trade was a loss.
     */
    public registerClosedTrade(trade: Trade) {
        if ((trade.pnl || 0) < 0) {
            this.triggerCooldown(trade.symbol);
        }
    }

    private async triggerCooldown(symbol: string) {
        try {
            const settings = await api.fetchSettings();
            if (settings.LOSS_COOLDOWN_HOURS > 0) {
                const cooldownMs = settings.LOSS_COOLDOWN_HOURS * 3600 * 1000;
                const cooldownEndTime = Date.now() + cooldownMs;
                this.recentlyLostSymbols.set(symbol, cooldownEndTime);
                logService.log('TRADE', `[Cooldown] ${symbol} is on cooldown for ${settings.LOSS_COOLDOWN_HOURS} hours due to a recent loss.`);
            }
        } catch (error) {
             logService.log('ERROR', `[Trading Engine] Could not fetch settings for cooldown logic: ${error}`);
        }
    }
    
    private async tick() {
        if (!this.isRunning) return;
        await this.checkExits();
        await this.checkEntries();
    }

    private async checkExits() {
        try {
            const settings = await api.fetchSettings(); // Fetch latest settings for TSL logic
            
            for (const trade of [...this.activePositions]) { // Iterate over a copy
                const latestPriceData = priceStore.getPrice(trade.symbol);
                const currentPrice = latestPriceData?.price;
                if (!currentPrice) continue;

                // --- Trailing Stop Loss Logic ---
                if (settings.USE_TRAILING_STOP_LOSS && trade.side === OrderSide.BUY) {
                    if (currentPrice > trade.highest_price_since_entry) {
                        const newStopLoss = currentPrice * (1 - settings.TRAILING_STOP_LOSS_PCT / 100);
                        // Only update if the new stop loss is higher (locks in profit)
                        if (newStopLoss > trade.stop_loss) {
                            positionService.updatePosition(trade.id, {
                                stop_loss: newStopLoss,
                                highest_price_since_entry: currentPrice,
                            });
                            logService.log('TRADE', `[TSL] Adjusted Stop Loss for ${trade.symbol} to ${newStopLoss.toFixed(2)}.`);
                        }
                    }
                }

                // --- Standard Exit Logic (TP/SL) ---
                let shouldClose = false;
                let reason = '';

                if (trade.side === OrderSide.BUY) {
                    if (currentPrice >= trade.take_profit) {
                        shouldClose = true;
                        reason = 'TAKE PROFIT';
                    } else if (currentPrice <= trade.stop_loss) { // This stop_loss may have been updated by TSL
                        shouldClose = true;
                        reason = 'STOP LOSS';
                    }
                }
                
                if (shouldClose) {
                    logService.log('TRADE', `[Trading Engine] ${reason} hit for ${trade.symbol}. Attempting to close.`);
                    const closedTrade = await api.closeTrade(trade.id);
                    if (closedTrade) {
                        positionService.removePosition(trade.id);
                        this.registerClosedTrade(closedTrade);
                        this.notifyUI();
                    }
                }
            }
        } catch (error) {
            logService.log('ERROR', `[Trading Engine] Error during exit check: ${error}`);
        }
    }

    private async checkEntries() {
        try {
            const settings = await api.fetchSettings();
            if (positionService.getPositions().length >= settings.MAX_OPEN_POSITIONS) {
                return; // Don't check for new entries if we are at capacity
            }

            const scannedPairs = scannerStore.getScannedPairs();
            const activeSymbols = new Set(this.activePositions.map(p => p.symbol));

            for (const pair of scannedPairs) {
                // Check 1: Already in a position?
                if (activeSymbols.has(pair.symbol)) continue;

                // Check 2: Is the symbol on a cooldown from a recent loss?
                const cooldownEndTime = this.recentlyLostSymbols.get(pair.symbol);
                if (cooldownEndTime && Date.now() < cooldownEndTime) {
                    // Still in cooldown, skip.
                    continue; 
                } else if (cooldownEndTime) {
                    // Cooldown has expired, remove it.
                    this.recentlyLostSymbols.delete(pair.symbol);
                }

                if (pair.score === 'STRONG BUY' || pair.score === 'BUY') {
                    const currentPriceData = priceStore.getPrice(pair.symbol);
                     if (!currentPriceData) {
                        logService.log('WARN', `No live price data for ${pair.symbol}, cannot open trade.`);
                        continue;
                    }

                    switch (this.currentMode) {
                        case TradingMode.VIRTUAL:
                        case TradingMode.REAL_PAPER:
                            if (this.currentMode === TradingMode.REAL_PAPER) {
                                logService.log('BINANCE', `[REAL PAPER] Simulating BUY order for ${pair.symbol} @ ${currentPriceData.price}. NO REAL FUNDS USED.`);
                            }
                            const newTrade = await api.openTrade(pair.symbol, currentPriceData.price, this.currentMode);
                            if (newTrade) {
                                positionService.addPosition(newTrade);
                                this.notifyUI();
                            }
                            break;

                        case TradingMode.REAL_LIVE:
                            logService.log('WARN', `[REAL LIVE] Live trading signal for ${pair.symbol} received, but live trading is not yet implemented.`);
                            // In the future, this would call binanceApiService.createOrder(...)
                            break;
                    }

                    // Stop checking for new entries in this tick if we've reached the max open positions limit
                    if (positionService.getPositions().length >= settings.MAX_OPEN_POSITIONS) {
                        break;
                    }
                }
            }
        } catch (error) {
            logService.log('ERROR', `[Trading Engine] Error during entry check: ${error}`);
        }
    }
}

export const tradingEngineService = new TradingEngine();
