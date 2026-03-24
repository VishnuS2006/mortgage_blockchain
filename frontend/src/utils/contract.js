import { BrowserProvider, Contract } from 'ethers';
import {
  CHAIN_ID,
  CONTRACTS,
  EXPLORER_URL,
  OPENSEA_BASE_URL,
  NETWORK_NAME,
  RPC_URL,
} from '../config/blockchain';

let contractAddresses = null;
let propertyNFTABI = null;
let mortgageCoreABI = null;
let loanRepaymentABI = null;
let verificationABI = null;
let loadPromise = null;

function getFallbackChainConfig(expectedChainId) {
  return {
    chainId: Number(expectedChainId || CHAIN_ID || 11155111),
    chainIdHex: '0xAA36A7',
    chainName: 'Sepolia',
    networkName: 'sepolia',
    rpcUrls: [RPC_URL || 'https://rpc.sepolia.org'],
    nativeCurrency: {
      name: 'Sepolia Ether',
      symbol: 'SEP ETH',
      decimals: 18,
    },
    blockExplorerUrls: [EXPLORER_URL || 'https://sepolia.etherscan.io'],
    explorerBaseUrl: EXPLORER_URL || 'https://sepolia.etherscan.io',
    openSeaBaseUrl: OPENSEA_BASE_URL || 'https://testnets.opensea.io/assets/sepolia',
  };
}

function mergeChainMetadata(addresses) {
  const expectedChainId = Number(CHAIN_ID || addresses?.chainId || 11155111);
  const fallback = getFallbackChainConfig(expectedChainId);

  return {
    ...fallback,
    chainId: expectedChainId,
    networkName: addresses?.network || NETWORK_NAME || fallback.networkName,
    explorerBaseUrl: addresses?.explorerBaseUrl || fallback.explorerBaseUrl,
    openSeaBaseUrl: addresses?.openSeaBaseUrl || fallback.openSeaBaseUrl,
  };
}

async function loadAbi(refName, fallbackNames = []) {
  const names = [refName, ...fallbackNames];
  for (const name of names) {
    try {
      const response = await fetch(`/contracts/${name}.json`);
      if (response.ok) {
        const data = await response.json();
        return data.abi;
      }
    } catch {
      // Ignore and continue to fallbacks.
    }
  }
  return null;
}

async function loadContracts() {
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = (async () => {
    try {
      const addressResponse = await fetch('/contracts/deployed-addresses.json');
      if (addressResponse.ok) {
        contractAddresses = await addressResponse.json();
      }
    } catch {
      console.warn('Contract addresses not found. Deploy contracts first.');
    }

    propertyNFTABI = await loadAbi('PropertyNFT');
    mortgageCoreABI = await loadAbi('MortgageCore', ['MortgageContract', 'MortgageLoan']);
    loanRepaymentABI = await loadAbi('LoanRepayment');
    verificationABI = await loadAbi('Verification');

    const nextAddresses = contractAddresses
      ? {
          ...contractAddresses,
          propertyNFT: CONTRACTS.nft || contractAddresses.propertyNFT,
          mortgageCore:
            CONTRACTS.mortgage ||
            contractAddresses.mortgageCore ||
            contractAddresses.mortgageContract ||
            contractAddresses.mortgageLoan,
          mortgageContract:
            CONTRACTS.mortgage ||
            contractAddresses.mortgageCore ||
            contractAddresses.mortgageContract ||
            contractAddresses.mortgageLoan,
          mortgageLoan:
            CONTRACTS.mortgage ||
            contractAddresses.mortgageCore ||
            contractAddresses.mortgageContract ||
            contractAddresses.mortgageLoan,
        }
      : {
          propertyNFT: CONTRACTS.nft,
          mortgageCore: CONTRACTS.mortgage,
          mortgageContract: CONTRACTS.mortgage,
          mortgageLoan: CONTRACTS.mortgage,
          network: NETWORK_NAME,
          chainId: CHAIN_ID || '11155111',
          explorerBaseUrl: EXPLORER_URL,
          openSeaBaseUrl: OPENSEA_BASE_URL,
        };

    contractAddresses = {
      ...nextAddresses,
      ...mergeChainMetadata(nextAddresses),
    };
  })();

  return loadPromise;
}

export async function getProvider() {
  if (!window.ethereum) {
    throw new Error('MetaMask not installed');
  }

  return new BrowserProvider(window.ethereum);
}

export async function getSigner() {
  const provider = await getProvider();
  return provider.getSigner();
}

export async function getCurrentChainId() {
  const provider = await getProvider();
  const network = await provider.getNetwork();
  return Number(network.chainId);
}

export async function getExpectedChainId() {
  await loadContracts();
  return Number(contractAddresses?.chainId || CHAIN_ID || 11155111);
}

export async function getExpectedNetworkLabel() {
  await loadContracts();
  return contractAddresses?.chainName || contractAddresses?.networkName || NETWORK_NAME || 'Sepolia';
}

