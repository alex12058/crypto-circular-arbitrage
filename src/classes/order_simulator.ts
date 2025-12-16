import Market from "./market";
import { assert } from "../helper";

export const enum OrderType {
  MARKET = 1,
  LIMIT = 2,
}

export const enum OrderSide {
  BUY = 1,
  SELL = 2,
}

export const enum OrderStatus {
  NEW = 1,
  PARTIALLY_FILLED = 2,
  FILLED = 3,
}

interface Trade {
  amount: number;
  price: number; // per unit
}

export interface OrderBase {
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

export class OrderSimulator {
  static execute(order: OrderBase): Order {
    const market = order.symbol.market;
    if (order.type === OrderType.LIMIT) {
      assert(order.price, "Limit order must have price");
    }
    // Throws if orders not within limits
    this.orderWithinLimits(order, true);

    const orderbook = order.symbol.orderBook;
    const side = order.side === OrderSide.BUY ? orderbook.asks : orderbook.bids;
    const trades: Trade[] = [];
    let remaining = order.amount;
    let filled = 0;

    for (const level of side) {
      if (!remaining) break;
      const price = level[0];
      if (!price) continue;
      if (order.type === OrderType.LIMIT) {
        if (
          (order.side === OrderSide.BUY && price > order.price!)
          || (order.side === OrderSide.SELL && price < order.price!)
        ) break;
      }
      const quantity = level[1];
      if (!quantity) continue;

      const amount = Math.min(remaining, quantity);
      const trade: Trade = { amount, price };
      trades.push(trade);
      remaining -= trade.amount;
      filled += trade.amount;
    }

    // Cost of all trades in quote currency (excluding fees)
    const cost = trades.reduce(
      (curr, next) => {
        return curr + next.amount * next.price;
      },
      0,
    );

    // Average price
    const price = filled ? cost / filled : 0;

    const takerFee = market?.taker || 0;
    // CCXT v4: taker fee is always a decimal percentage (e.g., 0.001 = 0.1%)
    const fee = cost * takerFee;

    return {
      ...order,
      price,
      filled,
      remaining,
      cost,
      trades,
      fee,
    };
  }

  static orderWithinLimits(order: OrderBase, can_throw = false) {
    const maybe_throw = (message: string) => {
      if (can_throw) throw new Error(message);
    };
    const limits = order.symbol.market?.limits;
    if (!limits) return true;

    if (order.type === OrderType.LIMIT) {
      const priceLimits = limits.price;
      if (priceLimits && priceLimits.min && order.price! < priceLimits.min) {
        maybe_throw("Price must be above minimum limit");
        return false;
      }
      if (priceLimits && priceLimits.max && order.price! > priceLimits.max) {
        maybe_throw("Price must be below maximum limit");
        return false;
      }
    }
    const amountLimits = limits.amount;
    if (amountLimits && amountLimits.min && order.amount < amountLimits.min) {
      maybe_throw("Order amount must be above minimum limit");
      return false;
    }
    if (amountLimits && amountLimits.max && order.amount > amountLimits.max) {
      maybe_throw("Order amount must be below maximum limit");
      return false;
    }
    return true;
  }
}
