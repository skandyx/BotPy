import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/mockApi';
import { BotSettings } from '../types';
import Spinner from '../components/common/Spinner';
import { useAppContext } from '../contexts/AppContext';
import ToggleSwitch from '../components/common/ToggleSwitch';
import Modal from '../components/common/Modal';
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
    LOSS_COOLDOWN_HOURS: "Anti-Churn: If a trade on a symbol is closed at a loss, the bot will be blocked from trading that same symbol for this number of hours.",
    EXCLUDED_PAIRS: "A comma-separated list of pairs to ignore completely, regardless of their volume (e.g., USDCUSDT,FDUSDUSDT).",
    BINANCE_API_KEY: "Your public API key from Binance. Required for REAL modes.",
    BINANCE_SECRET_KEY: "Your secret API key from Binance. Required for REAL modes. This is stored on the server and never exposed to the frontend."
};

const SettingsField: React.FC<{ id: keyof BotSettings, label: string, type?: string, formState: any, handleChange: any, children?: React.ReactNode }> = ({ id, label, type = 'text', formState, handleChange, children }) => {
    return (
        <div>
            <label htmlFor={id} className="flex items-center space-x-2 text-sm font-medium text-gray-300">
                <span>{label}</span>
                {tooltips[id] && <Tooltip text={tooltips[id]} />}
            </label>
            {children ? (
                <div className="mt-1">{children}</div>
            ) : (
                <input
                    type={type}
                    id={id}
                    value={formState[id]}
                    onChange={(e) => handleChange(id, e.target.value)}
                    className="mt-1 block w-full rounded-md border-[#3e4451] bg-[#0c0e12] shadow-sm focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white"
                />
            )}
        </div>
    );
};

