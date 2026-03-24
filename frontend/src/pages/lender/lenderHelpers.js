import { formatEther } from 'ethers';

export function toDisplayEth(value, digits = 4) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return '0.00 mETH';
  }

  if (number > 0 && number < 0.01) {
    return `${(number * 1000).toFixed(2)} mETH`;
  }

  return `${number.toFixed(digits)} ETH`;
}

export function formatEthAmount(value, digits = 4) {
  return toDisplayEth(value, digits);
}

export function formatWeiAmount(value, digits = 4) {
  try {
    return toDisplayEth(parseFloat(formatEther(value)), digits);
  } catch {
    return '0.00 mETH';
  }
}

export function formatPercent(value, digits = 2) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return '0%';
  }

  return `${number.toFixed(digits)}%`;
}

export function shortHash(value) {
  if (!value) {
    return '-';
  }

  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function getLoanStatusMeta(status) {
  const map = {
    Pending: { color: '#f59e0b', background: 'rgba(245, 158, 11, 0.12)' },
    Approved: { color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)' },
    Rejected: { color: '#ef4444', background: 'rgba(239, 68, 68, 0.12)' },
    Funded: { color: '#10b981', background: 'rgba(16, 185, 129, 0.12)' },
    Active: { color: '#10b981', background: 'rgba(16, 185, 129, 0.12)' },
    Completed: { color: '#a78bfa', background: 'rgba(167, 139, 250, 0.12)' },
    Defaulted: { color: '#f97316', background: 'rgba(249, 115, 22, 0.12)' },
    Cancelled: { color: '#94a3b8', background: 'rgba(148, 163, 184, 0.12)' },
  };

  return map[status] || { color: '#94a3b8', background: 'rgba(148, 163, 184, 0.12)' };
}

export function normalizeLenderLoanStatus(status) {
  return status === 'Active' ? 'Funded' : status;
}
