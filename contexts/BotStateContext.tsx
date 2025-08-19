import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import { TradingMode } from '../types';
import { api } from '../services/mockApi';
import { useAuth } from './AuthContext';

interface BotStateContextType {
  isBotRunning: boolean;
  toggleBot: () => void;
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;
}

const BotStateContext = createContext<BotStateContextType | undefined>(undefined);

export const BotStateProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isBotRunning, setIsBotRunning] = useState<boolean>(true);
  const [tradingMode, setTradingMode] = useState<TradingMode>(TradingMode.VIRTUAL);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
        api.getBotRunStatus()
            .then(data => setIsBotRunning(data.isRunning))
            .catch(err => console.error("Could not fetch bot run status:", err));
    }
  }, [isAuthenticated]);


  const toggleBot = useCallback(async () => {
    try {
        if (isBotRunning) {
            await api.stopBot();
            setIsBotRunning(false);
        } else {
            await api.startBot();
            setIsBotRunning(true);
        }
    } catch (error) {
        console.error("Failed to toggle bot state:", error);
    }
  }, [isBotRunning]);

  return (
    <BotStateContext.Provider value={{ isBotRunning, toggleBot, tradingMode, setTradingMode }}>
      {children}
    </BotStateContext.Provider>
  );
};

export const useBotState = (): BotStateContextType => {
  const context = useContext(BotStateContext);
  if (context === undefined) {
    throw new Error('useBotState must be used within a BotStateProvider');
  }
  return context;
};
