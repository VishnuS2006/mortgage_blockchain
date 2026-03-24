import { useState } from 'react';
import './EMICalculator.css';

export default function EMICalculator() {
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [months, setMonths] = useState('');

  const calculate = () => {
    const p = parseFloat(principal);
    const r = parseFloat(rate);
    const m = parseInt(months);
    if (!p || !r || !m) return null;

    const totalInterest = (p * r * m) / (12 * 100);
    const total = p + totalInterest;
    const emi = total / m;

    return { emi, total, totalInterest };
  };

  const result = calculate();

  return (
    <div className="emi-calculator">
      <h3>📊 EMI Calculator</h3>
      <div className="emi-inputs">
        <div className="emi-field">
          <label>Loan Amount (ETH)</label>
          <input type="number" value={principal} onChange={(e) => setPrincipal(e.target.value)} placeholder="e.g. 10" />
        </div>
        <div className="emi-field">
          <label>Interest Rate (%)</label>
          <input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 10" />
        </div>
        <div className="emi-field">
          <label>Duration (months)</label>
          <input type="number" value={months} onChange={(e) => setMonths(e.target.value)} placeholder="e.g. 12" />
        </div>
      </div>
      {result && (
        <div className="emi-results">
          <div className="emi-result-item">
            <span>Monthly EMI</span>
            <strong>{result.emi.toFixed(4)} ETH</strong>
          </div>
          <div className="emi-result-item">
            <span>Total Interest</span>
            <strong>{result.totalInterest.toFixed(4)} ETH</strong>
          </div>
          <div className="emi-result-item highlight">
            <span>Total Payable</span>
            <strong>{result.total.toFixed(4)} ETH</strong>
          </div>
        </div>
      )}
    </div>
  );
}
