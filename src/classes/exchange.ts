
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
 */
interface ExchangeConstructorParams {
	name: string;
	connectingCurrency: string,
	valueCurrency: string,
}

export default class Exchange {
	readonly exchange: ccxt.Exchange;

	/** Currency used to determine price relations between currencies */
	readonly connectingCurrency: string;
	/** Currency all prices are converted to (from connectingCurrency) */
	readonly valueCurrency: string;
	readonly markets: Map<string, Market> = new Map();
	readonly currencies: Map<string, Currency> = new Map();
	private readonly _chainBuilder: ChainBuilder;
	private _chains: Map<string, Chain> = new Map();
	readonly allQuoteCurrencies = new Map<string, Currency>();
	/** Only quoteCurrencies that have markets with a non-quoteCurrency baseCurrency */
	readonly quoteCurrencies = new Map<string, Currency>();
	public static readonly RETRY_DELAY_MS = 1000;
	public static readonly NUM_RETRY_ATTEMPTS = 3;

	constructor(config: ExchangeConstructorParams) {
		this.exchange = new (ccxt as any)[config.name]({ enableRateLimit: true });
		this.connectingCurrency = config.connectingCurrency;
		this.valueCurrency = config.valueCurrency;
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

	printPriceTable() {
		const currencies = Array.from(this.currencies.values())
			.filter(currency => currency.markets.size)
			.sort((a, b) => {
				if (a.code > b.code) return 1;
				return -1;
			}
		);
		const table: any = {};
		currencies.forEach(currency => {
			const row: any = {};
			currency.markets.forEach(market => {
				let midMarketPrice = market.midMarketPriceInValueCurrency;
				row[market.quoteCurrency] = midMarketPrice && round(midMarketPrice, 8);
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

		// Remove quote currencies we cannot valuate in the main quoteCurrency
		await doAndLog('Removing bad quote currencies', () => {
			const badQuotes = [...this.allQuoteCurrencies.values()]
				.filter(quoteCurrency => !quoteCurrency.priceIsDeterminable());
			const badQuotesCodes = badQuotes.map(badQuote => badQuote.code);
			badQuotesCodes.forEach(badQuoteCode => {
				this.allQuoteCurrencies.delete(badQuoteCode);
				this.quoteCurrencies.delete(badQuoteCode);
				this.currencies.delete(badQuoteCode);
			});
			this.markets.forEach(market => {
				if (badQuotesCodes.some(code => market.hasCurrency(code))) {
					this.markets.delete(market.symbol);
					this.currencies.get(market.baseCurrency)?.removeMarket(market.symbol);
				}
			})
			return `${badQuotes.length} deleted`;
		});
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
		let missingCurrency: string | undefined = undefined;
		let connectingMarketMissing = false;
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

			if (!this.quoteCurrencies.has(this.connectingCurrency)) {
				missingCurrency = this.connectingCurrency;
				return 'aborted';
			}
			if (!this.currencies.has(this.valueCurrency)) {
				missingCurrency = this.valueCurrency;
				return 'aborted';
			}
			if (!(this.connectingDirectMarket || this.connectingIndirectMarket)) {
				connectingMarketMissing = true;
				return 'aborted';
			}

			return `${this.quoteCurrencies.size} detected`;
		});
		if (missingCurrency) {
			throw new Error(`${missingCurrency} is not a valid quoteCurrency.`)
		}
		if (connectingMarketMissing) {
			throw new Error(`connecting currency ${this.connectingCurrency} has no direct connection to value currency ${this.valueCurrency} (no trading pair).`);
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
