import Exchange from './exchange';

import ccxt = require('ccxt');

export default class Currency {
    private readonly exchange: Exchange;

    private readonly currency: ccxt.Currency;

    constructor(exchange: Exchange, currency: ccxt.Currency) {
      this.exchange = exchange;
      this.currency = currency;
    }

    get code() {
      return this.currency.code;
    }

    isActive() {
      return (this.currency as any).active;
    }
}
