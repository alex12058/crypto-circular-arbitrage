# GTS Crypto Arbitrage

A triangular arbitrage detection and simulation tool for cryptocurrency exchanges built with TypeScript.

## Overview

This tool identifies triangular arbitrage opportunities on cryptocurrency exchanges and simulates potential profits. Triangular arbitrage exploits price discrepancies between three trading pairs on the same exchange.

**Important**: This is a simulation and analysis tool. It does not execute actual trades - it only calculates and displays potential arbitrage opportunities.

## ⚠️ IMPORTANT DISCLAIMERS

- 📚 **Educational/Research purposes only** - Study arbitrage detection algorithms
- 🚫 **Simulation only** - No actual trading implementation
- ⚠️ **Real arbitrage is complex** - Requires speed, capital, and often fails due to fees/slippage
- 📋 **No warranty** - Use at your own risk
- 💡 **Theoretical profits ≠ Real profits** - Simulations don't account for execution risks

## Prerequisites

- Node.js (v18 or higher)
- npm
- Exchange API credentials (optional, only for authenticated features)

## Technology Stack

- **Language**: TypeScript 5.7
- **Runtime**: Node.js 18+
- **Exchange API**: CCXT 4.4
- **Code Quality**: ESLint 9 with TypeScript support
- **Dev Tools**: Nodemon for hot-reload

## Installation & Usage

```bash
# Install dependencies (Node.js 18+ required)
npm install

# Run in development mode
npm start

# Compile TypeScript
npm run compile

# Check code style
npm run check

# Auto-fix style issues
npm run fix
```

### API Key Setup (Optional)

For **public market data** (monitoring/simulation mode), **no API keys are required**.

For **authenticated features** (if you add real trading later), use environment variables:

```bash
export BINANCE_API_KEY="your_api_key_here"
export BINANCE_API_SECRET="your_secret_here"
```

Or create a `.env` file (add to `.gitignore`):
```
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_secret_here
```

## What is Triangular Arbitrage?

Triangular arbitrage involves trading through three currency pairs to exploit pricing inefficiencies. For example:
1. BTC → ETH
2. ETH → USDT
3. USDT → BTC

If the exchange rates create a profitable cycle, trades could theoretically be executed to capture the difference. However, in practice, such opportunities are rare and quickly arbitraged away by high-frequency traders.

## Features

- Automated detection of triangular arbitrage opportunities
- Real-time price monitoring using CCXT library
- Chain cycle testing and validation
- Support for multiple exchanges (starting with Binance)
- Price table visualization
- Configurable connecting and value currencies

## Example Output

### Console Log During Execution

```
Loading config for Binance...... [public mode (no credentials)] | 2ms
Refreshing market data......................................... | 651ms
Fetching market volumes.................. [3449 tickers loaded] | 584ms
Indexing currencies............................... [912 loaded] | <1ms
Indexing markets........ [1742 loaded (504 filtered by volume)] | 3ms
Determining quote currencies..................... [20 detected] | <1ms
Removing bad quote currencies...................... [5 deleted] | 1ms
Processing quote 1/17..... [USDT: 589866 chains (589866 total)] | 3213ms
Processing quote 2/17........ [TUSD: 196 chains (590062 total)] | 2899ms
  ...
Chain cycle tests saved to chain_cycle_tests.csv
Price table saved to price_table.csv
```

### chain_cycle_tests.csv Results

```csv
Key,fowards,backwards
ETH/USDT/USDC,0.65,-0.64
ETH/USDT/ZEC/USDC,0.61,-0.72
BTC/USDT/ETH/USDC,-0.45,0.32
AAVE/USDT/ETH/USDC,-1.08,0.55
```

**Interpretation:**

- **Key**: The arbitrage chain path (e.g., `ETH/USDT/USDC`)
  - Start with ETH → Trade to USDT → Trade to USDC → Trade back to ETH
  - For 3-hop chains: A → B → C → A
  - For 4-hop chains: A → B → C → D → A

