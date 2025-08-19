import React, { useEffect } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { websocketService } from '../../services/websocketService';
import { useAuth } from '../../contexts/AuthContext';
import { logService } from '../../services/logService';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { setConnectionStatus } = useWebSocket();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    // Link the websocket service status to the React context
    websocketService.onStatusChange(setConnectionStatus);

    if (isAuthenticated) {
        logService.log('INFO', "User is authenticated, connecting to backend WebSocket...");
        websocketService.connect();
    } else {
        logService.log('INFO', "User is not authenticated, disconnecting WebSocket.");
        websocketService.disconnect();
    }
    
    return () => {
      // General cleanup when Layout unmounts (e.g., on logout)
      logService.log('INFO', "Layout unmounting, ensuring WebSocket is disconnected.");
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
