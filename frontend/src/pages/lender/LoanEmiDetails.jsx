import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import EMIDashboard from '../../components/EMIDashboard';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../utils/api';
import '../borrower/Pages.css';
import './Lender.css';

function toDateValue(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildFallbackEmiSchedule(loan, loanStatus) {
  const totalEmis = Number(loanStatus?.totalEmis || loan?.duration_months || 0);
  const emiAmount = Number(loan?.emi_amount || 0);
  const paidEmis = Number(loanStatus?.paidEmis || 0);
  const startDate = toDateValue(loan?.funded_at) || toDateValue(loan?.created_at) || new Date();
  const now = Date.now();

  if (!totalEmis || !emiAmount) {
    return [];
  }

  return Array.from({ length: totalEmis }, (_, index) => {
    const dueDate = new Date(startDate.getTime() + (30 * 24 * 60 * 60 * 1000 * (index + 1)));
    const isPaid = index < paidEmis;
    const status = isPaid ? 'paid' : dueDate.getTime() < now ? 'overdue' : 'pending';

    return {
      id: `fallback-${loan?.id || 'loan'}-${index}`,
      emi_index: index,
      amount: emiAmount,
      due_date: dueDate.toISOString(),
      paid: isPaid ? 1 : 0,
      paid_at: isPaid ? dueDate.toISOString() : null,
      status,
    };
  });
}

export default function LoanEmiDetails() {
  const { loanId } = useParams();
  const [loan, setLoan] = useState(null);
  const [loanStatus, setLoanStatus] = useState(null);
  const [emiSchedule, setEmiSchedule] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadDetails() {
      setLoading(true);

      try {
        const [loanResponse, statusResponse, emiResponse] = await Promise.allSettled([
          api.get(`/loans/${loanId}`),
          api.get('/loan-status', { params: { loanId } }),
          api.get(`/emi/${loanId}`),
        ]);

        if (!active) {
          return;
        }

        if (loanResponse.status !== 'fulfilled') {
          throw loanResponse.reason;
        }

        const nextLoan = loanResponse.value.data.loan || null;
        if (!nextLoan || !['Approved', 'Active', 'Completed', 'Defaulted'].includes(nextLoan.status)) {
          setLoan(null);
          setLoanStatus(null);
          setEmiSchedule([]);
          return;
        }

        setLoan(nextLoan);
        setLoanStatus(
          statusResponse.status === 'fulfilled'
            ? (statusResponse.value.data.loanStatus || null)
            : null
        );
        setEmiSchedule(
          emiResponse.status === 'fulfilled'
            ? (emiResponse.value.data.emiSchedule || [])
            : []
        );
      } catch (err) {
        console.error('Load lender EMI details error:', err);
        toast.error(err.response?.data?.error || 'Failed to load EMI details');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadDetails();
    return () => {
      active = false;
    };
  }, [loanId]);

  if (loading) {
    return <LoadingSpinner text="Loading EMI details..." />;
  }

  if (!loan) {
    return (
      <div className="page">
        <div className="empty-state">
          <h2>EMI details unavailable</h2>
          <p>This page is available only for approved lifecycle loans.</p>
          <Link to="/lender/manage-loans" className="btn btn-primary">Back to Manage Loans</Link>
        </div>
      </div>
    );
  }

  const displaySchedule = emiSchedule.length > 0
    ? emiSchedule
    : buildFallbackEmiSchedule(loan, loanStatus);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>EMI Tracking Dashboard</h1>
          <p>Review the full EMI schedule and upcoming due dates for this approved loan.</p>
        </div>
        <Link to="/lender/manage-loans" className="btn btn-secondary">Back</Link>
      </div>

      <EMIDashboard
        emiSchedule={displaySchedule}
        loanLifecycle={loanStatus}
        canPay={false}
      />
    </div>
  );
}
