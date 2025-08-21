
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
    INITIAL_VIRTUAL_BALANCE: "Le capital de départ pour votre compte de trading virtuel. Ce montant est appliqué lorsque vous effacez toutes les données de trading.",
    MAX_OPEN_POSITIONS: "Le nombre maximum de trades que le bot peut avoir ouverts en même temps. Aide à contrôler l'exposition globale au risque.",
    POSITION_SIZE_PCT: "Le pourcentage de votre solde total à utiliser pour chaque nouveau trade. (ex: 2% sur un solde de 10 000 $ se traduira par des positions de 200 $).",
    TAKE_PROFIT_PCT: "Le pourcentage de profit auquel un trade sera automatiquement clôturé. C'est l'objectif initial si le Trailing Stop Loss est désactivé.",
    STOP_LOSS_PCT: "Le pourcentage de perte auquel un trade sera automatiquement clôturé pour éviter de nouvelles pertes. C'est le risque maximum par trade.",
    USE_TRAILING_STOP_LOSS: "Active un stop loss dynamique qui monte pour sécuriser les profits à mesure que le prix augmente, mais ne descend jamais.",
    TRAILING_STOP_LOSS_PCT: "Le pourcentage en dessous du prix le plus élevé auquel le trailing stop loss sera fixé. Une valeur plus petite est plus serrée, une valeur plus grande est plus lâche.",
    SLIPPAGE_PCT: "Un petit pourcentage pour simuler la différence entre le prix d'exécution attendu et réel d'un trade sur un marché en direct.",
    MIN_VOLUME_USD: "Le volume de trading minimum sur 24 heures qu'une paire doit avoir pour être prise en compte par le scanner. Filtre les marchés illiquides.",
    MIN_VOLATILITY_PCT: "La volatilité de prix minimale qu'une paire doit avoir pour être considérée pour un trade. Évite d'entrer dans des trades sur des marchés plats et latéraux.",
    COINGECKO_API_KEY: "Votre clé API CoinGecko (par exemple, du plan gratuit 'Demo'). L'utilisation d'une clé fournit des réponses API plus fiables et plus rapides pour le scan du marché.",
    COINGECKO_SYNC_SECONDS: "La fréquence (en secondes) à laquelle le bot doit effectuer un scan complet du marché pour découvrir et analyser les paires en fonction de leurs données graphiques sur 4h.",
    USE_VOLUME_CONFIRMATION: "Si activé, un signal de trade n'est valide que si le volume de trading actuel est supérieur à sa moyenne récente, confirmant l'intérêt du marché.",
    USE_MARKET_REGIME_FILTER: "Un filtre maître. Si activé, le bot ne tradera que si la structure du marché à long terme (basée sur les MA 50/200 sur le graphique 4h) est dans une TENDANCE HAUSSIÈRE confirmée.",
    REQUIRE_STRONG_BUY: "Si activé, le bot n'ouvrira de nouvelles transactions que pour les paires avec un score 'STRONG BUY'. Il ignorera les paires avec un score 'BUY' régulier, rendant la stratégie plus sélective.",
    LOSS_COOLDOWN_HOURS: "Anti-Churn : Si une transaction sur un symbole est clôturée à perte, le bot sera empêché de trader ce même symbole pendant ce nombre d'heures.",
    EXCLUDED_PAIRS: "Une liste de paires séparées par des virgules à ignorer complètement, quel que soit leur volume (par exemple, USDCUSDT,FDUSDUSDT).",
    BINANCE_API_KEY: "Votre clé API publique Binance. Requise pour les modes de trading live et paper.",
    BINANCE_SECRET_KEY: "Votre clé API secrète Binance. Elle est stockée en toute sécurité sur le serveur et n'est jamais exposée au frontend.",
    USE_ATR_STOP_LOSS: "Utiliser un Stop Loss dynamique basé sur l'Average True Range (ATR), qui s'adapte à la volatilité du marché au lieu d'un pourcentage fixe.",
    ATR_MULTIPLIER: "Le multiplicateur à appliquer à la valeur ATR pour définir la distance du Stop Loss (ex: 1.5 signifie que le SL sera à 1.5 * ATR en dessous du prix d'entrée).",
    USE_AUTO_BREAKEVEN: "Déplacer automatiquement le Stop Loss au prix d'entrée une fois qu'un trade est en profit, éliminant le risque de perte.",
    BREAKEVEN_TRIGGER_R: "Le niveau de profit (en multiple du risque initial 'R') auquel déclencher le passage au seuil de rentabilité (ex: 1.0 signifie lorsque le profit est égal au risque initial).",
    USE_RSI_OVERBOUGHT_FILTER: "Empêcher l'ouverture de nouveaux trades si le RSI est dans la zone de 'surachat', évitant d'acheter à un potentiel sommet local.",
    RSI_OVERBOUGHT_THRESHOLD: "Le niveau RSI au-dessus duquel un signal de trade sera ignoré (ex: 70).",
    USE_MACD_CONFIRMATION: "Exiger une confirmation de l'indicateur MACD (par exemple, un histogramme positif) avant d'ouvrir un trade, ajoutant une couche de validation de momentum.",
    USE_PARTIAL_TAKE_PROFIT: "Vendre une partie de la position à un objectif de profit préliminaire et laisser le reste courir avec le trailing stop loss.",
    PARTIAL_TP_TRIGGER_PCT: "Le pourcentage de profit (%) auquel vendre la première partie de la position.",
    PARTIAL_TP_SELL_QTY_PCT: "Le pourcentage (%) de la quantité de position initiale à vendre pour la prise de profit partielle.",
    USE_DYNAMIC_POSITION_SIZING: "Allouer une taille de position plus importante pour les signaux 'STRONG BUY' de la plus haute qualité par rapport aux signaux 'BUY' réguliers.",
    STRONG_BUY_POSITION_SIZE_PCT: "Le pourcentage de votre solde à utiliser pour un signal 'STRONG BUY' si le dimensionnement dynamique est activé.",
    USE_ML_MODEL_FILTER: "Si activé, le bot exigera une confirmation du modèle d'Apprentissage Automatique interne (la prédiction ML doit être 'HAUSSE' avec un score élevé) avant d'ouvrir un trade.",
    USE_CONFLUENCE_FILTER_4H: "Filtre de Confluence : Si activé, un signal d'achat n'est valide que si la tendance sur 4 heures est également en HAUSSE.",
    USE_CONFLUENCE_FILTER_1H: "Filtre de Confluence : Si activé, un signal d'achat n'est valide que si la tendance sur 1 heure est également en HAUSSE.",
    USE_CONFLUENCE_FILTER_30M: "Filtre de Confluence : Si activé, un signal d'achat n'est valide que si la tendance sur 30 minutes est également en HAUSSE.",
    USE_CONFLUENCE_FILTER_15M: "Filtre de Confluence : Si activé, un signal d'achat n'est valide que si la tendance sur 15 minutes est également en HAUSSE.",
    USE_CONFLUENCE_FILTER_1M: "Filtre de Confluence : Si activé, un signal d'achat n'est valide que si la tendance sur 1 minute (le signal d'entrée) est également en HAUSSE.",
    USE_CORRELATION_FILTER: "(Fonctionnalité future) Empêcher l'ouverture de trades sur plusieurs paires fortement corrélées en même temps pour diversifier le risque.",
    USE_NEWS_FILTER: "(Fonctionnalité future) Mettre automatiquement en pause le bot lors d'événements d'actualité économique majeurs pour éviter une volatilité extrême."
};

