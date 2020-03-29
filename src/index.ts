import { Exchange } from "./classes/exchange";

async function run() {
    const binance = new Exchange('binance');
    binance.initialize().then(() => {
        console.log(binance.tickers);
    });
}
run();