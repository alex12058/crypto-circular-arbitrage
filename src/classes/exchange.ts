import Market from "./market";
import ChainBuilder from "../chain_builder";
import { unique, doAndLog, assert, request, round } from "../helper";
import Chain from "./chain";
import Currency from "./currency";
import * as fs from "fs";
import * as Papa from "papaparse";

import ccxt, {
  type Exchange as CCXTExchange,
  type Currency as CCXTCurrency,
  type Market as CCXTMarket,
} from "ccxt";

/**
 * The configuration takes the name of the exchange and the names of two currencies.
 * For the currencies to work the connectingCurrency should be the dominant currency (BTC)
 * and the valueCurrency should have low volatility (such as USDT or USD). There
 * must exist a market that has both the connectingCurrency and the valueCurrency
 * so that price conversions can be done.
 *
 * @param name The name of the exchange
 * @param connectingCurrency The currency used to determine the pricing relationship between currencies. It should be the dominant currency (most traded) e.g. BTC
 * @param valueCurrency The currency all prices are converted to (e.g. USDT)
 * @param minVolumeUSD Optional minimum 24h trading volume in USD to filter markets (default: 0 = no filter)
 */
interface ExchangeConstructorParams {
  name: string;
  connectingCurrency: string;
  valueCurrency: string;
  minVolumeUSD?: number;
}

export default class Exchange {
  readonly exchange: CCXTExchange;

  /** Currency used to determine price relations between currencies */
  readonly connectingCurrency: string;
  /** Currency all prices are converted to (from connectingCurrency) */
  readonly valueCurrency: string;
  /** Minimum 24h trading volume in USD to filter markets */
  readonly minVolumeUSD: number;
  readonly markets: Map<string, Market> = new Map();
  readonly marketsByCurrency: Map<string, Market[]> = new Map();
  readonly currencies: Map<string, Currency> = new Map();
  private readonly _chainBuilder: ChainBuilder;
  private _chains: Map<string, Chain> = new Map();
  readonly allQuoteCurrencies = new Map<string, Currency>();
  /** Only quoteCurrencies that have markets with a non-quoteCurrency baseCurrency */
  readonly quoteCurrencies = new Map<string, Currency>();
  public static readonly RETRY_DELAY_MS = 1000;
  public static readonly NUM_RETRY_ATTEMPTS = 3;
  private hasCredentials: boolean = false;

  constructor(config: ExchangeConstructorParams) {
    this.exchange = new (ccxt as any)[config.name]({ enableRateLimit: true });
    this.connectingCurrency = config.connectingCurrency;
    this.valueCurrency = config.valueCurrency;
    this.minVolumeUSD = config.minVolumeUSD || 0;
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
    assert(
      exchange.has.fetchL2OrderBook,
      `${name} does not have fetchL2OrderBook`,
    );

    // Trade management
    assert(exchange.has.fetchTrades, `${name} does not have fetchTrades()`);

    // Order management
    assert(exchange.has.createOrder, `${name} does not have createOrder()`);
    assert(exchange.has.cancelOrder, `${name} does not have cancelOrder()`);
    assert(
      exchange.has.fetchOpenOrders,
      `${name} does not have fetchOpenOrders()`,
    );
  }

  async initialize() {
    try {
      await this.loadExchangeConfiguration();
      await this.loadMarketsAndCurrencies();
      await this.createChains();
      await this.loadOrderBooks();
      if (this.hasCredentials) {
        await this.loadBalances();
      }
    }
    catch (error) {
      console.log(error);
      process.exit(1);
    }

    return this;
  }

  printPriceTable() {
    const currencies = Array
      .from(this.currencies.values())
      .filter((currency) => currency.markets.size)
      .sort((a, b) => {
        if (a.code > b.code) return 1;
        return -1;
      });
    const table: any = {};
    currencies.forEach((currency) => {
      const row: any = {};
      currency.markets.forEach((market) => {
        let midMarketPrice = market.midMarketPriceInValueCurrency;
        row[market.quoteCurrency] = midMarketPrice && round(midMarketPrice, 8);
      });
      table[currency.code] = row;
    });

    const csv = this.tableToCSV(table);
    fs.writeFileSync("price_table.csv", csv, "utf-8");
    console.log("\nPrice table saved to price_table.csv");
  }

  printChainCycleTests(onlyProfitable: boolean) {
    const table: any = {};
    this._chains.forEach((chain) => {
      const results = chain.simulateChainCycle(100);
      if (!onlyProfitable || results.fowards > 0 || results.backwards > 0) {
        results.fowards = round(results.fowards, 2);
        results.backwards = round(results.backwards, 2);
        table[chain.hash] = results;
      }
    });

    // Sort by most profitable (max of forwards/backwards) descending
    const sortedEntries = Object
      .entries(table)
      .sort(([_a, a]: [string, any], [_b, b]: [string, any]) => {
        const maxA = Math.max(a.fowards, a.backwards);
        const maxB = Math.max(b.fowards, b.backwards);
        return maxB - maxA;
      });

    const sortedTable: any = {};
    sortedEntries.forEach(([key, value]) => {
      sortedTable[key] = value;
    });

    const csv = this.tableToCSV(sortedTable);
    fs.writeFileSync("chain_cycle_tests.csv", csv, "utf-8");
    console.log("\nChain cycle tests saved to chain_cycle_tests.csv");
  }

