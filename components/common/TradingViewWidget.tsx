import React, { useEffect, useRef } from 'react';

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

  useEffect(() => {
    const createWidget = () => {
      if (containerRef.current && window.TradingView) {
        // Clear any existing widget
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
          container_id: containerRef.current.id,
          details: true,
          hotlist: true,
          calendar: true,
        };

        widgetRef.current = new window.TradingView.widget(widgetOptions);
      }
    };

    // TradingView script might load asynchronously
    if (window.TradingView) {
      createWidget();
    } else {
      const script = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
      if (script) {
        script.addEventListener('load', createWidget);
        return () => script.removeEventListener('load', createWidget);
      }
    }

  }, [symbol, defaultInterval]);

  // Give the container a unique ID for TradingView to hook into
  const containerId = `tradingview_widget_${symbol}_${defaultInterval}`;

  return (
    <div 
        id={containerId} 
        ref={containerRef} 
        className="tradingview-widget-container h-[500px]"
    />
  );
};

export default TradingViewWidget;