import Exchange from './classes/exchange';

async function main() {
  const binance = await new Exchange({ name: 'poloniex', mainQuoteCurrency: 'USDT' })
    .initialize();
  binance.printPriceTable();
}
main();
