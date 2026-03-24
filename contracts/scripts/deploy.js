const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

function parseCsvAddresses(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getChainDefaults(chainId, networkName) {
  if (Number(chainId) === 11155111 || networkName === 'sepolia') {
    return {
      network: 'sepolia',
      chainId: '11155111',
      explorerBaseUrl: 'https://sepolia.etherscan.io',
      openSeaBaseUrl: 'https://testnets.opensea.io/assets/sepolia',
    };
  }

  return {
    network: networkName || 'localhost',
    chainId: String(chainId || 31337),
    explorerBaseUrl: '',
    openSeaBaseUrl: '',
  };
}

function upsertEnvFile(filePath, values) {
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
    : [];

  const nextKeys = new Set(Object.keys(values));
  const updated = existing
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) {
        return line;
      }

      const key = match[1];
      if (!nextKeys.has(key)) {
        return line;
      }

      nextKeys.delete(key);
      return `${key}=${values[key]}`;
    });

  for (const key of nextKeys) {
    updated.push(`${key}=${values[key]}`);
  }

  fs.writeFileSync(filePath, `${updated.join('\n')}\n`);
}

function copyAbi(artifactsDir, contractFile, contractName, frontendPublicPath, aliasNames = []) {
  const candidatePaths = [
    path.join(artifactsDir, contractFile, `${contractName}.json`),
    path.join(artifactsDir, 'contracts', contractFile, `${contractName}.json`),
  ];

  const artifactPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
  if (!artifactPath) {
    throw new Error(
      `ABI artifact not found for ${contractName}. Checked: ${candidatePaths.join(', ')}`
    );
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  fs.writeFileSync(
    path.join(frontendPublicPath, `${contractName}.json`),
    JSON.stringify({ abi: artifact.abi }, null, 2)
  );

  for (const aliasName of aliasNames) {
    fs.writeFileSync(
      path.join(frontendPublicPath, `${aliasName}.json`),
      JSON.stringify({ abi: artifact.abi }, null, 2)
    );
  }
}

async function getLoanRepaymentFactory() {
  try {
    return await hre.ethers.getContractFactory('contracts/contracts/LoanRepayment.sol:LoanRepayment');
  } catch (error) {
    return hre.ethers.getContractFactory('contracts/LoanRepayment.sol:LoanRepayment');
  }
}

async function main() {
  console.log('Deploying contracts...\n');

  if (!process.env.PRIVATE_KEY) {
    throw new Error(
      'Missing PRIVATE_KEY in MortgageBC/.env. Add a funded Sepolia wallet private key before deploying.'
    );
  }

  if (
    !process.env.SEPOLIA_URL &&
    !process.env.SEPOLIA_RPC_URL &&
    !process.env.VITE_RPC_URL &&
    !process.env.ALCHEMY_API_KEY &&
    !process.env.INFURA_API_KEY
  ) {
    throw new Error(
      'Missing Sepolia RPC configuration in MortgageBC/.env. Set SEPOLIA_RPC_URL or VITE_RPC_URL before deploying.'
    );
  }

  const signers = await hre.ethers.getSigners();
  if (!signers.length) {
    throw new Error(
      'No deployer account available. Set PRIVATE_KEY in the root .env before deploying to Sepolia.'
    );
  }
  const network = await hre.ethers.provider.getNetwork();
  const chainDefaults = getChainDefaults(Number(network.chainId), hre.network.name);
  if (chainDefaults.network !== 'sepolia') {
    throw new Error(`Sepolia deployment only. Connected network: ${chainDefaults.network}`);
  }
  const configuredLenders = parseCsvAddresses(process.env.INITIAL_LENDER_ADDRESSES);
  const initialLenders = configuredLenders.length > 0
    ? configuredLenders
    : [signers[0].address];

  const PropertyNFT = await hre.ethers.getContractFactory('PropertyNFT');
  const propertyNFT = await PropertyNFT.deploy();
  await propertyNFT.waitForDeployment();
  const propertyNFTAddress = await propertyNFT.getAddress();
  console.log(`PropertyNFT deployed to: ${propertyNFTAddress}`);

  const Verification = await hre.ethers.getContractFactory('Verification');
  const verification = await Verification.deploy();
  await verification.waitForDeployment();
  const verificationAddress = await verification.getAddress();
  console.log(`Verification deployed to: ${verificationAddress}`);

  const PropertyEscrow = await hre.ethers.getContractFactory('PropertyEscrow');
  const propertyEscrow = await PropertyEscrow.deploy();
  await propertyEscrow.waitForDeployment();
  const propertyEscrowAddress = await propertyEscrow.getAddress();
  console.log(`PropertyEscrow deployed to: ${propertyEscrowAddress}`);

  const LoanRepayment = await getLoanRepaymentFactory();
  const loanRepayment = await LoanRepayment.deploy();
  await loanRepayment.waitForDeployment();
  const loanRepaymentAddress = await loanRepayment.getAddress();
  console.log(`LoanRepayment deployed to: ${loanRepaymentAddress}`);

  const MortgageCore = await hre.ethers.getContractFactory('MortgageCore');
  const mortgageCore = await MortgageCore.deploy(
    initialLenders,
    propertyEscrowAddress,
    loanRepaymentAddress,
    verificationAddress
  );
  await mortgageCore.waitForDeployment();
  const mortgageCoreAddress = await mortgageCore.getAddress();
  console.log(`MortgageCore deployed to: ${mortgageCoreAddress}`);

  const LoanAutomation = await hre.ethers.getContractFactory('LoanAutomation');
  const loanAutomation = await LoanAutomation.deploy(mortgageCoreAddress);
  await loanAutomation.waitForDeployment();
  const loanAutomationAddress = await loanAutomation.getAddress();
  console.log(`LoanAutomation deployed to: ${loanAutomationAddress}`);

  await propertyEscrow.setController(mortgageCoreAddress);
  await loanRepayment.setController(mortgageCoreAddress);
  await verification.setVerifierAuthorization(mortgageCoreAddress, true);
  await mortgageCore.setAutomationContract(loanAutomationAddress);
  await propertyNFT.setMortgageLoanContract(mortgageCoreAddress);
  await propertyNFT.setVerificationRegistry(verificationAddress);
  console.log('Modules linked to MortgageCore');

  const addresses = {
    propertyNFT: propertyNFTAddress,
    mortgageCore: mortgageCoreAddress,
    mortgageContract: mortgageCoreAddress,
    mortgageLoan: mortgageCoreAddress,
    propertyEscrow: propertyEscrowAddress,
    loanRepayment: loanRepaymentAddress,
    loanAutomation: loanAutomationAddress,
    verification: verificationAddress,
    network: chainDefaults.network,
    chainId: chainDefaults.chainId,
    explorerBaseUrl: chainDefaults.explorerBaseUrl,
    openSeaBaseUrl: chainDefaults.openSeaBaseUrl,
    authorizedLenders: initialLenders,
    deployedAt: new Date().toISOString(),
  };

  const outputPath = path.join(__dirname, '..', 'deployed-addresses.json');
  fs.writeFileSync(outputPath, JSON.stringify(addresses, null, 2));
  console.log(`\nAddresses saved to: ${outputPath}`);

  upsertEnvFile(path.join(__dirname, '..', '.env'), {
    PROPERTY_NFT_ADDRESS: propertyNFTAddress,
    MORTGAGE_CORE_ADDRESS: mortgageCoreAddress,
    MORTGAGE_CONTRACT_ADDRESS: mortgageCoreAddress,
    MORTGAGE_LOAN_ADDRESS: mortgageCoreAddress,
    PROPERTY_ESCROW_ADDRESS: propertyEscrowAddress,
    LOAN_REPAYMENT_ADDRESS: loanRepaymentAddress,
    LOAN_AUTOMATION_ADDRESS: loanAutomationAddress,
    VERIFICATION_ADDRESS: verificationAddress,
    CHAIN_ID: chainDefaults.chainId,
  });

  const frontendPublicPath = path.join(__dirname, '..', '..', 'frontend', 'public', 'contracts');
  if (!fs.existsSync(frontendPublicPath)) {
    fs.mkdirSync(frontendPublicPath, { recursive: true });
  }

  fs.writeFileSync(
    path.join(frontendPublicPath, 'deployed-addresses.json'),
    JSON.stringify(addresses, null, 2)
  );

  upsertEnvFile(path.join(__dirname, '..', '..', 'frontend', '.env'), {
    VITE_PROPERTY_NFT_ADDRESS: propertyNFTAddress,
    VITE_MORTGAGE_ADDRESS: mortgageCoreAddress,
    VITE_MORTGAGE_CORE_ADDRESS: mortgageCoreAddress,
    VITE_PROPERTY_ESCROW_ADDRESS: propertyEscrowAddress,
    VITE_LOAN_REPAYMENT_ADDRESS: loanRepaymentAddress,
    VITE_LOAN_AUTOMATION_ADDRESS: loanAutomationAddress,
    VITE_VERIFICATION_ADDRESS: verificationAddress,
    VITE_CHAIN_ID: chainDefaults.chainId,
    VITE_NETWORK_NAME: chainDefaults.network,
    VITE_CHAIN_EXPLORER_URL: chainDefaults.explorerBaseUrl,
    VITE_OPENSEA_BASE_URL: chainDefaults.openSeaBaseUrl,
    REACT_APP_PROPERTY_NFT_ADDRESS: propertyNFTAddress,
    REACT_APP_MORTGAGE_ADDRESS: mortgageCoreAddress,
    REACT_APP_MORTGAGE_CORE_ADDRESS: mortgageCoreAddress,
    REACT_APP_PROPERTY_ESCROW_ADDRESS: propertyEscrowAddress,
    REACT_APP_LOAN_REPAYMENT_ADDRESS: loanRepaymentAddress,
    REACT_APP_LOAN_AUTOMATION_ADDRESS: loanAutomationAddress,
    REACT_APP_VERIFICATION_ADDRESS: verificationAddress,
    REACT_APP_CHAIN_ID: chainDefaults.chainId,
    REACT_APP_NETWORK_NAME: chainDefaults.network,
    REACT_APP_CHAIN_EXPLORER_URL: chainDefaults.explorerBaseUrl,
    REACT_APP_OPENSEA_BASE_URL: chainDefaults.openSeaBaseUrl,
  });

  const artifactsDir = path.join(__dirname, '..', 'artifacts', 'contracts');
  copyAbi(artifactsDir, 'PropertyNFT.sol', 'PropertyNFT', frontendPublicPath);
  copyAbi(artifactsDir, 'MortgageCore.sol', 'MortgageCore', frontendPublicPath, ['MortgageContract', 'MortgageLoan']);
  copyAbi(artifactsDir, 'PropertyEscrow.sol', 'PropertyEscrow', frontendPublicPath);
  copyAbi(artifactsDir, 'LoanRepayment.sol', 'LoanRepayment', frontendPublicPath);
  copyAbi(artifactsDir, 'LoanAutomation.sol', 'LoanAutomation', frontendPublicPath);
  copyAbi(artifactsDir, 'Verification.sol', 'Verification', frontendPublicPath);

  console.log('ABIs copied to frontend public.\n');
  console.log('Deployment complete!');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
