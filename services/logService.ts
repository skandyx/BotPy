import { LogEntry } from '../types';

type LogSubscriber = (log: LogEntry) => void;

class LogService {
    private logs: LogEntry[] = [];
    private subscribers: LogSubscriber[] = [];

    constructor() {
        this.log('INFO', 'Log service initialized.');
    }

    public log(level: LogEntry['level'], message: string) {
        const newLog: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };
        this.logs.push(newLog);
        if (this.logs.length > 200) {
            this.logs.shift();
        }
        this.subscribers.forEach(cb => cb(newLog));
    }

    public subscribe(callback: LogSubscriber) {
        if (!this.subscribers.includes(callback)) {
            this.subscribers.push(callback);
        }
    }
    
    public unsubscribe(callback: LogSubscriber) {
        this.subscribers = this.subscribers.filter(cb => cb !== callback);
    }

    public getInitialLogs(): LogEntry[] {
        return [...this.logs];
    }
}

export const logService = new LogService();
