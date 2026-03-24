# MortgageBC

MortgageBC is a Sepolia-based mortgage workflow platform built with:

- React frontend
- Node.js/Express backend
- SQLite database
- Solidity smart contracts
- MetaMask wallet integration
- IPFS/Pinata storage

This project uses Sepolia only. Do not use a local blockchain for the active setup.

## Core Rule

- Backend uses `loan.id` as the database ID
- Blockchain uses `loan.contractLoanId` as the on-chain ID
- All smart contract calls must use `contractLoanId`

## What The Project Does

- Borrower uploads property details
- Property metadata is stored on IPFS
- Property NFT is minted on Sepolia
- Borrower applies for a loan using NFT collateral
- Lender reviews and approves or rejects the loan
- Lender funds approved loans
- Borrower pays EMI through MetaMask

## Required Env

This project uses one env file only:

- [`.env`](e:/bc_project/MortgageBC/.env)

Important env values:

- `VITE_API_URL`
- `VITE_CHAIN_ID=11155111`
- `VITE_NETWORK_NAME=sepolia`
- `VITE_RPC_URL`
- `SEPOLIA_RPC_URL`
- `PRIVATE_KEY`
- `JWT_SECRET`
- `VITE_PINATA_JWT`
- `VITE_PROPERTY_NFT_ADDRESS`
- `VITE_MORTGAGE_CORE_ADDRESS`
- `VITE_PROPERTY_ESCROW_ADDRESS`
- `VITE_LOAN_REPAYMENT_ADDRESS`
- `VITE_LOAN_AUTOMATION_ADDRESS`
- `VITE_VERIFICATION_ADDRESS`

Validate env:

```powershell
cd e:\bc_project\MortgageBC
npm install
npm run env:check
```

## How To Run The Project

Install dependencies:

```powershell
cd e:\bc_project\MortgageBC
npm install

cd e:\bc_project\MortgageBC\backend
npm install

cd e:\bc_project\MortgageBC\frontend
npm install
```

Start backend:

```powershell
cd e:\bc_project\MortgageBC\backend
npm run dev
```

Start frontend:

```powershell
cd e:\bc_project\MortgageBC\frontend
npm run dev
```

URLs:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:5000`
- Health: `http://localhost:5000/api/health`

Before using the app:

- connect MetaMask
- switch MetaMask to Sepolia

## How To Deploy Contracts

```powershell
cd e:\bc_project\MortgageBC
npm run deploy:sepolia
```

This updates:

- [`.env`](e:/bc_project/MortgageBC/.env)
- [`contracts/deployed-addresses.json`](e:/bc_project/MortgageBC/contracts/deployed-addresses.json)
- [`frontend/public/contracts`](e:/bc_project/MortgageBC/frontend/public/contracts)

## Main Commands

Root:

```powershell
cd e:\bc_project\MortgageBC
npm run env:check
npm run compile
npm test
npm run deploy:sepolia
npm run mint:property
npm run create:loan
```

Backend:

```powershell
cd e:\bc_project\MortgageBC\backend
npm run dev
npm run prisma:generate
npm run prisma:studio
npm run prisma:view
```

Frontend:

```powershell
cd e:\bc_project\MortgageBC\frontend
npm run dev
npm run lint
npm run build
```

## How To See Stored Data

Open Prisma Studio:

```powershell
cd e:\bc_project\MortgageBC\backend
npm run prisma:generate
npm run prisma:studio
```

View all data:

```powershell
cd e:\bc_project\MortgageBC\backend
npm run prisma:view
```

View users only:

```powershell
cd e:\bc_project\MortgageBC\backend
npm run prisma:view -- users
```

View loans only:

```powershell
cd e:\bc_project\MortgageBC\backend
npm run prisma:view -- loans
```

## Important Routes

Borrower:

- `/borrower/dashboard`
- `/borrower/upload-property`
- `/borrower/apply-loan`
- `/borrower/payment`

Lender:

- `/lender/dashboard`
- `/lender/manage-loans`
- `/lender/investments`
- `/lender/wallet`

## Important Contracts

- [`MortgageCore.sol`](e:/bc_project/MortgageBC/contracts/contracts/MortgageCore.sol)
- [`PropertyNFT.sol`](e:/bc_project/MortgageBC/contracts/contracts/PropertyNFT.sol)
- [`PropertyEscrow.sol`](e:/bc_project/MortgageBC/contracts/contracts/PropertyEscrow.sol)
- [`LoanRepayment.sol`](e:/bc_project/MortgageBC/contracts/contracts/LoanRepayment.sol)
- [`Verification.sol`](e:/bc_project/MortgageBC/contracts/contracts/Verification.sol)
- [`LoanAutomation.sol`](e:/bc_project/MortgageBC/contracts/contracts/LoanAutomation.sol)

## Important Files

- [`.env`](e:/bc_project/MortgageBC/.env)
- [`.env.example`](e:/bc_project/MortgageBC/.env.example)
- [`ENV_SETUP.md`](e:/bc_project/MortgageBC/ENV_SETUP.md)
- [`backend/server.js`](e:/bc_project/MortgageBC/backend/server.js)
- [`backend/db/database.js`](e:/bc_project/MortgageBC/backend/db/database.js)
- [`backend/prisma/schema.prisma`](e:/bc_project/MortgageBC/backend/prisma/schema.prisma)
- [`frontend/src/App.jsx`](e:/bc_project/MortgageBC/frontend/src/App.jsx)
- [`frontend/src/context/WalletRuntimeContext.jsx`](e:/bc_project/MortgageBC/frontend/src/context/WalletRuntimeContext.jsx)
- [`frontend/src/pages/lender/LoanBoard.jsx`](e:/bc_project/MortgageBC/frontend/src/pages/lender/LoanBoard.jsx)

## Common Checks

If blockchain actions fail, verify:

- MetaMask is on Sepolia
- the correct wallet is connected
- `.env` has correct contract addresses
- contracts were deployed successfully
- the lender wallet is authorized in `MortgageCore`

If approval fails:

- use the lender manage-loans page
- the app auto-verifies the property on-chain before approval when needed
