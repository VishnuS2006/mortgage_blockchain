/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BrowserProvider, formatEther } from 'ethers';
import toast from 'react-hot-toast';
import {
  getExpectedChainId,
  getExpectedNetworkLabel,
  switchToExpectedNetwork,
} from '../utils/contract';
import { useAuth } from './AuthContext';

const WalletContext = createContext(null);

function normalizeChainId(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string' && value.startsWith('0x')) {
    return Number.parseInt(value, 16);
  }

  return Number(value);
}

export function WalletProvider({ children }) {
  const { user, linkWallet } = useAuth();
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [networkName, setNetworkName] = useState('');
  const [expectedChainId, setExpectedChainId] = useState(null);
  const [expectedNetworkLabel, setExpectedNetworkLabel] = useState('Sepolia');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLinkingWallet, setIsLinkingWallet] = useState(false);
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);
  const [switchError, setSwitchError] = useState('');

  const refreshBalance = useCallback(async (targetAccount = account) => {
    if (!window.ethereum || !targetAccount) {
      setBalance(null);
      return null;
    }

    try {
      const provider = new BrowserProvider(window.ethereum);
      const nextBalance = await provider.getBalance(targetAccount);
      const network = await provider.getNetwork();
      const formatted = formatEther(nextBalance);
      setBalance(formatted);
      setNetworkName(network.name || '');
      return formatted;
    } catch {
      setBalance(null);
      return null;
    }
  }, [account]);

  useEffect(() => {
    getExpectedChainId().then(setExpectedChainId).catch(() => setExpectedChainId(null));
    getExpectedNetworkLabel().then(setExpectedNetworkLabel).catch(() => setExpectedNetworkLabel('Sepolia'));
  }, []);

  useEffect(() => {
    if (!window.ethereum || !account) {
      setBalance(null);
      return undefined;
    }

    let cancelled = false;

    const loadBalance = async () => {
      const nextBalance = await refreshBalance(account);
      if (cancelled) {
        return;
      }
      setBalance(nextBalance);
    };

    loadBalance();
    return () => {
      cancelled = true;
    };
  }, [account, chainId, refreshBalance]);

  useEffect(() => {
    if (!window.ethereum) {
      return undefined;
    }

    const hydrateWallet = async () => {
      try {
        const [accounts, currentChainId] = await Promise.all([
          window.ethereum.request({ method: 'eth_accounts' }),
          window.ethereum.request({ method: 'eth_chainId' }),
        ]);
        if (accounts.length > 0) {
          setAccount(accounts[0]);
        }
        setChainId(normalizeChainId(currentChainId));
        const provider = new BrowserProvider(window.ethereum);
        const network = await provider.getNetwork();
        setNetworkName(network.name || '');
      } catch {
        // Ignore hydration failures.
      }
    };

    hydrateWallet();
    return undefined;
  }, []);

  useEffect(() => {
    if (!window.ethereum) {
      return undefined;
    }

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        setAccount(null);
        setBalance(null);
        toast('Wallet disconnected');
        return;
      }

      setAccount(accounts[0]);
    };

    const handleChainChanged = (value) => {
      setChainId(normalizeChainId(value));
      setNetworkName('');
      setSwitchError('');
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, []);

  const switchNetwork = async () => {
    if (!window.ethereum) {
      toast.error('Please install MetaMask to continue');
      return false;
    }

    setIsSwitchingNetwork(true);
    setSwitchError('');

    try {
      await switchToExpectedNetwork();
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      setChainId(normalizeChainId(currentChainId));
      toast.success('Network switched successfully');
      return true;
    } catch (err) {
      console.error('Switch network error:', err);
      const message = err.message || 'Failed to switch network';
      setSwitchError(message);
      toast.error(message);
      return false;
    } finally {
      setIsSwitchingNetwork(false);
    }
  };

  const connectWallet = async ({ autoSwitch = true } = {}) => {
    if (!window.ethereum) {
      toast.error('Please install MetaMask to continue');
      return null;
    }

    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const nextAccount = accounts[0] || null;
      const nextChainId = await window.ethereum.request({ method: 'eth_chainId' });
      setAccount(nextAccount);
      setChainId(normalizeChainId(nextChainId));
      await refreshBalance(nextAccount);

      if (
        autoSwitch &&
        expectedChainId &&
        normalizeChainId(nextChainId) !== Number(expectedChainId)
      ) {
        const switched = await switchNetwork();
        if (!switched) {
          throw new Error(`Switch MetaMask to ${expectedNetworkLabel}`);
        }
      }

      return nextAccount;
    } catch (err) {
      console.error('Connect wallet error:', err);
      toast.error(err.code === 4001 ? 'Wallet connection was rejected' : (err.message || 'Failed to connect wallet'));
      return null;
    } finally {
      setIsConnecting(false);
    }
  };

  const linkConnectedWallet = async (walletSignature) => {
    if (!account) {
      throw new Error('Connect MetaMask before linking a wallet');
    }

    setIsLinkingWallet(true);
    try {
      return await linkWallet(account, walletSignature);
    } finally {
      setIsLinkingWallet(false);
    }
  };

  const disconnectWallet = () => {
    setAccount(null);
    setBalance(null);
    setChainId(null);
    setNetworkName('');
    setSwitchError('');
    toast.success('Wallet disconnected from the app');
  };

  const registeredWallet = user?.walletAddress || null;
  const isWalletMismatch = Boolean(
    registeredWallet &&
      account &&
      registeredWallet.toLowerCase() !== account.toLowerCase()
  );
  const isWrongNetwork = Boolean(
    expectedChainId &&
      chainId &&
      Number(expectedChainId) !== Number(chainId)
  );

  return (
        <WalletContext.Provider
      value={{
        account,
        chainId,
        balance,
        networkName,
        connectionStatus: account ? 'Connected' : 'Disconnected',
        expectedChainId,
        expectedNetworkLabel,
        registeredWallet,
        isConnecting,
        isLinkingWallet,
        isSwitchingNetwork,
        switchError,
        isWalletMismatch,
        isWrongNetwork,
        hasMetaMask: Boolean(window.ethereum),
        connectWallet,
        disconnectWallet,
        switchNetwork,
        linkConnectedWallet,
        refreshBalance,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return ctx;
}
