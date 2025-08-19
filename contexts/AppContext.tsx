import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';

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

  const refreshData = useCallback(() => {
    setTradeActivityCounter(prev => prev + 1);
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
