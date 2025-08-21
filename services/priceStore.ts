import { PriceUpdate } from './websocketService';
import { scannerStore } from './scannerStore';

type PriceStoreSubscriber = (update: PriceUpdate) => void;

class PriceStore {
    private prices = new Map<string, PriceUpdate>();
    private subscribers = new Set<PriceStoreSubscriber>();

    public subscribe(callback: PriceStoreSubscriber): () => void {
        this.subscribers.add(callback);
        // Return an unsubscribe function
        return () => this.unsubscribe(callback);
    }

    public unsubscribe(callback: PriceStoreSubscriber): void {
        this.subscribers.delete(callback);
    }

    public updatePrice(update: PriceUpdate): void {
        this.prices.set(update.symbol, update);
        // The scanner store is updated via the main 'SCANNER_UPDATE' websocket message.
        // Calling it here is redundant and inefficient.
        // scannerStore.handlePriceUpdate(update);
        
        // Notify direct subscribers (like positionService for real-time PnL)
        this.subscribers.forEach(callback => callback(update));
    }

    public getPrice(symbol: string): PriceUpdate | undefined {
        return this.prices.get(symbol);
    }
}

export const priceStore = new PriceStore();