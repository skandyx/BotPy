
import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/mockApi';
import { BotSettings } from '../types';
import Spinner from '../components/common/Spinner';
import { useAppContext } from '../contexts/AppContext';
import ToggleSwitch from '../components/common/ToggleSwitch';
import Tooltip from '../components/common/Tooltip';
import Modal from '../components/common/Modal';

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
    BINANCE_API_KEY: "Your public Binance API key. Required for live and paper trading modes.",
    BINANCE_SECRET_KEY: "Your secret Binance API key. This is stored securely on the server and is never exposed to the frontend.",
};

const inputClass = "mt-1 block w-full rounded-md border-[#3e4451] bg-[#0c0e12] shadow-sm focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white";

const SettingsPage: React.FC = () => {
    const [settings, setSettings] = useState<BotSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTestingCoinGecko, setIsTestingCoinGecko] = useState(false);
    const [isTestingBinance, setIsTestingBinance] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isClearModalOpen, setIsClearModalOpen] = useState(false);
    const { incrementSettingsActivity, refreshData } = useAppContext();

    const loadSettings = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await api.fetchSettings();
            setSettings(data);
        } catch (error) {
            console.error("Failed to load settings", error);
            showMessage("Error: Could not load settings from server.", 'error');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const showMessage = (text: string, type: 'success' | 'error' = 'success', duration: number = 4000) => {
        setSaveMessage({ text, type });
        setTimeout(() => setSaveMessage(null), duration);
    };

    const handleChange = (id: keyof BotSettings, value: string | boolean) => {
        if (settings) {
            setSettings({ ...settings, [id]: value });
        }
    };

    const handleSave = async () => {
        if (!settings) return;
        setIsSaving(true);
        try {
            await api.updateSettings(settings);
            incrementSettingsActivity();
            showMessage('Settings saved successfully!');
        } catch (error: any) {
            showMessage(`Failed to save settings: ${error.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestCoinGeckoConnection = async () => {
        if (!settings || !settings.COINGECKO_API_KEY) {
            showMessage('Please enter a CoinGecko API key first.', 'error');
            return;
        }
        setIsTestingCoinGecko(true);
        try {
            const result = await api.testCoinGeckoConnection(settings.COINGECKO_API_KEY);
            showMessage(result.message, result.success ? 'success' : 'error');
        } catch (error: any) {
            showMessage(error.message || 'CoinGecko connection failed.', 'error');
        } finally {
            setIsTestingCoinGecko(false);
        }
    };

    const handleTestBinanceConnection = async () => {
        if (!settings || !settings.BINANCE_API_KEY || !settings.BINANCE_SECRET_KEY) {
             showMessage('Please enter both Binance API and Secret keys.', 'error');
            return;
        }
        setIsTestingBinance(true);
        try {
            const result = await api.testBinanceConnection(settings.BINANCE_API_KEY, settings.BINANCE_SECRET_KEY);
            showMessage(result.message, result.success ? 'success' : 'error');
        } catch (error: any) {
            showMessage(error.message || 'Binance connection test failed.', 'error');
        } finally {
            setIsTestingBinance(false);
        }
    };

    const handleUpdatePassword = async () => {
        if (!newPassword) {
            showMessage('Password cannot be empty.', 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            showMessage('Passwords do not match.', 'error');
            return;
        }
        setIsSaving(true);
        try {
            const result = await api.changePassword(newPassword);
            showMessage(result.message, result.success ? 'success' : 'error');
            if (result.success) {
                setNewPassword('');
                setConfirmPassword('');
            }
        } catch (error: any) {
            showMessage(error.message || 'Failed to update password.', 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleClearData = async () => {
        setIsClearModalOpen(false);
        setIsSaving(true);
        try {
            await api.clearAllTradeData();
            showMessage('All trade data has been cleared.');
            refreshData(); 
            loadSettings();
        } catch (error: any) {
            showMessage(`Failed to clear data: ${error.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    if (isLoading || !settings) return <div className="flex justify-center items-center h-64"><Spinner /></div>;
    
    const isAnyActionInProgress = isSaving || isTestingCoinGecko || isTestingBinance;

    const renderField = (id: keyof BotSettings | 'newPassword' | 'confirmPassword', label: string, type: string = "number", props: any = {}) => (
        <div>
            <label htmlFor={id} className="flex items-center space-x-2 text-sm font-medium text-gray-300">
                <span>{label}</span>
                {tooltips[id] && <Tooltip text={tooltips[id]} />}
            </label>
            <input
                type={type}
                id={id}
                value={id in settings ? settings[id as keyof BotSettings] as any : (id === 'newPassword' ? newPassword : confirmPassword)}
                onChange={(e) => {
                    if (id in settings) {
                         handleChange(id as keyof BotSettings, e.target.value)
                    } else if (id === 'newPassword') {
                        setNewPassword(e.target.value);
                    } else {
                        setConfirmPassword(e.target.value);
                    }
                }}
                className={inputClass}
                {...props}
            />
        </div>
    );

    const renderToggle = (id: keyof BotSettings, label: string) => (
         <div className="flex flex-col justify-between h-full">
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
        <>
        <div className="space-y-6">
            <div className="flex justify-between items-start">
                <h2 className="text-3xl font-bold text-white">Bot Settings</h2>
                <div className="flex items-center space-x-4 flex-shrink-0">
                    {saveMessage && <p className={`text-sm transition-opacity ${saveMessage.type === 'success' ? 'text-[#f0b90b]' : 'text-red-400'}`}>{saveMessage.text}</p>}
                    <button onClick={handleSave} disabled={isAnyActionInProgress} className="inline-flex justify-center rounded-md border border-transparent bg-[#f0b90b] py-2 px-4 text-sm font-semibold text-black shadow-sm hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-[#f0b90b] focus:ring-offset-2 focus:ring-offset-[#0c0e12] disabled:opacity-50">
                        {isSaving ? 'Saving...' : 'Save All Settings'}
                    </button>
                </div>
            </div>
            
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-6 space-y-8">
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

            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-6 space-y-6">
                <h3 className="text-lg font-semibold text-white">API Credentials</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                    {renderField('BINANCE_API_KEY', 'Binance API Key', 'text')}
                    {renderField('BINANCE_SECRET_KEY', 'Binance Secret Key', 'password')}
                </div>
                <div className="flex justify-end">
                    <button onClick={handleTestBinanceConnection} disabled={isAnyActionInProgress || !settings.BINANCE_API_KEY || !settings.BINANCE_SECRET_KEY} className="inline-flex justify-center rounded-md border border-[#3e4451] bg-gray-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-[#f0b90b] focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        {isTestingBinance ? 'Testing...' : 'Test Connection'}
                    </button>
                </div>
            </div>
            
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-6 space-y-6">
                 <h3 className="text-lg font-semibold text-white">Security & Data Management</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                    {renderField('newPassword', 'New Password', 'password')}
                    {renderField('confirmPassword', 'Confirm New Password', 'password')}
                 </div>
                 <div className="flex justify-between items-center pt-4 border-t border-[#2b2f38] mt-6">
                     <button onClick={() => setIsClearModalOpen(true)} disabled={isSaving} className="inline-flex justify-center rounded-md border border-red-800 bg-transparent py-2 px-4 text-sm font-medium text-red-400 shadow-sm hover:bg-red-900/50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        Clear All Trade Data
                    </button>
                    <button onClick={handleUpdatePassword} disabled={isAnyActionInProgress} className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        {isSaving ? 'Updating...' : 'Update Password'}
                    </button>
                 </div>
            </div>
        </div>
        <Modal
            isOpen={isClearModalOpen}
            onClose={() => setIsClearModalOpen(false)}
            onConfirm={handleClearData}
            title="Clear All Trade Data?"
            confirmText="Yes, Clear Data"
            confirmVariant="danger"
        >
            This action is irreversible. It will permanently delete all trade history 
            and reset your virtual balance. Are you sure you want to proceed?
      </Modal>
      </>
    );
};

export default SettingsPage;
