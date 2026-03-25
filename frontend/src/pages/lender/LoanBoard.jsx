import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FaCheck, FaExternalLinkAlt, FaTimes, FaWallet } from 'react-icons/fa';
import LoadingSpinner from '../../components/LoadingSpinner';
import { useAuth } from '../../context/AuthContext';
import { useWallet } from '../../context/WalletRuntimeContext';
import api from '../../utils/api';
import {
  ensureBlockchainReady,
  getLoanStatusLabel,
  getMortgageLoanContract,
  getProvider,
} from '../../utils/contract';
import {
  formatEthAmount,
  formatPercent,
  getLoanStatusMeta,
  normalizeLenderLoanStatus,
} from './lenderHelpers';
import '../borrower/Pages.css';
import './Lender.css';

function getContractLoanId(loan) {
  return loan.contractLoanId ?? loan.blockchain_loan_id ?? null;
}

function getPropertyIpfsUrl(loan) {
  const ipfsHash = loan.ipfsHash ?? loan.property_ipfs ?? loan.metadata_ipfs ?? loan.image_ipfs ?? '';
  if (!ipfsHash) {
    return '';
  }

  if (ipfsHash.startsWith('http://') || ipfsHash.startsWith('https://')) {
    return ipfsHash;
  }

  return `https://gateway.pinata.cloud/ipfs/${ipfsHash.replace(/^ipfs:\/\//, '')}`;
}

function isOnlyLenderError(error) {
  const message = String(error?.reason || error?.shortMessage || error?.message || '');
  return /only lender/i.test(message);
}

async function authorizeLenderWallet(walletAddress) {
  try {
    return await api.post('/loans/authorize-lender-wallet', { walletAddress });
  } catch (error) {
    if (error.response?.status !== 404) {
      throw error;
    }

    return api.post('/lender/authorize-lender-wallet', { walletAddress });
  }
}

const PAGE_CONFIG = {
  all: {
    title: 'Loan Management',
    description: 'Review the full lender workflow and act only where the lifecycle allows it.',
    apiStatus: '',
  },
  pending: {
    title: 'Pending Loans',
    description: 'Pending loans can be approved or rejected by an authorized lender.',
    apiStatus: 'pending',
  },
  approved: {
    title: 'Approved Loans',
    description: 'Approved loans are ready to fund. Only the approving lender can fund them.',
    apiStatus: 'approved',
  },
  funded: {
    title: 'Funded Loans',
    description: 'Funded loans have already been disbursed. Actions are disabled.',
    apiStatus: 'funded',
  },
  rejected: {
    title: 'Rejected Loans',
    description: 'Rejected loans remain visible for audit and borrower follow-up.',
    apiStatus: 'rejected',
  },
};

