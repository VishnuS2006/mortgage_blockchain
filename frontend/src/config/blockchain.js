const env = import.meta.env;

function readRequiredEnv(key, fallback = '') {
  const value = String(env[key] || fallback).trim();
  if (!value || value.startsWith('0xYour') || value.includes('your-key') || value === 'your_pinata_jwt_here') {
    console.warn(`[blockchain-config] Missing or placeholder value for ${key}`);
  }
  return value;
}

export const CHAIN_ID = Number(readRequiredEnv('VITE_CHAIN_ID', '11155111'));
export const NETWORK_NAME = readRequiredEnv('VITE_NETWORK_NAME', 'sepolia');
export const RPC_URL = readRequiredEnv('VITE_RPC_URL', 'https://rpc.sepolia.org');
export const EXPLORER_URL = 'https://sepolia.etherscan.io';
export const OPENSEA_BASE_URL = 'https://testnets.opensea.io/assets/sepolia';

export const CONTRACTS = {
  nft: readRequiredEnv('VITE_PROPERTY_NFT_ADDRESS'),
  mortgage: readRequiredEnv('VITE_MORTGAGE_CORE_ADDRESS'),
};

export function getOpenSeaUrl(contractAddress, tokenId) {
  if (!contractAddress || tokenId === undefined || tokenId === null || tokenId === '') {
    return '';
  }

  return `${OPENSEA_BASE_URL}/${contractAddress}/${tokenId}`;
}

export function getExplorerTxUrl(txHash) {
  return txHash ? `${EXPLORER_URL}/tx/${txHash}` : '';
}
