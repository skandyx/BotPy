import { WebSocketStatus, LogEntry } from '../types';
import { logService } from './logService';
import { priceStore } from './priceStore';
import { positionService } from './positionService';
import { scannerStore } from './scannerStore';

export interface PriceUpdate {
    symbol: string;
    price: number;
}

type StatusChangeCallback = (status: WebSocketStatus) => void;
type DataRefreshCallback = () => void;

let socket: WebSocket | null = null;
let statusCallback: StatusChangeCallback | null = null;
let dataRefreshCallback: DataRefreshCallback | null = null;
let reconnectTimeout: number | null = null;
let isManualDisconnect = false;
let watchedSymbols = new Set<string>();

const getWebSocketURL = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
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
        subscribeToSymbols(Array.from(watchedSymbols));
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            // Log the received message type for better traceability in the console's WEBSOCKET tab
            logService.log('WEBSOCKET', `Received message type '${message.type}' from backend.`);
            switch (message.type) {
                case 'PRICE_UPDATE':
                    priceStore.updatePrice(message.payload);
                    break;
                case 'SCANNER_UPDATE':
                    // This is the new primary message for real-time indicator/score updates
                    scannerStore.handleScannerUpdate(message.payload);
                    break;
                case 'POSITIONS_UPDATED':
                    logService.log('TRADE', 'Positions updated by backend, triggering data refresh...');
                    dataRefreshCallback?.();
                    break;
                case 'BOT_STATUS_UPDATE':
                    logService.log('INFO', `Bot running state is now: ${message.payload.isRunning}`);
                    break;
                case 'LOG_ENTRY':
                    const logPayload = message.payload as LogEntry;
                    logService.log(logPayload.level, logPayload.message);
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
    watchedSymbols = new Set(symbols);
    if (socket && socket.readyState === WebSocket.OPEN) {
        logService.log('WEBSOCKET', `Sending subscription request for ${symbols.length} symbols.`);
        socket.send(JSON.stringify({ type: 'SUBSCRIBE', symbols }));
    } else {
        logService.log('WEBSOCKET', 'Socket not open. Subscription deferred until connection is established.');
    }
};

export const websocketService = {
    connect,
    disconnect,
    subscribeToSymbols,
    onStatusChange: (callback: StatusChangeCallback | null) => {
        statusCallback = callback;
    },
    onDataRefresh: (callback: DataRefreshCallback | null) => {
        dataRefreshCallback = callback;
    }
};