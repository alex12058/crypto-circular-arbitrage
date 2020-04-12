
import { assert } from 'console';
import Market from './market';
import ChainBuilder from '../chain_builder';
import { unique, doAndLog } from '../helper';
import Chain from './chain';
import Currency from './currency';

import ccxt = require('ccxt');

export default class Exchange {
    private readonly _exchange: ccxt.Exchange;

    private readonly _markets: Map<string, Market> = new Map();

    private readonly _currencies: Map<string, Currency> = new Map();

    private readonly _chainBuilder: ChainBuilder;

    private _chains: Map<string, Chain> = new Map();

    private _quoteCurrencies: string[] = [];

    constructor(name: string) {
      this._exchange = new (ccxt as any)[name]();
      this.checkExchangeHasMethods();
      this._chainBuilder = new ChainBuilder(this);
    }

    private checkExchangeHasMethods() {
      const exchange = this._exchange;

      // Account info
      assert(exchange.has.fetchBalance);

      // Markets / Price data
      assert(exchange.has.fetchMarkets);
      assert(exchange.has.fetchL2OrderBook);

      // Trade management
      assert(exchange.has.fetchTradingFees);
      assert(exchange.has.fetchTrades);

      // Order management
      assert(exchange.has.createOrder);
      assert(exchange.has.cancelOrder);
      assert(exchange.has.fetchOpenOrders);
    }

    get markets() {
      return new Map(this._markets);
    }

    get getMarketsArray() {
      return Array.from(this._markets.values()).slice();
    }

    get quoteCurrencies() {
      return this._quoteCurrencies.slice();
    }

    async initialize() {
      await this.loadMarketsAndCurrencies();
      await this.createChains();
      return this;
    }

    private async loadMarketsAndCurrencies() {
      this._markets.clear();

      await doAndLog('Refreshing market data', async () => {
        await this._exchange.loadMarkets(true);
      });

      await doAndLog('Storing market pairs', () => {
        Object.values(this._exchange.markets).forEach((market: ccxt.Market) => {
          this._markets.set(market.symbol, new Market(this, market));
        });
      });

      await doAndLog('Storing currencies', () => {
        Object.values(this._exchange.currencies).forEach((currency: ccxt.Currency) => {
          this._currencies.set(currency.code, new Currency(this, currency));
        });
      });

      this.determineMainQuoteCurrencies();
    }

    /**
     * Get a list of quote currencies from the market.
     */
    private async determineMainQuoteCurrencies() {
      await doAndLog('Determining quote currencies', () => {
        const markets = Array.from(this._markets.values());

        // All the currencies listed as quote currencies
        const firstPass = unique(markets.map((market) => market.quoteCurrency));

        // Exclude quote currencies that are only quote currencies to other quote
        // currencies
        this._quoteCurrencies = Array.from(
          unique(markets
            .filter((market) => !firstPass.has(market.baseCurrency))
            .map((market) => market.quoteCurrency)),
        );
      });
    }

    private async createChains() {
      doAndLog('Building Chains', async () => {
        this._chains = await this._chainBuilder.createChains();
      });
    }
}
