import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '../context/WalletRuntimeContext';
import {
  FaBuilding,
  FaChartLine,
  FaCreditCard,
  FaEthereum,
  FaFileContract,
  FaHome,
  FaSignOutAlt,
  FaWallet,
} from 'react-icons/fa';
import { getDefaultRouteForRole } from '../utils/routing';
import { formatEthAmount } from '../pages/lender/lenderHelpers';
import './Navbar.css';
import './NavbarOverrides.css';

export default function Navbar() {
  const { user, logout } = useAuth();
  const {
    account,
    balance,
    chainId,
    networkName,
    connectionStatus,
    registeredWallet,
    connectWallet,
    disconnectWallet,
    isConnecting,
    isWalletMismatch,
    isWrongNetwork,
  } = useWallet();
  const [isWalletMenuOpen, setIsWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef(null);
  const navigate = useNavigate();
  const homePath = getDefaultRouteForRole(user?.role);
  const links = user?.role === 'lender'
    ? [
        { to: '/lender/dashboard', icon: FaHome, label: 'Dashboard' },
        { to: '/lender/manage-loans', icon: FaFileContract, label: 'Manage Loans' },
        { to: '/lender/investments', icon: FaChartLine, label: 'Investments' },
        { to: '/lender/wallet', icon: FaWallet, label: 'Wallet' },
      ]
    : [
        { to: '/borrower/dashboard', icon: FaHome, label: 'Dashboard' },
        { to: '/borrower/upload-property', icon: FaBuilding, label: 'Upload Property' },
        { to: '/borrower/apply-loan', icon: FaFileContract, label: 'Apply Loan' },
        { to: '/borrower/payment', icon: FaCreditCard, label: 'Payments' },
      ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const shortAddr = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (walletMenuRef.current && !walletMenuRef.current.contains(event.target)) {
        setIsWalletMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  return (
    <nav className="navbar">
      <Link to={homePath} className="navbar-brand">
        <span className="brand-icon">MB</span>
        <span className="brand-text">MortgageBC</span>
      </Link>

      {user && (
        <div className="navbar-links">
          {links.map((link) => {
            const IconComponent = link.icon;
            return (
              <Link key={link.to} to={link.to}>
                <IconComponent /> {link.label}
              </Link>
            );
          })}
        </div>
      )}

      <div className="navbar-actions">
        {user && (
          <>
            <div className="wallet-menu" ref={walletMenuRef}>
              <button
                className={`wallet-btn ${isWalletMismatch ? 'mismatch' : account ? 'connected' : ''}`}
                onClick={async () => {
                  if (!account) {
                    const connected = await connectWallet();
                    if (!connected) {
                      return;
                    }
                  }

                  setIsWalletMenuOpen((current) => !current);
                }}
                disabled={isConnecting}
              >
                <FaEthereum />
                {isConnecting ? 'Connecting...' : account ? `MetaMask | ${formatEthAmount(balance || 0)}` : 'MetaMask'}
              </button>

              {isWalletMenuOpen && (
                <div className="wallet-popover">
                  <div className="wallet-popover-header">
                    <strong>MetaMask</strong>
                    <span>{connectionStatus}</span>
                  </div>

                  <div className="wallet-popover-grid">
                    <div className="wallet-popover-item">
                      <span>Address</span>
                      <strong>{account || 'Not connected'}</strong>
                    </div>
                    <div className="wallet-popover-item">
                      <span>Balance</span>
                      <strong>{account ? formatEthAmount(balance || 0) : 'Unavailable'}</strong>
                    </div>
                    <div className="wallet-popover-item">
                      <span>Network</span>
                      <strong>{networkName || 'Unknown'}</strong>
                    </div>
                    <div className="wallet-popover-item">
                      <span>Status</span>
                      <strong>{connectionStatus}</strong>
                    </div>
                  </div>

                  {registeredWallet && (
                    <div className="wallet-popover-note">
                      Registered wallet: {shortAddr(registeredWallet)}
                    </div>
                  )}

                  {isWalletMismatch && (
                    <div className="wallet-popover-warning">
                      Connected wallet does not match the registered account wallet.
                    </div>
                  )}

                  {isWrongNetwork && (
                    <div className="wallet-popover-warning">
                      Current chain ID {chainId || 'Unknown'} is not the expected app network.
                    </div>
                  )}

                  <div className="wallet-popover-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={async () => {
                        await connectWallet();
                        setIsWalletMenuOpen(true);
                      }}
                    >
                      {account ? 'Reconnect' : 'Connect'}
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={() => {
                        disconnectWallet();
                        setIsWalletMenuOpen(false);
                      }}
                      disabled={!account}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              )}
            </div>
            {isWalletMismatch && <span className="mismatch-badge">Wallet mismatch</span>}
            <span className="user-name">{user.name} ({user.role})</span>
            <button className="logout-btn" onClick={handleLogout}>
              <FaSignOutAlt />
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
