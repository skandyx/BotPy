import { WebSocketStatus } from '../types';
import { logService } from './logService';
import { priceStore } from './priceStore';
import { positionService } from './positionService';

export interface PriceUpdate {
    symbol: string;
    price: number;
}

type StatusChangeCallback = (status: WebSocketStatus) => void;

let socket: WebSocket | null = null;
let statusCallback: StatusChangeCallback | null = null;
let reconnectTimeout: number | null = null;
let isManualDisconnect = false;
let watchedSymbols = new Set<string>();

const getWebSocketURL = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}`;
};

const connect = () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        logService.log('WEBSOCKET', 'Connection attempt ignored, socket already open or connecting.');
        return;
    }
    isManualDisconnect = false;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);

    const url = getWebSocketURL();
    logService.log('WEBSOCKET', `Connecting to backend at ${url}...`);
    statusCallback?.(WebSocketStatus.CONNECTING);
    socket = new WebSocket(url);

    socket.onopen = () => {
        logService.log('WEBSOCKET', 'Successfully connected to backend.');
        statusCallback?.(WebSocketStatus.CONNECTED);
        // On connection, tell the backend which symbols we care about
        subscribeToSymbols(Array.from(watchedSymbols));
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            switch (message.type) {
                case 'PRICE_UPDATE':
                    priceStore.updatePrice(message.payload);
                    break;
                case 'POSITIONS_UPDATED':
                    logService.log('TRADE', 'Positions updated by backend, fetching new data...');
                    api.fetchActivePositions().then(positionService._initialize);
                    api.fetchTradeHistory(); // Potentially trigger update on history page
                    break;
                case 'BOT_STATUS_UPDATE':
                    // This can be handled by a context if needed in the future
                    logService.log('INFO', `Bot running state is now: ${message.payload.isRunning}`);
                    break;
                default:
                    logService.log('WEBSOCKET', `Received unknown message type: ${message.type}`);
            }
        } catch (error) {
            logService.log('ERROR', `Failed to parse WebSocket message: ${event.data}`);
        }
    };

    socket.onclose = () => {
        statusCallback?.(WebSocketStatus.DISCONNECTED);
        socket = null;
        if (!isManualDisconnect) {
            logService.log('WARN', 'WebSocket disconnected from backend. Attempting to reconnect in 5s...');
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
    watchedSymbols.clear();
    if (socket) {
        socket.close();
        socket = null;
    }
};

const subscribeToSymbols = (symbols: string[]) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        logService.log('WEBSOCKET', `Sending subscription request for ${symbols.length} symbols.`);
        socket.send(JSON.stringify({ type: 'SUBSCRIBE', symbols }));
    } else {
        logService.log('WEBSOCKET', 'Socket not open. Subscription deferred until connection is established.');
    }
};

const registerOwner = (owner: string, symbols: string[]) => {
    // For simplicity in the new architecture, we'll just combine all symbols.
    // A more complex system could track owners, but this works.
    let changed = false;
    symbols.forEach(s => {
        if (!watchedSymbols.has(s)) {
            watchedSymbols.add(s);
            changed = true;
        }
    });

    if (changed) {
        subscribeToSymbols(Array.from(watchedSymbols));
    }
};

export const websocketService = {
    connect,
    disconnect,
    registerOwner,
    onStatusChange: (callback: StatusChangeCallback) => {
        statusCallback = callback;
    },
};
// This is a bit of a hack to avoid circular dependencies with mockApi
import { api } from './mockApi';
