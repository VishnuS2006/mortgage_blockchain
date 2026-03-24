import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useWallet } from '../../context/WalletRuntimeContext';
import { getDefaultRouteForRole } from '../../utils/routing';
import './Auth.css';

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';
}

export default function Signup() {
  const { signup } = useAuth();
  const { account, connectWallet, isConnecting } = useWallet();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'borrower',
  });
  const [loading, setLoading] = useState(false);
  const [walletSignature, setWalletSignature] = useState('');

  const signWalletProof = async (walletAddress) => {
    if (!window.ethereum || !walletAddress) {
      return '';
    }

    const message = `MortgageBC wallet verification for ${form.email || form.name || 'user'} at ${new Date().toISOString()}`;

    try {
      return await window.ethereum.request({
        method: 'personal_sign',
        params: [message, walletAddress],
      });
    } catch {
      return '';
    }
  };

  const handleConnectWallet = async () => {
    const walletAddress = await connectWallet();
    if (!walletAddress) {
      return;
    }

    const signature = await signWalletProof(walletAddress);
    setWalletSignature(signature);
    toast.success(signature ? 'Wallet connected and signed' : 'Wallet connected');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (form.password !== form.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (form.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const user = await signup({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        walletAddress: account || undefined,
        walletSignature: walletSignature || undefined,
      });

      toast.success('Account created successfully');
      navigate(getDefaultRouteForRole(user.role), { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <span className="auth-kicker">Role-aware onboarding</span>
          <h1>Create your MortgageBC account</h1>
          <p>Select your role up front and continue into the matching workspace after authentication.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">Full Name</label>
            <input
              id="name"
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="Jane Doe"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="name@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label>Role</label>
            <div className="auth-role-grid">
              <button
                type="button"
                className={`auth-role-card ${form.role === 'borrower' ? 'active' : ''}`}
                aria-pressed={form.role === 'borrower'}
                onClick={() => setForm((current) => ({ ...current, role: 'borrower' }))}
              >
                <strong>Borrower</strong>
              </button>
              <button
                type="button"
                className={`auth-role-card ${form.role === 'lender' ? 'active' : ''}`}
                aria-pressed={form.role === 'lender'}
                onClick={() => setForm((current) => ({ ...current, role: 'lender' }))}
              >
                <strong>Lender</strong>
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="Minimum 6 characters"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              id="confirm-password"
              type="password"
              value={form.confirmPassword}
              onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))}
              placeholder="Repeat password"
              required
            />
          </div>

          <div className="wallet-panel">
            <div className="wallet-panel-header">
              <strong>MetaMask</strong>
              <button type="button" onClick={handleConnectWallet} disabled={isConnecting}>
                {isConnecting ? 'Connecting...' : account ? 'Reconnect Wallet' : 'Connect Wallet'}
              </button>
            </div>
            {account ? (
              <div className="wallet-value">{shortAddress(account)}</div>
            ) : null}
            <p className="auth-note">
              {form.role === 'lender'
                ? 'Connecting a wallet is recommended for lender funding and wallet mismatch checks. If available, a lightweight signature is captured as proof of ownership.'
                : 'Borrowers can connect now or later. The borrower workflow still supports connecting inside dashboard actions.'}
            </p>
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </div>

      <div className="auth-visual">
        <div className="auth-visual-card">
          <h2>One identity model</h2>
          <p>The user record now stores role and wallet metadata, which keeps signup, login, redirects, and protected routing in one path.</p>
          <div className="auth-visual-list">
            <div>JWT payload includes user ID, role, and wallet address.</div>
            <div>Lender wallets are reused for funding and investment audit trails.</div>
            <div>Borrower routes remain isolated from lender-only screens.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
