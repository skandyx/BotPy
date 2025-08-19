import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { websocketService } from '../../services/websocketService';
import { useAuth } from '../../contexts/AuthContext';
import { logService } from '../../services/logService';
import { api } from '../../services/mockApi';
import { scannerStore } from '../../services/scannerStore';
import { useAppContext } from '../../contexts/AppContext';


const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setConnectionStatus } = useWebSocket();
  const { isAuthenticated } = useAuth();
  const { settingsActivityCounter } = useAppContext(); // Listen for settings changes

  useEffect(() => {
    // This effect handles the application's main data flow and WebSocket connection.
    // It runs on login/logout and whenever settings are updated.
    
    let scannerInterval: number | null = null;

    if (isAuthenticated) {
        logService.log('INFO', "User is authenticated, initializing data and WebSocket...");
        websocketService.connect();
        
        const initializeAndFetchData = async () => {
            try {
                // 1. Fetch the latest settings and update the scanner store.
                // This is crucial for real-time indicator calculations.
                logService.log('INFO', 'Fetching settings and initializing scanner store...');
                const settings = await api.fetchSettings();
                scannerStore.updateSettings(settings);
                scannerStore.initialize();

                // 2. Perform an initial fetch of scanner data.
                const pairs = await api.fetchScannedPairs();
                scannerStore.updatePairList(pairs);
            } catch (error) {
                logService.log('ERROR', `Failed to initialize app data: ${error}`);
            }
        };

        initializeAndFetchData();
        
        // Start polling for scanner data to catch any new pairs found by the backend scan.
        scannerInterval = window.setInterval(async () => {
            try {
                const pairs = await api.fetchScannedPairs();
                scannerStore.updatePairList(pairs);
            } catch (error) {
                logService.log('ERROR', `Failed to poll scanner data: ${error}`);
            }
        }, 10000); // Poll every 10 seconds

    } else {
        logService.log('INFO', "User is not authenticated, disconnecting WebSocket.");
        websocketService.disconnect();
    }
    
    return () => {
      // Cleanup when the effect re-runs or on logout.
      if (scannerInterval) clearInterval(scannerInterval);
      if (!isAuthenticated) {
          logService.log('INFO', "Layout cleanup: ensuring WebSocket is disconnected.");
          websocketService.disconnect();
      }
    };
  }, [isAuthenticated, setConnectionStatus, settingsActivityCounter]);

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