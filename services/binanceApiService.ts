import { logService } from './logService';

// Use a more reliable CORS proxy that requires URL encoding.
const PROXY_URL = 'https://api.allorigins.win/raw?url=';
const BINANCE_API_URL = 'https://api.binance.com';

/**
 * Creates a HMAC-SHA256 signature for a given query string.
 * This is required for authenticated Binance API endpoints.
 * @param queryString The URL-encoded query string (e.g., "symbol=BTCUSDT&limit=10")
 * @param secretKey The user's Binance secret key.
 * @returns A promise that resolves to the hexadecimal signature string.
 */
const createSignature = async (queryString: string, secretKey: string): Promise<string> => {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secretKey),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(queryString));
    
    // Convert ArrayBuffer to hex string
    return Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * Performs a generic, signed request to the Binance API.
 * @param endpoint The API endpoint path (e.g., "/api/v3/account").
 * @param params The request parameters as a URLSearchParams object.
 * @param apiKey The user's Binance API key.
 * @param secretKey The user's Binance secret key.
 * @returns A promise that resolves to the JSON response from the API.
 */
const signedRequest = async (endpoint: string, params: URLSearchParams, apiKey: string, secretKey: string) => {
    params.append('timestamp', Date.now().toString());
    const queryString = params.toString();
    const signature = await createSignature(queryString, secretKey);
    params.append('signature', signature);
    
    const targetUrl = `${BINANCE_API_URL}${endpoint}?${params.toString()}`;
    const proxyUrl = `${PROXY_URL}${encodeURIComponent(targetUrl)}`;
    
    const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: {
            'X-MBX-APIKEY': apiKey,
        },
    });

    if (!response.ok) {
        // Handle non-200 responses from the proxy or target API
        throw new Error(`API request failed with status ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    try {
        const data = JSON.parse(text);
        if (data.code) { // Binance can return 200 OK with an error code in the body
            throw new Error(`Binance API Error: ${data.msg || 'Unknown error'} (Code: ${data.code})`);
        }
        return data;
    } catch (e) {
        // This catches JSON parsing errors, which often happen when the proxy returns an HTML error page.
        throw new Error(`SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`);
    }
};

/**
 * Tests the connection to the Binance API using the provided credentials.
 * It uses a read-only endpoint to safely verify the keys.
 * @param apiKey The user's Binance API key.
 * @param secretKey The user's Binance secret key.
 * @returns A promise that resolves to true if the connection is successful.
 */
const testConnection = async (apiKey: string, secretKey: string): Promise<boolean> => {
    if (!apiKey || !secretKey) {
        logService.log('ERROR', 'API Key and Secret Key must be provided for connection test.');
        return false;
    }

    logService.log('BINANCE_API', 'Attempting to test Binance API connection...');
    try {
        const params = new URLSearchParams();
        const accountInfo = await signedRequest('/api/v3/account', params, apiKey, secretKey);
        if (accountInfo && accountInfo.canTrade) {
            logService.log('BINANCE_API', 'Connection successful. Account is ready.');
            return true;
        } else {
            throw new Error('Received a valid response, but account permissions are incorrect.');
        }
    } catch (error) {
        logService.log('ERROR', `Binance API connection failed: ${error}`);
        throw error; // Re-throw to be caught by the UI
    }
};

export const binanceApiService = {
    testConnection,
    // Future functions like createOrder, cancelOrder, getAccountBalance will go here
};