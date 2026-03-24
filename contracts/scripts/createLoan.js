const hre = require('hardhat');

async function main() {
  const mortgageAddress = process.env.MORTGAGE_CORE_ADDRESS || process.env.MORTGAGE_CONTRACT_ADDRESS;
  const nftAddress = process.env.PROPERTY_NFT_ADDRESS;
  const escrowAddress = process.env.PROPERTY_ESCROW_ADDRESS;
  const tokenId = process.env.LOAN_TOKEN_ID;
  const loanAmount = process.env.LOAN_AMOUNT_WEI;
  const interestRateBps = process.env.LOAN_INTEREST_BPS;
  const durationMonths = process.env.LOAN_DURATION_MONTHS;

  if (!mortgageAddress || !nftAddress || !tokenId || !loanAmount || !interestRateBps || !durationMonths) {
    throw new Error('Set MORTGAGE_CORE_ADDRESS, PROPERTY_NFT_ADDRESS, LOAN_TOKEN_ID, LOAN_AMOUNT_WEI, LOAN_INTEREST_BPS, and LOAN_DURATION_MONTHS');
  }

  const [signer] = await hre.ethers.getSigners();
  const propertyNFT = await hre.ethers.getContractAt('PropertyNFT', nftAddress, signer);
  const mortgageCore = await hre.ethers.getContractAt('MortgageCore', mortgageAddress, signer);

  const approvalTarget = escrowAddress || mortgageAddress;
  const approvalTx = await propertyNFT.approve(approvalTarget, tokenId);
  await approvalTx.wait();

  const applyTx = await mortgageCore.applyLoan(
    nftAddress,
    tokenId,
    loanAmount,
    interestRateBps,
    durationMonths
  );
  const receipt = await applyTx.wait();
  console.log(`Created mortgage loan in tx ${receipt.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
