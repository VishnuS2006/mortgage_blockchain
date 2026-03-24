import { createContext, useContext, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { getExpectedChainId } from '../utils/contract';
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
  const [chainId, setChainId] = useState(null);
  const [expectedChainId, setExpectedChainId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLinkingWallet, setIsLinkingWallet] = useState(false);

  useEffect(() => {
    getExpectedChainId().then(setExpectedChainId).catch(() => setExpectedChainId(null));
  }, []);

  // Auto-connect on page load
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then((accounts) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
        }
      }).catch(() => undefined);
      window.ethereum.request({ method: 'eth_chainId' }).then((value) => {
        setChainId(normalizeChainId(value));
      }).catch(() => undefined);
    }
  }, []);

  // Listen for account/chain changes
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        setAccount(null);
        toast('Wallet disconnected', { icon: '🔌' });
      } else {
        setAccount(accounts[0]);
        // Check for wallet mismatch
        if (user?.wallet_address && accounts[0].toLowerCase() !== user.wallet_address.toLowerCase()) {
          toast.error('⚠️ Wallet mismatch! Please use the wallet linked to your account.');
        }
      }
    };

    const handleChainChanged = (newChainId) => {
      setChainId(newChainId);
      toast('Network changed', { icon: '🔄' });
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [user]);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      toast.error('Please install MetaMask!');
      return null;
    }

    setIsConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const addr = accounts[0];
      setAccount(addr);

      // Link wallet to backend account if not already linked
      if (user && !user.wallet_address) {
        await linkWallet(addr);
        toast.success('Wallet linked to your account!');
      } else if (user?.wallet_address && addr.toLowerCase() !== user.wallet_address.toLowerCase()) {
        toast.error('⚠️ This wallet doesn\'t match your account. Please switch to ' + user.wallet_address.slice(0, 6) + '...');
      } else {
        toast.success('Wallet connected!');
      }

      return addr;
    } catch (err) {
      toast.error('Failed to connect wallet');
      console.error(err);
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [user, linkWallet]);

  const isWalletMismatch = user?.wallet_address && account
    ? account.toLowerCase() !== user.wallet_address.toLowerCase()
    : false;

  return (
    <WalletContext.Provider value={{
      account,
      chainId,
      isConnecting,
      connectWallet,
      isWalletMismatch,
      hasMetaMask: !!window.ethereum,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
