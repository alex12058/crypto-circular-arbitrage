import Exchange from "./exchange";

import { type Currency as CCXTCurrency } from "ccxt";
import Market from "./market";
import { assert } from "../helper";

export default class Currency {
  private readonly exchange: Exchange;

  private readonly currency: CCXTCurrency;

  readonly markets: Map<string, Market> = new Map();

  private free: number = 0;

  private used: number = 0;

  constructor(exchange: Exchange, currency: CCXTCurrency) {
    this.exchange = exchange;
    this.currency = currency;
  }

  addMarket(market: Market) {
    this.markets.set(market.symbol, market);
  }

  removeMarket(marketSymbol: string) {
    this.markets.delete(marketSymbol);
  }

  get code() {
    return this.currency?.code!;
  }

  priceIsDeterminable() {
    // The currency is main currency
    return !!(
      this.code === this.exchange.connectingCurrency
      // OR the currency has a pair where the quote is the main currency
      || this.markets.get(`${this.code}/${this.exchange.connectingCurrency}`)
      // OR an inverse pair exists
      || this.exchange.markets.get(
        `${this.exchange.connectingCurrency}/${this.code}`,
      )
    );
  }

  /**
   * Used to get the price of a quoteCurrency values in the valueCurrency (converted from connectingCurrency)
   */
  get price() {
    // Return 1 if this currency is the valueCurrency
    if (this.code === this.exchange.valueCurrency) return 1;

    const connectingPrice = this.connectingPrice;
    if (connectingPrice === undefined) return undefined;
    const multiplier = this.exchange.connectingPriceMultiplier;
    if (!multiplier) return undefined;
    return connectingPrice * multiplier;
  }

  /**
   * Used to get the price of a quoteCurrency values in the connectingCurrency
   */
  private get connectingPrice() {
    // Return 1 if this currency is the mainQuoteCurrency
    if (this.code === this.exchange.connectingCurrency) return 1;

    // Market where quote currency is the mainQuoteCurrency
    const directMarket = this.markets.get(
      `${this.code}/${this.exchange.connectingCurrency}`,
    );
    if (directMarket) return directMarket.midMarketPrice;

    // Market where base currency is the MainQuoteCurrency
    const indirectMarket = this.exchange.markets.get(
      `${this.exchange.connectingCurrency}/${this.code}`,
    );
    assert(
      indirectMarket,
      `${this.code} cannot be evaluated in ${this.exchange.connectingCurrency}`,
    );
    const indirectMidMarket = indirectMarket!.midMarketPrice;
    if (!indirectMidMarket) return undefined;
    return 1 / indirectMidMarket;
  }

  updateBalance(balance: any) {
    this.free = balance.free;
    this.used = balance.used;
  }
}
