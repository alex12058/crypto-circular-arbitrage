import Exchange from "./exchange";
import { request } from "../helper";

import { type Market as CCXTMarket, type OrderBook } from "ccxt";
import { OrderSide, OrderType, OrderSimulator } from "./order_simulator";

export default class Market {
  private readonly exchange: Exchange;

  readonly market: CCXTMarket;

  private _orderBook?: OrderBook;

  constructor(exchange: Exchange, market: CCXTMarket) {
    this.exchange = exchange;
    this.market = market;
  }

  async initialize() {
    this._orderBook = await request(this.fetchOrderBook);
    return this;
  }

  private fetchOrderBook = async () => {
    return this.exchange.exchange.fetchL2OrderBook(this.symbol);
  };

  get baseCurrency() {
    return this.market?.base!;
  }

  get quoteCurrency() {
    return this.market?.quote!;
  }

  get symbol() {
    return this.market?.symbol!;
  }

  get orderBook() {
    return { ...this._orderBook } as OrderBook;
  }

  get bestAsk() {
    const best = this._orderBook?.asks[0];
    if (!best) return undefined;
    return best[0];
  }

  get bestAskInValueCurrency() {
    const bestAsk = this.bestAsk;
    if (!bestAsk) return undefined;
    return this.convertPrice(bestAsk);
  }

  get bestBid() {
    const best = this._orderBook?.bids[0];
    if (!best) return undefined;
    return best[0];
  }

  get bestBidInValueCurrenct() {
    const best_bid = this.bestBid;
    if (!best_bid) return undefined;
    return this.convertPrice(best_bid);
  }

  get midMarketPrice() {
    const bestAsk = this.bestAsk;
    const bestBid = this.bestBid;
    if (!bestAsk || !bestBid) return undefined;
    return (bestAsk + bestBid) / 2;
  }

  get midMarketPriceInValueCurrency() {
    const midMarketPrice = this.midMarketPrice;
    if (!midMarketPrice) return undefined;
    return this.convertPrice(midMarketPrice);
  }

  opposite(currency: string) {
    return currency === this.baseCurrency
      ? this.quoteCurrency
      : this.baseCurrency;
  }

  hasCurrency(currency: string) {
    return this.baseCurrency === currency || this.quoteCurrency === currency;
  }

  baseIsQuote() {
    return this.exchange.quoteCurrencies.has(this.baseCurrency);
  }

  simulateOrder(
    type: OrderType,
    side: OrderSide,
    amount: number,
    price?: number,
  ) {
    return OrderSimulator.execute({
      symbol: this,
      type,
      side,
      amount,
      price,
    });
  }

  private convertPrice(quoteCurrencyQuantity: number) {
    const quoteCurrencyPrice = this.exchange.allQuoteCurrencies.get(
      this.quoteCurrency,
    )?.price;
    if (!quoteCurrencyPrice) return undefined;
    return quoteCurrencyQuantity * quoteCurrencyPrice;
  }
}
