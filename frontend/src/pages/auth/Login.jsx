import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { getDefaultRouteForRole } from '../../utils/routing';
import './Auth.css';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);

    try {
      const user = await login(email, password);
      toast.success('Signed in successfully');
      navigate(getDefaultRouteForRole(user.role), { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-visual">
        <div className="auth-visual-card">
          <h2>Mortgage Blockchain Platform</h2>
          <p>A decentralized mortgage workspace that combines NFT collateral, lender funding, on-chain repayments, and automated default handling.</p>
          <div className="auth-visual-list">
            <div><strong>Borrower</strong><br />Apply for a loan using a property NFT as collateral.</div>
            <div><strong>Lender</strong><br />Review, verify, approve, and fund mortgage requests.</div>
            <div><strong>Blockchain</strong><br />Secure funding, repayment, escrow, and ownership transfer.</div>
            <div><strong>Automation</strong><br />Track EMI schedules, detect defaults, and manage the loan lifecycle.</div>
          </div>
        </div>
      </div>

      <div className="auth-container">
        <div className="auth-header">
          <span className="auth-kicker">Unified Mortgage Access</span>
          <h1>Sign in to MortgageBC</h1>
          <p>Borrowers and lenders use the same login and are routed to role-specific dashboards after authentication.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Log In'}
          </button>
        </form>

        <p className="auth-footer">
          Need an account? <Link to="/signup">Create one</Link>
        </p>
      </div>
    </div>
  );
}
