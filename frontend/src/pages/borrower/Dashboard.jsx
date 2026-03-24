import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useWallet } from '../../context/WalletRuntimeContext';
import api from '../../utils/api';
import { ensureSupportedNetwork, getMortgageLoanContract, getProvider } from '../../utils/contract';
import EMICalculator from '../../components/EMICalculator';
import LoadingSpinner from '../../components/LoadingSpinner';
import toast from 'react-hot-toast';
import {
  FaBuilding,
  FaCheckCircle,
  FaClock,
  FaExclamationTriangle,
  FaFileContract,
  FaSyncAlt,
  FaWallet,
} from 'react-icons/fa';
import './Pages.css';

function getPropertyIpfsUrl(target) {
  const ipfsHash =
    target?.ipfsHash ??
    target?.property_ipfs ??
    target?.metadata_ipfs ??
    target?.image_ipfs ??
    '';

  if (!ipfsHash) {
    return '';
  }

  if (ipfsHash.startsWith('http://') || ipfsHash.startsWith('https://')) {
    return ipfsHash;
  }

  return `https://gateway.pinata.cloud/ipfs/${ipfsHash.replace(/^ipfs:\/\//, '')}`;
}

export default function Dashboard() {
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
  const [properties, setProperties] = useState([]);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [propRes, loanRes] = await Promise.all([
        api.get('/properties/my-properties'),
        api.get('/loans/my-loans'),
      ]);
      setProperties(propRes.data.properties);
      setLoans(loanRes.data.loans);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      Pending: '#f59e0b',
      Approved: '#38bdf8',
      Rejected: '#ef4444',
      Active: '#10b981',
      Completed: '#6366f1',
      Defaulted: '#ef4444',
      Cancelled: '#94a3b8',
    };
    return colors[status] || '#94a3b8';
  };

  const handleReclaimCollateral = async (loan) => {
    const contractLoanId = loan.contractLoanId ?? loan.blockchain_loan_id;
    if (!contractLoanId) {
      toast.error('This rejected loan has no blockchain record to cancel');
      return;
    }

    let walletAccount = account;
    if (!walletAccount) {
      walletAccount = await connectWallet();
      if (!walletAccount) {
        return;
      }
    }

    try {
      await ensureSupportedNetwork();
      toast.loading('Cancelling rejected loan on-chain...', { id: `cancel-${loan.id}` });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const contract = await getMortgageLoanContract(signer);
      const tx = await contract.cancelPendingLoan(contractLoanId);
      await tx.wait();

      await api.put(`/loans/${loan.id}/status`, {
        status: 'Cancelled',
      });

      toast.success('Collateral reclaimed successfully', { id: `cancel-${loan.id}` });
      await fetchData();
    } catch (err) {
      console.error('Cancel rejected loan error:', err);
      toast.error(err.reason || err.message || 'Failed to reclaim collateral', { id: `cancel-${loan.id}` });
    }
  };

  const handleDeletePendingLoan = async (loan) => {
    const contractLoanId = loan.contractLoanId ?? loan.blockchain_loan_id;

    try {
      if (contractLoanId) {
        let walletAccount = account;
        if (!walletAccount) {
          walletAccount = await connectWallet();
          if (!walletAccount) {
            return;
          }
        }

        await ensureSupportedNetwork();
        toast.loading('Deleting pending loan on-chain...', { id: `delete-${loan.id}` });
        const provider = await getProvider();
        const signer = await provider.getSigner();
        const contract = await getMortgageLoanContract(signer);
        const tx = await contract.cancelPendingLoan(contractLoanId);
        await tx.wait();
      }

      await api.delete(`/loans/${loan.id}`);
      toast.success('Pending loan deleted', { id: `delete-${loan.id}` });
      await fetchData();
    } catch (err) {
      console.error('Delete pending loan error:', err);
      toast.error(err.response?.data?.error || err.reason || err.message || 'Failed to delete pending loan', { id: `delete-${loan.id}` });
    }
  };

  const activeLoans = loans.filter((loan) => loan.status === 'Active');
  const pendingLoans = loans.filter((loan) => loan.status === 'Pending');
  const completedLoans = loans.filter((loan) => loan.status === 'Completed');

  if (loading) {
    return <LoadingSpinner text="Loading dashboard..." />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Welcome, {user?.name}</h1>
          <p>Your borrower dashboard for properties, loans, and repayments.</p>
        </div>
        {!account && (
          <button className="btn btn-primary" onClick={connectWallet}>
            <FaWallet /> Connect Wallet
          </button>
        )}
      </div>

      {isWalletMismatch && (
        <div className="alert alert-warning">
          <FaExclamationTriangle /> <strong>Wallet mismatch.</strong> Switch to the wallet linked to this account before sending blockchain transactions.
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <FaBuilding className="stat-icon" style={{ color: '#818cf8' }} />
          <div>
            <span className="stat-value">{properties.length}</span>
            <span className="stat-label">Properties</span>
          </div>
        </div>
        <div className="stat-card">
          <FaFileContract className="stat-icon" style={{ color: '#10b981' }} />
          <div>
            <span className="stat-value">{activeLoans.length}</span>
            <span className="stat-label">Active Loans</span>
          </div>
        </div>
        <div className="stat-card">
          <FaClock className="stat-icon" style={{ color: '#f59e0b' }} />
          <div>
            <span className="stat-value">{pendingLoans.length}</span>
            <span className="stat-label">Pending</span>
          </div>
        </div>
        <div className="stat-card">
          <FaCheckCircle className="stat-icon" style={{ color: '#6366f1' }} />
          <div>
            <span className="stat-value">{completedLoans.length}</span>
            <span className="stat-label">Completed</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Wallet</h2>
        <div className="loan-details-grid">
          <div className="detail-item">
            <span>Balance</span>
            <strong>{balance ? `${Number(balance).toFixed(4)} ETH` : 'Unavailable'}</strong>
          </div>
          <div className="detail-item">
            <span>Network</span>
            <strong>{networkName || (chainId ? `Chain ${chainId}` : 'Unknown')}</strong>
          </div>
          <div className="detail-item">
            <span>Status</span>
            <strong>{connectionStatus}</strong>
          </div>
        </div>
        <div className="wallet-action-row">
          <button type="button" className="btn btn-primary" onClick={() => connectWallet()}>
            <FaWallet /> {account ? 'Reconnect Wallet' : 'Connect Wallet'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
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

      {loans.length > 0 && (
        <div className="section">
          <h2>Your Loans</h2>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Loan Amount</th>
                  <th>EMI</th>
                  <th>Paid</th>
                  <th>Remaining</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <tr key={loan.id}>
                    <td>{loan.property_name || `NFT #${loan.nft_id}`}</td>
                    <td>{loan.loan_amount} ETH</td>
                    <td>{loan.emi_amount?.toFixed(4)} ETH</td>
                    <td>{loan.amount_paid?.toFixed(4)} ETH</td>
                    <td>{loan.remaining_balance?.toFixed(4)} ETH</td>
                    <td>
                      <span
                        className="status-badge"
                        style={{
                          background: `${getStatusColor(loan.status)}22`,
                          color: getStatusColor(loan.status),
                          border: `1px solid ${getStatusColor(loan.status)}44`,
                        }}
                      >
                        {loan.status}
                      </span>
                    </td>
                    <td>
                      {loan.status === 'Active' && (
                        <Link to={`/payment?loanId=${loan.id}`} className="btn btn-sm btn-primary">Pay EMI</Link>
                      )}
                      {loan.status === 'Pending' && (
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeletePendingLoan(loan)}>
                          Delete Loan
                        </button>
                      )}
                      {loan.status === 'Rejected' && (
                        <button type="button" className="btn btn-sm btn-primary" onClick={() => handleReclaimCollateral(loan)}>
                          Reclaim NFT
                        </button>
                      )}
                      {getPropertyIpfsUrl(loan) && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => window.open(getPropertyIpfsUrl(loan), '_blank', 'noopener,noreferrer')}
                        >
                          View Property
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {properties.length > 0 && (
        <div className="section">
          <h2>Your Properties</h2>
          <div className="property-grid">
            {properties.map((property) => (
              <div key={property.id} className="property-card">
                {property.image_ipfs && (
                  <img src={property.image_ipfs} alt={property.name} className="property-image" />
                )}
                <div className="property-info">
                  <h3>{property.name}</h3>
                  <p className="property-location">{property.location}</p>
                  <p className="property-price">{property.price} ETH</p>
                  {property.nft_token_id && (
                    <span className="nft-badge">NFT #{property.nft_token_id}</span>
                  )}
                  {getPropertyIpfsUrl(property) && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      style={{ marginTop: '0.75rem' }}
                      onClick={() => window.open(getPropertyIpfsUrl(property), '_blank', 'noopener,noreferrer')}
                    >
                      View Property
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <EMICalculator />
      </div>

      {properties.length === 0 && loans.length === 0 && (
        <div className="empty-state">
          <h2>Get Started</h2>
          <p>Upload your first property to begin the mortgage flow.</p>
          <Link to="/upload-property" className="btn btn-primary">Upload Property</Link>
        </div>
      )}
    </div>
  );
}
