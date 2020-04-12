
import Market from './market';
import ChainBuilder from '../chain_builder';
import { unique, doAndLog, assert } from '../helper';
import Chain from './chain';
import Currency from './currency';

import ccxt = require('ccxt');

interface API_KEY{
  apiKey: string;
  secret: string;
}

const API_KEYS = require('../api_keys.json');

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

    private async loadAPIKeys() {
      const { name } = this._exchange;
      await doAndLog(`Retrieving API keys for ${name}`, () => {
        const APIKey: API_KEY | undefined = (API_KEYS as any)[name.toLowerCase()];
        if (APIKey) {
          assert(APIKey.apiKey !== undefined, `Invalid API Key for ${name}`);
          assert(APIKey.secret !== undefined, `Invalid API Key for ${name}`);
          const exchange = this._exchange;
          exchange.apiKey = APIKey.apiKey;
          exchange.secret = APIKey.secret;
          return 'success';
        }
        return 'failure';
      });
      return this;
    }

    private checkExchangeHasMethods() {
      const exchange = this._exchange;
      const { name } = exchange;

      // Account info
      assert(exchange.has.fetchBalance, `${name} does not have fetchBalance()`);

      // Markets / Price data
      assert(exchange.has.fetchMarkets, `${name} does not have fetchMarkets()`);
      assert(exchange.has.fetchL2OrderBook, `${name} does not have fetchL2OrderBook`);

      // Trade management
      assert(exchange.has.fetchTradingFees, `${name} does not have fetchBalance()`);
      assert(exchange.has.fetchTrades, `${name} does not have fetchTrades()`);

      // Order management
      assert(exchange.has.createOrder, `${name} does not have createOrder()`);
      assert(exchange.has.cancelOrder, `${name} does not have cancelOrder()`);
      assert(exchange.has.fetchOpenOrders, `${name} does not have fetchOpenOrders()`);
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
      await this.loadAPIKeys();
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
        return `${this._markets.size} loaded`;
      });

      await doAndLog('Storing currencies', () => {
        Object.values(this._exchange.currencies).forEach((currency: ccxt.Currency) => {
          this._currencies.set(currency.code, new Currency(this, currency));
        });
        return `${this._currencies.size} loaded`;
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

        return `${this.quoteCurrencies.length} detected`;
      });
    }

    private async createChains() {
      doAndLog('Building chains', async () => {
        this._chains = await this._chainBuilder.createChains();
        return `${this._chains.size} generated`;
      });
    }
}
