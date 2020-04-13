
import Market from './market';
import ChainBuilder from '../chain_builder';
import { unique, doAndLog, assert, request } from '../helper';
import Chain from './chain';
import Currency from './currency';

import ccxt = require('ccxt');

interface API_KEY{
  apiKey: string;
  secret: string;
}

const API_KEYS = require('../api_keys.json');

export default class Exchange {
    readonly exchange: ccxt.Exchange;

    private readonly _markets: Map<string, Market> = new Map();

    private readonly _currencies: Map<string, Currency> = new Map();

    private readonly _chainBuilder: ChainBuilder;

    private _chains: Map<string, Chain> = new Map();

    private _quoteCurrencies: string[] = [];

    private apiKeyAdded = false;

    public static readonly RETRY_DELAY_MS = 1000;

    public static readonly NUM_RETRY_ATTEMPTS = 3;

    constructor(name: string) {
      this.exchange = new (ccxt as any)[name]({ enableRateLimit: true });
      this.checkExchangeHasMethods();
      this._chainBuilder = new ChainBuilder(this);
    }

    setMaxRequestsPerSecond(maxRequestsPerSecond: number) {
      const millisBetweenRequests = Math.round(1000 / maxRequestsPerSecond);
      this.exchange.rateLimit = millisBetweenRequests;
      return this;
    }

    private checkExchangeHasMethods() {
      const exchange = this.exchange;
      const { name } = exchange;

      // Account info
      assert(exchange.has.fetchBalance, `${name} does not have fetchBalance()`);

      // Markets / Price data
      assert(exchange.has.fetchMarkets, `${name} does not have fetchMarkets()`);
      assert(exchange.has.fetchL2OrderBook, `${name} does not have fetchL2OrderBook`);

      // Trade management
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
      await this.loadOrderBooks();
      await this.terminateIfNoAPIKey();
      await this.loadBalances();
      return this;
    }

    private async loadAPIKeys() {
      const { name } = this.exchange;
      await doAndLog(`Retrieving API keys for ${name}`, () => {
        const APIKey: API_KEY | undefined = (API_KEYS as any)[name.toLowerCase()];
        if (APIKey) {
          assert(APIKey.apiKey !== undefined, `Invalid API Key for ${name}`);
          assert(APIKey.secret !== undefined, `Invalid API Key for ${name}`);
          const exchange = this.exchange;
          exchange.apiKey = APIKey.apiKey;
          exchange.secret = APIKey.secret;
          this.apiKeyAdded = true;
          return 'success';
        }
        return 'failure';
      });
      return this;
    }

    private async loadMarketsAndCurrencies() {
      this._markets.clear();

      await doAndLog('Refreshing market data', async () => {
        await request(async () => this.exchange.loadMarkets(true));
      });

      await doAndLog('Indexing markets', () => {
        Object.values(this.exchange.markets).forEach((market: ccxt.Market) => {
          this._markets.set(market.symbol, new Market(this, market));
        });
        return `${this._markets.size} loaded`;
      });

      await doAndLog('Indexing currencies', () => {
        Object.values(this.exchange.currencies).forEach((currency: ccxt.Currency) => {
          this._currencies.set(currency.code, new Currency(this, currency));
        });
        return `${this._currencies.size} loaded`;
      });

      this.determineMainQuoteCurrencies();
    }

    private async createChains() {
      await doAndLog('Building chains', async () => {
        this._chains = await this._chainBuilder.createChains();
        return `${this._chains.size} generated`;
      });
    }

    private async terminateIfNoAPIKey() {
      if (!this.apiKeyAdded) {
        console.log('No API key: process terminated.');
        process.exit(0);
      }
    }

    private async loadOrderBooks() {
      const activeMarkets = Array.from(this._markets.values()).filter(m => m.isActive());
      const racePromises = activeMarkets.map(market => market.initialize());

      // Keep track of finished promises
      const finished = racePromises.map(promise => false);
      for(let i = 0; i < racePromises.length; i++) {
        new Promise(async () => {
          await racePromises[i];
          finished[i] = true;
        });
      }

      while(finished.some(finishedState => !finishedState)) {
        await doAndLog('Loading order books', async() => {
          const notCompleted = racePromises.filter((_value, index) => !finished[index]);
          const result = await Promise.race(notCompleted);
          const completedLength = activeMarkets.length - (notCompleted.length - 1);
          return `${result.symbol} (${completedLength}/${activeMarkets.length})`;
        });
      }
    }

    private async loadBalances() {
      await doAndLog('Loading balances', async () => {
        const balances = await request(async() => this.exchange.fetchBalance());
        this._currencies.forEach((currency, key) => currency.updateBalance(balances[key]));
      });
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
}
