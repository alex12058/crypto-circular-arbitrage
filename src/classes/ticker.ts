
import ccxt = require('ccxt');

export class Ticker {
    readonly ticker: ccxt.Ticker;

    constructor(ticker: ccxt.Ticker) {
        this.ticker = ticker;
    }
}
