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
  const { settingsActivityCounter, refreshData, setSettings } = useAppContext(); // Listen for settings/trade changes

  useEffect(() => {
    // This effect handles the application's main data flow and WebSocket connection.
    // It runs on login/logout and whenever settings are updated.

    if (isAuthenticated) {
        logService.log('INFO', "User is authenticated, initializing data and WebSocket...");
        
        // Connect the WebSocket service status to the React context for the UI
        websocketService.onStatusChange(setConnectionStatus);
        
        // Connect the data refresh callback for position updates
        websocketService.onDataRefresh(refreshData);

        websocketService.connect();
        
        const initializeAndFetchData = async () => {
            try {
                // 1. Fetch the latest settings and update both context and store
                logService.log('INFO', 'Fetching settings and initializing...');
                const settingsData = await api.fetchSettings();
                setSettings(settingsData);
                scannerStore.updateSettings(settingsData);
                scannerStore.initialize();

                // 2. Perform an initial fetch of scanner data to populate the view.
                // Subsequent updates will arrive exclusively via WebSocket.
                const pairs = await api.fetchScannedPairs();
                scannerStore.updatePairList(pairs);
            } catch (error) {
                logService.log('ERROR', `Failed to initialize app data: ${error}`);
            }
        };

        initializeAndFetchData();

    } else {
        logService.log('INFO', "User is not authenticated, disconnecting WebSocket.");
        websocketService.disconnect();
    }
    
    return () => {
      // Cleanup when the effect re-runs or on logout.
      if (!isAuthenticated) {
          logService.log('INFO', "Layout cleanup: ensuring WebSocket is disconnected.");
          websocketService.disconnect();
      }
      // Clean up callbacks to prevent memory leaks with stale context
      websocketService.onStatusChange(null);
      websocketService.onDataRefresh(null);
    };
  }, [isAuthenticated, setConnectionStatus, settingsActivityCounter, refreshData, setSettings]);

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