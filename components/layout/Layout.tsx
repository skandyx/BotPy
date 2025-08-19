import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { websocketService } from '../../services/websocketService';
import { useAuth } from '../../contexts/AuthContext';
import { logService } from '../../services/logService';
import { api } from '../../services/mockApi';
import { scannerStore } from '../../services/scannerStore';


const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setConnectionStatus } = useWebSocket();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    // Link the websocket service status to the React context
    websocketService.onStatusChange(setConnectionStatus);
    
    let scannerInterval: number | null = null;

    if (isAuthenticated) {
        logService.log('INFO', "User is authenticated, connecting to backend WebSocket...");
        websocketService.connect();
        
        // Start polling for scanner data
        const fetchScannerData = async () => {
            try {
                const pairs = await api.fetchScannedPairs();
                scannerStore.updatePairList(pairs);
            } catch (error) {
                logService.log('ERROR', `Failed to fetch scanner data: ${error}`);
            }
        };
        
        fetchScannerData(); // Initial fetch
        scannerInterval = window.setInterval(fetchScannerData, 10000); // Poll every 10 seconds

    } else {
        logService.log('INFO', "User is not authenticated, disconnecting WebSocket.");
        websocketService.disconnect();
    }
    
    return () => {
      // General cleanup when Layout unmounts (e.g., on logout)
      logService.log('INFO', "Layout unmounting, ensuring WebSocket is disconnected.");
      if (scannerInterval) clearInterval(scannerInterval);
      websocketService.disconnect();
    };
  }, [isAuthenticated, setConnectionStatus]);

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