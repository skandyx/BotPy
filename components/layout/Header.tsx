
import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useBotState } from '../../contexts/BotStateContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import ToggleSwitch from '../common/ToggleSwitch';
import Modal from '../common/Modal';
import { TradingMode, WebSocketStatus } from '../../types';
import { LogoutIcon, ClockIcon } from '../icons/Icons';

const getTitleFromPath = (path: string): string => {
    const name = path.split('/').pop() || 'dashboard';
    return name.charAt(0).toUpperCase() + name.slice(1);
};


const Header: React.FC = () => {
  const { tradingMode, setTradingMode, isBotRunning, toggleBot } = useBotState();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<TradingMode | null>(null);
  const { logout } = useAuth();
  const location = useLocation();
  const [pageTitle, setPageTitle] = useState('Dashboard');
  const [syncTimer, setSyncTimer] = useState(60);
  const { connectionStatus } = useWebSocket();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    setPageTitle(getTitleFromPath(location.pathname));
  }, [location]);

  useEffect(() => {
    const updateTimer = () => {
        const seconds = new Date().getSeconds();
        setSyncTimer(60 - seconds);
    };

    updateTimer(); // Set initial value immediately
    
    const timerId = setInterval(updateTimer, 1000);
    
    return () => clearInterval(timerId);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
            setIsDropdownOpen(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleModeChange = (newMode: TradingMode) => {
    setIsDropdownOpen(false);
    if (newMode === TradingMode.REAL_LIVE) {
      setPendingMode(newMode);
      setIsModalOpen(true);
    } else {
      setTradingMode(newMode);
    }
  };

  const confirmModeSwitch = () => {
    if (pendingMode) {
        setTradingMode(pendingMode);
    }
    setIsModalOpen(false);
    setPendingMode(null);
  };

  const getStatusIndicatorClass = () => {
      switch(connectionStatus) {
          case WebSocketStatus.CONNECTED:
              return 'bg-[#f0b90b]';
          case WebSocketStatus.CONNECTING:
              return 'bg-yellow-500 animate-pulse';
          case WebSocketStatus.DISCONNECTED:
              return 'bg-red-500';
          default:
              return 'bg-gray-500';
      }
  };

  const getModeLabel = (mode: TradingMode) => {
    switch (mode) {
        case TradingMode.VIRTUAL: return 'Virtual';
        case TradingMode.REAL_PAPER: return 'Real (Paper)';
        case TradingMode.REAL_LIVE: return 'Real (Live)';
    }
  };
  
  return (
    <>
      <header className="bg-[#0c0e12]/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="flex items-center justify-between h-16 px-4 sm:px-6 lg:px-8 border-b border-[#1a1d26]">
            <h1 className="text-xl font-bold text-white">{pageTitle}</h1>
            <div className="flex items-center space-x-4 md:space-x-6">
                <div className="flex items-center space-x-3">
                    <ToggleSwitch
                        checked={isBotRunning}
                        onChange={toggleBot}
                        leftLabel="ON"
                        rightLabel="OFF"
                    />
                    <div className="hidden sm:flex items-center space-x-2" aria-live="polite">
                        <div className={`h-2.5 w-2.5 rounded-full ${isBotRunning ? 'bg-[#f0b90b]' : 'bg-orange-500'}`}></div>
                        <span className={`text-xs font-semibold ${isBotRunning ? 'text-[#f0b90b]' : 'text-orange-400'}`}>
                            {isBotRunning ? 'Bot Active' : 'Bot Offline'}
                        </span>
                    </div>
                </div>

                <div className="hidden sm:flex items-center space-x-2" title="Time until next 1-min candle analysis">
                    <ClockIcon />
                    <span className="text-xs text-gray-400 font-mono w-7">
                        {syncTimer}s
                    </span>
                </div>

                <div className="flex items-center space-x-2">
                    <div className={`h-3 w-3 rounded-full transition-colors ${getStatusIndicatorClass()}`} title={`WebSocket: ${connectionStatus}`}></div>
                    <span className="text-xs text-gray-400 font-medium hidden sm:block">WS</span>
                </div>

                <div ref={dropdownRef} className="relative">
                    <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} className="flex items-center justify-center px-3 py-1.5 border border-[#3e4451] rounded-md text-sm font-medium text-white hover:bg-[#14181f] transition-colors">
                        {getModeLabel(tradingMode)}
                        <svg className="-mr-1 ml-2 h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                    {isDropdownOpen && (
                         <div className="origin-top-right absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-[#14181f] ring-1 ring-black ring-opacity-5 focus:outline-none">
                             <div className="py-1">
                                <a href="#" onClick={() => handleModeChange(TradingMode.VIRTUAL)} className={`block px-4 py-2 text-sm ${tradingMode === TradingMode.VIRTUAL ? 'text-[#f0b90b]' : 'text-gray-300'} hover:bg-[#2b2f38]`}>Virtual</a>
                                <a href="#" onClick={() => handleModeChange(TradingMode.REAL_PAPER)} className={`block px-4 py-2 text-sm ${tradingMode === TradingMode.REAL_PAPER ? 'text-[#f0b90b]' : 'text-gray-300'} hover:bg-[#2b2f38]`}>Real (Paper)</a>
                                <a href="#" onClick={() => handleModeChange(TradingMode.REAL_LIVE)} className={`block px-4 py-2 text-sm ${tradingMode === TradingMode.REAL_LIVE ? 'text-[#f0b90b]' : 'text-red-400'} hover:bg-[#2b2f38]`}>Real (Live)</a>
                             </div>
                         </div>
                    )}
                </div>

                <button onClick={logout} aria-label="Logout">
                <LogoutIcon />
                </button>
            </div>
        </div>
      </header>
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={confirmModeSwitch}
        title="Switch to REAL (LIVE) Trading Mode?"
        confirmText="Yes, switch to LIVE"
        confirmVariant="danger"
      >
        You are about to switch to REAL LIVE trading mode. This will execute trades
        with real funds on your exchange account. Are you absolutely sure you
        want to proceed?
      </Modal>
    </>
  );
};

export default Header;