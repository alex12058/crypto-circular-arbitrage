import Exchange from './exchange';

import ccxt = require('ccxt');

export default class Currency {
    private readonly exchange: Exchange;

    private readonly currency: ccxt.Currency;

    private free: number = 0;

    private used: number = 0;

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

    updateBalance(balance: any) {
      this.free = balance.free;
      this.used = balance.used;
    }
}
