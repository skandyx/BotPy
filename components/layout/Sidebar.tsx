
import React from 'react';
import { NavLink } from 'react-router-dom';
import { useSidebar } from '../../contexts/SidebarContext';
import { DashboardIcon, ScannerIcon, HistoryIcon, SettingsIcon, ConsoleIcon, SidebarToggleIcon } from '../icons/Icons';

interface NavItemProps {
  to: string;
  isCollapsed: boolean;
  children: React.ReactNode;
}

const NavItem: React.FC<NavItemProps> = ({ to, isCollapsed, children }) => {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => {
        const baseClasses = 'group flex items-center px-4 py-3 text-sm font-semibold rounded-lg transition-colors';
        if (isCollapsed) {
          // When collapsed, active icon turns yellow, inactive is a brighter gray and turns white on hover.
          return `${baseClasses} justify-center ${isActive ? 'text-[#f0b90b]' : 'text-gray-300 hover:text-white hover:bg-[#14181f]/50'}`;
        } else {
          // When expanded, active item has a background and white text.
          return `${baseClasses} ${isActive ? 'bg-[#14181f] text-white' : 'text-gray-300 hover:text-white hover:bg-[#14181f]/50'}`;
        }
      }}
    >
      {children}
    </NavLink>
  );
};

const Sidebar: React.FC = () => {
  const { isCollapsed, toggleSidebar } = useSidebar();

  const navItemTextClass = `whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out ${isCollapsed ? 'w-0 ml-0' : 'w-auto ml-3'}`;
  const logoPyClass = `whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out ${isCollapsed ? 'w-0' : 'w-auto'}`;


  return (
    <div className={`bg-[#0c0e12] border-r border-[#1a1d26] flex-shrink-0 flex flex-col transition-all duration-300 ease-in-out ${isCollapsed ? 'w-20' : 'w-64'}`}>
      <div className="h-16 flex items-center justify-center px-4 border-b border-[#1a1d26]">
        <h1 className="text-2xl font-bold text-white tracking-wider flex items-center">
          <span className="text-[#f0b90b]">{isCollapsed ? 'B' : 'BOT'}</span>
          <span className={`text-gray-400 ${logoPyClass}`}>{isCollapsed ? '' : 'PY'}</span>
        </h1>
      </div>
      <nav className="flex-1 px-4 py-6 space-y-2">
        <NavItem to="/dashboard" isCollapsed={isCollapsed}>
          <DashboardIcon />
          <span className={navItemTextClass}>Dashboard</span>
        </NavItem>
        <NavItem to="/scanner" isCollapsed={isCollapsed}>
          <ScannerIcon />
          <span className={navItemTextClass}>Scanner</span>
        </NavItem>
        <NavItem to="/history" isCollapsed={isCollapsed}>
          <HistoryIcon />
          <span className={navItemTextClass}>History</span>
        </NavItem>
        <NavItem to="/settings" isCollapsed={isCollapsed}>
          <SettingsIcon />
          <span className={navItemTextClass}>Settings</span>
        </NavItem>
        <NavItem to="/console" isCollapsed={isCollapsed}>
          <ConsoleIcon />
          <span className={navItemTextClass}>Console</span>
        </NavItem>
      </nav>
      <div className="p-4 border-t border-[#1a1d26]">
         <button 
            onClick={toggleSidebar}
            className="w-full group flex items-center justify-center p-2 rounded-lg hover:bg-[#14181f]/50 transition-colors"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
         >
            <SidebarToggleIcon isCollapsed={isCollapsed} />
         </button>
       </div>
    </div>
  );
};

export default Sidebar;
