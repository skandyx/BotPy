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
        // Notify the scanner store to merge the real-time price
        scannerStore.handlePriceUpdate(update);
        // Notify direct subscribers (like positionService)
        this.subscribers.forEach(callback => callback(update));
    }

    public getPrice(symbol: string): PriceUpdate | undefined {
        return this.prices.get(symbol);
    }
}

export const priceStore = new PriceStore();