export async function getChainConfig() {
  await loadContracts();
  const expectedChainId = Number(contractAddresses?.chainId || CHAIN_ID || 11155111);
  return {
    ...getFallbackChainConfig(expectedChainId),
    chainId: expectedChainId,
    chainIdHex: `0x${expectedChainId.toString(16).toUpperCase()}`,
    networkName: contractAddresses?.networkName || NETWORK_NAME || 'sepolia',
    chainName: 'Sepolia',
    explorerBaseUrl: contractAddresses?.explorerBaseUrl || EXPLORER_URL,
    openSeaBaseUrl: contractAddresses?.openSeaBaseUrl || OPENSEA_BASE_URL,
  };
}

export async function switchToExpectedNetwork() {
  const expectedChain = await getChainConfig();
  if (!window.ethereum) {
    throw new Error('MetaMask not installed');
  }

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: expectedChain.chainIdHex }],
    });
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: expectedChain.chainIdHex,
          chainName: expectedChain.chainName,
          rpcUrls: expectedChain.rpcUrls,
          nativeCurrency: expectedChain.nativeCurrency,
          blockExplorerUrls: expectedChain.blockExplorerUrls,
        }],
      });
      return;
    }

    throw err;
  }
}

export async function ensureSupportedNetwork({ autoSwitch = true } = {}) {
  const expectedChainId = await getExpectedChainId();
  const currentChainId = await getCurrentChainId();

  if (expectedChainId && currentChainId !== expectedChainId) {
    if (autoSwitch) {
      await switchToExpectedNetwork();
      const switchedChainId = await getCurrentChainId();
      if (switchedChainId !== expectedChainId) {
        throw new Error(`Wrong network. Switch MetaMask to chain ID ${expectedChainId}.`);
      }
      return switchedChainId;
    }

    throw new Error(`Wrong network. Switch MetaMask to chain ID ${expectedChainId}.`);
  }

  return currentChainId;
}

export async function ensureBlockchainReady({
  requireWallet = true,
  requireMortgage = false,
  autoSwitch = true,
} = {}) {
  if (requireWallet && !window.ethereum) {
    throw new Error('MetaMask not installed');
  }

  if (requireWallet) {
    const provider = await getProvider();
    const signer = await provider.getSigner();
    const address = await signer.getAddress();
    if (!address) {
      throw new Error('Wallet not connected');
    }
  }

  await ensureSupportedNetwork({ autoSwitch });
  await loadContracts();

  if (requireMortgage) {
    requireAddress(contractAddresses?.mortgageCore, 'MortgageCore');
  }

  return contractAddresses;
}

function requireAddress(address, label) {
  if (!address) {
    throw new Error(`${label} not deployed. Deploy contracts first.`);
  }
}

export async function getPropertyNFTContract(signerOrProvider) {
  await loadContracts();
  requireAddress(contractAddresses?.propertyNFT, 'PropertyNFT');
  if (!propertyNFTABI) {
    throw new Error('PropertyNFT ABI not found.');
  }
  return new Contract(contractAddresses.propertyNFT, propertyNFTABI, signerOrProvider);
}

export async function getMortgageLoanContract(signerOrProvider) {
  await loadContracts();
  requireAddress(contractAddresses?.mortgageCore, 'MortgageCore');
  if (!mortgageCoreABI) {
    throw new Error('MortgageCore ABI not found.');
  }
  return new Contract(contractAddresses.mortgageCore, mortgageCoreABI, signerOrProvider);
}

export async function getLoanRepaymentContract(signerOrProvider) {
  await loadContracts();
  requireAddress(contractAddresses?.loanRepayment, 'LoanRepayment');
  if (!loanRepaymentABI) {
    throw new Error('LoanRepayment ABI not found.');
  }
  return new Contract(contractAddresses.loanRepayment, loanRepaymentABI, signerOrProvider);
}

export async function getVerificationContract(signerOrProvider) {
  await loadContracts();
  requireAddress(contractAddresses?.verification, 'Verification');
  if (!verificationABI) {
    throw new Error('Verification ABI not found.');
  }
  return new Contract(contractAddresses.verification, verificationABI, signerOrProvider);
}

export function getContractAddresses() {
  return contractAddresses;
}

export function getLoanStatusLabel(statusValue) {
  const statusMap = ['Pending', 'Approved', 'Rejected', 'Active', 'Completed', 'Defaulted', 'Cancelled'];
  return statusMap[Number(statusValue)] || `Unknown(${statusValue})`;
}

export function buildExplorerTxUrl(txHash) {
  if (!txHash || !contractAddresses?.explorerBaseUrl) {
    return '';
  }

  return `${contractAddresses.explorerBaseUrl}/tx/${txHash}`;
}

export function buildNftExplorerUrl(tokenId) {
  if (!tokenId || !contractAddresses?.openSeaBaseUrl || !contractAddresses?.propertyNFT) {
    return '';
  }

  return `${contractAddresses.openSeaBaseUrl}/${contractAddresses.propertyNFT}/${tokenId}`;
}

export { contractAddresses, propertyNFTABI, mortgageCoreABI, loanRepaymentABI, verificationABI };
