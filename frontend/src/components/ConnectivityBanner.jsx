import { useEffect, useState } from 'react';
import { API_URL } from '../utils/api';
import { useWallet } from '../context/WalletRuntimeContext';

export default function ConnectivityBanner() {
  const [isBrowserOnline, setIsBrowserOnline] = useState(() => navigator.onLine);
  const [isBackendOnline, setIsBackendOnline] = useState(true);
  const {
    isWrongNetwork,
    expectedChainId,
    expectedNetworkLabel,
    chainId,
    switchNetwork,
    isSwitchingNetwork,
    switchError,
  } = useWallet();

  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const checkBackend = async () => {
      try {
        const response = await fetch(`${API_URL}/health`, { cache: 'no-store' });
        if (!cancelled) {
          setIsBackendOnline(response.ok);
        }
      } catch {
        if (!cancelled) {
          setIsBackendOnline(false);
        }
      }
    };

    checkBackend();
    const intervalId = window.setInterval(checkBackend, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const browserMessage = !isBrowserOnline
    ? 'Browser is offline. Wallet and API actions are unavailable until the connection returns.'
    : null;
  const backendMessage = isBrowserOnline && !isBackendOnline
    ? 'Backend is unreachable. Data and API-driven actions may fail until the server is back online.'
    : null;
  const networkMessage = isWrongNetwork
    ? `Wrong network detected. Connected chain ID ${chainId || 'unknown'}, expected ${expectedNetworkLabel} (${expectedChainId}).`
    : null;

  if (!browserMessage && !backendMessage && !networkMessage) {
    return null;
  }

  return (
    <div className="connectivity-banner">
      <div className="connectivity-banner-content">
        <span>{browserMessage || backendMessage || networkMessage}</span>
        {isWrongNetwork && (
          <button
            type="button"
            className="connectivity-action"
            onClick={switchNetwork}
            disabled={isSwitchingNetwork}
          >
            {isSwitchingNetwork ? 'Switching...' : 'Switch Network'}
          </button>
        )}
      </div>
      {switchError ? <div className="connectivity-detail">{switchError}</div> : null}
    </div>
  );
}
