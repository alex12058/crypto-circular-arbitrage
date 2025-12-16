import { ChainNode } from "../chain_builder";
import {
  nextLoopableIndex,
  prevLoopableIndex,
  mirrorIndex,
  changeFirstIndex,
  XOR,
  average,
} from "../helper";
import Market from "./market";
import Exchange from "./exchange";
import {
  OrderSide,
  OrderSimulator,
  OrderType,
  OrderBase,
} from "./order_simulator";
import { assert } from "console";

export default class Chain {
  private readonly exchange: Exchange;

  private readonly markets: Market[];

  readonly hash: string;

  constructor(exchange: Exchange, chainNodes: ChainNode[]) {
    this.exchange = exchange;
    this.markets = Chain.getHashableOrder(chainNodes);
    this.hash = Chain.generateHash(this.markets);
  }

  get reverse_markets() {
    return changeFirstIndex(
      this.markets.slice().reverse(),
      mirrorIndex(0, this.markets.length),
    );
  }

  /**
   * Given a chain which represents a unique sequence of markets that forms a
   * loop; return an array of markets in a determinable order that maintains
   * the chains sequence. Allowed manipulations are changing the starting index
   * and reversing the sequence.
   *
   * The starting index (first market) is the one with the highest priority.
   * The second market is the market directory connecting the the first
   * market with the highest priority.
   *
   *
   * Example: [XEMBTC -> XEMUSD -> BTCUSD]
   *
   * Selecting the starting index (first market):
   * In this sequence XEMBTC is the first market as its baseCurrency (XEM) is
   * not a quoteCurrency. XEMBTC has a higher priority than XEMUSD because it
   * comes first alphabetically.
   *
   * Selecting the second market: Both XEMUSD and BTCUSD are directly connected
   * to XEMBTC. XEMUSD has a higher priority because its base currency (XEM) is
   * not a quoteCurrency.
   */
  private static getHashableOrder(chainNodes: ChainNode[]) {
    const markets = chainNodes.map((link) => link.market);
    const sortedMarketSymbols = markets
      .slice()
      .sort(this.compareMarkets)
      .map((market) => market.symbol);
    const firstMarket = sortedMarketSymbols[0];
    let firstMarketIndex = markets.findIndex(
      (market) => market.symbol === firstMarket,
    );
    if (
      Chain.needToReverseOrder(markets, sortedMarketSymbols, firstMarketIndex)
    ) {
      markets.reverse();
      firstMarketIndex = mirrorIndex(firstMarketIndex, markets.length);
    }
    return changeFirstIndex(markets, firstMarketIndex);
  }

  private static compareMarkets = (a: Market, b: Market) => {
    const aHasQuoteBase = a.baseIsQuote();
    const bhasQuoteBase = b.baseIsQuote();

    // If one market has a non quote base (other has a quote base)
    // Then prioritise the one that does not have the quote base
    if (XOR(aHasQuoteBase, bhasQuoteBase)) {
      if (bhasQuoteBase) return -1;
      if (aHasQuoteBase) return 1;
    }

    // Else compare alphabetically using market symbol
    return a.symbol < b.symbol ? -1 : 1;
  };

  /**
   * Return true if the market before the firstMarket (one with highest priority)
   * has a higher priority than the market ater the firstMarket
   */
  private static needToReverseOrder(
    markets: Market[],
    sortedMarketSymbols: string[],
    firstMarketIndex: number,
  ) {
    const nextMarketIndex = nextLoopableIndex(firstMarketIndex, markets.length);
    const prevMarketIndex = prevLoopableIndex(firstMarketIndex, markets.length);
    if (nextMarketIndex === prevMarketIndex) return false;

    const nextMarketName = markets[nextMarketIndex].symbol;
    const prevMarketName = markets[prevMarketIndex].symbol;

    // Lower number means higher priority
    const nextPriority = sortedMarketSymbols.indexOf(nextMarketName);
    const prevPriority = sortedMarketSymbols.indexOf(prevMarketName);
    return nextPriority > prevPriority;
  }

