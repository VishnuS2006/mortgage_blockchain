import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FaExclamationTriangle, FaLink, FaWallet } from 'react-icons/fa';
import { useAuth } from '../../context/AuthContext';
import { useWallet } from '../../context/WalletRuntimeContext';
import api from '../../utils/api';
import { formatEthAmount } from './lenderHelpers';
import '../borrower/Pages.css';
import './Lender.css';

export default function LenderWalletPage() {
  const { user } = useAuth();
  const {
    account,
    balance,
    chainId,
    networkName,
    connectionStatus,
    expectedChainId,
    expectedNetworkLabel,
    registeredWallet,
    connectWallet,
    hasMetaMask,
    isConnecting,
    isLinkingWallet,
    isWalletMismatch,
    isWrongNetwork,
    isSwitchingNetwork,
    linkConnectedWallet,
    refreshBalance,
    switchNetwork,
  } = useWallet();
  const [isSigning, setIsSigning] = useState(false);
  const [transactions, setTransactions] = useState([]);

  useEffect(() => {
    api.get('/investments?sort=newest').then((response) => {
      setTransactions((response.data.investments || []).slice(0, 5));
    }).catch(() => undefined);
  }, []);

  const signWalletProof = async () => {
    if (!window.ethereum || !account) {
      return '';
    }

    const message = `MortgageBC wallet verification for ${user?.email} at ${new Date().toISOString()}`;

    try {
      setIsSigning(true);
      return await window.ethereum.request({
        method: 'personal_sign',
        params: [message, account],
      });
    } catch {
      return '';
    } finally {
      setIsSigning(false);
    }
  };

  const handleLinkWallet = async () => {
    try {
      const signature = await signWalletProof();
      await linkConnectedWallet(signature);
      toast.success(registeredWallet ? 'Wallet relinked successfully' : 'Wallet linked successfully');
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to link wallet');
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Wallet Management</h1>
          <p>Monitor wallet readiness for funding, refresh balance, and review recent lending transactions.</p>
        </div>
      </div>

      {!hasMetaMask && (
        <div className="alert alert-warning">
          MetaMask is not available in this browser. Install it before attempting lender funding transactions.
        </div>
      )}

      {isWalletMismatch && (
        <div className="alert alert-warning">
          <FaExclamationTriangle /> The connected wallet differs from the wallet registered for this lender account.
        </div>
      )}

      {isWrongNetwork && (
        <div className="alert alert-warning">
          Connected chain ID is {chainId}. Expected network is {expectedNetworkLabel} ({expectedChainId}).
        </div>
      )}

      <div className="wallet-grid">
        <div className="wallet-card">
          <h3>Balance</h3>
          <p>Current MetaMask balance available for lender-side blockchain actions.</p>
          <div className="wallet-pill">{balance ? formatEthAmount(balance) : 'Unavailable'}</div>
        </div>

        <div className="wallet-card">
          <h3>Network</h3>
          <p>The lender funding flow checks the active MetaMask network before sending transactions.</p>
          <div className="wallet-pill">{networkName || expectedNetworkLabel || 'Unknown'}</div>
        </div>

        <div className="wallet-card">
          <h3>Status</h3>
          <p>Blockchain actions are allowed only when the correct wallet and network are active.</p>
          <div className="wallet-pill">{connectionStatus}</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2>Actions</h2>
        <div className="wallet-actions">
          <button type="button" className="btn btn-primary" onClick={connectWallet} disabled={isConnecting || !hasMetaMask}>
            <FaWallet /> {account ? 'Reconnect MetaMask' : 'Connect MetaMask'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => refreshBalance().then(() => toast.success('Balance refreshed'))}
            disabled={!account}
          >
            Refresh Balance
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleLinkWallet}
            disabled={!account || isLinkingWallet || isSigning}
          >
            <FaLink /> {registeredWallet ? 'Re-link Wallet' : 'Link Wallet'}
          </button>
          {isWrongNetwork && (
            <button
              type="button"
              className="btn-secondary"
              onClick={switchNetwork}
              disabled={isSwitchingNetwork}
            >
              {isSwitchingNetwork ? 'Switching...' : 'Switch Network'}
            </button>
          )}
        </div>
        <p className="tiny-text" style={{ marginTop: '0.9rem' }}>
          Use reconnect and relink only when the lender wallet session or backend wallet binding has changed.
        </p>
      </div>

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h2>Recent Transactions</h2>
        {transactions.length === 0 ? (
          <p className="tiny-text">No recent lender transactions recorded yet.</p>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Tx Hash</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((investment) => (
                  <tr key={investment.id}>
                    <td>#{investment.loan_id}</td>
                    <td>{formatEthAmount(investment.amount)}</td>
                    <td>{investment.status}</td>
                    <td>{investment.tx_hash ? `${investment.tx_hash.slice(0, 10)}...${investment.tx_hash.slice(-8)}` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
