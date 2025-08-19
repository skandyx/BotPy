import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ScannedPair } from '../types';
import Spinner from '../components/common/Spinner';
import { PriceUpdate } from '../services/websocketService';
import { priceStore } from '../services/priceStore';
import { scannerStore } from '../services/scannerStore';

type SortableKeys = keyof ScannedPair;
type SortDirection = 'asc' | 'desc';

interface SortConfig {
  key: SortableKeys;
  direction: SortDirection;
}

const formatPrice = (price: number | undefined | null): string => {
    if (price === undefined || price === null) return 'N/A';
    if (price >= 1000) return price.toFixed(2);
    if (price >= 10) return price.toFixed(3);
    if (price >= 0.1) return price.toFixed(4);
    if (price >= 0.001) return price.toFixed(6);
    return price.toFixed(8);
};

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
            className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-[#14181f] transition-colors"
            onClick={() => requestSort(sortKey)}
        >
            <div className="flex items-center">
                <span>{children}</span>
                <span className="ml-2 text-[#f0b90b]">{directionIcon}</span>
            </div>
        </th>
    );
};

const EmptyScannerIcon = () => (
    <svg className="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
    </svg>
);


const ScannerPage: React.FC = () => {
  const [pairs, setPairs] = useState<ScannedPair[]>(() => scannerStore.getScannedPairs());
  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(() => scannerStore.getScannedPairs().length === 0);

  const handlePriceUpdate = useCallback((update: PriceUpdate) => {
    setPairs(prevPairs => 
      prevPairs.map(p => {
        if (p.symbol === update.symbol) {
          const priceDirection = update.price > p.price ? 'up' : (update.price < p.price ? 'down' : p.priceDirection);
          return { ...p, price: update.price, priceDirection };
        }
        return p;
      })
    );
  }, []);

  const handleScannerUpdate = useCallback((updatedPairs: ScannedPair[]) => {
    setPairs(prevPairs => {
        const prevPairsMap = new Map(prevPairs.map(p => [p.symbol, p]));
        return updatedPairs.map(newPair => {
            const existingPair = prevPairsMap.get(newPair.symbol);
            if (existingPair) {
                // Pair exists. Use new scanner data (rsi, score, etc.)
                // BUT preserve the most recent real-time price and its direction.
                return {
                    ...newPair,
                    price: existingPair.price,
                    priceDirection: existingPair.priceDirection,
                };
            }
            // This is a new pair that wasn't in the state before.
            return newPair;
        });
    });

    if (isInitialLoading) {
        setIsInitialLoading(false);
    }
  }, [isInitialLoading]);


  useEffect(() => {
    const unsubscribeScanner = scannerStore.subscribe(handleScannerUpdate);
    const unsubscribePrice = priceStore.subscribe(handlePriceUpdate);

    if (isInitialLoading && scannerStore.getScannedPairs().length > 0) {
        setIsInitialLoading(false);
        setPairs(scannerStore.getScannedPairs());
    }

    return () => {
        unsubscribeScanner();
        unsubscribePrice();
    };
  }, [handlePriceUpdate, handleScannerUpdate, isInitialLoading]);


  const requestSort = (key: SortableKeys) => {
    let direction: SortDirection = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const sortedPairs = useMemo(() => {
    let sortablePairs = [...pairs];
    if (sortConfig !== null) {
      sortablePairs.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];

        if (aVal === undefined || aVal === null) return 1;
        if (bVal === undefined || bVal === null) return -1;
        
        if (aVal < bVal) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortablePairs;
  }, [pairs, sortConfig]);
  
  const getScoreBadgeClass = (score: ScannedPair['score']) => {
    switch (score) {
        case 'STRONG BUY': return 'bg-green-600 text-green-100';
        case 'BUY': return 'bg-green-800 text-green-200';
        case 'HOLD': return 'bg-gray-700 text-gray-200';
        default: return 'bg-gray-700 text-gray-200';
    }
  };
  
  const getTrendJsx = (trend: ScannedPair['trend'] | ScannedPair['trend_4h']) => {
      if (!trend) return <span className="text-gray-500">-</span>;
      switch(trend) {
          case 'UP': return <span className="text-green-400 flex items-center gap-1">▲ UP</span>;
          case 'DOWN': return <span className="text-red-400 flex items-center gap-1">▼ DOWN</span>;
          default: return <span className="text-gray-400">- NEUTRAL</span>;
      }
  }

  const getMarketRegimeJsx = (regime: ScannedPair['marketRegime']) => {
    if (!regime) return <span className="text-gray-500">-</span>;
    switch(regime) {
        case 'UPTREND': return <span className="text-sky-400 font-bold">UPTREND</span>;
        case 'DOWNTREND': return <span className="text-orange-400">DOWNTREND</span>;
        default: return <span className="text-gray-500">NEUTRAL</span>;
    }
  }

  if (isInitialLoading) {
    return <div className="flex justify-center items-center h-64"><Spinner /></div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-white">Market Scanner</h2>
      <div className="bg-[#14181f]/50 border border-[#2b2f38] rounded-lg shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[#2b2f38]">
                <thead className="bg-[#14181f]">
                    <tr>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="symbol">Symbol</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="price">Price</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="volume">Volume</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="volatility">Volatility</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="trend">Trend 1m</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="trend_4h">Trend 4h</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="marketRegime">Market Regime</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="rsi">RSI</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="adx">ADX</SortableHeader>
                        <SortableHeader sortConfig={sortConfig} requestSort={requestSort} sortKey="score">Score</SortableHeader>
                    </tr>
                </thead>
                <tbody className="bg-[#14181f]/50 divide-y divide-[#2b2f38]">
                    {sortedPairs.length > 0 ? (
                        sortedPairs.map(pair => {
                            const priceClass = pair.priceDirection === 'up' ? 'text-green-400' : (pair.priceDirection === 'down' ? 'text-red-400' : 'text-gray-300');
                            const rsiClass = pair.rsi > 70 ? 'text-yellow-400' : (pair.rsi < 30 ? 'text-purple-400' : 'text-gray-300');
                            const adxClass = pair.adx > 25 ? 'text-blue-400 font-bold' : 'text-gray-300';
                            
                            return (
                                <tr key={pair.symbol}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">{pair.symbol}</td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-mono transition-colors duration-200 ${priceClass}`}>${formatPrice(pair.price)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">${(pair.volume / 1_000_000).toFixed(2)}M</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{pair.volatility.toFixed(2)}%</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">{getTrendJsx(pair.trend)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">{getTrendJsx(pair.trend_4h)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold">{getMarketRegimeJsx(pair.marketRegime)}</td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${rsiClass}`}>{pair.rsi.toFixed(1)}</td>
                                    <td className={`px-6 py-4 whitespace-nowrap text-sm ${adxClass}`}>{pair.adx.toFixed(1)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${getScoreBadgeClass(pair.score)}`}>
                                            {pair.score}
                                        </span>
                                    </td>
                                </tr>
                            )
                        })
                    ) : (
                         <tr>
                            <td colSpan={10} className="px-6 py-16 text-center text-gray-500">
                                <div className="flex flex-col items-center">
                                    <EmptyScannerIcon />
                                    <h3 className="mt-4 text-sm font-semibold text-gray-300">No Pairs Found</h3>
                                    <p className="mt-1 text-sm text-gray-500">
                                        No pairs currently meet the scanner's criteria.
                                    </p>
                                    <p className="mt-1 text-sm text-gray-500">
                                        Try adjusting your filters on the Settings page or wait for market conditions to change.
                                    </p>
                                </div>
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

export default ScannerPage;