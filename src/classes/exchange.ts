
import Market from './market';
import ChainBuilder from '../chain_builder';
import { unique, doAndLog, assert, request } from '../helper';
import Chain from './chain';
import Currency from './currency';

import ccxt = require('ccxt');
import { stringify } from 'querystring';

interface ExchangeConfig{
  rateLimit?: number;
  apiKey: string;
  secret: string;
}

function isExchangeConfig(exchangeConfig: ExchangeConfig) {
  return typeof exchangeConfig.apiKey === 'string'
    && typeof exchangeConfig.secret === 'string'
    && !exchangeConfig.rateLimit || typeof exchangeConfig.rateLimit === 'number';
}

const exchangeConfigs = require('../exchange_configs.json');

export default class Exchange {
    readonly exchange: ccxt.Exchange;

    /** What every currecny will be valued against */
    readonly mainQuoteCurrency: string;

    readonly markets: Map<string, Market> = new Map();

    readonly currencies: Map<string, Currency> = new Map();

    private readonly _chainBuilder: ChainBuilder;

    private _chains: Map<string, Chain> = new Map();

    quoteCurrencies = new Map<string, Currency>();

    public static readonly RETRY_DELAY_MS = 1000;

    public static readonly NUM_RETRY_ATTEMPTS = 3;

    constructor(config: { name: string, mainQuoteCurrency: string }) {
      this.exchange = new (ccxt as any)[config.name]({ enableRateLimit: true });
      this.mainQuoteCurrency = config.mainQuoteCurrency;
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

    async initialize() {
      try {
        await this.loadExchangeConfiguration();
        await this.loadMarketsAndCurrencies();
        await this.createChains();
        await this.loadOrderBooks();
        await this.loadBalances();
      }
      catch (error) {
        console.log(error);
        process.exit(1);
      }

      return this;
    }

    // TODO: Make a sub function of loadConfiguration() which also has details about rate limiting
    private async loadExchangeConfiguration() {
      const { name } = this.exchange;
      let loaded = false;
      await doAndLog(`Loading config for ${name}`, () => {
        const exchangeConfig: ExchangeConfig | undefined = (exchangeConfigs as any)[name.toLowerCase()];
        if (exchangeConfig) {
          if (!isExchangeConfig(exchangeConfig)) return 'invalid config';
          const exchange = this.exchange;
          exchange.apiKey = exchangeConfig.apiKey;
          exchange.secret = exchangeConfig.secret;
          if (exchangeConfig.rateLimit) this.setMaxRequestsPerSecond(exchangeConfig.rateLimit);
          loaded = true;
          return 'success';
        }
        return 'no config found'
      });
      if (!loaded) {
        console.log('Load sequence aborted.')
        process.exit(0);
      }
      return this;
    }

    private async loadMarketsAndCurrencies() {
      this.markets.clear();

      await doAndLog('Refreshing market data', async () => {
        await request(async () => this.exchange.loadMarkets(true));
      });

      await doAndLog('Indexing currencies', () => {
        // Create currencies
        Object.values(this.exchange.currencies).forEach((currency: ccxt.Currency) => {
          this.currencies.set(currency.code, new Currency(this, currency));
        });
        return `${this.currencies.size} loaded`;
      });

      await doAndLog('Indexing markets', () => {
        Object.values(this.exchange.markets).forEach((market: ccxt.Market) => {
          if (market.active) {
            const newMarket = new Market(this, market);
            this.markets.set(market.symbol, newMarket);
            this.currencies.get(newMarket.baseCurrency)?.addMarket(newMarket);
          } 
        });
        return `${this.markets.size} loaded`;
      });


      await this.determineMainQuoteCurrencies();
    }

    private async createChains() {
      await doAndLog('Building chains', async () => {
        this._chains = await this._chainBuilder.createChains();
        return `${this._chains.size} generated`;
      });
    }

    private async loadOrderBooks() {
      const markets = Array.from(this.markets.values())
      const promises = markets.map(market => market.initialize());

      // Keep track of finished promises
      const finished = promises.map(_promise => false);
      for(let i = 0; i < promises.length; i++) {
        new Promise(async () => {
          await promises[i];
          finished[i] = true;
        });
      }

      while(finished.some(finishedState => !finishedState)) {
        await doAndLog('Loading order book', async() => {
          const notCompleted = promises.filter((_value, index) => !finished[index]);
          const result = await Promise.race(notCompleted);
          const completedLength = markets.length - (notCompleted.length - 1);
          return `${result.symbol} (${completedLength}/${markets.length})`;
        });
      }
    }

    private async loadBalances() {
      await doAndLog('Loading balances', async () => {
        const balances = await request(async() => this.exchange.fetchBalance());
        this.currencies.forEach((currency, key) => currency.updateBalance(balances[key]));
      });
    }

    /**
     * Get a list of quote currencies from the market.
     */
    private async determineMainQuoteCurrencies() {
      let aborted = false;
      await doAndLog('Determining quote currencies', () => {
        this.quoteCurrencies.clear();

        const markets = Array.from(this.markets.values());

        // All the currencies listed as quote currencies
        const firstPass = unique(markets.map((market) => market.quoteCurrency));

        // Exclude quote currencies that are only quote currencies to other quote
        // currencies
        unique(
          markets
            .filter((market) => !firstPass.has(market.baseCurrency))
            .map((market) => market.quoteCurrency)
        ).forEach(currencyCode => {
          const currency = this.currencies.get(currencyCode);
          assert(currency, `Currency ${currencyCode} missing from currencies map`);
          this.quoteCurrencies.set(currencyCode, currency!);
        });

        if(!this.quoteCurrencies.has(this.mainQuoteCurrency)) {
          aborted = true;
          return 'aborted'
        }

        return `${this.quoteCurrencies.size} detected`;
      });
      if (aborted) {
        throw new Error(`${this.mainQuoteCurrency} is not a valid quoteCurrency.`)
      }
    }
}
