
import { BotSettings, Trade, TradingMode } from '../types';

const API_BASE_URL = '/api'; // Nginx will proxy this to our backend

const getAuthToken = () => localStorage.getItem('authToken');

const handleResponse = async (response: Response) => {
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'An unknown error occurred' }));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }
    return response.json();
};

const authorizedFetch = async (endpoint: string, options: RequestInit = {}) => {
    const token = getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
        'Authorization': `Bearer ${token}`
    };
    const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
    return handleResponse(response);
};

export const api = {
    // Auth
    login: async (password: string): Promise<{ success: boolean, token?: string }> => {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        return handleResponse(response);
    },
    changePassword: async (newPassword: string): Promise<{ success: boolean, message: string }> => {
        return authorizedFetch('/change-password', {
            method: 'POST',
            body: JSON.stringify({ newPassword })
        });
    },

    // Settings
    fetchSettings: async (): Promise<BotSettings> => {
        return authorizedFetch('/settings');
    },
    updateSettings: async (settings: BotSettings): Promise<{ success: boolean }> => {
        return authorizedFetch('/settings', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
    },

    // Data
    fetchBotStatus: async (tradingMode?: TradingMode) => {
        return authorizedFetch('/status');
    },
    fetchActivePositions: async () => {
        return authorizedFetch('/positions');
    },
    fetchTradeHistory: async () => {
        return authorizedFetch('/history');
    },
    fetchPerformanceStats: async () => {
        return authorizedFetch('/performance-stats');
    },
    fetchScannedPairs: async () => {
        return authorizedFetch('/scanner');
    },

    // Actions
    openTrade: async (symbol: string, price: number, mode: TradingMode): Promise<Trade> => {
        return authorizedFetch('/open-trade', {
            method: 'POST',
            body: JSON.stringify({ symbol, price, mode })
        });
    },
     closeTrade: async (tradeId: number): Promise<Trade> => {
        return authorizedFetch(`/close-trade/${tradeId}`, { method: 'POST' });
    },
    clearAllTradeData: async (): Promise<{ success: boolean }> => {
        return authorizedFetch('/clear-data', { method: 'POST' });
    },
    testBinanceConnection: async (apiKey: string, secretKey: string): Promise<{ success: boolean, message: string }> => {
        return authorizedFetch('/test-connection', {
            method: 'POST',
            body: JSON.stringify({ apiKey, secretKey })
        });
    },
};
