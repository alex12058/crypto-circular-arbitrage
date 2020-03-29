
import ccxt = require('ccxt');
import { Ticker } from './ticker';

export class Exchange {
    readonly exchange: ccxt.Exchange;
    private readonly _tickers: Map<string, Ticker> = new Map();

    constructor(name: string) {
        this.exchange = new (ccxt as any)[name]();
    }

    get tickers() {
        return new Map(this._tickers);
    }

    async initialize() {
        const tickers =  await this.exchange.fetchTickers();
        Object.keys(tickers).forEach(key => {
            this._tickers.set(key, (tickers as any)[key]);
        });
    }
}