const SettingsPage: React.FC = () => {
    const [settings, setSettings] = useState<BotSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [isClearDataModalOpen, setIsClearDataModalOpen] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
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

    const handleClearData = async () => {
        setIsClearing(true);
        try {
             // Save any pending changes before clearing, to ensure the new initial balance is used.
            if(settings) await api.updateSettings(settings);
            await api.clearAllTradeData();
            setSaveMessage('All trade data has been cleared.');
            incrementSettingsActivity();
        } catch (error: any) {
            setSaveMessage(`Failed to clear trade data: ${error.message}`);
        } finally {
            setIsClearing(false);
            setIsClearDataModalOpen(false);
            setTimeout(() => setSaveMessage(''), 3000);
        }
    };

    const handleTestConnection = async () => {
        if (!settings) return;
        setIsTesting(true);
        setSaveMessage('');
        try {
            const result = await api.testBinanceConnection(settings.BINANCE_API_KEY, settings.BINANCE_SECRET_KEY);
            setSaveMessage(result.message);
        } catch (error: any) {
            setSaveMessage(error.message || 'Connection failed.');
        } finally {
            setIsTesting(false);
            setTimeout(() => setSaveMessage(''), 5000);
        }
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setSaveMessage("Passwords do not match.");
            setTimeout(() => setSaveMessage(''), 3000);
            return;
        }
        if (newPassword.length < 6) {
            setSaveMessage("Password must be at least 6 characters.");
            setTimeout(() => setSaveMessage(''), 3000);
            return;
        }
        setIsSaving(true);
        try {
            const result = await api.changePassword(newPassword);
            setSaveMessage(result.message);
            setNewPassword('');
            setConfirmPassword('');
        } catch (error: any) {
            setSaveMessage(error.message || "Failed to change password.");
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveMessage(''), 5000);
        }
    };

    if (isLoading || !settings) return <div className="flex justify-center items-center h-64"><Spinner /></div>;

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-white">Bot Settings</h2>
                <div className="flex items-center space-x-4">
                     {saveMessage && <p className={`text-sm transition-opacity ${saveMessage.includes('success') || saveMessage.includes('cleared') || saveMessage.includes('successful') ? 'text-[#f0b90b]' : 'text-red-400'}`}>{saveMessage}</p>}
                    <button onClick={handleSave} disabled={isSaving || isClearing || isTesting} className="inline-flex justify-center rounded-md border border-transparent bg-[#f0b90b] py-2 px-4 text-sm font-semibold text-black shadow-sm hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-[#f0b90b] focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        {isSaving ? 'Saving...' : 'Save All Settings'}
                    </button>
                </div>
            </div>
            
            {/* Main Settings */}
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-6">
                 <h3 className="text-lg font-semibold text-white mb-4 border-b border-[#2b2f38] pb-2">Trading Parameters</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
                    <SettingsField id="INITIAL_VIRTUAL_BALANCE" label="Initial Virtual Balance ($)" type="number" formState={settings} handleChange={handleChange} />
                    <SettingsField id="MAX_OPEN_POSITIONS" label="Max Open Positions" type="number" formState={settings} handleChange={handleChange} />
                    <SettingsField id="POSITION_SIZE_PCT" label="Position Size (%)" type="number" formState={settings} handleChange={handleChange} />
                    <SettingsField id="TAKE_PROFIT_PCT" label="Take Profit (%)" type="number" formState={settings} handleChange={handleChange} />
                    <SettingsField id="STOP_LOSS_PCT" label="Stop Loss (%)" type="number" formState={settings} handleChange={handleChange} />
                    <SettingsField id="SLIPPAGE_PCT" label="Slippage (%)" type="number" formState={settings} handleChange={handleChange} />
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4 pt-4 border-t border-[#2b2f38]">
                    <SettingsField id="USE_TRAILING_STOP_LOSS" label="Use Trailing Stop Loss" formState={settings} handleChange={handleChange}>
                        <ToggleSwitch checked={settings.USE_TRAILING_STOP_LOSS} onChange={(val) => handleChange('USE_TRAILING_STOP_LOSS', val)} leftLabel="ON" rightLabel="OFF" />
                    </SettingsField>
                    <SettingsField id="TRAILING_STOP_LOSS_PCT" label="Trailing Stop Loss (%)" type="number" formState={settings} handleChange={handleChange} />
                 </div>

                 <h3 className="text-lg font-semibold text-white mb-4 border-b border-[#2b2f38] pb-2 mt-8">Market Scanner & Strategy Filters</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
                    <SettingsField id="MIN_VOLUME_USD" label="Min Volume (USD)" type="number" formState={settings} handleChange={handleChange} />
                    <SettingsField id="MIN_VOLATILITY_PCT" label="Min Volatility (%)" type="number" formState={settings} handleChange={handleChange} />
                    <SettingsField id="COINGECKO_SYNC_SECONDS" label="Scanner Sync (seconds)" type="number" formState={settings} handleChange={handleChange} />
                    <SettingsField id="LOSS_COOLDOWN_HOURS" label="Loss Cooldown (Hours)" type="number" formState={settings} handleChange={handleChange} />
                     <div className="lg:col-span-2">
                        <SettingsField id="COINGECKO_API_KEY" label="CoinGecko API Key" formState={settings} handleChange={handleChange} />
                    </div>
                    <div className="md:col-span-2 lg:col-span-3">
                        <SettingsField id="EXCLUDED_PAIRS" label="Exclude Pairs (comma-separated)" formState={settings} handleChange={handleChange} />
                    </div>
                 </div>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4 pt-4 border-t border-[#2b2f38]">
                     <SettingsField id="USE_VOLUME_CONFIRMATION" label="Use Volume Confirmation" formState={settings} handleChange={handleChange}>
                        <ToggleSwitch checked={settings.USE_VOLUME_CONFIRMATION} onChange={(val) => handleChange('USE_VOLUME_CONFIRMATION', val)} leftLabel="ON" rightLabel="OFF" />
                    </SettingsField>
                    <SettingsField id="USE_MULTI_TIMEFRAME_CONFIRMATION" label="Use Multi-Timeframe Confirmation" formState={settings} handleChange={handleChange}>
                        <ToggleSwitch checked={settings.USE_MULTI_TIMEFRAME_CONFIRMATION} onChange={(val) => handleChange('USE_MULTI_TIMEFRAME_CONFIRMATION', val)} leftLabel="ON" rightLabel="OFF" />
                    </SettingsField>
                    <SettingsField id="USE_MARKET_REGIME_FILTER" label="Use Market Regime Filter" formState={settings} handleChange={handleChange}>
                        <ToggleSwitch checked={settings.USE_MARKET_REGIME_FILTER} onChange={(val) => handleChange('USE_MARKET_REGIME_FILTER', val)} leftLabel="ON" rightLabel="OFF" />
                    </SettingsField>
                 </div>
            </div>

            {/* API and Data Management */}
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-6">
                 <h3 className="text-lg font-semibold text-white mb-4 border-b border-[#2b2f38] pb-2">API Credentials</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    <SettingsField id="BINANCE_API_KEY" label="Binance API Key" formState={settings} handleChange={handleChange} />
                    <div>
                        <label htmlFor="BINANCE_SECRET_KEY" className="flex items-center space-x-2 text-sm font-medium text-gray-300">
                            <span>Binance Secret Key</span>
                            {tooltips['BINANCE_SECRET_KEY'] && <Tooltip text={tooltips['BINANCE_SECRET_KEY']} />}
                        </label>
                        <input
                            type="password"
                            id="BINANCE_SECRET_KEY"
                            value={settings.BINANCE_SECRET_KEY}
                            onChange={(e) => handleChange('BINANCE_SECRET_KEY', e.target.value)}
                            className="mt-1 block w-full rounded-md border-[#3e4451] bg-[#0c0e12] shadow-sm focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white"
                        />
                    </div>
                 </div>
                 <div className="mt-4 flex justify-end">
                    <button onClick={handleTestConnection} disabled={isTesting} className="inline-flex justify-center rounded-md border border-transparent bg-gray-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        {isTesting ? 'Testing...' : 'Test Connection'}
                    </button>
                 </div>
                 
                 <h3 className="text-lg font-semibold text-white mb-4 border-b border-[#2b2f38] pb-2 mt-8">Security & Data Management</h3>
                 <form onSubmit={handleChangePassword} className="space-y-4 mt-4 max-w-sm">
                    <div>
                        <label className="flex items-center space-x-2 text-sm font-medium text-gray-300">New Password</label>
                        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1 block w-full rounded-md border-[#3e4451] bg-[#0c0e12] shadow-sm focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white" />
                    </div>
                    <div>
                        <label className="flex items-center space-x-2 text-sm font-medium text-gray-300">Confirm New Password</label>
                        <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-1 block w-full rounded-md border-[#3e4451] bg-[#0c0e12] shadow-sm focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white" />
                    </div>
                    <div className="pt-2">
                        <button type="submit" disabled={isSaving} className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                            {isSaving ? 'Updating...' : 'Update Password'}
                        </button>
                    </div>
                </form>

                <div className="mt-6 pt-6 border-t border-[#2b2f38]">
                    <button onClick={() => setIsClearDataModalOpen(true)} disabled={isClearing} className="inline-flex justify-center rounded-md border border-red-500 py-2 px-4 text-sm font-medium text-red-400 shadow-sm hover:bg-red-900/50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        {isClearing ? 'Clearing...' : 'Clear All Trade Data'}
                    </button>
                </div>
            </div>

             <Modal isOpen={isClearDataModalOpen} onClose={() => setIsClearDataModalOpen(false)} onConfirm={handleClearData} title="Clear All Trade Data?" confirmText="Yes, Clear Data" confirmVariant="danger">
                Are you sure? This will permanently delete all trade history and reset your virtual balance to the configured initial value. This action cannot be undone.
            </Modal>
        </div>
    );
};

export default SettingsPage;