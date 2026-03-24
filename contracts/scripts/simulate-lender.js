// Script to simulate a lender funding a loan (for testing borrower flow)
const hre = require("hardhat");

async function main() {
  const loanId = parseInt(process.argv[2] || "1");
  
  const [, lender] = await hre.ethers.getSigners(); // second account is the lender
  
  const fs = require("fs");
  const path = require("path");
  const addresses = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployed-addresses.json"), "utf8")
  );
  
  const mortgageAddress = addresses.mortgageContract || addresses.mortgageLoan;
  const MortgageContract = await hre.ethers.getContractAt("MortgageContract", mortgageAddress);
  
  // Get loan details
  const loan = await MortgageContract.viewLoanDetails(loanId);
  console.log(`\nFunding Loan #${loanId}...`);
  console.log(`  Borrower: ${loan.borrower}`);
  console.log(`  Amount: ${hre.ethers.formatEther(loan.loanAmount)} ETH`);

  if (Number(loan.status) === 0) {
    const approveTx = await MortgageContract.connect(lender).approveLoan(loanId);
    await approveTx.wait();
    console.log(`  Approved by lender: ${lender.address}`);
  }
  
  // Fund the loan as lender
  const tx = await MortgageContract.connect(lender).fundLoan(loanId, {
    value: loan.loanAmount,
  });
  
  const receipt = await tx.wait();
  console.log(`  ✅ Loan funded! Tx: ${receipt.hash}`);
  console.log(`  Lender: ${lender.address}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
