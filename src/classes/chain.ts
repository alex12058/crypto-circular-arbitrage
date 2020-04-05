import { ChainNode } from "../chain_builder";
import { reverseIndex as calcReverseIndex, nextLoopableIndex, prevLoopableIndex, reverseIndex, changeFirstIndex, XOR } from "../helper";
import { Ticker } from "./ticker";
import { Exchange } from "./exchange";

export class Chain {

    private exchange: Exchange;

    constructor(exchange: Exchange, chainNodes: ChainNode[]) {
        this.exchange = exchange;
        console.log(this.getHashableOrder(chainNodes).map(t => t.name));
    }

    private getHashableOrder(chainNodes: ChainNode[]) {
        const tickers = chainNodes.map(link => link.ticker);
        const sortedTickerNames = this.sortTickerNames(tickers);
        const firstTicker = sortedTickerNames[0];
        let firstTickerIndex = tickers.findIndex(ticker => {
            return ticker.name === firstTicker;
        });
        if(this.needToReverseOrder(tickers, sortedTickerNames, firstTickerIndex)) {
            tickers.reverse();
            firstTickerIndex = reverseIndex(firstTickerIndex, tickers.length);
        }
        return changeFirstIndex(tickers, firstTickerIndex);
    }

    private sortTickerNames(tickers: Ticker[]) {
        return tickers.sort((a, b) => {
            const aHasQuoteBase = a.baseIsQuote();
            const bhasQuoteBase = b.baseIsQuote();

            // If one ticker has a non quote base (other has a quote base)
            // Then prioritise the one that does not have the quote base
            if(XOR(aHasQuoteBase, bhasQuoteBase)) {
                if(bhasQuoteBase) return -1;
                if(aHasQuoteBase) return 1;
            }

            // Else compare using ticker symbol
            return a.name < b.name
                ? -1
                : 1;
        }
    
        ).map(ticker => ticker.name);
    }

    private needToReverseOrder(tickers: Ticker[], sortedTickerNames: string[],
        firstTickerIndex: number)
    {
        const nextTickerIndex = nextLoopableIndex(firstTickerIndex, tickers.length);
        const prevTickerIndex = prevLoopableIndex(firstTickerIndex, tickers.length);
        if (nextTickerIndex === prevTickerIndex) return false;

        const nextTickerName = tickers[nextTickerIndex]!.name;
        const prevTickerName = tickers[prevTickerIndex]!.name;

        // Lower number means higher priority
        const nextPriority = sortedTickerNames.indexOf(nextTickerName);
        const prevPriority = sortedTickerNames.indexOf(prevTickerName);
        return nextPriority > prevPriority;
    }
}