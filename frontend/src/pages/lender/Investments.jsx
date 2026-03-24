import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FaCopy } from 'react-icons/fa';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../utils/api';
import { formatEthAmount, formatPercent, shortHash } from './lenderHelpers';
import '../borrower/Pages.css';
import './Lender.css';

export default function Investments() {
  const [loading, setLoading] = useState(true);
  const [investments, setInvestments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState('newest');

  useEffect(() => {
    const loadInvestments = async () => {
      try {
        const params = { sort };
        if (statusFilter !== 'all') {
          params.status = statusFilter;
        }

        const response = await api.get('/investments', { params });
        setInvestments(response.data.investments || []);
      } catch (err) {
        toast.error(err.response?.data?.error || 'Failed to load investments');
      } finally {
        setLoading(false);
      }
    };

    setLoading(true);
    loadInvestments();
  }, [sort, statusFilter]);

  const copyHash = async (txHash) => {
    try {
      await navigator.clipboard.writeText(txHash);
      toast.success('Transaction hash copied');
    } catch {
      toast.error('Failed to copy transaction hash');
    }
  };

  if (loading) {
    return <LoadingSpinner text="Loading investments..." />;
  }

  const totalInvested = investments
    .filter((investment) => investment.status !== 'failed')
    .reduce((total, investment) => total + Number(investment.amount || 0), 0);
  const pendingInvestments = investments.filter((investment) => investment.status === 'pending');
  const confirmedInvestments = investments.filter((investment) => investment.status === 'confirmed');
  const averageInterest = investments.length > 0
    ? investments.reduce((total, investment) => total + Number(investment.interest_rate || 0), 0) / investments.length
    : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Investments</h1>
          <p>Track confirmed lender funding, inspect transaction hashes, and review portfolio yield.</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div>
            <span className="stat-value">{formatEthAmount(totalInvested, 2)}</span>
            <span className="stat-label">Total Invested</span>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <span className="stat-value">{pendingInvestments.length}</span>
            <span className="stat-label">Pending Investments</span>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <span className="stat-value">{confirmedInvestments.length}</span>
            <span className="stat-label">Confirmed Investments</span>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <span className="stat-value">{formatPercent(averageInterest)}</span>
            <span className="stat-label">Average Interest</span>
          </div>
        </div>
      </div>

      <div className="toolbar-row">
        <div className="toolbar-controls">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="failed">Failed</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="highest">Highest amount</option>
          </select>
        </div>
      </div>

      {investments.length === 0 ? (
        <div className="empty-state">
          <h2>No investments recorded</h2>
          <p>Fund an approved loan to create the first lender investment record.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Loan</th>
                <th>Borrower</th>
                <th>Amount</th>
                <th>Interest</th>
                <th>Status</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {investments.map((investment) => (
                <tr key={investment.id}>
                  <td>#{investment.loan_id}</td>
                  <td>{investment.borrower_name}</td>
                  <td>{formatEthAmount(investment.amount)}</td>
                  <td>{formatPercent(investment.interest_rate)}</td>
                  <td>{investment.status}</td>
                  <td>
                    <div className="copy-row">
                      <span className="tx-hash">{shortHash(investment.tx_hash)}</span>
                      <button type="button" className="btn-ghost" onClick={() => copyHash(investment.tx_hash)}>
                        <FaCopy /> Copy
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
