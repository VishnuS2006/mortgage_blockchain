const env = import.meta.env;

export const API_URL = String(env.VITE_API_URL || 'http://localhost:5000/api').trim();
export const PINATA_JWT = String(env.VITE_PINATA_JWT || '').trim();