  private tableToCSV(data: any): string {
    const entries = Object.entries(data);
    if (entries.length === 0) return "";

    // Convert object to array of rows for papaparse
    const rows = entries.map(([key, row]: [string, any]) => ({
      Key: key,
      ...row,
    }));

    return Papa.unparse(rows);
  }

  private async loadExchangeConfiguration() {
    const { name } = this.exchange;
    await doAndLog(
      `Loading config for ${name || "exchange"}`,
      () => {
        // Try to load from environment variables (e.g., BINANCE_API_KEY, BINANCE_API_SECRET)
        const envKeyName = `${(name || "").toUpperCase()}_API_KEY`;
        const envSecretName = `${(name || "").toUpperCase()}_API_SECRET`;
        const apiKey = process.env[envKeyName];
        const apiSecret = process.env[envSecretName];

        if (apiKey && apiSecret) {
          this.exchange.apiKey = apiKey;
          this.exchange.secret = apiSecret;
          this.hasCredentials = true;
          return "loaded from environment";
        }
        // No credentials found - will run in public API mode (no authentication)
        this.hasCredentials = false;
        return "public mode (no credentials)";
      },
    );
    return this;
  }

  private async loadMarketsAndCurrencies() {
    this.markets.clear();

    await doAndLog(
      "Refreshing market data",
      async () => {
        await request(async () => this.exchange.loadMarkets(true));
      },
    );

    // Fetch tickers to get volume data for filtering
    let tickers: any = {};
    if (this.minVolumeUSD > 0) {
      await doAndLog(
        "Fetching market volumes",
        async () => {
          tickers = await request(async () => this.exchange.fetchTickers());
          return `${Object.keys(tickers).length} tickers loaded`;
        },
      );
    }

    await doAndLog(
      "Indexing currencies",
      () => {
        // Create currencies
        Object
          .values(this.exchange.currencies)
          .forEach((currency: CCXTCurrency) => {
            if (currency && currency.code) {
              this.currencies.set(currency.code, new Currency(this, currency));
            }
          });
        return `${this.currencies.size} loaded`;
      },
    );

    await doAndLog(
      "Indexing markets",
      () => {
        let filtered = 0;
        Object
          .values(this.exchange.markets)
          .forEach((market: CCXTMarket) => {
            if (market && market.active) {
              // Filter by volume if minVolumeUSD is set
              if (this.minVolumeUSD > 0 && tickers[market.symbol]) {
                const ticker = tickers[market.symbol];
                // Use quoteVolume (24h volume in quote currency)
                const quoteVolume = ticker.quoteVolume || 0;

                // Skip if volume is below threshold
                // Note: For USDT pairs, this is directly in USD
                // For other pairs, we're using a rough approximation
                if (quoteVolume < this.minVolumeUSD) {
                  filtered++;
                  return;
                }
              }

              const newMarket = new Market(this, market);
              this.markets.set(market.symbol, newMarket);
              this.currencies.get(newMarket.baseCurrency)?.addMarket(newMarket);

              // Index by base currency
              if (!this.marketsByCurrency.has(newMarket.baseCurrency)) {
                this.marketsByCurrency.set(newMarket.baseCurrency, []);
              }
              this.marketsByCurrency
                .get(newMarket.baseCurrency)!
                .push(newMarket);

              // Index by quote currency
              if (!this.marketsByCurrency.has(newMarket.quoteCurrency)) {
                this.marketsByCurrency.set(newMarket.quoteCurrency, []);
              }
              this.marketsByCurrency
                .get(newMarket.quoteCurrency)!
                .push(newMarket);
            }
          });
        const msg = `${this.markets.size} loaded`;
        return filtered > 0 ? `${msg} (${filtered} filtered by volume)` : msg;
      },
    );

    await this.determineMainQuoteCurrencies();

    // Remove quote currencies we cannot valuate in the main quoteCurrency
    await doAndLog(
      "Removing bad quote currencies",
      () => {
        const badQuotes = [...this.allQuoteCurrencies.values()].filter(
          (quoteCurrency) => !quoteCurrency.priceIsDeterminable(),
        );
        const badQuotesCodes = badQuotes.map((badQuote) => badQuote.code);
        badQuotesCodes.forEach((badQuoteCode) => {
          this.allQuoteCurrencies.delete(badQuoteCode);
          this.quoteCurrencies.delete(badQuoteCode);
          this.currencies.delete(badQuoteCode);
        });
        this.markets.forEach((market) => {
          if (badQuotesCodes.some((code) => market.hasCurrency(code))) {
            this.markets.delete(market.symbol);
            this.currencies
              .get(market.baseCurrency)
              ?.removeMarket(market.symbol);
          }
        });
        return `${badQuotes.length} deleted`;
      },
    );
  }

