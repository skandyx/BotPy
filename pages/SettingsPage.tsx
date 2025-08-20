
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/mockApi';
import { BotSettings } from '../types';
import Spinner from '../components/common/Spinner';
import { useAppContext } from '../contexts/AppContext';
import ToggleSwitch from '../components/common/ToggleSwitch';
import Tooltip from '../components/common/Tooltip';

// --- HELPERS ---
const tooltips: Record<string, string> = {
    INITIAL_VIRTUAL_BALANCE: "The starting capital for your virtual trading account. This amount is applied when you clear all trade data.",
    MAX_OPEN_POSITIONS: "The maximum number of trades the bot can have open at the same time. Helps control overall risk exposure.",
    POSITION_SIZE_PCT: "The percentage of your total balance to use for each new trade. (e.g., 2% on a $10,000 balance will result in $200 positions).",
    TAKE_PROFIT_PCT: "The percentage of profit at which a trade will be automatically closed. This is the initial target if Trailing Stop Loss is disabled.",
    STOP_LOSS_PCT: "The percentage of loss at which a trade will be automatically closed to prevent further losses. This is the maximum risk per trade.",
    USE_TRAILING_STOP_LOSS: "Enables a dynamic stop loss that moves up to lock in profits as the price increases, but never moves down.",
    TRAILING_STOP_LOSS_PCT: "The percentage below the highest price at which the trailing stop loss will be set. A smaller value is tighter, a larger value is looser.",
    SLIPPAGE_PCT: "A small percentage to simulate the difference between the expected and actual execution price of a trade in a live market.",
    MIN_VOLUME_USD: "The minimum 24-hour trading volume a pair must have to be considered by the scanner. Filters out illiquid markets.",
    MIN_VOLATILITY_PCT: "The minimum price volatility a pair must have to be considered for a trade. Avoids entering trades in flat, sideways markets.",
    COINGECKO_API_KEY: "Your CoinGecko API key (e.g., from the free 'Demo' plan). Using a key provides more reliable and faster API responses for market scanning.",
    COINGECKO_SYNC_SECONDS: "How often (in seconds) the bot should fetch new market-wide data from CoinGecko to update the list of scannable pairs.",
    USE_VOLUME_CONFIRMATION: "If enabled, a trade signal is only valid if the current trading volume is above its recent average, confirming market interest.",
    USE_MULTI_TIMEFRAME_CONFIRMATION: "A powerful filter. If enabled, a short-term buy signal (1-minute) is only valid if the long-term trend (4-hour) is also UP.",
    USE_MARKET_REGIME_FILTER: "A master filter. If enabled, the bot will only trade if the long-term market structure (based on 50/200 MAs on the 4h chart) is in a confirmed UPTREND.",
    REQUIRE_STRONG_BUY: "If enabled, the bot will only open new trades for pairs with a 'STRONG BUY' score. It will ignore pairs with a regular 'BUY' score, making the strategy more selective.",
    LOSS_COOLDOWN_HOURS: "Anti-Churn: If a trade on a symbol is closed at a loss, the bot will be blocked from trading that same symbol for this number of hours.",
    EXCLUDED_PAIRS: "A comma-separated list of pairs to ignore completely, regardless of their volume (e.g., USDCUSDT,FDUSDUSDT).",
};

const inputClass = "mt-1 block w-full rounded-md border-[#3e4451] bg-[#0c0e12] shadow-sm focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white";

