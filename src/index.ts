import Exchange from './classes/exchange';

async function main() {
  const binance = await new Exchange('poloniex').initialize();
}
main();
