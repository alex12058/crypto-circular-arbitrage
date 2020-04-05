
import ccxt = require('ccxt');
import { Ticker } from './ticker';
import { ChainBuilder } from '../chain_builder';
import { contains } from '../helper';

export class Exchange {
    private readonly _exchange: ccxt.Exchange;
    private readonly _tickers: Map<string, Ticker> = new Map();
    private readonly _symbols: Map<string, Symbol> = new Map();
    private readonly _chainBuilder: ChainBuilder;
    private  _quoteCurrencies: string[] = [];

    constructor(name: string) {
        this._exchange = new (ccxt as any)[name]();
        this._chainBuilder = new ChainBuilder(this);
    }

    get tickers() {
        return new Map(this._tickers);
    }
    
    get tickersArray() {
        return Array.from(this._tickers.values()).slice();
    }

    get quoteCurrencies() {
        return this._quoteCurrencies.slice();
    }

    async initialize() {
        await this.load_tickers();
        await this.create_chains();
    }

    private async load_tickers() {
        this._tickers.clear();
        const tickers = await this._exchange.fetchTickers();
        Object.keys(tickers).forEach(key => {
            this._tickers.set(key, new Ticker(this, (tickers as any)[key]));
        });
        this.load_quote_currencies();
    }

    /**
     * Get a list of quote currencies from the tickers.
     *  The base currency must not also be a quote currency
     */
    private load_quote_currencies() {
        const firstPass: string[] = [];
        const secondPass: string[] = [];
        const tickers = Array.from(this._tickers.values());

        const firstPassRequirement = (ticker: Ticker) => {
            // Quote not in first pass
            return !contains(firstPass, ticker.quoteCurrency);
        };
        const secondPassRequirement = (ticker: Ticker) => {
            // Quote not in second pass and base not in first pass
            return !contains(secondPass, ticker.quoteCurrency)
            && !contains(firstPass, ticker.baseCurrency);
        };

        tickers.forEach(ticker => {
            if(firstPassRequirement(ticker)) {
                firstPass.push(ticker.quoteCurrency);
            }
        });
        tickers.forEach(ticker => {
            if(secondPassRequirement(ticker)) {
                secondPass.push(ticker.quoteCurrency);
            }
        });
        this._quoteCurrencies = secondPass;
    }

    private async create_chains() {
        await this._chainBuilder.createChains();
    }
}