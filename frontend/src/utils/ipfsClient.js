import { API_URL, PINATA_JWT } from './env';

const PINATA_API_URL = 'https://api.pinata.cloud';

function hasPinataJwt() {
  return Boolean(PINATA_JWT && PINATA_JWT !== 'your_pinata_jwt_here');
}

function getPinataHeaders(isJson = false) {
  const headers = {};

  if (hasPinataJwt()) {
    headers.Authorization = `Bearer ${PINATA_JWT}`;
  }

  if (isJson) {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

async function uploadFileToPinata(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${PINATA_API_URL}/pinning/pinFileToIPFS`, {
    method: 'POST',
    headers: getPinataHeaders(),
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Pinata file upload failed');
  }

  const data = await response.json();
  return {
    hash: data.IpfsHash,
    url: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
  };
}

async function uploadJsonToPinata(jsonData) {
  const response = await fetch(`${PINATA_API_URL}/pinning/pinJSONToIPFS`, {
    method: 'POST',
    headers: getPinataHeaders(true),
    body: JSON.stringify({
      pinataContent: jsonData,
      pinataMetadata: { name: jsonData.name || 'property-metadata' },
    }),
  });

  if (!response.ok) {
    throw new Error('Pinata JSON upload failed');
  }

  const data = await response.json();
  return {
    hash: data.IpfsHash,
    url: `https://gateway.pinata.cloud/ipfs/${data.IpfsHash}`,
  };
}

async function uploadFileToLocal(file) {
  const token = localStorage.getItem('token');
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_URL}/ipfs/upload-file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Local file upload failed');
  }

  const data = await response.json();
  return { hash: data.IpfsHash, url: data.url };
}

async function uploadJsonToLocal(jsonData) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_URL}/ipfs/upload-json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ metadata: jsonData }),
  });

  if (!response.ok) {
    throw new Error('Local JSON upload failed');
  }

  const data = await response.json();
  return { hash: data.IpfsHash, url: data.url };
}

export async function uploadFileToIPFS(file) {
  if (hasPinataJwt()) {
    return uploadFileToPinata(file);
  }

  console.warn('[ipfs] Missing VITE_PINATA_JWT. Falling back to backend IPFS upload.');
  return uploadFileToLocal(file);
}

export async function uploadJSONToIPFS(jsonData) {
  if (hasPinataJwt()) {
    return uploadJsonToPinata(jsonData);
  }

  console.warn('[ipfs] Missing VITE_PINATA_JWT. Falling back to backend IPFS upload.');
  return uploadJsonToLocal(jsonData);
}