- **forwards**: Profit/loss starting with $100 going forward through the chain
  - `0.65` = +$0.65 profit (0.65% return)
  - `-0.64` = -$0.64 loss

- **backwards**: Profit/loss going through chain in reverse
  - Some chains are profitable in one direction but not the other

**Real-world considerations:**
- Most results show losses due to trading fees and spreads
- Positive values indicate theoretical arbitrage opportunities
- In practice, opportunities disappear quickly due to:
  - High-frequency trading bots
  - Network latency
  - Order book depth changes
  - Exchange fees (not all fees modeled here)

## Configuration Options

```typescript
const exchange = await new Exchange({ 
  name: 'binance',              // Exchange name (from CCXT)
  connectingCurrency: 'BTC',    // Main trading pair currency
  valueCurrency: 'USDT',        // Currency to value results in
  minVolumeUSD: 50000           // Min 24h volume filter (optional)
})
.setMaxRequestsPerSecond(5)     // Rate limiting
.initialize();
```

**Performance Tips:**
- Increase `minVolumeUSD` to reduce the number of markets analyzed
- Adjust `setMaxRequestsPerSecond()` based on exchange limits
- Chain length is fixed at 4 hops maximum

## Project Structure

```
gts-crypto-arbitrage/
├── src/
│   ├── index.ts              # Main entry point
│   ├── chain_builder.ts      # Builds arbitrage chains
│   ├── helper.ts             # Utility functions
│   └── classes/
│       ├── chain.ts          # Arbitrage chain logic
│       ├── currency.ts       # Currency representation
│       ├── exchange.ts       # Exchange interface
│       ├── market.ts         # Market data handling
│       └── order_simulator.ts # Trade simulation
└── package.json
```

## Configuration

The bot can be configured with:
- **Exchange name**: Which exchange to monitor (e.g., 'binance')
- **Connecting currency**: The intermediate currency (e.g., 'BTC')
- **Value currency**: The base currency for profit calculation (e.g., 'USDT')

Example configuration in `index.ts`:
```typescript
const binance = await new Exchange({ 
    name: 'binance', 
    connectingCurrency: 'BTC',
    valueCurrency: 'USDT'
}).initialize();
```

## Key Components

### Exchange Class
Handles connection to exchanges, retrieves market data, and executes trades.

### Chain Class
Represents a triangular arbitrage opportunity and calculates potential profits.

### Order Simulator
Simulates order execution to estimate actual profits after fees and slippage.

## How It Works

1. **Initialize Exchange**: Connect to exchange and load all available trading pairs
2. **Build Chains**: Construct all possible triangular arbitrage paths
3. **Monitor Prices**: Continuously fetch real-time prices for all markets
4. **Detect Opportunities**: Calculate profit potential for each chain
5. **Execute Trades**: When profitable opportunity is found, execute the trade sequence

## Risk Considerations

⚠️ **IMPORTANT**:
- **Execution Speed**: Arbitrage opportunities can disappear in milliseconds
- **Trading Fees**: Must account for exchange fees on all three trades
- **Slippage**: Market orders may execute at worse prices than expected
- **API Latency**: Network delays can eliminate arbitrage profits
- **Market Risk**: Prices can move against you during execution

## Why Arbitrage is Difficult in Practice

- High-frequency traders dominate with microsecond execution
- Exchange fees often eliminate theoretical profits
- Slippage and order book depth affect real execution
- Network latency matters significantly
- Capital requirements can be substantial
- Opportunities disappear within milliseconds

The opportunities shown by this simulator are theoretical. Real arbitrage requires sophisticated infrastructure, significant capital, and often yields much smaller profits than simulations suggest.

## Development

- Nodemon provides hot-reload during development
- ESLint with TypeScript support for code quality
- TypeScript for type safety and better IDE support

## Acknowledgments

- CCXT library for unified exchange APIs
- TypeScript/Node.js community
