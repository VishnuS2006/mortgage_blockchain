import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FaChartLine,
  FaClock,
  FaFileContract,
  FaHandHoldingUsd,
  FaSyncAlt,
  FaWallet,
} from 'react-icons/fa';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import { useWallet } from '../../context/WalletRuntimeContext';
import api from '../../utils/api';
import { formatEthAmount, getLoanStatusMeta, normalizeLenderLoanStatus } from './lenderHelpers';
import '../borrower/Pages.css';
import './Lender.css';

export default function LenderDashboard() {
  const { user } = useAuth();
  const {
    account,
    balance,
    chainId,
    connectionStatus,
    networkName,
    connectWallet,
    isWalletMismatch,
    refreshBalance,
  } = useWallet();
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState([]);
  const [investments, setInvestments] = useState([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [loanResponse, investmentResponse] = await Promise.all([
          api.get('/loans'),
          api.get('/investments'),
        ]);

        setLoans(loanResponse.data.loans || []);
        setInvestments(investmentResponse.data.investments || []);
      } catch (err) {
        toast.error(err.response?.data?.error || 'Failed to load lender dashboard');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  if (loading) {
    return <LoadingSpinner text="Loading lender dashboard..." />;
  }

  const pendingLoans = loans.filter((loan) => loan.status === 'Pending');
  const approvedLoans = loans.filter((loan) => loan.status === 'Approved');
  const fundedLoans = loans.filter((loan) => loan.status === 'Active');
  const completedLoans = loans.filter((loan) => loan.status === 'Completed');
  const rejectedLoans = loans.filter((loan) => loan.status === 'Rejected');
  const totalInvestedAmount = investments
    .filter((investment) => investment.status !== 'failed')
    .reduce((total, investment) => total + Number(investment.amount || 0), 0);
  const recentLoanRequests = [...loans].slice(0, 5);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Lender Dashboard</h1>
          <p>Review mortgage applications, fund approved loans, and track portfolio performance.</p>
        </div>
        {!account && (
          <button className="btn btn-primary" onClick={connectWallet}>
            <FaWallet /> Connect Wallet
          </button>
        )}
      </div>

      {isWalletMismatch && (
        <div className="alert alert-warning">
          Connected wallet does not match the wallet registered for {user?.email}. Funding is blocked until the wallet is aligned.
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <FaFileContract className="stat-icon" style={{ color: '#7dd3fc' }} />
          <div>
            <span className="stat-value">{loans.length}</span>
            <span className="stat-label">Total Loans</span>
          </div>
        </div>
        <div className="stat-card">
          <FaClock className="stat-icon" style={{ color: '#fbbf24' }} />
          <div>
            <span className="stat-value">{pendingLoans.length}</span>
            <span className="stat-label">Pending Review</span>
          </div>
        </div>
        <div className="stat-card">
          <FaChartLine className="stat-icon" style={{ color: '#38bdf8' }} />
          <div>
            <span className="stat-value">{approvedLoans.length}</span>
            <span className="stat-label">Approved</span>
          </div>
        </div>
        <div className="stat-card">
          <FaChartLine className="stat-icon" style={{ color: '#10b981' }} />
          <div>
            <span className="stat-value">{fundedLoans.length}</span>
            <span className="stat-label">Funded</span>
          </div>
        </div>
        <div className="stat-card">
          <FaChartLine className="stat-icon" style={{ color: '#a78bfa' }} />
          <div>
            <span className="stat-value">{completedLoans.length}</span>
            <span className="stat-label">Completed</span>
          </div>
        </div>
        <div className="stat-card">
          <FaClock className="stat-icon" style={{ color: '#f87171' }} />
          <div>
            <span className="stat-value">{rejectedLoans.length}</span>
            <span className="stat-label">Rejected</span>
          </div>
        </div>
        <div className="stat-card">
          <FaHandHoldingUsd className="stat-icon" style={{ color: '#10b981' }} />
          <div>
            <span className="stat-value">{formatEthAmount(totalInvestedAmount, 2)}</span>
            <span className="stat-label">Total Invested</span>
          </div>
        </div>
      </div>

      <div className="quick-grid section">
        <div className="quick-card">
          <h3>Balance</h3>
          <p>{balance ? formatEthAmount(balance) : 'Unavailable'}</p>
        </div>
        <div className="quick-card">
          <h3>Network</h3>
          <p>{networkName || (chainId ? `Chain ${chainId}` : 'Unknown')}</p>
        </div>
        <div className="quick-card">
          <h3>Status</h3>
          <p>{connectionStatus}</p>
          <div className="wallet-actions">
            <button type="button" className="btn btn-primary" onClick={() => connectWallet()}>
              <FaWallet /> {account ? 'Reconnect Wallet' : 'Connect Wallet'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                await refreshBalance();
                toast.success('Balance refreshed');
              }}
              disabled={!account}
            >
              <FaSyncAlt /> Refresh Balance
            </button>
          </div>
        </div>
      </div>

      <div className="quick-grid section">
        <div className="quick-card">
          <h3>Review Pipeline</h3>
          <p>{pendingLoans.length} applications are waiting for a decision.</p>
          <Link className="btn btn-primary" to="/lender/manage-loans">Open Manage Loans</Link>
        </div>
        <div className="quick-card">
          <h3>Portfolio Activity</h3>
          <p>{investments.length} investment record(s) are linked to this lender account.</p>
          <Link className="btn btn-primary" to="/lender/investments">Open Investments</Link>
        </div>
        <div className="quick-card">
          <h3>Wallet Status</h3>
          <p>{account ? 'MetaMask is connected for lender actions.' : 'No wallet is connected in this browser session.'}</p>
          <Link className="btn btn-primary" to="/lender/wallet">Manage Wallet</Link>
        </div>
      </div>

      <div className="section">
        <h2>Recent Loan Requests</h2>
        {recentLoanRequests.length === 0 ? (
          <div className="empty-state small">
            <p>No loan requests have been submitted yet.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Borrower</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Property</th>
                </tr>
              </thead>
              <tbody>
                {recentLoanRequests.map((loan) => {
                  const displayStatus = normalizeLenderLoanStatus(loan.status);
                  const statusMeta = getLoanStatusMeta(displayStatus);
                  return (
                    <tr key={loan.id}>
                      <td>#{loan.id}</td>
                      <td>{loan.borrower_name}</td>
                      <td>{formatEthAmount(loan.loan_amount)}</td>
                      <td>
                        <span className="status-chip" style={{ color: statusMeta.color, background: statusMeta.background }}>
                          {displayStatus}
                        </span>
                      </td>
                      <td>{loan.property_name || `NFT #${loan.nft_id}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rejectedLoans.length > 0 && (
        <div className="tiny-text">
          {rejectedLoans.length} loan{rejectedLoans.length === 1 ? '' : 's'} marked as rejected remain visible for audit tracking.
        </div>
      )}
    </div>
  );
}
