const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('MortgageCore Sepolia-ready flow', function () {
  async function getLoanRepaymentFactory() {
    try {
      return await ethers.getContractFactory('contracts/contracts/LoanRepayment.sol:LoanRepayment');
    } catch (error) {
      return ethers.getContractFactory('contracts/LoanRepayment.sol:LoanRepayment');
    }
  }

  async function deployFixture() {
    const [owner, borrower, lender] = await ethers.getSigners();

    const PropertyNFT = await ethers.getContractFactory('PropertyNFT');
    const propertyNFT = await PropertyNFT.deploy();
    await propertyNFT.waitForDeployment();

    const Verification = await ethers.getContractFactory('Verification');
    const verification = await Verification.deploy();
    await verification.waitForDeployment();

    const PropertyEscrow = await ethers.getContractFactory('PropertyEscrow');
    const propertyEscrow = await PropertyEscrow.deploy();
    await propertyEscrow.waitForDeployment();

    const LoanRepayment = await getLoanRepaymentFactory();
    const loanRepayment = await LoanRepayment.deploy();
    await loanRepayment.waitForDeployment();

    const MortgageCore = await ethers.getContractFactory('MortgageCore');
    const mortgageCore = await MortgageCore.deploy(
      [lender.address],
      await propertyEscrow.getAddress(),
      await loanRepayment.getAddress(),
      await verification.getAddress()
    );
    await mortgageCore.waitForDeployment();

    const LoanAutomation = await ethers.getContractFactory('LoanAutomation');
    const loanAutomation = await LoanAutomation.deploy(await mortgageCore.getAddress());
    await loanAutomation.waitForDeployment();

    await propertyEscrow.setController(await mortgageCore.getAddress());
    await loanRepayment.setController(await mortgageCore.getAddress());
    await verification.setVerifierAuthorization(await mortgageCore.getAddress(), true);
    await mortgageCore.setAutomationContract(await loanAutomation.getAddress());
    await propertyNFT.setMortgageLoanContract(await mortgageCore.getAddress());
    await propertyNFT.setVerificationRegistry(await verification.getAddress());

    return {
      owner,
      borrower,
      lender,
      propertyNFT,
      verification,
      mortgageCore,
      propertyEscrow,
    };
  }

  it('mints collateral, verifies it, funds the loan, and marks NFT verified', async function () {
    const { borrower, lender, propertyNFT, verification, mortgageCore, propertyEscrow } = await deployFixture();

    await propertyNFT.connect(borrower).mintPropertyDetailed(
      borrower.address,
      'ipfs://property-metadata',
      'Villa',
      'Chennai',
      ethers.parseEther('25')
    );

    expect((await propertyNFT.getPropertyDetails(1)).verified).to.equal(false);

    await propertyNFT.connect(borrower).approve(await propertyEscrow.getAddress(), 1);
    await mortgageCore.connect(borrower).applyLoan(
      await propertyNFT.getAddress(),
      1,
      ethers.parseEther('1'),
      850,
      6
    );

    await mortgageCore.connect(lender).verifyPropertyForLoan(1);
    expect(await verification.isPropertyVerified(await propertyNFT.getAddress(), 1)).to.equal(true);
    expect((await propertyNFT.getPropertyDetails(1)).verified).to.equal(true);

    await mortgageCore.connect(lender).approveLoan(1);
    await mortgageCore.connect(lender).fundLoan(1, { value: ethers.parseEther('1') });

    const loan = await mortgageCore.getLoan(1);
    expect(loan.funded).to.equal(true);
    expect(loan.lender).to.equal(lender.address);
  });
});
