import Market from "./classes/market";
import Exchange from "./classes/exchange";
import Chain from "./classes/chain";
import { doAndLog } from "./helper";

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

  private readonly MAX_CHAIN_LENGTH = 4;
  private chainCount = 0;

  constructor(exchange: Exchange) {
    this.exchange = exchange;
  }

  async createChains() {
    this.chainCount = 0;
    const chainsFromQuotes = await this.buildChainsFromQuotes();
    const chainMap = new Map<string, Chain>();
    chainsFromQuotes.forEach((primativeChain) => {
      const chain = new Chain(this.exchange, primativeChain);
      if (!chainMap.has(chain.hash)) {
        chainMap.set(chain.hash, chain);
      }
    });
    return chainMap;
  }

  async buildChainsFromQuotes(): Promise<ChainNode[][]> {
    const quoteCurrencies = Array.from(this.exchange.quoteCurrencies.keys());
    const allChains: ChainNode[][] = [];

    for (let i = 0; i < quoteCurrencies.length; i++) {
      const quote = quoteCurrencies[i];
      let chains: ChainNode[][] = [];
      doAndLog(
        `Processing quote ${i + 1}/${quoteCurrencies.length}`,
        () => {
          chains = this.buildChainIterative(quote);
          // Use concat or forEach to avoid stack overflow with large arrays
          for (const chain of chains) {
            allChains.push(chain);
          }
          return `${quote}: ${chains.length} chains (${allChains.length} total)`;
        },
      );
    }

    return allChains;
  }

  private buildChainIterative(startCurrency: string): ChainNode[][] {
    const completedChains: ChainNode[][] = [];
    const stack: ChainBuildState[] = [
      {
        currentCurrency: startCurrency,
        visited: [],
      },
    ];

    const MAX_STACK_SIZE = 100000;
    let iterations = 0;
    const MAX_ITERATIONS = 10000000;

    while (stack.length > 0) {
      iterations++;

      // Prevent infinite loops
      if (iterations > MAX_ITERATIONS) {
        console.warn(
          `\n    Warning: Reached maximum iterations for ${startCurrency}`,
        );
        break;
      }

      // Prevent stack overflow
      if (stack.length > MAX_STACK_SIZE) {
        console.warn(`\n    Warning: Stack size exceeded for ${startCurrency}`);
        break;
      }

      const state = stack.pop()!;
      const possibleLinks = this.getPossibleLink(startCurrency, state);

      for (const market of possibleLinks) {
        const nextCurrency = market.opposite(state.currentCurrency);
        const nextNode: ChainNode = {
          market,
          prevCurrency: state.currentCurrency,
          nextCurrency,
        };
        const nextVisited = [...state.visited, nextNode];

        if (this.endOfChain(startCurrency, nextCurrency, nextVisited.length)) {
          completedChains.push(nextVisited);
          this.chainCount++;
        }
        else {
          // Continue building the chain
          stack.push({
            currentCurrency: nextCurrency,
            visited: nextVisited,
          });
        }
      }
    }

    return completedChains;
  }

  private getPossibleLink(
    startCurrency: string,
    chainBuildState: ChainBuildState,
  ): Market[] {
    // Use indexed lookup instead of filtering all markets
    const marketsWithCurrency =
      this.exchange.marketsByCurrency.get(chainBuildState.currentCurrency)
      || [];
    return marketsWithCurrency.filter((market) =>
      this.marketIsPossibleLink(market, startCurrency, chainBuildState),
    );
  }

  private marketIsPossibleLink(
    market: Market,
    startCurrency: string,
    chainBuildState: ChainBuildState,
  ): boolean {
    const { currentCurrency, visited } = chainBuildState;
    return (
      !ChainBuilder.MarketVisited(market, visited)
      && market.hasCurrency(currentCurrency)
      && (
        visited.length < this.MAX_CHAIN_LENGTH - 1
        || market.opposite(currentCurrency) === startCurrency
      )
    );
  }

  private static MarketVisited(market: Market, visited: ChainNode[]): boolean {
    return visited.some((node) => node.market.symbol === market.symbol);
  }

  private endOfChain(
    startCurrency: string,
    nextCurrency: string,
    chainLength: number,
  ): boolean {
    return (
      startCurrency === nextCurrency || chainLength === this.MAX_CHAIN_LENGTH
    );
  }
}
