import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCallback } from 'react';
import { useWallet } from '../../context/WalletRuntimeContext';
import {
  ensureSupportedNetwork,
  getLoanStatusLabel,
  getProvider,
  getMortgageLoanContract,
} from '../../utils/contract';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import EMIDashboard from '../../components/EMIDashboard';
import LoadingSpinner from '../../components/LoadingSpinner';
import { formatEther } from 'ethers';
import { FaCheckCircle, FaClock, FaExternalLinkAlt } from 'react-icons/fa';
import './Pages.css';

function normalizePendingEmi(pendingEmi) {
  if (!pendingEmi) {
    return null;
  }

  return {
    index: Number(pendingEmi[0]),
    amount: pendingEmi[1],
    dueDate: pendingEmi[2],
    overdue: Boolean(pendingEmi[3]),
  };
}

export default function Payment() {
  const [searchParams] = useSearchParams();
  const preselectedLoanId = searchParams.get('loanId');
  const { account, connectWallet, isWalletMismatch } = useWallet();
  const [loans, setLoans] = useState([]);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [payments, setPayments] = useState([]);
  const [emiSchedule, setEmiSchedule] = useState([]);
  const [loanLifecycle, setLoanLifecycle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [txStatus, setTxStatus] = useState(null);

  const fetchLoans = useCallback(async () => {
    try {
      const res = await api.get('/loans/my-loans');
      const allLoans = res.data.loans;
      setLoans(allLoans);

      if (preselectedLoanId) {
        const loan = allLoans.find((entry) => entry.id === parseInt(preselectedLoanId, 10));
        if (loan) {
          await selectLoan(loan);
        }
      }
    } catch {
      toast.error('Failed to load loans');
    } finally {
      setLoading(false);
    }
  }, [preselectedLoanId]);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  const selectLoan = async (loan) => {
    setSelectedLoan(loan);

    try {
      const [paymentsRes, emiRes, loanStatusRes] = await Promise.all([
        api.get(`/payments/loan/${loan.id}`),
        api.get(`/emi/${loan.id}`),
        api.get('/loan-status', { params: { loanId: loan.id } }),
      ]);

      setPayments(paymentsRes.data.payments || []);
      setEmiSchedule(emiRes.data.emiSchedule || []);
      setLoanLifecycle(loanStatusRes.data.loanStatus || null);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || 'Failed to load repayment details');
    }
  };

  const refreshSelectedLoan = async () => {
    if (!selectedLoan) {
      return;
    }

    const [loanRes, paymentsRes, emiRes, loanStatusRes] = await Promise.allSettled([
      api.get(`/loans/${selectedLoan.id}`),
      api.get(`/payments/loan/${selectedLoan.id}`),
      api.get(`/emi/${selectedLoan.id}`),
      api.get('/loan-status', { params: { loanId: selectedLoan.id } }),
    ]);

    if (loanRes.status === 'fulfilled') {
      setSelectedLoan(loanRes.value.data.loan);
    }

    if (paymentsRes.status === 'fulfilled') {
      setPayments(paymentsRes.value.data.payments || []);
    }

    if (emiRes.status === 'fulfilled') {
      setEmiSchedule(emiRes.value.data.emiSchedule || []);
    }

    if (loanStatusRes.status === 'fulfilled') {
      setLoanLifecycle(loanStatusRes.value.data.loanStatus || null);
    }
  };

  const handlePayEMI = async () => {
    if (!account) {
      toast.error('Connect wallet first');
      return;
    }

    const contractLoanId = selectedLoan?.contractLoanId ?? selectedLoan?.blockchain_loan_id;
    if (!contractLoanId) {
      toast.error('This loan has no blockchain loan ID');
      return;
    }

    if (isWalletMismatch) {
      toast.error('The connected wallet does not match the wallet linked to this borrower account');
      return;
    }

    setPaying(true);
    setTxStatus('pending');

    try {
      toast.loading('Paying EMI in MetaMask...', { id: 'pay' });
      await ensureSupportedNetwork();
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const loanContract = await getMortgageLoanContract(signer);
      const onChainLoan = await loanContract.viewLoanDetails(contractLoanId);
      const onChainStatus = getLoanStatusLabel(onChainLoan.status);

      if (onChainStatus !== 'Active') {
        throw new Error(`On-chain loan is ${onChainStatus.toLowerCase()}, not active`);
      }

      const pendingEmi = normalizePendingEmi(
        await loanContract.getPendingEMI(contractLoanId)
      );

      if (!pendingEmi || pendingEmi.index < 0 || pendingEmi.amount <= 0n) {
        throw new Error('This loan has no EMI amount due');
      }

      const tx = await loanContract.payEMI(contractLoanId, pendingEmi.index, {
        value: pendingEmi.amount,
      });

      toast.dismiss('pay');
      toast.loading('Transaction pending...', { id: 'confirm' });

      const receipt = await tx.wait();
      setTxStatus('confirmed');
      toast.dismiss('confirm');
      toast.success('EMI paid successfully');

      const syncPayload = {
        loanId: selectedLoan.id,
        amount: Number(formatEther(pendingEmi.amount)),
        txHash: receipt.hash,
      };

      let syncResponse;
      try {
        syncResponse = await api.post('/emi/pay', syncPayload);
      } catch (syncErr) {
        if (syncErr.response?.status === 404) {
          syncResponse = await api.post('/pay-emi', syncPayload);
        } else {
          throw syncErr;
        }
      }

      if (syncResponse?.data?.emiSchedule) {
        setEmiSchedule(syncResponse.data.emiSchedule || []);
      }

      await fetchLoans();
      await refreshSelectedLoan();
    } catch (err) {
      console.error('Pay EMI error:', err);
      toast.dismiss('pay');
      toast.dismiss('confirm');
      toast.error(err.response?.data?.error || err.reason || err.message || 'Payment failed');
      setTxStatus(null);
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return <LoadingSpinner text="Loading payment info..." />;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>EMI Payments</h1>
        <p>Review active loans, inspect the EMI schedule, and pay instalments through MetaMask.</p>
      </div>

      <div className="payment-layout">
        <div className="card">
          <h2>Select Loan</h2>
          {loans.filter((loan) => loan.status === 'Active').length === 0 ? (
            <div className="empty-state small">
              <p>No active loans are ready for EMI payment yet.</p>
            </div>
          ) : (
            <div className="loan-list">
              {loans
                .filter((loan) => ['Pending', 'Approved', 'Active', 'Completed', 'Defaulted'].includes(loan.status))
                .map((loan) => (
                  <div
                    key={loan.id}
                    className={`loan-item ${selectedLoan?.id === loan.id ? 'selected' : ''}`}
                    onClick={() => selectLoan(loan)}
                  >
                    <div className="loan-item-header">
                      <strong>{loan.property_name || `Loan #${loan.id}`}</strong>
                      <span
                        className="status-badge"
                        style={{
                          background:
                            loan.status === 'Active'
                              ? '#10b98122'
                              : loan.status === 'Approved'
                                ? '#38bdf822'
                                : loan.status === 'Completed'
                                  ? '#818cf822'
                                  : loan.status === 'Defaulted'
                                    ? '#ef444422'
                                    : '#f59e0b22',
                          color:
                            loan.status === 'Active'
                              ? '#10b981'
                              : loan.status === 'Approved'
                                ? '#38bdf8'
                                : loan.status === 'Completed'
                                  ? '#818cf8'
                                  : loan.status === 'Defaulted'
                                    ? '#ef4444'
                                    : '#f59e0b',
                        }}
                      >
                        {loan.status}
                      </span>
                    </div>
                    <p>{loan.loan_amount} ETH - {loan.duration_months} months</p>
                  </div>
                ))}
            </div>
          )}
        </div>

        {selectedLoan && (
          <div className="card">
            <h2>Loan Details</h2>
            <div className="loan-details-grid">
              <div className="detail-item">
                <span>Loan Amount</span>
                <strong>{selectedLoan.loan_amount} ETH</strong>
              </div>
              <div className="detail-item">
                <span>Interest Rate</span>
                <strong>{selectedLoan.interest_rate}%</strong>
              </div>
              <div className="detail-item">
                <span>Duration</span>
                <strong>{selectedLoan.duration_months} months</strong>
              </div>
              <div className="detail-item">
                <span>Monthly EMI</span>
                <strong>{selectedLoan.emi_amount?.toFixed(4)} ETH</strong>
              </div>
              <div className="detail-item">
                <span>Status</span>
                <strong>{loanLifecycle?.status || selectedLoan.status}</strong>
              </div>
              <div className="detail-item highlight">
                <span>Remaining Balance</span>
                <strong style={{ color: '#f59e0b' }}>{selectedLoan.remaining_balance?.toFixed(4)} ETH</strong>
              </div>
            </div>

            {loanLifecycle && (
              <div className="card" style={{ marginBottom: '1rem' }}>
                <h2>Lifecycle Tracker</h2>
                <div className="loan-details-grid">
                  <div className="detail-item">
                    <span>Paid EMIs</span>
                    <strong>{loanLifecycle.paidEmis} / {loanLifecycle.totalEmis}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Pending EMIs</span>
                    <strong>{loanLifecycle.pendingEmis}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Verification</span>
                    <strong>{loanLifecycle.verificationStatus}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Next EMI</span>
                    <strong>
                      {loanLifecycle.nextEmi
                        ? new Date(loanLifecycle.nextEmi.due_date || loanLifecycle.nextEmi.dueDate).toLocaleDateString()
                        : 'Cleared'}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {txStatus && (
              <div className={`tx-status ${txStatus}`}>
                {txStatus === 'pending' && <><FaClock /> Transaction pending...</>}
                {txStatus === 'confirmed' && <><FaCheckCircle /> Transaction confirmed.</>}
              </div>
            )}

            {selectedLoan.status === 'Active' && (
              !account ? (
                <button className="btn btn-primary" onClick={connectWallet}>Connect Wallet</button>
              ) : (
                <button className="btn btn-primary btn-large" onClick={handlePayEMI} disabled={paying}>
                  {paying ? 'Processing...' : 'Pay Next EMI'}
                </button>
              )
            )}

            {selectedLoan.status === 'Approved' && (
              <div className="alert alert-warning">
                This loan has been approved but not funded yet. EMI payments start after lender funding completes.
              </div>
            )}

            {(loanLifecycle?.status === 'Completed' || selectedLoan.remaining_balance <= 0) && (
              <div className="alert alert-success">
                <FaCheckCircle /> This loan is fully paid and the collateral has been released back to you on-chain.
              </div>
            )}

            {loanLifecycle?.status === 'Defaulted' && (
              <div className="alert alert-warning">
                This loan is marked defaulted. The collateral is eligible to be transferred to the lender.
              </div>
            )}
          </div>
        )}
      </div>

      {selectedLoan && emiSchedule.length > 0 && (
        <div className="section">
          <EMIDashboard
            emiSchedule={emiSchedule}
            loanLifecycle={loanLifecycle}
            onPay={handlePayEMI}
            canPay={selectedLoan.status === 'Active' && Boolean(account)}
            isPaying={paying}
          />
        </div>
      )}

      {payments.length > 0 && (
        <div className="section">
          <h2>Payment History</h2>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Transaction Hash</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment, index) => (
                  <tr key={payment.id}>
                    <td>{payments.length - index}</td>
                    <td>{payment.amount} ETH</td>
                    <td>{new Date(payment.created_at).toLocaleDateString()}</td>
                    <td>
                      <span className="tx-hash" title={payment.tx_hash}>
                        {payment.tx_hash?.slice(0, 10)}...{payment.tx_hash?.slice(-8)}
                        <FaExternalLinkAlt style={{ marginLeft: '4px', fontSize: '0.7rem' }} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
