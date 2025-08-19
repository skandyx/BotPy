import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';
import { api } from '../services/mockApi';
import { positionService } from '../services/positionService';
import { logService } from '../services/logService';

interface AppContextType {
  tradeActivityCounter: number;
  refreshData: () => void;
  settingsActivityCounter: number;
  incrementSettingsActivity: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [tradeActivityCounter, setTradeActivityCounter] = useState(0);
  const [settingsActivityCounter, setSettingsActivityCounter] = useState(0);

  const refreshData = useCallback(async () => {
    logService.log('INFO', 'WebSocket triggered position refresh. Fetching fresh data...');
    try {
        const freshPositions = await api.fetchActivePositions();
        positionService.setPositions(freshPositions);
        setTradeActivityCounter(prev => prev + 1);
    } catch (error) {
        logService.log('ERROR', `Failed to refresh positions: ${error}`);
    }
  }, []);
  
  const incrementSettingsActivity = useCallback(() => {
    setSettingsActivityCounter(prev => prev + 1);
  }, []);

  return (
    <AppContext.Provider value={{ tradeActivityCounter, refreshData, settingsActivityCounter, incrementSettingsActivity }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
