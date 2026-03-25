import { FaCheckCircle, FaClock, FaExclamationTriangle } from 'react-icons/fa';

function formatDate(value) {
  if (!value) {
    return 'Not scheduled';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Not scheduled';
  }

  return date.toLocaleDateString();
}

function getStatusMeta(status) {
  if (status === 'paid') {
    return { label: 'Paid', className: 'emi-status-paid', icon: <FaCheckCircle /> };
  }

  if (status === 'overdue') {
    return { label: 'Overdue', className: 'emi-status-overdue', icon: <FaExclamationTriangle /> };
  }

  return { label: 'Pending', className: 'emi-status-pending', icon: <FaClock /> };
}

export default function EMIDashboard({
  emiSchedule = [],
  loanLifecycle = null,
  onPay,
  canPay = false,
  isPaying = false,
}) {
  const paidCount = emiSchedule.filter((emi) => String(emi.status).toLowerCase() === 'paid' || Number(emi.paid) === 1).length;
  const overdueCount = emiSchedule.filter((emi) => String(emi.status).toLowerCase() === 'overdue').length;
  const totalCount = emiSchedule.length || Number(loanLifecycle?.totalEmis) || 0;
  const remainingCount = Math.max(totalCount - paidCount, 0);
  const nextEmi = emiSchedule.find((emi) => String(emi.status).toLowerCase() !== 'paid') || loanLifecycle?.nextEmi || null;

  return (
    <div className="card">
      <h2>EMI Tracking Dashboard</h2>

      {overdueCount > 0 && (
        <div className="alert alert-danger">
          <FaExclamationTriangle /> <strong>EMI payment missed.</strong> One or more instalments are overdue.
        </div>
      )}

      <div className="stats-grid emi-stats-grid">
        <div className="stat-card">
          <div>
            <span className="stat-value">{totalCount}</span>
            <span className="stat-label">Total EMIs</span>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <span className="stat-value">{paidCount}</span>
            <span className="stat-label">Paid EMIs</span>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <span className="stat-value">{remainingCount}</span>
            <span className="stat-label">Remaining EMIs</span>
          </div>
        </div>
        <div className="stat-card">
          <div>
            <span className="stat-value emi-date-value">{formatDate(nextEmi?.due_date || nextEmi?.dueDate)}</span>
            <span className="stat-label">Next Due Date</span>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>EMI Number</th>
              <th>Amount</th>
              <th>Due Date</th>
              <th>Status</th>
              <th>Paid At</th>
            </tr>
          </thead>
          <tbody>
            {emiSchedule.map((emi) => {
              const statusMeta = getStatusMeta(String(emi.status).toLowerCase());
              return (
                <tr key={emi.id}>
                  <td>{Number(emi.emi_index) + 1}</td>
                  <td>{Number(emi.amount).toFixed(4)} ETH</td>
                  <td>{formatDate(emi.due_date)}</td>
                  <td>
                    <span className={`status-badge emi-status-badge ${statusMeta.className}`}>
                      {statusMeta.icon} {statusMeta.label}
                    </span>
                  </td>
                  <td>{formatDate(emi.paid_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canPay && typeof onPay === 'function' && (
        <button type="button" className="btn btn-primary btn-large" onClick={onPay} disabled={isPaying}>
          {isPaying ? 'Processing...' : 'Pay EMI'}
        </button>
      )}
    </div>
  );
}
