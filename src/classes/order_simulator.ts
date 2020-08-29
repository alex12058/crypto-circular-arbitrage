import Market from "./market";
import { assert } from "../helper";
import { prototype } from "events";

export const enum OrderType {
	MARKET = 1,
	LIMIT = 2
}

export const enum OrderSide {
	BUY = 1,
	SELL = 2
}

export const enum OrderStatus {
	NEW = 1,
	PARTIALLY_FILLED = 2,
	FILLED = 3
}

interface Trade {
	amount: number;
	price: number; // per unit
}

interface Fee {
	currency: string; // Usually the quote
	cost: number; // The amount in that currency
	rate: number;  // The fee rate (if applicable)
 }


interface OrderBase {
	symbol: Market;
	type: OrderType;
	side: OrderSide;
	price?: number; // float price in quote currency
	amount: number; // ordered amount in base currency
}

export interface Order extends OrderBase {
	price: number; // volume weighted average execution price
	filled: number; // filled amount in base currency
	remaining: number; // remaining amount to fill
	cost: number; // 'filled' * 'price' (from trades) and excluding fee
	trades: Trade[];
	fee: number; // Fee is quote currency
}

export class OrderSimulator{
	static execute(order: OrderBase): Order | undefined {
		const market = order.symbol.market;
		if (order.type === OrderType.LIMIT) {
			assert(order.price, 'Limit order must have price');
		}
		this.checkOrderWithinLimits(order);

		const orderbook = order.symbol.orderBook;
		const side = order.side === OrderSide.BUY
			? orderbook.asks
			: orderbook.bids;
		const trades: Trade[] = [];
		let remaining = order.amount;
		let filled = 0;

		for (const level of side) {
			if (!remaining) break;
			const price = level[0];
			if (order.type === OrderType.LIMIT) {
				if (
					order.side === OrderSide.BUY
						&& price > order.price!
					|| order.side === OrderSide.SELL
						&& price < order.price!
				) break;
			}
			const quantity = level[1];
			
			const amount = Math.min(remaining, quantity);
			const trade: Trade = { amount, price};
			trades.push(trade);
			remaining -= trade.amount;
			filled += trade.amount;
		}

		// Cost of all trades in quote currency (excluding fees)
		const cost = trades.reduce((curr, next) => {
			return curr + next.amount * next.price;
		}, 0);

		// Average price
		const price = filled
			? cost / filled
			: 0;

		const takerFee = market.taker;
		const percentage = market.percentage; // Indicated if takerFee is flat or percentage

		const fee = percentage
			? cost * takerFee
			: takerFee;

		return {
			...order,
			price,
			filled,
			remaining,
			cost,
			trades,
			fee
		}
	}

	private static checkOrderWithinLimits(order: OrderBase) {
		const limits = order.symbol.market.limits;
		if (order.type === OrderType.LIMIT) {
			const priceLimits = limits.price;
			assert(order.price! >= priceLimits.min, 'Price must be above minimum limit');
			if (priceLimits.max) assert(order.price! <= priceLimits.max, 'Price must be below maximum limit') 
		}
		const amountLimits = limits.amount;
		assert(order.amount >= amountLimits.min, 'Order amount must be above minimum limit');
		if (amountLimits.max) assert(order.amount <= amountLimits.max, 'Order amount must be below maximum limit')
	}
}