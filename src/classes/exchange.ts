
import ccxt = require('ccxt');
import { Ticker } from './ticker';
import { ChainBuilder } from '../chain_builder';
import { contains, unique } from '../helper';
import { Chain } from './chain';

export class Exchange {
    private readonly _exchange: ccxt.Exchange;
    private readonly _tickers: Map<string, Ticker> = new Map();
    private readonly _symbols: Map<string, Symbol> = new Map();
    private readonly _chainBuilder: ChainBuilder;
    private _chains: Map<string, Chain> = new Map();
    private _quoteCurrencies: string[] = [];

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
     */
    private load_quote_currencies() {
        const tickers = Array.from(this._tickers.values());

        // All the currencies listed as quote currencies
        const firstPass = unique(tickers.map(ticker => ticker.quoteCurrency));

        // Exclude quote currencies that are only quote currencies to other quote
        // currencies
        this._quoteCurrencies = Array.from(
            unique(tickers
                .filter(ticker => !firstPass.has(ticker.baseCurrency))
                .map(ticker => ticker.quoteCurrency)
            )
        );
    }

    private async create_chains() {
        this._chains = await this._chainBuilder.createChains();
        console.log(this._chains.keys());
    }
}
