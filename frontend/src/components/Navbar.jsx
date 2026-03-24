import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWallet } from '../context/WalletRuntimeContext';
import {
  FaBuilding,
  FaChartLine,
  FaCreditCard,
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
  const { account, balance, connectWallet, isConnecting, isWalletMismatch } = useWallet();
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
            <button
              className={`wallet-btn ${isWalletMismatch ? 'mismatch' : account ? 'connected' : ''}`}
              onClick={connectWallet}
              disabled={isConnecting}
            >
              <FaWallet />
              {isConnecting ? 'Connecting...' : account ? `${shortAddr(account)}${balance ? ` | ${formatEthAmount(balance)}` : ''}` : 'Connect Wallet'}
            </button>
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
