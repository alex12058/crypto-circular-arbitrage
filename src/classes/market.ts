import Exchange from './exchange';
import { contains } from '../helper';

import ccxt = require('ccxt');

export default class Market {
    private readonly exchange: Exchange;

    readonly market: ccxt.Market;

    constructor(exchange: Exchange, market: ccxt.Market) {
      this.exchange = exchange;
      this.market = market;
    }

    get baseCurrency() {
      return this.market.base;
    }

    get quoteCurrency() {
      return this.market.quote;
    }

    get symbol() {
      return this.market.symbol;
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
      return contains(this.exchange.quoteCurrencies, this.baseCurrency);
    }
}
