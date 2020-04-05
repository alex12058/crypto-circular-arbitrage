
import ccxt = require('ccxt');
import { Exchange } from './exchange';

export class Ticker {
    private readonly exchange: Exchange;
    readonly baseCurrency: string;
    readonly quoteCurrency: string;
    readonly ticker: ccxt.Ticker;
    readonly name: string;

    constructor(exchange: Exchange, ticker: ccxt.Ticker) {
        this.exchange = exchange;
        const currencies = ticker.symbol.split('/'); // BTC/USD
        this.baseCurrency = currencies[0]; // BTC
        this.quoteCurrency = currencies[1]; // USD
        this.ticker = ticker;
        this.name = this.baseCurrency + '/' + this.quoteCurrency;
    }

    opposite(currency: string) {
        return currency === this.baseCurrency
            ? this.quoteCurrency
            : this.baseCurrency;
    }

    hasCurrency(currency: string) {
        return this.baseCurrency === currency
            || this.quoteCurrency === currency;
    }

    baseIsQuote() {
        return this.exchange.quoteCurrencies
            .findIndex(quote => quote === this.baseCurrency) !== -1;
    }
}
