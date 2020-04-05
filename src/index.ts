import { Exchange } from "./classes/exchange";

async function main() {
    const binance = new Exchange('binance');
    await binance.initialize();
}
main();
