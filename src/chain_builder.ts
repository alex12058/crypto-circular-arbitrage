import Market from './classes/market';
import Exchange from './classes/exchange';
import Chain from './classes/chain';

export interface ChainNode {
  market: Market;
  prevCurrency: string;
  nextCurrency: string;
}

interface ChainBuildState {
  currentCurrency: string;
  visited: ChainNode[];
}

export default class ChainBuilder {
  private readonly exchange: Exchange;

  private readonly MAX_CHAIN_LENGTH = 3;

  constructor(exchange: Exchange) {
    this.exchange = exchange;
  }

  async createChains() {
    const chainsFromQuotes = await this.buildChainsFromQuotes();
    const chainMap = new Map<string, Chain>();
    chainsFromQuotes.forEach((primativeChain) => {
      const chain = new Chain(this.exchange, primativeChain);
      if (chainMap.get(chain.hash) === undefined) {
        chainMap.set(chain.hash, chain);
      }
    });
    return chainMap;
  }

  async buildChainsFromQuotes(): Promise<ChainNode[][]> {
    const { markets } = this.exchange;
    return Promise.all(
      this.exchange.quoteCurrencies.map((quote) => this.buildChain(quote, markets)),
    ).then((createdChains) => ChainBuilder.concatChains(createdChains));
  }

  private async buildChain(
    startCurrency: string,
    markets: Map<string, Market>,
    chainBuildState: ChainBuildState = {
      currentCurrency: startCurrency,
      visited: [],
    },
  ): Promise<ChainNode[][]> {
    return Promise.all(
      this.getPossibleLink(startCurrency, markets, chainBuildState)
        .map((market) => this.takePaths(
          market,
          startCurrency,
          markets,
          chainBuildState,
        )),
    ).then((createdChains) => ChainBuilder.concatChains(createdChains));
  }

  private getPossibleLink(
    startCurrency: string,
    markets: Map<string, Market>,
    chainBuildState: ChainBuildState,
  ): Market[] {
    return Array.from(markets.values()).filter((market) => this.marketIsPossibleLink(
      market,
      startCurrency,
      chainBuildState,
    ));
  }

  private marketIsPossibleLink(
    market: Market,
    startCurrency: string,
    chainBuildState: ChainBuildState,
  ): boolean {
    const { currentCurrency, visited } = chainBuildState;
    return !ChainBuilder.MarketVisited(market, visited)
        && market.hasCurrency(currentCurrency)
        && (
          visited.length < this.MAX_CHAIN_LENGTH - 1
          || market.opposite(currentCurrency) === startCurrency
        );
  }

  private static MarketVisited(market: Market, visited: ChainNode[]): boolean {
    return visited.some((node) => node.market.symbol === market.symbol);
  }

  private endOfChain(startCurrency: string, nextCurrency: string,
    chainLength: number): boolean {
    return startCurrency === nextCurrency || chainLength === this.MAX_CHAIN_LENGTH;
  }

  private async takePaths(
    nextMarket: Market,
    startCurrency: string,
    markets: Map<string, Market>,
    chainBuildState: ChainBuildState,
  ): Promise<ChainNode[][]> {
    const { currentCurrency, visited } = chainBuildState;

    const nextCurrency = nextMarket.opposite(currentCurrency);
    const nextNode: ChainNode = {
      market: nextMarket,
      prevCurrency: currentCurrency,
      nextCurrency,
    };
    const nextVisited = visited.slice();
    nextVisited.push(nextNode);

    if (this.endOfChain(startCurrency, nextCurrency, nextVisited.length)) {
      return [nextVisited];
    }

    // Else, continue the chain
    return this.buildChain(
      startCurrency,
      markets,
      {
        currentCurrency: nextCurrency,
        visited: nextVisited,
      },
    );
  }

  /**
   * Merge chains that were created from taking separate paths into a singular
   * array of chains
   */
  private static concatChains(chains: ChainNode[][][]): ChainNode[][] {
    return chains.reduce((curr, next) => curr.concat(next), []);
  }
}
