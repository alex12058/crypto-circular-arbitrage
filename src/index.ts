import Exchange from "./classes/exchange";

async function main() {
  const binance = await new Exchange({
    name: "binance",
    connectingCurrency: "BTC",
    valueCurrency: "USDT",
  })
    .setMaxRequestsPerSecond(60) // Conservative rate limit to avoid 429 errors
    .initialize();
  //binance.printPriceTable();
  binance.printChainCycleTests(true);
}
main();