const SettingsPage: React.FC = () => {
    const [settings, setSettings] = useState<BotSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTestingCoinGecko, setIsTestingCoinGecko] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const { incrementSettingsActivity } = useAppContext();

    const loadSettings = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await api.fetchSettings();
            setSettings(data);
        } catch (error) {
            console.error("Failed to load settings", error);
            setSaveMessage("Error: Could not load settings from server.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const handleChange = (id: keyof BotSettings, value: string | boolean) => {
        if (settings) {
            setSettings({ ...settings, [id]: value });
        }
    };

    const handleSave = async () => {
        if (!settings) return;
        setIsSaving(true);
        setSaveMessage('');
        try {
            await api.updateSettings(settings);
            incrementSettingsActivity();
            setSaveMessage('Settings saved successfully!');
        } catch (error: any) {
            setSaveMessage(`Failed to save settings: ${error.message}`);
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveMessage(''), 3000);
        }
    };

    const handleTestCoinGeckoConnection = async () => {
        if (!settings || !settings.COINGECKO_API_KEY) {
            setSaveMessage('Please enter a CoinGecko API key first.');
            setTimeout(() => setSaveMessage(''), 3000);
            return;
        }
        setIsTestingCoinGecko(true);
        setSaveMessage('');
        try {
            const result = await api.testCoinGeckoConnection(settings.COINGECKO_API_KEY);
            setSaveMessage(result.message);
        } catch (error: any) {
            setSaveMessage(error.message || 'CoinGecko connection failed.');
        } finally {
            setIsTestingCoinGecko(false);
            setTimeout(() => setSaveMessage(''), 5000);
        }
    };
    
    if (isLoading || !settings) return <div className="flex justify-center items-center h-64"><Spinner /></div>;
    
    const isAnyActionInProgress = isSaving || isTestingCoinGecko;

    const renderField = (id: keyof BotSettings, label: string, type: string = "number") => (
        <div>
            <label htmlFor={id} className="flex items-center space-x-2 text-sm font-medium text-gray-300">
                <span>{label}</span>
                {tooltips[id] && <Tooltip text={tooltips[id]} />}
            </label>
            <input
                type={type}
                id={id}
                value={settings[id] as any}
                onChange={(e) => handleChange(id, e.target.value)}
                className={inputClass}
            />
        </div>
    );

    const renderToggle = (id: keyof BotSettings, label: string) => (
         <div>
            <label className="flex items-center space-x-2 text-sm font-medium text-gray-300">
                <span>{label}</span>
                {tooltips[id] && <Tooltip text={tooltips[id]} />}
            </label>
            <div className="mt-2">
                <ToggleSwitch checked={settings[id] as boolean} onChange={(val) => handleChange(id, val)} leftLabel="ON" rightLabel="OFF" />
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">Bot Settings</h2>
                <div className="flex items-center space-x-4">
                     {saveMessage && <p className={`text-sm transition-opacity ${saveMessage.includes('success') || saveMessage.includes('successful') ? 'text-[#f0b90b]' : 'text-red-400'}`}>{saveMessage}</p>}
                    <button onClick={handleSave} disabled={isAnyActionInProgress} className="inline-flex justify-center rounded-md border border-transparent bg-[#f0b90b] py-2 px-4 text-sm font-semibold text-black shadow-sm hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-[#f0b90b] focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        {isSaving ? 'Saving...' : 'Save All Settings'}
                    </button>
                </div>
            </div>
            
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-6 space-y-8">
                {/* --- Trading Parameters --- */}
                <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Trading Parameters</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {renderField('INITIAL_VIRTUAL_BALANCE', 'Initial Virtual Balance ($)')}
                        {renderField('MAX_OPEN_POSITIONS', 'Max Open Positions')}
                        {renderField('POSITION_SIZE_PCT', 'Position Size (%)')}
                        {renderField('TAKE_PROFIT_PCT', 'Take Profit (%)')}
                        {renderField('STOP_LOSS_PCT', 'Stop Loss (%)')}
                        {renderField('SLIPPAGE_PCT', 'Slippage (%)')}
                    </div>
                    <hr className="border-[#2b2f38] my-6" />
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                        {renderToggle('USE_TRAILING_STOP_LOSS', 'Use Trailing Stop Loss')}
                        {renderField('TRAILING_STOP_LOSS_PCT', 'Trailing Stop Loss (%)')}
                    </div>
                </div>

                {/* --- Market Scanner & Strategy Filters --- */}
                <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Market Scanner & Strategy Filters</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                       {renderField('MIN_VOLUME_USD', 'Min Volume (USD)')}
                       {renderField('MIN_VOLATILITY_PCT', 'Min Volatility (%)')}
                       {renderField('COINGECKO_SYNC_SECONDS', 'Scanner Sync (seconds)')}
                       {renderField('LOSS_COOLDOWN_HOURS', 'Loss Cooldown (Hours)')}
                        <div className="md:col-span-2">
                             <label htmlFor="COINGECKO_API_KEY" className="flex items-center space-x-2 text-sm font-medium text-gray-300">
                                <span>CoinGecko API Key</span>
                                {tooltips['COINGECKO_API_KEY'] && <Tooltip text={tooltips['COINGECKO_API_KEY']} />}
                            </label>
                            <div className="mt-1 flex rounded-md shadow-sm">
                                <input
                                    type="text"
                                    id="COINGECKO_API_KEY"
                                    value={settings.COINGECKO_API_KEY}
                                    onChange={(e) => handleChange('COINGECKO_API_KEY', e.target.value)}
                                    className="block w-full min-w-0 flex-1 rounded-none rounded-l-md border-[#3e4451] bg-[#0c0e12] focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white"
                                />
                                <button
                                    type="button"
                                    onClick={handleTestCoinGeckoConnection}
                                    disabled={isAnyActionInProgress || !settings.COINGECKO_API_KEY}
                                    className="inline-flex items-center rounded-r-md border border-l-0 border-[#3e4451] bg-gray-600 px-3 py-2 text-xs font-medium text-white hover:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-[#f0b90b] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isTestingCoinGecko ? 'Testing...' : 'Test'}
                                </button>
                            </div>
                        </div>
                        <div className="md:col-span-3">
                            {renderField('EXCLUDED_PAIRS', 'Exclude Pairs (comma-separated)', 'text')}
                        </div>
                    </div>
                    <hr className="border-[#2b2f38] my-6" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                        {renderToggle('USE_VOLUME_CONFIRMATION', 'Use Volume Confirmation')}
                        {renderToggle('USE_MULTI_TIMEFRAME_CONFIRMATION', 'Use Multi-Timeframe Confirmation')}
                        {renderToggle('USE_MARKET_REGIME_FILTER', 'Use Market Regime Filter')}
                        {renderToggle('REQUIRE_STRONG_BUY', "Require 'Strong Buy' Only")}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsPage;
