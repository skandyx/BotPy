
import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useBotState } from '../../contexts/BotStateContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useAppContext } from '../../contexts/AppContext';
import { websocketService } from '../../services/websocketService';
import { tradingEngineService } from '../../services/tradingEngineService';
import { WebSocketStatus } from '../../types';
import { api } from '../../services/mockApi';
import { logService } from '../../services/logService';
import { scannerStore } from '../../services/scannerStore';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isBotRunning, tradingMode } = useBotState();
  const { setConnectionStatus } = useWebSocket();
  const { incrementTradeActivity, settingsActivityCounter } = useAppContext();

  useEffect(() => {
    // Link the websocket service status to the React context
    websocketService.onStatusChange(setConnectionStatus);
  }, [setConnectionStatus]);
  
  // Effect to pass the current trading mode to the non-React trading engine
  useEffect(() => {
      tradingEngineService.setMode(tradingMode);
  }, [tradingMode]);


  // Effect to manage the main bot lifecycle (start/stop services)
  useEffect(() => {
    if (isBotRunning) {
        logService.log('INFO',"Bot is starting... initializing services.");
        scannerStore.initialize();
        websocketService.connect();
        tradingEngineService.start(incrementTradeActivity);
    } else {
        logService.log('INFO', "Bot is stopping... clearing data and disconnecting services.");
        tradingEngineService.stop();
        websocketService.disconnect();
        scannerStore.updatePairList([]); // Clear the UI data
    }
    
    return () => {
      // General cleanup when Layout unmounts (e.g., on logout)
      tradingEngineService.stop();
      websocketService.disconnect();
    };
  }, [isBotRunning, incrementTradeActivity]);

  // Effect to sync the list of scanned pairs from the API
  useEffect(() => {
    if (!isBotRunning) {
        return; // Don't run if the bot is off.
    }

    let scanInterval: number | null = null;
    let isMounted = true;

    const syncScannerData = async () => {
        try {
            logService.log('INFO', "Syncing scanner data source...");
            const scannedPairs = await api.fetchScannedPairs();
            
            // 1. Push the full, updated list to the central store
            scannerStore.updatePairList(scannedPairs);
            
            // 2. Update WebSocket subscriptions with the symbols from the new list
            const symbols = scannedPairs.map(p => p.symbol);
            websocketService.registerOwner('scanner', symbols);

        } catch (error) {
            logService.log('ERROR', `Failed to sync scanner data: ${error}`);
        }
    };
    
    const setupAndRunSync = async () => {
        // Clear any existing interval before setting a new one.
        if (scanInterval) {
            clearInterval(scanInterval);
        }

        await syncScannerData(); // Run immediately on first load or settings change

        if (!isMounted) return;

        try {
            const currentSettings = await api.fetchSettings();
            scannerStore.updateSettings(currentSettings); // Keep the store's settings in sync
            const syncSeconds = currentSettings.COINGECKO_SYNC_SECONDS || 900;
            logService.log('INFO', `Setting scanner sync interval to ${syncSeconds} seconds.`);
            scanInterval = window.setInterval(syncScannerData, syncSeconds * 1000);
        } catch (error) {
            logService.log('ERROR', `Could not fetch settings for sync interval. Defaulting to 15 minutes. Error: ${error}`);
            scanInterval = window.setInterval(syncScannerData, 15 * 60 * 1000);
        }
    };

    setupAndRunSync();
    
    // Cleanup function for this effect
    return () => {
        isMounted = false;
        if (scanInterval) {
            clearInterval(scanInterval);
        }
    };
  }, [isBotRunning, settingsActivityCounter]); // Re-runs when bot is started OR settings are changed


  return (
    <div className="flex h-screen bg-[#0c0e12] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <Header />
        <main className="flex-1 overflow-y-auto bg-[#0c0e12] p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                {children}
            </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
