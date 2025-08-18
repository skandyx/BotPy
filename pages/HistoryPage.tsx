
import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/mockApi';
import { Trade, OrderSide, TradingMode } from '../types';
import Spinner from '../components/common/Spinner';
import StatCard from '../components/common/StatCard';
import { useAppContext } from '../contexts/AppContext';
import { SearchIcon, ExportIcon } from '../components/icons/Icons';


// --- TYPE DEFINITIONS ---
type SortableKeys = 'symbol' | 'entry_time' | 'exit_time' | 'pnl' | 'pnl_pct';
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  key: SortableKeys;
  direction: SortDirection;
}

// --- HELPER FUNCTIONS ---
const formatPrice = (price: number | undefined | null): string => {
    if (price === undefined || price === null) return 'N/A';
    if (price >= 1000) return price.toFixed(2);
    if (price >= 10) return price.toFixed(3);
    if (price >= 0.1) return price.toFixed(4);
    if (price >= 0.001) return price.toFixed(6);
    return price.toFixed(8);
};

const dateTimeFormatOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
};


// --- SUB-COMPONENTS ---
const SortableHeader: React.FC<{
    sortConfig: SortConfig | null;
    requestSort: (key: SortableKeys) => void;
    sortKey: SortableKeys;
    children: React.ReactNode;
}> = ({ sortConfig, requestSort, sortKey, children }) => {
    const isSorted = sortConfig?.key === sortKey;
    const directionIcon = isSorted ? (sortConfig?.direction === 'asc' ? '▲' : '▼') : '';

    return (
        <th 
            scope="col" 
            className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-[#14181f]/50 transition-colors"
            onClick={() => requestSort(sortKey)}
        >
            <div className="flex items-center">
                <span>{children}</span>
                <span className="ml-2 text-[#f0b90b]">{directionIcon}</span>
            </div>
        </th>
    );
};


// --- MAIN COMPONENT ---
const HistoryPage: React.FC = () => {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortConfig, setSortConfig] = useState<SortConfig | null>({ key: 'entry_time', direction: 'desc' });
  const [symbolFilter, setSymbolFilter] = useState('');
  const { tradeActivityCounter } = useAppContext();

  useEffect(() => {
    const loadHistory = async () => {
      setLoading(true);
      try {
        const history = await api.fetchTradeHistory();
        setTrades(history);
      } catch (error) {
        console.error("Failed to fetch trade history:", error);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [tradeActivityCounter]);

  const { filteredAndSortedTrades, summaryStats } = useMemo(() => {
    let filteredTrades = trades;
    if (symbolFilter) {
      filteredTrades = trades.filter(trade => 
        trade.symbol.toLowerCase().includes(symbolFilter.toLowerCase())
      );
    }

    const sortedTrades = [...filteredTrades];
    if (sortConfig !== null) {
      sortedTrades.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];
        
        if (aValue === undefined || aValue === null) return 1;
        if (bValue === undefined || bValue === null) return -1;
        
        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    const totalTrades = sortedTrades.length;
    const winningTrades = sortedTrades.filter(t => (t.pnl || 0) > 0).length;
    const losingTrades = totalTrades - winningTrades;
    const totalPnl = sortedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    return { 
      filteredAndSortedTrades: sortedTrades, 
      summaryStats: { totalPnl, winningTrades, losingTrades, winRate } 
    };
  }, [trades, symbolFilter, sortConfig]);

  const requestSort = (key: SortableKeys) => {
    let direction: SortDirection = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };
  
  const handleExport = () => {
    if (filteredAndSortedTrades.length === 0) {
        alert("No data to export.");
        return;
    }

    const headers = ['ID', 'Symbol', 'Side', 'Mode', 'Entry Time', 'Exit Time', 'Entry Price', 'Exit Price', 'Quantity', 'PnL', 'PnL %'];
    
    const rows = filteredAndSortedTrades.map(trade => [
        trade.id,
        `"${trade.symbol}"`,
        trade.side,
        trade.mode,
        `"${trade.entry_time}"`,
        `"${trade.exit_time || 'N/A'}"`,
        trade.entry_price,
        trade.exit_price || 'N/A',
        trade.quantity,
        trade.pnl?.toFixed(4) || 'N/A',
        trade.pnl_pct?.toFixed(2) || 'N/A'
    ]);

    const csvContent = "data:text/csv;charset=utf-8," 
        + headers.join(",") + "\n" 
        + rows.map(e => e.join(",")).join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `trade_history_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  const getSideClass = (side: OrderSide) => side === OrderSide.BUY ? 'text-green-400' : 'text-red-400';
  const getPnlClass = (pnl: number = 0) => pnl >= 0 ? 'text-green-400' : 'text-red-400';

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Spinner /></div>;
  }

  const { totalPnl, winningTrades, losingTrades, winRate } = summaryStats;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Trade History</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <StatCard title="Total P&L" value={`$${totalPnl.toFixed(2)}`} valueClassName={getPnlClass(totalPnl)} subtitle="Based on current filters" />
         <StatCard title="Trades (Win/Loss)" value={`${winningTrades} / ${losingTrades}`} subtitle="Based on current filters" />
         <StatCard title="Win Rate" value={`${winRate.toFixed(1)}%`} subtitle="Based on current filters"/>
      </div>

      <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg overflow-hidden">
        <div className="p-4 flex flex-col md:flex-row justify-between items-center gap-4 bg-[#14181f]/30">
            <div className="relative w-full md:w-auto">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <SearchIcon />
                </div>
                <input
                    type="text"
                    placeholder="Filter by Symbol..."
                    value={symbolFilter}
                    onChange={(e) => setSymbolFilter(e.target.value)}
                    className="block w-full rounded-md border-[#3e4451] bg-[#0c0e12]/50 pl-10 pr-4 py-2 shadow-sm focus:border-[#f0b90b] focus:ring-[#f0b90b] sm:text-sm text-white"
                />
            </div>
            <button
                onClick={handleExport}
                className="inline-flex items-center justify-center rounded-md border border-transparent bg-[#f0b90b] px-4 py-2 text-sm font-medium text-black font-semibold shadow-sm hover:bg-yellow-500 focus:outline-none focus:ring-2 focus:ring-[#f0b90b] focus:ring-offset-2 focus:ring-offset-[#14181f] w-full md:w-auto"
            >
                <ExportIcon />
                <span className="ml-2">Export CSV</span>
            </button>
        </div>
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[#2b2f38]">
                <thead className="bg-[#14181f]">
                    <tr>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="symbol">Symbol</SortableHeader>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Side</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Mode</th>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="entry_time">Entry Time</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="exit_time">Exit Time</SortableHeader>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Entry Price</th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Exit Price</th>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="pnl">PnL</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="pnl_pct">PnL %</SortableHeader>
                    </tr>
                </thead>
                <tbody className="bg-[#14181f]/50 divide-y divide-[#2b2f38]">
                    {filteredAndSortedTrades.map(trade => (
                        <tr key={trade.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{trade.symbol}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm font-bold ${getSideClass(trade.side)}`}>{trade.side}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${(trade.mode === TradingMode.REAL_LIVE || trade.mode === TradingMode.REAL_PAPER) ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}`}>
                                    {trade.mode}
                                </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">{new Date(trade.entry_time).toLocaleString(undefined, dateTimeFormatOptions)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">{trade.exit_time ? new Date(trade.exit_time).toLocaleString(undefined, dateTimeFormatOptions) : 'N/A'}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${formatPrice(trade.entry_price)}</td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">${formatPrice(trade.exit_price)}</td>
                            <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getPnlClass(trade.pnl)}`}>{trade.pnl?.toFixed(2) || 'N/A'}</td>
                             <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getPnlClass(trade.pnl_pct)}`}>{trade.pnl_pct?.toFixed(2) || 'N/A'}%</td>
                        </tr>
                    ))}
                     {filteredAndSortedTrades.length === 0 && (
                        <tr>
                            <td colSpan={9} className="text-center py-10 text-gray-500">
                                No trades found for the current filter.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

export default HistoryPage;
