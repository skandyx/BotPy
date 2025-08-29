import React, { useEffect, useRef, memo } from 'react';

// Make TradingView available on the window object
declare global {
  interface Window {
    TradingView: any;
  }
}

interface TradingViewWidgetProps {
  symbol: string;
  defaultInterval?: string;
}

const TradingViewWidget: React.FC<TradingViewWidgetProps> = ({ symbol, defaultInterval = "15" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  // Give the container a unique ID for TradingView to hook into
  const containerId = `tradingview_widget_${symbol.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;


  useEffect(() => {
    if (!containerRef.current) return;

    let isMounted = true;
    
    const createWidget = () => {
        if (!isMounted || !containerRef.current || !window.TradingView?.widget) {
            return;
        }

        // Clean up any previous widget instance before creating a new one
        if (widgetRef.current) {
            widgetRef.current.remove();
            widgetRef.current = null;
        }
        containerRef.current.innerHTML = '';

        const widgetOptions = {
            autosize: true,
            symbol: `BINANCE:${symbol}`,
            interval: defaultInterval,
            timezone: "Etc/UTC",
            theme: "dark",
            style: "1",
            locale: "fr",
            toolbar_bg: "#f1f3f6",
            enable_publishing: false,
            hide_side_toolbar: false,
            allow_symbol_change: true,
            container_id: containerId,
            details: true,
            hotlist: true,
            calendar: true,
        };
        
        widgetRef.current = new window.TradingView.widget(widgetOptions);
    };

    // If the TradingView script is already available, create the widget directly.
    if (window.TradingView) {
        createWidget();
    } else {
        // If not, find the script tag and add a one-time listener.
        const script = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
        if (script) {
            script.addEventListener('load', createWidget);
        }
    }

    // Cleanup function when the component unmounts or dependencies change
    return () => {
        isMounted = false;
        const script = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
        if (script) {
            script.removeEventListener('load', createWidget);
        }
        if (widgetRef.current) {
            widgetRef.current.remove();
            widgetRef.current = null;
        }
    };
  }, [symbol, defaultInterval, containerId]); // Depend on containerId to ensure re-creation

  return (
    <div 
        id={containerId} 
        ref={containerRef} 
        className="tradingview-widget-container h-[500px]"
    />
  );
};

// Use React.memo to prevent unnecessary re-renders if props haven't changed
export default memo(TradingViewWidget);