const inputClass = "mt-1 block w-full rounded-md border-[#3e4451] bg-[#0c0e12] shadow-sm focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white";

const SettingsPage: React.FC = () => {
    const { settings: contextSettings, setSettings: setContextSettings, incrementSettingsActivity, refreshData } = useAppContext();
    const [settings, setSettings] = useState<BotSettings | null>(contextSettings);
    const [isSaving, setIsSaving] = useState(false);
    const [isTestingCoinGecko, setIsTestingCoinGecko] = useState(false);
    const [isTestingBinance, setIsTestingBinance] = useState(false);
    const [saveMessage, setSaveMessage] = useState<{text: string, type: 'success' | 'error'} | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isClearModalOpen, setIsClearModalOpen] = useState(false);

    useEffect(() => {
        if (contextSettings) {
            setSettings(contextSettings);
        }
    }, [contextSettings]);

    const showMessage = (text: string, type: 'success' | 'error' = 'success', duration: number = 4000) => {
        setSaveMessage({ text, type });
        setTimeout(() => setSaveMessage(null), duration);
    };

    const handleChange = (id: keyof BotSettings, value: string | boolean | number) => {
        if (settings) {
            setSettings({ ...settings, [id]: value });
        }
    };

    const handleSave = async () => {
        if (!settings) return;
        setIsSaving(true);
        try {
            await api.updateSettings(settings);
            setContextSettings(settings);
            incrementSettingsActivity();
            showMessage("Paramètres sauvegardés avec succès !");
        } catch (error: any) {
            showMessage(`Échec de la sauvegarde des paramètres : ${error.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleTestCoinGeckoConnection = async () => {
        if (!settings || !settings.COINGECKO_API_KEY) {
            showMessage("Veuillez d'abord entrer une clé API CoinGecko.", 'error');
            return;
        }
        setIsTestingCoinGecko(true);
        try {
            const result = await api.testCoinGeckoConnection(settings.COINGECKO_API_KEY);
            showMessage(result.message, result.success ? 'success' : 'error');
        } catch (error: any) {
            showMessage(error.message || 'La connexion à CoinGecko a échoué.', 'error');
        } finally {
            setIsTestingCoinGecko(false);
        }
    };

    const handleTestBinanceConnection = async () => {
        if (!settings || !settings.BINANCE_API_KEY || !settings.BINANCE_SECRET_KEY) {
             showMessage("Veuillez entrer les clés API et secrète de Binance.", 'error');
            return;
        }
        setIsTestingBinance(true);
        try {
            const result = await api.testBinanceConnection(settings.BINANCE_API_KEY, settings.BINANCE_SECRET_KEY);
            showMessage(result.message, result.success ? 'success' : 'error');
        } catch (error: any) {
            showMessage(error.message || 'Le test de connexion à Binance a échoué.', 'error');
        } finally {
            setIsTestingBinance(false);
        }
    };

    const handleUpdatePassword = async () => {
        if (!newPassword) {
            showMessage("Le mot de passe ne peut pas être vide.", 'error');
            return;
        }
        if (newPassword !== confirmPassword) {
            showMessage("Les mots de passe ne correspondent pas.", 'error');
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
            showMessage(error.message || "Échec de la mise à jour du mot de passe.", 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    const handleClearData = async () => {
        setIsClearModalOpen(false);
        setIsSaving(true);
        try {
            await api.clearAllTradeData();
            showMessage("Toutes les données de trading ont été effacées.");
            refreshData(); 
            // The settings will auto-reload via the layout effect triggered by refreshData/incrementSettings
        } catch (error: any) {
            showMessage(`Échec de l'effacement des données : ${error.message}`, 'error');
        } finally {
            setIsSaving(false);
        }
    };
    
    if (!settings) return <div className="flex justify-center items-center h-64"><Spinner /></div>;
    
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
                    const value = type === 'number' ? parseFloat(e.target.value) : e.target.value;
                    if (id in settings) {
                         handleChange(id as keyof BotSettings, value)
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
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-2xl sm:text-3xl font-bold text-white">Paramètres</h2>
                <div className="flex items-center space-x-4 flex-shrink-0 w-full sm:w-auto">
                    {saveMessage && <p className={`text-sm transition-opacity ${saveMessage.type === 'success' ? 'text-[#f0b90b]' : 'text-red-400'}`}>{saveMessage.text}</p>}
                    <button onClick={handleSave} disabled={isAnyActionInProgress} className="w-full sm:w-auto inline-flex justify-center rounded-md border border-transparent bg-[#f0b90b] py-2 px-4 text-sm font-semibold text-black shadow-sm hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-[#f0b90b] focus:ring-offset-2 focus:ring-offset-[#0c0e12] disabled:opacity-50">
                        {isSaving ? "Sauvegarde..." : "Sauvegarder les Paramètres"}
                    </button>
                </div>
            </div>
            
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-4 sm:p-6 space-y-8">
                <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Paramètres du Bot</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {renderField('INITIAL_VIRTUAL_BALANCE', "Solde Virtuel Initial ($)")}
                        {renderField('MAX_OPEN_POSITIONS', "Positions Ouvertes Max")}
                        {renderField('POSITION_SIZE_PCT', "Taille de Position (%)")}
                        {renderField('TAKE_PROFIT_PCT', "Take Profit (%)")}
                        {renderField('STOP_LOSS_PCT', "Stop Loss (%)")}
                        {renderField('SLIPPAGE_PCT', "Slippage (%)")}
                    </div>
                    <hr className="border-[#2b2f38] my-6" />
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                        {renderToggle('USE_TRAILING_STOP_LOSS', "Utiliser le Trailing Stop Loss")}
                        {renderField('TRAILING_STOP_LOSS_PCT', "Trailing Stop Loss (%)")}
                    </div>
                </div>

                <div>
                    <h3 className="text-lg font-semibold text-white mb-4">Scanner de Marché & Filtres Stratégiques</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                       {renderField('MIN_VOLUME_USD', "Volume Min (USD)")}
                       {renderField('MIN_VOLATILITY_PCT', "Volatilité Min (%)")}
                       {renderField('COINGECKO_SYNC_SECONDS', "Synchro Scanner (secondes)")}
                       {renderField('LOSS_COOLDOWN_HOURS', "Cooldown sur Perte (Heures)")}
                        <div className="md:col-span-2">
                             <label htmlFor="COINGECKO_API_KEY" className="flex items-center space-x-2 text-sm font-medium text-gray-300">
                                <span>Clé API CoinGecko</span>
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
                                    {isTestingCoinGecko ? "Test..." : "Tester"}
                                </button>
                            </div>
                        </div>
                        <div className="md:col-span-3">
                            {renderField('EXCLUDED_PAIRS', "Paires Exclues (séparées par des virgules)", 'text')}
                        </div>
                    </div>
                    <hr className="border-[#2b2f38] my-6" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        {renderToggle('USE_VOLUME_CONFIRMATION', "Conf. par le Volume")}
                        {renderToggle('USE_MARKET_REGIME_FILTER', "Filtre de Régime de Marché")}
                        {renderToggle('REQUIRE_STRONG_BUY', "Exiger 'Strong Buy' Uniquement")}
                    </div>
                </div>
            </div>

            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-4 sm:p-6 space-y-6">
                <h3 className="text-lg font-semibold text-white">Stratégie Avancée & Gestion des Risques</h3>
                 <div className="space-y-6">
                    {/* --- Defense --- */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start p-4 border border-gray-700 rounded-md">
                        <div className="md:col-span-3 text-base font-semibold text-[#f0b90b]">Défense</div>
                        {renderToggle('USE_ATR_STOP_LOSS', "Utiliser le Stop Loss ATR")}
                        {renderField('ATR_MULTIPLIER', "Multiplicateur ATR")}
                        <div></div>
                        {renderToggle('USE_AUTO_BREAKEVEN', "Utiliser l'Auto Break-even")}
                        {renderField('BREAKEVEN_TRIGGER_R', "Déclencheur Break-even (R)")}
                        <div></div>
                        {renderToggle('USE_RSI_OVERBOUGHT_FILTER', "Utiliser le filtre RSI Surachat")}
                        {renderField('RSI_OVERBOUGHT_THRESHOLD', "Seuil RSI Surachat")}
                    </div>
                    {/* --- Gains Optimization --- */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start p-4 border border-gray-700 rounded-md">
                        <div className="md:col-span-3 text-base font-semibold text-[#f0b90b]">Optimisation des Gains</div>
                        {renderToggle('USE_PARTIAL_TAKE_PROFIT', "Utiliser le Take Profit Partiel")}
                        {renderField('PARTIAL_TP_TRIGGER_PCT', "Déclencheur TP Partiel (%)")}
                        {renderField('PARTIAL_TP_SELL_QTY_PCT', "Qté Vendue TP Partiel (%)")}
                        {renderToggle('USE_MACD_CONFIRMATION', "Utiliser la Confirmation MACD")}
                    </div>
                     {/* --- Expert --- */}
                    <div className="grid grid-cols-1 gap-6 items-start p-4 border border-gray-700 rounded-md">
                        <div className="col-span-1 text-base font-semibold text-[#f0b90b]">Expert</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {renderToggle('USE_DYNAMIC_POSITION_SIZING', "Taille de Position Dynamique")}
                            {renderField('STRONG_BUY_POSITION_SIZE_PCT', "Taille Position Strong Buy (%)")}
                             <div></div>
                            {renderToggle('USE_ML_MODEL_FILTER', "Utiliser le filtre du modèle ML")}
                            {renderToggle('USE_CORRELATION_FILTER', "Utiliser le filtre de Corrélation")}
                            {renderToggle('USE_NEWS_FILTER', "Utiliser le filtre de Nouvelles")}
                        </div>
                         <div className="pt-4 border-t border-gray-700 mt-4">
                            <label className="text-base font-medium text-gray-300">Filtre de Confluence Multi-Temporelle</label>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-6 mt-4">
                                {renderToggle('USE_CONFLUENCE_FILTER_1M', "Tendance 1m")}
                                {renderToggle('USE_CONFLUENCE_FILTER_15M', "Tendance 15m")}
                                {renderToggle('USE_CONFLUENCE_FILTER_30M', "Tendance 30m")}
                                {renderToggle('USE_CONFLUENCE_FILTER_1H', "Tendance 1h")}
                                {renderToggle('USE_CONFLUENCE_FILTER_4H', "Tendance 4h")}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-4 sm:p-6 space-y-6">
                <h3 className="text-lg font-semibold text-white">Identifiants API</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                    {renderField('BINANCE_API_KEY', "Clé API Binance", 'text')}
                    {renderField('BINANCE_SECRET_KEY', "Clé Secrète Binance", 'password')}
                </div>
                <div className="flex justify-end">
                    <button onClick={handleTestBinanceConnection} disabled={isAnyActionInProgress || !settings.BINANCE_API_KEY || !settings.BINANCE_SECRET_KEY} className="inline-flex justify-center rounded-md border border-[#3e4451] bg-gray-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-[#f0b90b] focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        {isTestingBinance ? "Test..." : "Tester la Connexion"}
                    </button>
                </div>
            </div>
            
            <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg p-4 sm:p-6 space-y-6">
                 <h3 className="text-lg font-semibold text-white">Sécurité & Gestion des Données</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                    {renderField('newPassword', "Nouveau Mot de Passe", 'password')}
                    {renderField('confirmPassword', "Confirmer le Nouveau Mot de Passe", 'password')}
                 </div>
                 <div className="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-[#2b2f38] mt-6 gap-4">
                     <button onClick={() => setIsClearModalOpen(true)} disabled={isSaving} className="w-full sm:w-auto inline-flex justify-center rounded-md border border-red-800 bg-transparent py-2 px-4 text-sm font-medium text-red-400 shadow-sm hover:bg-red-900/50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        Effacer Toutes les Données
                    </button>
                    <button onClick={handleUpdatePassword} disabled={isAnyActionInProgress} className="w-full sm:w-auto inline-flex justify-center rounded-md border border-transparent bg-blue-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#14181f] disabled:opacity-50">
                        {isSaving ? "Mise à jour..." : "Mettre à jour le Mot de Passe"}
                    </button>
                 </div>
            </div>
        </div>
        <Modal
            isOpen={isClearModalOpen}
            onClose={() => setIsClearModalOpen(false)}
            onConfirm={handleClearData}
            title="Effacer toutes les données de trading ?"
            confirmText="Oui, Effacer les Données"
            confirmVariant="danger"
        >
            Cette action est irréversible. Elle supprimera définitivement tout l'historique des trades 
            et réinitialisera votre solde virtuel. Êtes-vous sûr de vouloir continuer ?
      </Modal>
      </>
    );
};

export default SettingsPage;