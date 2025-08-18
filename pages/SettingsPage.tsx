
import React, { useState, useEffect } from 'react';
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
    VOLUME_SPIKE_FACTOR: "A multiplier for volume confirmation. A value of 2 means the current volume must be at least 2x the recent average to be considered a 'spike'. (Currently used by the Volume Confirmation toggle).",
    MIN_VOLUME_USD: "The minimum 24-hour trading volume a pair must have to be considered by the scanner. Filters out illiquid markets.",
    MIN_VOLATILITY_PCT: "The minimum price volatility a pair must have to be considered for a trade. Avoids entering trades in flat, sideways markets.",
    COINGECKO_SYNC_SECONDS: "How often (in seconds) the bot should fetch new market-wide data from CoinGecko to update the list of scannable pairs.",
    USE_VOLUME_CONFIRMATION: "If enabled, a trade signal is only valid if the current trading volume is above its recent average, confirming market interest.",
    USE_MULTI_TIMEFRAME_CONFIRMATION: "A powerful filter. If enabled, a short-term buy signal (1-minute) is only valid if the long-term trend (4-hour) is also UP.",
    USE_MARKET_REGIME_FILTER: "A master filter. If enabled, the bot will only trade if the long-term market structure (based on 50/200 MAs on the 4h chart) is in a confirmed UPTREND.",
    LOSS_COOLDOWN_HOURS: "Anti-Churn: If a trade on a symbol is closed at a loss, the bot will be blocked from trading that same symbol for this number of hours.",
    COINGECKO_API_KEY: "Your CoinGecko API key (optional but recommended) to increase API rate limits.",
    EXCLUDED_PAIRS: "A comma-separated list of pairs to ignore completely, regardless of their volume (e.g., USDCUSDT,FDUSDUSDT).",
    BINANCE_API_KEY: "Your public API key from Binance. Required for REAL modes.",
    BINANCE_SECRET_KEY: "Your secret API key from Binance. Required for REAL modes. This is stored on the server and never exposed to the frontend."
};

type FormState = Record<keyof BotSettings, string>;

const SettingsPage: React.FC = () => {
    const [formState, setFormState] = useState<FormState | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [isClearDataModalOpen, setIsClearDataModalOpen] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    useEffect(() => {
        const loadSettings = async () => {
            setIsLoading(true);
            try {
                const data = await api.fetchSettings();
                if (data) {
                    const stringifiedData = Object.fromEntries(
                        Object.entries(data).map(([key, value]) => [key, String(value)])
                    ) as FormState;
                    setFormState(stringifiedData);
                }
            } catch (error) {
                console.error("Failed to load settings", error);
            } finally {
                setIsLoading(false);
            }
        };
        loadSettings();
    }, []);

    const handleChange = (id: keyof BotSettings, value: string | boolean) => {
        if (formState) {
            setFormState({ ...formState, [id]: String(value) });
        }
    };

    const handleSave = async () => {
        if (!formState) return;
        setIsSaving(true);
        setSaveMessage('');
        try {
            const settingsToSave = Object.fromEntries(
              Object.entries(formState).map(([key, value]) => {
                const numFields = ['INITIAL_VIRTUAL_BALANCE', 'MAX_OPEN_POSITIONS', 'COINGECKO_SYNC_SECONDS', 'LOSS_COOLDOWN_HOURS'];
                if (numFields.includes(key)) return [key, parseInt(value, 10)];
                const floatFields = ['MIN_VOLUME_USD', 'POSITION_SIZE_PCT', 'TAKE_PROFIT_PCT', 'STOP_LOSS_PCT', 'SLIPPAGE_PCT', 'VOLUME_SPIKE_FACTOR', 'MIN_VOLATILITY_PCT', 'TRAILING_STOP_LOSS_PCT'];
                if (floatFields.includes(key)) return [key, parseFloat(value)];
                const boolFields = ['USE_VOLUME_CONFIRMATION', 'USE_MULTI_TIMEFRAME_CONFIRMATION', 'USE_MARKET_REGIME_FILTER', 'USE_TRAILING_STOP_LOSS'];
                if (boolFields.includes(key)) return [key, value === 'true'];
                return [key, value];
              })
            );
            await api.updateSettings(settingsToSave as unknown as BotSettings);
            setSaveMessage('Settings saved successfully!');
        } catch (error) {
            setSaveMessage('Failed to save settings.');
        } finally {
            setIsSaving(false);
            setTimeout(() => setSaveMessage(''), 3000);
        }
    };

    const handleClearData = async () => {
        setIsClearing(true);
        try {
            await api.clearAllTradeData();
            setSaveMessage('All trade data has been cleared.');
        } catch (error) {
            setSaveMessage('Failed to clear trade data.');
        } finally {
            setIsClearing(false);
            setIsClearDataModalOpen(false);
            setTimeout(() => setSaveMessage(''), 3000);
        }
    };

    const handleTestConnection = async () => {
        if (!formState) return;
        setIsTesting(true);
        try {
            const result = await api.testBinanceConnection(formState.BINANCE_API_KEY, formState.BINANCE_SECRET_KEY);
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

    if (isLoading || !formState) return <div className="flex justify-center items-center h-64"><Spinner /></div>;

    return (
        <div className="space-y-6 max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-white">Bot Settings</h2>
            
            {/* General Settings */}
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-6">
                 <h3 className="text-lg font-semibold text-white mb-4 border-b border-[#2b2f38] pb-2">Trading Parameters</h3>
                 {/* Form fields here */}
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    {/* Trading Parameters */}
                 </div>

                 <h3 className="text-lg font-semibold text-white mb-4 border-b border-[#2b2f38] pb-2 mt-8">Market Scanner & Strategy Filters</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 items-center">
                    {/* Scanner and Strategy fields here */}
                 </div>
            </div>

            {/* Security Settings */}
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-6">
                <h3 className="text-lg font-semibold text-white mb-4 border-b border-[#2b2f38] pb-2">Security</h3>
                <form onSubmit={handleChangePassword} className="space-y-4 mt-4">
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
            </div>

            {/* API and Data Management */}
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-6">
                 <h3 className="text-lg font-semibold text-white mb-4 border-b border-[#2b2f38] pb-2 mt-8">API Credentials & Data</h3>
                 {/* API fields and data management buttons here */}
                 <div className="mt-8 flex items-center justify-end space-x-4">
                    {saveMessage && <p className={`text-sm ${saveMessage.includes('success') || saveMessage.includes('cleared') ? 'text-[#f0b90b]' : 'text-red-400'}`}>{saveMessage}</p>}
                    <button onClick={handleSave} disabled={isSaving || isClearing || isTesting} className="inline-flex justify-center rounded-md border border-transparent bg-[#f0b90b] py-2 px-4 text-sm font-semibold text-black shadow-sm hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-[#f0b90b] focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        {isSaving ? 'Saving...' : 'Save All Settings'}
                    </button>
                </div>
            </div>

             <Modal isOpen={isClearDataModalOpen} onClose={() => setIsClearDataModalOpen(false)} onConfirm={handleClearData} title="Clear All Trade Data?" confirmText="Yes, Clear Data" confirmVariant="danger">
                Are you sure? This will permanently delete all trade history and reset your virtual balance. This action cannot be undone.
            </Modal>
        </div>
    );
};

export default SettingsPage;
