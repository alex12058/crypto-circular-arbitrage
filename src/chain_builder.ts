import { Ticker } from "./classes/ticker";
import { Exchange } from "./classes/exchange";
import { Chain } from "./classes/chain";

export interface ChainNode {
	ticker: Ticker;
	prevCurrency: string;
	nextCurrency: string;
}

interface ChainBuildState {
	currentCurrency: string;
	visited: ChainNode[];
}

export class ChainBuilder {

	private readonly exchange: Exchange;

	constructor(exchange: Exchange) {
		this.exchange = exchange;
	}

	async createChains() {
		const chains_from_quotes = await this.buildChainsFromQuotes();
		chains_from_quotes.slice(0, 100).forEach(chain => new Chain(this.exchange, chain));
	}

	async buildChainsFromQuotes(): Promise<ChainNode[][]> {
		const tickers = this.exchange.tickers;
		return Promise.all(
			this.exchange.quoteCurrencies.map(quote => {
				return this.buildChain(quote, tickers);
			})
		).then(createdChains => this.concatChains(createdChains));
	}

	private async buildChain(
		startCurrency: string,
		tickers: Map<string, Ticker>,
		chainBuildState: ChainBuildState = {
			currentCurrency: startCurrency,
			visited: []
		}
	): Promise<ChainNode[][]> {
		return Promise.all(
			this.getPossibleLink(startCurrency, tickers, chainBuildState)
				.map(ticker => {
					return this.takePaths(
						ticker,
						startCurrency,
						tickers,
						chainBuildState
					);
				})
		).then(createdChains => this.concatChains(createdChains));
	}

	private getPossibleLink(
		startCurrency: string,
		tickers: Map<string, Ticker>,
		chainBuildState: ChainBuildState
	): Ticker[] {
		return Array.from(tickers.values()).filter(ticker => {
			return this.tickerIsPossibleLink(
				ticker,
				startCurrency,
				chainBuildState
			);
		});
	}

	private tickerIsPossibleLink(
		ticker: Ticker,
		startCurrency: string,
		chainBuildState: ChainBuildState): boolean
	{
		const { currentCurrency, visited } = chainBuildState;
			return !this.ticker_visited(ticker, visited)
				&& ticker.hasCurrency(currentCurrency)
				&& (
					visited.length < 2
					|| ticker.opposite(currentCurrency) === startCurrency
				);
	}

	private ticker_visited(ticker: Ticker, visited: ChainNode[]): boolean {
		return visited.some(visited => visited.ticker.name === ticker.name);
	}

	private endOfChain(startCurrency: string, nextCurrency: string, 
		chainLength: number): boolean
	{
		return startCurrency === nextCurrency || chainLength === 3;
	}

	private async takePaths(
		nextTicker: Ticker,
		startCurrency: string,
		tickers: Map<string, Ticker>,
		chainBuildState: ChainBuildState
	): Promise<ChainNode[][]> {
		const { currentCurrency, visited } = chainBuildState;

		const nextCurrency = nextTicker.opposite(currentCurrency);
		const nextNode: ChainNode = {
			ticker: nextTicker,
			prevCurrency: currentCurrency,
			nextCurrency
		};
		const nextVisited = visited.slice();
		nextVisited.push(nextNode);

		if(this.endOfChain(startCurrency, nextCurrency, nextVisited.length)) {
			return [ nextVisited ];
		}
		else {
			// Else, continue the chain
			return this.buildChain(
				startCurrency,
				tickers,
				{
					currentCurrency: nextCurrency,
					visited: nextVisited
				}
			);
		}
	}

	/**
	 * Merge chains that were created from taking separate paths into a singular
	 * array of chains
	 */
	private concatChains(chains: ChainNode[][][]): ChainNode[][] {
		return chains.reduce((curr, next) => {
			return curr.concat(next);
		}, []);
	}
}