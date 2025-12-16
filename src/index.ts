import Exchange from "./classes/exchange";

async function main() {
  const binance = await new Exchange({
    name: "binance",
    connectingCurrency: "BTC",
    valueCurrency: "USDT",
    minVolumeUSD: 50000, // Only consider markets with >$50k daily volume (in quote currency)
  })
    .setMaxRequestsPerSecond(100) // Conservative rate limit to avoid 429 errors
    .initialize();
  //binance.printPriceTable();
  binance.printChainCycleTests(true);
}
main();
