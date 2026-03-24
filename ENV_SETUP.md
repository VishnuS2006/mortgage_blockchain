# MortgageBC Environment Setup

This project now uses one env file only:

- [`.env`](e:/bc_project/MortgageBC/.env)

`frontend/.env` and `contracts/.env` are not used anymore.

## Sepolia setup

Set these values in the root `.env`:

- `SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-key>`
- `PRIVATE_KEY=0x<your-wallet-private-key>`
- `ETHERSCAN_API_KEY=<optional>`
- `VITE_CHAIN_ID=11155111`
- `VITE_NETWORK_NAME=sepolia`
- `VITE_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<your-key>`

Then run:

1. `npm run deploy:sepolia`
2. `npm run env:check`

## Important

- Do not use `npx hardhat node` for this Sepolia-only setup.
- MetaMask should be connected to Sepolia.
- The deploy script writes contract addresses back into the root `.env` automatically.
- Vite reads `VITE_*` values from the root `.env`.