  private async createChains() {
    await doAndLog(
      "Building chains",
      async () => {
        this._chains = await this._chainBuilder.createChains();
        return `${this._chains.size} generated`;
      },
    );
  }

  private async loadOrderBooks() {
    const markets = Array.from(this.markets.values());
    let completed = 0;
    const BATCH_SIZE = 100; // Process markets in batches to avoid overwhelming the throttle queue

    // Process markets in batches to avoid exceeding CCXT's throttle queue capacity (1000)
    for (let i = 0; i < markets.length; i += BATCH_SIZE) {
      const batch = markets.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (market) => {
        try {
          await doAndLog(
            "Loading order book",
            async () => {
              await market.initialize();
              completed++;
              return `${market.symbol} (${completed}/${markets.length})`;
            },
          );
        }
        catch (error: any) {
          console.warn(`\nFailed to load ${market.symbol}: ${error.message}`);
          completed++;
        }
      });

      await Promise.all(promises);
    }
  }

  private async loadBalances() {
    await doAndLog(
      "Loading balances",
      async () => {
        const balances = await request(async () =>
          this.exchange.fetchBalance(),
        );
        this.currencies.forEach((currency, key) =>
          currency.updateBalance(balances[key]),
        );
      },
    );
  }

  /**
   * Get a list of quote currencies from the market.
   */
  private async determineMainQuoteCurrencies() {
    let missingCurrency: string | undefined = undefined;
    let connectingMarketMissing = false;
    await doAndLog(
      "Determining quote currencies",
      () => {
        const markets = Array.from(this.markets.values());

        // All quoteCurrencies
        this.allQuoteCurrencies.clear();
        unique(markets.map((market) => market.quoteCurrency)).forEach(
          (quoteCurrency) => {
            const currency = this.currencies.get(quoteCurrency);
            assert(
              currency,
              `Currency ${quoteCurrency} is missing from the currency map`,
            );
            this.allQuoteCurrencies.set(currency!.code, currency!);
          },
        );

        // Only quoteCurrencies that have markets with a non-quoteCurrency baseCurrency
        this.quoteCurrencies.clear();
        unique(
          markets
            .filter(
              (market) => !this.allQuoteCurrencies.has(market.baseCurrency),
            )
            .map((market) => market.quoteCurrency),
        ).forEach((quoteCurrency) => {
          const currency = this.currencies.get(quoteCurrency);
          assert(
            currency,
            `Currency ${quoteCurrency} is missing from the currency map`,
          );
          this.quoteCurrencies.set(currency!.code, currency!);
        });

        if (!this.quoteCurrencies.has(this.connectingCurrency)) {
          missingCurrency = this.connectingCurrency;
          return "aborted";
        }
        if (!this.currencies.has(this.valueCurrency)) {
          missingCurrency = this.valueCurrency;
          return "aborted";
        }
        if (!(this.connectingDirectMarket || this.connectingIndirectMarket)) {
          connectingMarketMissing = true;
          return "aborted";
        }

        return `${this.quoteCurrencies.size} detected`;
      },
    );
    if (missingCurrency) {
      throw new Error(`${missingCurrency} is not a valid quoteCurrency.`);
    }
    if (connectingMarketMissing) {
      throw new Error(
        `connecting currency ${this.connectingCurrency} has no direct connection to value currency ${this.valueCurrency} (no trading pair).`,
      );
    }
  }

  private get connectingDirectMarket() {
    return this.markets.get(`${this.connectingCurrency}/${this.valueCurrency}`);
  }

  private get connectingIndirectMarket() {
    return this.markets.get(`${this.valueCurrency}/${this.connectingCurrency}`);
  }

  /**
   * Gets the number required to convert a price from the connectingCurrency
   * to the valueCurrency.
   *
   * E.g. If the price is in BTC and we want to evaluate in USDT then the
   * muliplier will be the cost of BTC in USDT.
   */
  get connectingPriceMultiplier() {
    // Market where base is connectingCurrency and quote is valueCurrency
    const directMarket = this.connectingDirectMarket; // e.g. BTC/USDT
    if (directMarket) return directMarket.midMarketPrice;

    // Market where the base is valueCurrency and quote is connectingCurrency
    const indirectMarket = this.connectingIndirectMarket; // e.g. USDT/BTC
    if (indirectMarket) {
      const indirectMidMarket = indirectMarket.midMarketPrice;
      if (!indirectMidMarket) return undefined;
      return 1 / indirectMidMarket;
    }
    return undefined;
  }
}
