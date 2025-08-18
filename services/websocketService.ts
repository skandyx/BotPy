import { WebSocketStatus } from '../types';
import { logService } from './logService';
import { priceStore } from './priceStore';
import { scannerStore } from './scannerStore';

export interface PriceUpdate {
    symbol: string;
    price: number;
}

type StatusChangeCallback = (status: WebSocketStatus) => void;

let socket: WebSocket | null = null;
let statusCallback: StatusChangeCallback | null = null;
let reconnectTimeout: number | null = null; // For auto-reconnect on unexpected close
let isManualDisconnect = false;

// --- State management for multiple subscription owners ---
let watchedSymbols = new Set<string>();
const symbolOwners = new Map<string, Set<string>>();
// ---

// --- Debounce timer for reconnection logic to prevent race conditions ---
let reconnectDebounceTimer: number | null = null;
// ---


const BINANCE_BASE_URL = 'wss://stream.binance.com:9443/stream';

const getStreamNamesForSymbols = (symbols: string[]): string[] => {
    const streams: string[] = [];
    symbols.forEach(s => {
        const symbolLower = s.toLowerCase();
        streams.push(`${symbolLower}@miniTicker`); // For fast price updates
        streams.push(`${symbolLower}@kline_1m`);
        streams.push(`${symbolLower}@kline_15m`);
        streams.push(`${symbolLower}@kline_1h`);
    });
    return streams;
};

const connect = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        logService.log('WEBSOCKET', 'Connection attempt ignored, socket already open or connecting.');
        return;
    }
    isManualDisconnect = false;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    if (watchedSymbols.size === 0) {
        logService.log('WEBSOCKET', 'No symbols to watch. WebSocket connection deferred.');
        statusCallback?.(WebSocketStatus.DISCONNECTED);
        return;
    }
    
    const streams = getStreamNamesForSymbols(Array.from(watchedSymbols));
    const fullUrl = `${BINANCE_BASE_URL}?streams=${streams.join('/')}`;
    
    logService.log('WEBSOCKET', `Connecting to Binance combined stream...`);
    statusCallback?.(WebSocketStatus.CONNECTING);
    socket = new WebSocket(fullUrl);

    socket.onopen = () => {
        logService.log('WEBSOCKET', `WebSocket connected successfully to ${watchedSymbols.size} pairs.`);
        statusCallback?.(WebSocketStatus.CONNECTED);
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (!message.stream || !message.data) return;

            const symbol = message.data.s.toUpperCase();

            if (message.data.e === '24hrMiniTicker') {
                const price = parseFloat(message.data.c);
                priceStore.updatePrice({ symbol, price });

            } else if (message.data.e === 'kline') {
                const kline = message.data.k;
                const interval = kline.i;
                const isClosed = kline.x;

                // Update real-time price from kline's close price for UI responsiveness
                priceStore.updatePrice({ symbol, price: parseFloat(kline.c) });

                // We only care about closed candles for logging and calculations
                if (isClosed) {
                    logService.log('WEBSOCKET', `[KLINE CLOSED] ${symbol} | ${interval} | C: ${kline.c}`);

                    // If it's a closed 1-minute candle, notify the scannerStore to update indicators
                    if (interval === '1m') {
                        scannerStore.handleKlineUpdate(message.data);
                    }
                }
            }
        } catch (error) {
            logService.log('ERROR', `Failed to parse WebSocket message: ${event.data}`);
        }
    };

    socket.onclose = () => {
        statusCallback?.(WebSocketStatus.DISCONNECTED);
        socket = null;
        if (!isManualDisconnect) {
            logService.log('WARN', 'WebSocket disconnected. Attempting to reconnect in 5s...');
            reconnectTimeout = window.setTimeout(connect, 5000);
        } else {
            logService.log('INFO', 'WebSocket disconnected manually.');
        }
    };

    socket.onerror = (error) => {
        logService.log('ERROR', `WebSocket error: ${(error as Event).type}. Closing socket.`);
        statusCallback?.(WebSocketStatus.DISCONNECTED);
        socket?.close();
    };
};

const disconnect = () => {
    isManualDisconnect = true;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (reconnectDebounceTimer) {
        clearTimeout(reconnectDebounceTimer);
        reconnectDebounceTimer = null;
    }

    // Full state reset to prevent issues with React StrictMode double-invoking effects
    symbolOwners.clear();
    watchedSymbols.clear();
    
    if (socket) {
        logService.log('INFO', 'Manual disconnect initiated. Clearing state and closing socket.');
        // Nullify handlers to prevent the onclose event from triggering a reconnect, which can cause a race condition.
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
        socket = null;
    }
};


// This is the function that will actually perform the reconnection logic.
const _executeReconnect = () => {
    // 1. Consolidate all symbols from all owners into a single unique set.
    const newSymbolSet = new Set<string>();
    for (const ownerSymbols of symbolOwners.values()) {
        for (const symbol of ownerSymbols) {
            newSymbolSet.add(symbol);
        }
    }

    // 2. Check if the final list of symbols has actually changed.
    const areSetsEqual = (a: Set<string>, b: Set<string>) => {
        if (a.size !== b.size) return false;
        for (const item of a) if (!b.has(item)) return false;
        return true;
    };

    if (areSetsEqual(watchedSymbols, newSymbolSet) && socket?.readyState === WebSocket.OPEN) {
        logService.log('WEBSOCKET', `Watch list unchanged (${newSymbolSet.size} symbols) and socket connected. No reconnection needed.`);
        return; 
    }

    logService.log('WEBSOCKET', `Symbol watch list updated. Reconnecting WebSocket. New count: ${newSymbolSet.size}, Old count: ${watchedSymbols.size}`);
    watchedSymbols = newSymbolSet;

    // 3. Disconnect existing socket before creating a new one.
    if (socket) {
        logService.log('WEBSOCKET', 'Previous WebSocket connection closed for list update.');
        // Nullify handlers of the old socket to prevent its onclose event from firing and causing a race condition with the new connection.
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
        socket = null; // Null out the reference immediately to allow a new connection.
    }
    
    // 4. Connect with the new set of symbols.
    connect();
}

// This function is called by owners. It debounces the actual reconnection.
const _updateAndReconnect = () => {
    if (reconnectDebounceTimer) {
        clearTimeout(reconnectDebounceTimer);
    }
    // After a short delay, execute the reconnect. This batches multiple rapid calls (e.g., on startup).
    reconnectDebounceTimer = window.setTimeout(_executeReconnect, 250); 
}

/**
 * Registers a component or service (an "owner") and its desired list of symbols.
 * The WebSocket service will manage the combined list from all owners.
 * @param owner A unique identifier for the subscriber (e.g., 'scanner', 'engine').
 * @param symbols The list of symbols the owner wants to watch. An empty array removes the owner's contribution.
 */
const registerOwner = (owner: string, symbols: string[]) => {
    logService.log('WEBSOCKET', `Registering owner '${owner}' with ${symbols.length} symbols.`);
    symbolOwners.set(owner, new Set(symbols));
    _updateAndReconnect();
};


export const websocketService = {
    connect: () => { // The main connect/disconnect are for the bot's global state
         isManualDisconnect = false;
         _updateAndReconnect();
    },
    disconnect,
    registerOwner,
    onStatusChange: (callback: StatusChangeCallback) => {
        statusCallback = callback;
    },
};