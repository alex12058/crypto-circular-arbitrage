import Exchange from './classes/exchange';

async function main() {
	const binance = await new Exchange({ 
		name: 'binance', 
		connectingCurrency: 'BTC',
		valueCurrency: 'USDT'
	}).initialize();
	binance.printPriceTable();
}
main();