export default function LoanBoard({ view = 'all' }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { account, connectWallet, registeredWallet } = useWallet();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(view);
  const [activeAction, setActiveAction] = useState('');
  const [txStateByLoanId, setTxStateByLoanId] = useState({});
  const deferredSearch = useDeferredValue(search);
  const pageConfig = PAGE_CONFIG[statusFilter] || PAGE_CONFIG.all;

  const filteredLoans = useMemo(() => {
    if (statusFilter === 'funded') {
      return loans.filter((loan) => loan.status === 'Active');
    }
    return loans;
  }, [loans, statusFilter]);

  const loadLoans = useCallback(async () => {
    try {
      const params = {};
      if (pageConfig.apiStatus) {
        params.status = pageConfig.apiStatus;
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
  }, [deferredSearch, pageConfig.apiStatus]);

  useEffect(() => {
    setLoading(true);
    loadLoans();
  }, [loadLoans]);

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

    if (!user) {
      throw new Error('User session not found. Please login again.');
    }

    const userRole = String(user.role || '').trim().toLowerCase();
    if (userRole !== 'lender') {
      throw new Error('Only lender accounts can review loans');
    }

    await ensureBlockchainReady({ requireWallet: true, requireMortgage: true });
    return connectedAccount;
  };

  const runReviewAction = async (type, loan) => {
    setActiveAction(`${type}:${loan.id}`);

    try {
      let txHash = '';
      let connectedAccount = account || registeredWallet || '';

      const contractLoanId = getContractLoanId(loan);
      if (contractLoanId) {
        connectedAccount = await ensureWalletReady();
        setTxState(loan.id, type, 'signing');

        const provider = await getProvider();
        const signer = await provider.getSigner();
        const contract = await getMortgageLoanContract(signer);

        try {
          const executeReview = async () => {
            const onChainLoan = await contract.viewLoanDetails(contractLoanId);
            const onChainStatus = getLoanStatusLabel(onChainLoan.status);

            if (type === 'approve' && onChainStatus !== 'Pending') {
              throw new Error(`On-chain loan is ${onChainStatus.toLowerCase()}, not pending`);
            }

            if (type === 'reject' && !['Pending', 'Approved'].includes(onChainStatus)) {
              throw new Error(`On-chain loan is ${onChainStatus.toLowerCase()}, not reviewable`);
            }

            let gasEstimate;

            if (type === 'approve') {
              try {
                gasEstimate = await contract.approveLoan.estimateGas(contractLoanId);
              } catch (estimateErr) {
                const message = String(
                  estimateErr?.reason ||
                  estimateErr?.shortMessage ||
                  estimateErr?.message ||
                  ''
                );

                if (/property not verified/i.test(message) && typeof contract.verifyPropertyForLoan === 'function') {
                  setTxState(loan.id, 'verify', 'signing');
                  const verifyTx = await contract.verifyPropertyForLoan(contractLoanId);
                  setTxState(loan.id, 'verify', 'pending', verifyTx.hash);
                  await verifyTx.wait();
                  setTxState(loan.id, 'verify', 'confirmed', verifyTx.hash);
                  toast.success('Property verified on-chain');
                  gasEstimate = await contract.approveLoan.estimateGas(contractLoanId);
                } else {
                  throw estimateErr;
                }
              }
            } else {
              gasEstimate = await contract.rejectLoan.estimateGas(contractLoanId);
            }

            return (
              type === 'approve'
                ? contract.approveLoan(contractLoanId, { gasLimit: (gasEstimate * 120n) / 100n })
                : contract.rejectLoan(contractLoanId, { gasLimit: (gasEstimate * 120n) / 100n })
            );
          };

          let tx;
          try {
            tx = await executeReview();
          } catch (initialErr) {
            if (!isOnlyLenderError(initialErr)) {
              throw initialErr;
            }

            toast.loading('Authorizing lender wallet on-chain...', { id: `authorize:${loan.id}` });
            await authorizeLenderWallet(connectedAccount);
            toast.success('Lender wallet authorized. Retrying transaction...', { id: `authorize:${loan.id}` });
            tx = await executeReview();
          }

          txHash = tx.hash;
          setTxState(loan.id, type, 'pending', tx.hash);
          await tx.wait();
          setTxState(loan.id, type, 'confirmed', tx.hash);
        } catch (contractErr) {
          throw contractErr;
        } finally {
          toast.dismiss(`authorize:${loan.id}`);
        }
      }

      const endpoint = type === 'approve' ? `/loans/${loan.id}/approve` : `/loans/${loan.id}/reject`;
      await api.put(endpoint, {
        txHash,
        walletAddress: connectedAccount || account || registeredWallet || '',
      });
      toast.success(type === 'approve' ? 'Loan Approved' : 'Loan Rejected');
      await loadLoans();
    } catch (err) {
      console.error(`${type} loan error:`, err);
      setTxState(loan.id, type, 'failed');
      toast.error(err.response?.data?.error || err.reason || err.message || 'Transaction Failed');
    } finally {
      setActiveAction('');
    }
  };

  const handleFundLoan = async (loan) => {
    const contractLoanId = getContractLoanId(loan);
    if (!contractLoanId) {
      toast.error('This loan does not have an on-chain loan ID');
      return;
    }

    if (!loan || !loan.id) {
      toast.error('Loan data is missing or corrupted. Please reload the page.');
      return;
    }

    setActiveAction(`fund:${loan.id}`);

    try {
      // Verify loan still exists in backend before attempting fund
      try {
        await api.get(`/loans/${loan.id}`);
      } catch (verifyErr) {
        if (verifyErr.response?.status === 404) {
          toast.error('Loan not found in database. It may have been deleted or database was reset. Please refresh the page to see current loans.');
          setTxState(loan.id, 'fund', 'failed');
          await loadLoans();
          return;
        }
        throw verifyErr;
      }

      const connectedAccount = await ensureWalletReady();
      setTxState(loan.id, 'fund', 'signing');

      const provider = await getProvider();
      const signer = await provider.getSigner();
      const contract = await getMortgageLoanContract(signer);
      const executeFunding = async () => {
        const onChainLoan = await contract.viewLoanDetails(contractLoanId);
        const onChainStatus = getLoanStatusLabel(onChainLoan.status);

        if (onChainStatus !== 'Approved') {
          const hint = loan.status === 'Approved'
            ? 'Loan is approved in DB but not on-chain; run approve on-chain with an authorized lender first.'
            : 'Loan must be approved before funding.';

          toast.error(`Cannot fund loan: ${hint}`);
          setTxState(loan.id, 'fund', 'failed');
          return null;
        }

        const loanAmountValue = onChainLoan.loanAmount;
        if (!loanAmountValue || loanAmountValue.toString() === '0') {
          throw new Error('Loan amount is zero or invalid on the chain, cannot fund.');
        }

        const gasEstimate = await contract.fundLoan.estimateGas(contractLoanId, {
          value: loanAmountValue,
        });

        return contract.fundLoan(contractLoanId, {
          value: loanAmountValue,
          gasLimit: (gasEstimate * 120n) / 100n,
        });
      };

      let tx;
      try {
        tx = await executeFunding();
      } catch (initialErr) {
        if (!isOnlyLenderError(initialErr)) {
          throw initialErr;
        }

        toast.loading('Authorizing lender wallet on-chain...', { id: `authorize:${loan.id}` });
        await authorizeLenderWallet(connectedAccount);
        toast.success('Lender wallet authorized. Retrying funding...', { id: `authorize:${loan.id}` });
        tx = await executeFunding();
      }

      if (!tx) {
        return;
      }

      setTxState(loan.id, 'fund', 'pending', tx.hash);
      const receipt = await tx.wait();

      await api.post('/investments', {
        loanId: loan.id,
        txHash: receipt.hash,
        amount: Number(loan.loan_amount),
        status: 'confirmed',
        walletAddress: connectedAccount,
      });

      setTxState(loan.id, 'fund', 'confirmed', receipt.hash);
      toast.success('Funding successful');
      await loadLoans();
    } catch (err) {
      console.error('Fund loan error:', err);
      setTxState(loan.id, 'fund', 'failed');
      const errorMsg = err.response?.data?.error || err.reason || err.message || 'Transaction failed';
      console.error('Error details:', { errorMsg, err });
      toast.error(errorMsg);
    } finally {
      toast.dismiss(`authorize:${loan.id}`);
      setActiveAction('');
    }
  };

  if (loading) {
    return <LoadingSpinner text="Loading loan queue..." />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{pageConfig.title}</h1>
          <p>{pageConfig.description}</p>
        </div>
      </div>

      <div className="toolbar-row">
        <div className="toolbar-controls">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="funded">Funded</option>
            <option value="rejected">Rejected</option>
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

      {filteredLoans.length === 0 ? (
        <div className="empty-state">
          <h2>No loans match the current view</h2>
          <p>Adjust the search query or switch to another lender loan page.</p>
        </div>
      ) : (
        <div className="loan-card-grid">
          {filteredLoans.map((loan) => {
            const txState = txStateByLoanId[loan.id];
            const displayStatus = normalizeLenderLoanStatus(loan.status);
            const statusMeta = getLoanStatusMeta(displayStatus);
            const isOwnApproval = loan.reviewed_by === user?.id;
            const propertyUrl = getPropertyIpfsUrl(loan);
            const showEmiDetailsButton = ['Approved', 'Active', 'Completed', 'Defaulted'].includes(loan.status);

            return (
              <div key={loan.id} className="loan-review-card">
                <div className="toolbar-row" style={{ marginBottom: '0.75rem' }}>
                  <div>
                    <h3>Loan #{loan.id}</h3>
                    <div className="tiny-text">{loan.borrower_name} | {loan.borrower_email}</div>
                  </div>
                  <span className="status-chip" style={{ color: statusMeta.color, background: statusMeta.background }}>
                    {displayStatus}
                  </span>
                </div>

                <div className="loan-review-meta">
                  <div className="loan-meta-panel">
                    <span>Amount</span>
                    <strong>{formatEthAmount(loan.loan_amount)}</strong>
                  </div>
                  <div className="loan-meta-panel">
                    <span>Interest</span>
                    <strong>{formatPercent(loan.interest_rate)}</strong>
                  </div>
                  <div className="loan-meta-panel">
                    <span>Duration</span>
                    <strong>{loan.duration_months} months</strong>
                  </div>
                  <div className="loan-meta-panel">
                    <span>Property</span>
                    <strong>{loan.property_name || `NFT #${loan.nft_id}`}</strong>
                  </div>
                  <div className="loan-meta-panel loan-meta-wide">
                    <span>Contract Loan ID</span>
                    <strong>{getContractLoanId(loan) ?? 'Pending sync'}</strong>
                  </div>
                </div>

                <div className="tiny-text" style={{ marginBottom: '0.8rem' }}>
                  Property location: {loan.property_location || 'Not available'}
                </div>

                <div className="loan-actions">
                  {propertyUrl && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => navigate(`/property/${loan.id}`)}
                    >
                      <FaExternalLinkAlt /> View Property
                    </button>
                  )}
                  {showEmiDetailsButton && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => navigate(`/lender/loan-emi/${loan.id}`)}
                    >
                      EMI Details
                    </button>
                  )}
                  {loan.status === 'Pending' && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={activeAction === `approve:${loan.id}`}
                        onClick={() => runReviewAction('approve', loan)}
                      >
                        <FaCheck /> {activeAction === `approve:${loan.id}` ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={activeAction === `reject:${loan.id}`}
                        onClick={() => runReviewAction('reject', loan)}
                      >
                        <FaTimes /> {activeAction === `reject:${loan.id}` ? 'Rejecting...' : 'Reject'}
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
                      {activeAction === `fund:${loan.id}` ? 'Funding...' : 'Fund Loan'}
                    </button>
                  )}
                </div>

                {loan.status === 'Approved' && !isOwnApproval && (
                  <div className="tiny-text" style={{ marginTop: '0.8rem' }}>
                    Approved by another lender. Only the approving lender can fund this request through the app.
                  </div>
                )}

                {loan.status === 'Active' && (
                  <div className="tiny-text" style={{ marginTop: '0.8rem' }}>
                    Funding completed. Approval and funding actions are disabled for funded loans.
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