  /**
   * Example input: [XEMBTC -> XEMUSD -> BTCUSD]
   * Example output: [XEM, USD, BTC]
   */
  private static currencyOrder(markets: Market[]) {
    const firstMarket = markets[0];
    const secondMarket = markets[1];
    const firstCurrency = [
      firstMarket.baseCurrency,
      firstMarket.quoteCurrency,
    ].find((currency) => secondMarket.hasCurrency(currency))!;
    let lastCurrency = firstCurrency;
    const currencyOrder: string[] = [firstCurrency];
    for (let i = 1; i < markets.length; i += 1) {
      const nextCurrency = markets[i].opposite(lastCurrency);
      currencyOrder.push((lastCurrency = nextCurrency));
    }
    return currencyOrder;
  }

  private static generateHash(markets: Market[]) {
    return Chain.currencyOrder(markets).join("/");
  }

  simulateChainCycle(starting_balance: number) {
    const calculate_for = (markets: Market[]) => {
      // Setup the balances
      const firstMarket = markets[0];
      const balances: Record<string, number> = {};
      this.hash.split("/").forEach((currency) => (balances[currency] = 0));
      const secondMarket = markets[1];
      // We start with quote if we are going to buy first
      const start_width_quote = secondMarket.hasCurrency(
        firstMarket.baseCurrency,
      );
      if (start_width_quote) {
        const quotePrice = this.exchange.quoteCurrencies.get(
          firstMarket.quoteCurrency,
        )?.price;
        if (!quotePrice) return starting_balance;
        balances[firstMarket.quoteCurrency] = starting_balance / quotePrice;
      }
      else {
        const mid_market = firstMarket.midMarketPriceInValueCurrency;
        if (!mid_market) return starting_balance;
        balances[firstMarket.baseCurrency] = starting_balance / mid_market;
      }

      // Simulate the trades between the markets
      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];
        const next_market = markets[nextLoopableIndex(i, markets.length)];
        const side = next_market.hasCurrency(market.baseCurrency)
          ? OrderSide.BUY
          : OrderSide.SELL;
        const relevant_best =
          side === OrderSide.BUY ? market.bestAsk : market.bestBid;
        if (!relevant_best) return starting_balance;
        const amount =
          side === OrderSide.BUY
            ? balances[market.quoteCurrency] / relevant_best
            : balances[market.baseCurrency];
        if (!amount) continue;
        const order_base: OrderBase = {
          symbol: market,
          type: OrderType.MARKET,
          side,
          amount,
        };
        if (!OrderSimulator.orderWithinLimits(order_base)) {
          return starting_balance;
        }
        const order = OrderSimulator.execute(order_base);
        if (side === OrderSide.BUY) {
          balances[market.quoteCurrency] -= order.cost;
          balances[market.baseCurrency] += order.filled;
        }
        else {
          balances[market.quoteCurrency] += order.cost;
          balances[market.baseCurrency] -= order.filled;
        }
        balances[market.quoteCurrency] -= order.fee;
      }

      // Calculate the value of the balances
      let balance = 0;
      for (const [currency, sub_balance] of Object.entries(balances)) {
        if (!sub_balance) continue;
        let currency_value: number;
        const quote_currency = this.exchange.allQuoteCurrencies.get(currency);
        if (quote_currency) {
          const quote_price = quote_currency.price;
          if (!quote_price) return starting_balance;
          currency_value = quote_price;
        }
        else {
          const relevant_markets = markets.filter(
            (market) => market.baseCurrency === currency,
          );
          assert(relevant_markets.length);
          const values = relevant_markets.map(
            (market) => market.midMarketPriceInValueCurrency,
          );
          if (values.some((value) => value === undefined)) {
            return starting_balance;
          }
          currency_value = average(values as number[]);
        }
        balance += sub_balance * currency_value;
      }
      return balance;
    };
    return {
      fowards: calculate_for(this.markets) - starting_balance,
      backwards: calculate_for(this.reverse_markets) - starting_balance,
    };
  }
}
