
import Market from './market';
import ChainBuilder from '../chain_builder';
import { unique, doAndLog, assert, request, round } from '../helper';
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

    /**
     * All quoteCurrencies
     */
    readonly allQuoteCurrencies = new Map<string, Currency>();

    /**
     * Only quoteCurrencies that have markets with a non-quoteCurrency baseCurrency
     */
    readonly quoteCurrencies = new Map<string, Currency>();

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
        //TODO: 
        /**
         * Create a way to evaluate quoteCurrencies that are not directly
         * associated with the selected mainQuoteCurrency. A good way would be
         * to create a frequency of the quoteCurrencies and try to get to the
         * mainQuoteCurrency using the frequency order.
         */
        await this.loadBalances();
      }
      catch (error) {
        console.log(error);
        process.exit(1);
      }

      return this;
    }

    printPriceTable() {
      const currencies = Array.from(this.currencies.values()).sort((a, b) => {
        if (a.code > b.code) return 1;
        return -1;
      });
      const table: any = {};
      currencies.forEach(currency => {
        const row: any = {};
        currency.markets.forEach(market => {
          let midMarketPrice = market.mainQuoteMidMarketPrice;
          if (midMarketPrice) midMarketPrice = round(midMarketPrice, 8);
          row[market.quoteCurrency] = midMarketPrice;
        });
        table[currency.code] = row;
      });
      console.log('\nMid market prices:')
      console.table(table);
    }

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
        const markets = Array.from(this.markets.values());

        // All quoteCurrencies
        this.allQuoteCurrencies.clear();
        unique(
          markets.map((market) => market.quoteCurrency)
        ).forEach(quoteCurrency => {
          const currency = this.currencies.get(quoteCurrency);
          assert(currency, `Currency ${quoteCurrency} is missing from the currency map`);
          this.allQuoteCurrencies.set(currency!.code, currency!);
        });
  
        // Only quoteCurrencies that have markets with a non-quoteCurrency baseCurrency
        this.quoteCurrencies.clear();
        unique(
          markets.filter(market => !this.allQuoteCurrencies.has(market.baseCurrency))
            .map(market => market.quoteCurrency)
        ).forEach(quoteCurrency => {
          const currency = this.currencies.get(quoteCurrency);
          assert(currency, `Currency ${quoteCurrency} is missing from the currency map`);
          this.quoteCurrencies.set(currency!.code, currency!);
        })

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
