import Exchange from './exchange';

import ccxt = require('ccxt');
import Market from './market';
import { assert } from '../helper';

export default class Currency {
    private readonly exchange: Exchange;

    private readonly currency: ccxt.Currency;

    private readonly _markets: Map<string, Market> = new Map();

    private free: number = 0;

    private used: number = 0;

    constructor(exchange: Exchange, currency: ccxt.Currency) {
      this.exchange = exchange;
      this.currency = currency;
    }

    addMarket(market: Market) {
      this._markets.set(market.symbol, market);
    }

    get code() {
      return this.currency.code;
    }

    /**
     * The value of 1 unit of the currency in the mainQuoteCurrrency specified
     * by the exchange
     */
    get mainQuotePrice() {
      // Return 1 if this currency is the mainQuoteCurrency
      if (this.code === this.exchange.mainQuoteCurrency) return 1;

      // Market where quote currency is the mainQuoteCurrency
      const directMarket = this._markets.get(`${this.code}/${this.exchange.mainQuoteCurrency}`);
      if (directMarket) return directMarket.midMarketPrice;

      // Market where base currency is the MainQuoteCurrency
      const indirectMarket = this.exchange.markets.get(`${this.exchange.mainQuoteCurrency}/${this.code}`);
      assert(indirectMarket, `Currency cannot be evaluated in ${this.exchange.mainQuoteCurrency}`);
      const indirectMidMarket = indirectMarket!.midMarketPrice;
      if (!indirectMidMarket) return undefined;
      return 1 / indirectMidMarket;
    }

    updateBalance(balance: any) {
      this.free = balance.free;
      this.used = balance.used;
    }
}
