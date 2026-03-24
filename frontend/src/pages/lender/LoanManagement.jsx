import { useDeferredValue, useEffect, useState } from 'react';
import { formatEther } from 'ethers';
import toast from 'react-hot-toast';
import { FaCheck, FaExternalLinkAlt, FaTimes, FaWallet } from 'react-icons/fa';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import { useWallet } from '../../context/WalletRuntimeContext';
import api from '../../utils/api';
import {
  ensureSupportedNetwork,
  getLoanStatusLabel,
  getMortgageLoanContract,
  getSigner,
} from '../../utils/contract';
import { formatEthAmount, formatPercent, getLoanStatusMeta } from './lenderHelpers';
import '../borrower/Pages.css';
import './Lender.css';

export default function LoanManagement() {
  const { user } = useAuth();
  const {
    account,
    connectWallet,
    registeredWallet,
  } = useWallet();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [activeAction, setActiveAction] = useState('');
  const [txStateByLoanId, setTxStateByLoanId] = useState({});
  const deferredSearch = useDeferredValue(search);

  const loadLoans = async () => {
    try {
      const params = {};
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }
      if (deferredSearch.trim()) {
        params.search = deferredSearch.trim();
      }

      const response = await api.get('/loans', { params });
      setLoans(response.data.loans || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load loans');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadLoans();
  }, [statusFilter, deferredSearch]);

  const setTxState = (loanId, action, state, txHash = '') => {
    setTxStateByLoanId((current) => ({
      ...current,
      [loanId]: { action, state, txHash },
    }));
  };

  const ensureWalletReady = async () => {
    let connectedAccount = account;

    if (!connectedAccount) {
      connectedAccount = await connectWallet();
    }

    if (!connectedAccount) {
      throw new Error('Connect MetaMask to continue');
    }

    if (
      registeredWallet &&
      connectedAccount &&
      registeredWallet.toLowerCase() !== connectedAccount.toLowerCase()
    ) {
      throw new Error('Connected wallet does not match your registered lender wallet');
    }

    await ensureSupportedNetwork();
    return connectedAccount;
  };

  const runReviewAction = async (type, loan) => {
    setActiveAction(`${type}:${loan.id}`);

    try {
      let txHash = '';

      if (loan.blockchain_loan_id) {
        await ensureWalletReady();
        setTxState(loan.id, type, 'signing');

        const signer = await getSigner();
        const contract = await getMortgageLoanContract(signer);
        if (!contract) {
          throw new Error('Mortgage contract not available');
        }
        const onChainLoan = await contract.viewLoanDetails(loan.blockchain_loan_id);
        const onChainStatus = getLoanStatusLabel(onChainLoan.status);

        if (type === 'approve' && onChainStatus !== 'Pending') {
          throw new Error(`On-chain loan is ${onChainStatus.toLowerCase()}, not pending`);
        }

        if (type === 'reject' && !['Pending', 'Approved'].includes(onChainStatus)) {
          throw new Error(`On-chain loan is ${onChainStatus.toLowerCase()}, not reviewable`);
        }

        const gasEstimate =
          type === 'approve'
            ? await contract.approveLoan.estimateGas(loan.blockchain_loan_id)
            : await contract.rejectLoan.estimateGas(loan.blockchain_loan_id);

        let tx;
        if (type === 'approve') {
          if (typeof contract.verifyPropertyForLoan === 'function') {
            try {
              const verifyTx = await contract.verifyPropertyForLoan(loan.blockchain_loan_id);
              await verifyTx.wait();
            } catch (verifyErr) {
              console.error('Property verification before approval failed:', verifyErr);
            }
          }

          tx = await contract.approveLoan(loan.blockchain_loan_id, {
            gasLimit: (gasEstimate * 120n) / 100n,
          });
        } else {
          tx = await contract.rejectLoan(loan.blockchain_loan_id, {
            gasLimit: (gasEstimate * 120n) / 100n,
          });
        }

        txHash = tx.hash;
        setTxState(loan.id, type, 'pending', tx.hash);
        await tx.wait();
        setTxState(loan.id, type, 'confirmed', tx.hash);
      }

      const endpoint =
        type === 'approve'
          ? `/lender/approve-loan/${loan.id}`
          : `/lender/reject-loan/${loan.id}`;

      await api.post(endpoint, { txHash });
      toast.success(type === 'approve' ? 'Loan approved' : 'Loan rejected');
      await loadLoans();
    } catch (err) {
      console.error(`${type} loan error:`, err);
      setTxState(loan.id, type, 'failed');
      toast.error(err.response?.data?.error || err.reason || err.message || `Failed to ${type} loan`);
    } finally {
      setActiveAction('');
    }
  };

  const handleFundLoan = async (loan) => {
    if (!loan.blockchain_loan_id) {
      toast.error('This loan does not have an on-chain loan ID');
      return;
    }

    setActiveAction(`fund:${loan.id}`);

    try {
      const connectedAccount = await ensureWalletReady();
      setTxState(loan.id, 'fund', 'signing');

      const signer = await getSigner();
      const contract = await getMortgageLoanContract(signer);
      const onChainLoan = await contract.viewLoanDetails(loan.blockchain_loan_id);
      const onChainStatus = getLoanStatusLabel(onChainLoan.status);

      if (onChainStatus !== 'Approved') {
        throw new Error(`On-chain loan is ${onChainStatus.toLowerCase()}, not approved`);
      }

      const gasEstimate = await contract.fundLoan.estimateGas(loan.blockchain_loan_id, {
        value: onChainLoan.loanAmount,
      });

      const tx = await contract.fundLoan(loan.blockchain_loan_id, {
        value: onChainLoan.loanAmount,
        gasLimit: (gasEstimate * 120n) / 100n,
      });

      setTxState(loan.id, 'fund', 'pending', tx.hash);
      const receipt = await tx.wait();

      await api.post('/investments', {
        loanId: loan.id,
        txHash: receipt.hash,
        amount: Number(formatEther(onChainLoan.loanAmount)),
        status: 'confirmed',
        walletAddress: connectedAccount,
      });

      setTxState(loan.id, 'fund', 'confirmed', receipt.hash);
      toast.success('Loan funded successfully');
      await loadLoans();
    } catch (err) {
      console.error('Fund loan error:', err);
      setTxState(loan.id, 'fund', 'failed');
      toast.error(err.reason || err.message || 'Funding failed');
    } finally {
      setActiveAction('');
    }
  };

  if (loading) {
    return <LoadingSpinner text="Loading loan review queue..." />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Loan Management</h1>
          <p>Search, review, approve, reject, and fund borrower loan requests from one screen.</p>
        </div>
      </div>

      <div className="toolbar-row">
        <div className="toolbar-controls">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="active">Active</option>
          </select>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by loan ID, borrower, email, or property"
          />
        </div>
        {!account && (
          <button type="button" className="btn btn-primary" onClick={connectWallet}>
            <FaWallet /> Connect Wallet
          </button>
        )}
      </div>

      {loans.length === 0 ? (
        <div className="empty-state">
          <h2>No loans match the current filter</h2>
          <p>Adjust the status filter or search query to load a different set of applications.</p>
        </div>
      ) : (
        <div className="loan-card-grid">
          {loans.map((loan) => {
            const txState = txStateByLoanId[loan.id];
            const statusMeta = getLoanStatusMeta(loan.status);
            const isOwnApproval = loan.reviewed_by === user?.id;

            return (
              <div key={loan.id} className="loan-review-card">
                <div className="toolbar-row" style={{ marginBottom: '0.75rem' }}>
                  <div>
                    <h3>Loan #{loan.id}</h3>
                    <div className="tiny-text">{loan.borrower_name} | {loan.borrower_email}</div>
                  </div>
                  <span className="status-chip" style={{ color: statusMeta.color, background: statusMeta.background }}>
                    {loan.status}
                  </span>
                </div>

                <div className="loan-review-meta">
                  <div>
                    <span>Amount</span>
                    <strong>{formatEthAmount(loan.loan_amount)}</strong>
                  </div>
                  <div>
                    <span>Interest</span>
                    <strong>{formatPercent(loan.interest_rate)}</strong>
                  </div>
                  <div>
                    <span>Duration</span>
                    <strong>{loan.duration_months} months</strong>
                  </div>
                  <div>
                    <span>Property</span>
                    <strong>{loan.property_name || `NFT #${loan.nft_id}`}</strong>
                  </div>
                </div>

                <div className="tiny-text" style={{ marginBottom: '0.8rem' }}>
                  Property location: {loan.property_location || 'Not available'}
                </div>

                <div className="loan-actions">
                  {loan.property_ipfs && (
                    <a className="btn-ghost" href={loan.property_ipfs} target="_blank" rel="noreferrer">
                      <FaExternalLinkAlt /> View Property
                    </a>
                  )}
                  {loan.status === 'Pending' && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={activeAction === `approve:${loan.id}`}
                        onClick={() => runReviewAction('approve', loan)}
                      >
                        <FaCheck /> Approve
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={activeAction === `reject:${loan.id}`}
                        onClick={() => runReviewAction('reject', loan)}
                      >
                        <FaTimes /> Reject
                      </button>
                    </>
                  )}
                  {loan.status === 'Approved' && isOwnApproval && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={activeAction === `fund:${loan.id}`}
                      onClick={() => handleFundLoan(loan)}
                    >
                      Fund Loan
                    </button>
                  )}
                </div>

                {loan.status === 'Approved' && !isOwnApproval && (
                  <div className="tiny-text" style={{ marginTop: '0.8rem' }}>
                    Approved by another lender. Only the approving lender can fund this request through the app.
                  </div>
                )}

                {loan.rejection_reason && (
                  <div className="tiny-text" style={{ marginTop: '0.8rem' }}>
                    Rejection reason: {loan.rejection_reason}
                  </div>
                )}

                {txState?.state && (
                  <div className="tx-state">
                    {txState.state === 'signing' && `Waiting for MetaMask ${txState.action} confirmation`}
                    {txState.state === 'pending' && `${txState.action} transaction pending: ${txState.txHash.slice(0, 10)}...`}
                    {txState.state === 'confirmed' && `${txState.action} confirmed: ${txState.txHash.slice(0, 10)}...`}
                    {txState.state === 'failed' && `${txState.action} failed`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

