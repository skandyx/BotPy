import React, { createContext, useState, useContext, ReactNode } from 'react';
import { TradingMode } from '../types';

interface BotStateContextType {
  isBotRunning: boolean;
  toggleBot: () => void;
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;
}

const BotStateContext = createContext<BotStateContextType | undefined>(undefined);

export const BotStateProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isBotRunning, setIsBotRunning] = useState<boolean>(true); // Start as ON by default
  const [tradingMode, setTradingMode] = useState<TradingMode>(TradingMode.VIRTUAL);

  const toggleBot = () => {
    setIsBotRunning(prev => !prev);
  };

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
