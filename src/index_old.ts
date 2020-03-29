
class PairTest {
    private ccxt: any;
    private binance: any;

    constructor() {
        const ccxt = require('ccxt');
        this.binance = new ccxt.binance();

    }

    async run() {
        const binance = this.binance;
        const tickers = await binance.fetchTickers();
        const tickerKeys = Object.keys(tickers);

        class Ticker {
            private readonly _baseCurrency: string;
            private readonly _quoteCurrency: string;

            constructor(baseCurrency: string, quoteCurrency: string) {
                this._baseCurrency = baseCurrency;
                this._quoteCurrency = quoteCurrency;
            }

            get base_currency(): string {
                return this._baseCurrency;
            }

            get quote_currency(): string {
                return this._quoteCurrency;
            }

            get key() {
                return this._baseCurrency + '/' + this._quoteCurrency;
            }

            toString(): string {
                return this.key;
            }

            opposite_edge(symbol: string) {
                if(symbol === this._baseCurrency) return this._quoteCurrency;
                else return this._baseCurrency;
            }

            static extract(key: string) {
                // @ts-ignore
                return new Ticker(...key.split('/'));
            }
        }
        const ticker_names: Ticker[] = tickerKeys.map(t => Ticker.extract(t));
        const symbol_ticker_map: Map<string, Ticker[]> = new Map();
        const add_to_map = (ticker: Ticker) => {
            const symbols = [ ticker.base_currency, ticker.quote_currency ];
            symbols.forEach(c => {
                const tickers = symbol_ticker_map.get(c) || [];
                tickers.push(ticker);
                symbol_ticker_map.set(c, tickers);
            });
        };
        ticker_names.forEach(add_to_map);

        const get_chain = (start: string, max_depth: number) => {
            const generate_chain = (start: string, current: string, visited_edges: Ticker[]): Ticker[][] | undefined => {
                let can_visit: Ticker[] = (symbol_ticker_map.get(current) || []).filter(e => visited_edges.indexOf(e) === -1);
                if (visited_edges.length === max_depth - 1) {
                    can_visit = can_visit.filter(e => e.opposite_edge(current) === start);
                    if (!can_visit.length) return undefined;
                    return [[ can_visit[0] ]];
                }
                if (!can_visit.length) return undefined;
                const to_return: Ticker[][] = [];
                can_visit.forEach((t: Ticker) => {
                    const new_visited = visited_edges.slice(0);
                    new_visited.push(t);
                    const next_return = generate_chain(start, t.opposite_edge(current), new_visited);
                    if(next_return) {
                        const only_defined: Ticker[][] = next_return.filter(r => r);
                        only_defined.forEach((r: Ticker[])  => {
                            to_return.push([t].concat(r));
                        })
                    }
                });
                return to_return;
            };
            return generate_chain(start, start, []);
        };

        //console.log(ticker_names.length);
        //console.log(symbol_ticker_map.size);
        const first_symbol = Array.from(symbol_ticker_map.keys())[0];
        console.log(get_chain(first_symbol, 3));
    }
}

const pair_test = new PairTest();
pair_test.run().then();
