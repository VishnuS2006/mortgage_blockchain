import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../../context/WalletRuntimeContext';
import {
  ensureSupportedNetwork,
  getProvider,
  getPropertyNFTContract,
  getMortgageLoanContract,
  getContractAddresses,
} from '../../utils/contract';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import { parseEther } from 'ethers';
import './Pages.css';

export default function ApplyLoan() {
  const { account, connectWallet, isWalletMismatch } = useWallet();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState([]);
  const [form, setForm] = useState({
    propertyId: '',
    nftId: '',
    loanAmount: '',
    interestRate: '',
    durationMonths: '',
  });

  useEffect(() => {
    api.get('/properties/my-properties').then((res) => {
      setProperties(res.data.properties.filter((property) => property.nft_token_id));
    });
  }, []);

  const loanAmount = parseFloat(form.loanAmount) || 0;
  const rate = parseFloat(form.interestRate) || 0;
  const months = parseInt(form.durationMonths, 10) || 0;
  const totalInterest = (loanAmount * rate * months) / (12 * 100);
  const totalPayable = loanAmount + totalInterest;
  const emiAmount = months > 0 ? totalPayable / months : 0;

  const handlePropertySelect = (event) => {
    const property = properties.find((entry) => entry.id === parseInt(event.target.value, 10));
    if (property) {
      setForm((current) => ({
        ...current,
        propertyId: property.id.toString(),
        nftId: property.nft_token_id.toString(),
      }));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!account) {
      toast.error('Connect wallet first');
      return;
    }

    if (!form.nftId) {
      toast.error('Select a property with an NFT');
      return;
    }

    if (isWalletMismatch) {
      toast.error('The connected wallet does not match the wallet linked to this account');
      return;
    }

    setLoading(true);

    try {
      await ensureSupportedNetwork();

      toast.loading('Approving NFT transfer in MetaMask...', { id: 'approve' });
      const provider = await getProvider();
      const signer = await provider.getSigner();
      const nftContract = await getPropertyNFTContract(signer);
      const addresses = getContractAddresses();

      const approveTarget = addresses.propertyEscrow || addresses.mortgageCore || addresses.mortgageLoan;
      const approveTx = await nftContract.approve(approveTarget, form.nftId);
      await approveTx.wait();
      toast.dismiss('approve');
      toast.success('NFT transfer approved');

      toast.loading('Submitting loan application in MetaMask...', { id: 'apply' });
      const loanContract = await getMortgageLoanContract(signer);
      const loanAmountWei = parseEther(form.loanAmount);
      const interestBps = Math.round(parseFloat(form.interestRate) * 100);

      const tx = await loanContract.applyLoan(
        addresses.propertyNFT,
        form.nftId,
        loanAmountWei,
        interestBps,
        parseInt(form.durationMonths, 10)
      );
      const receipt = await tx.wait();

      const eventLog = receipt.logs.find((log) => {
        try {
          return loanContract.interface.parseLog(log)?.name === 'LoanApplied';
        } catch {
          return false;
        }
      });
      const contractLoanId = eventLog
        ? loanContract.interface.parseLog(eventLog).args.loanId.toString()
        : null;

      toast.dismiss('apply');

      await api.post('/loans/apply', {
        propertyId: parseInt(form.propertyId, 10),
        nftId: parseInt(form.nftId, 10),
        loanAmount: parseFloat(form.loanAmount),
        interestRate: parseFloat(form.interestRate),
        durationMonths: parseInt(form.durationMonths, 10),
        contractLoanId: contractLoanId ? parseInt(contractLoanId, 10) : null,
        txHash: receipt.hash,
      });

      toast.success('Loan application submitted');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      console.error('Apply loan error:', err);
      toast.dismiss('approve');
      toast.dismiss('apply');
      toast.error(err.reason || err.message || 'Failed to apply for loan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Apply for Loan</h1>
        <p>Use your property NFT as collateral for a mortgage request.</p>
      </div>

      <div className="apply-layout">
        <div className="card">
          <h2>Loan Application</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Select Property (NFT)</label>
              <select value={form.propertyId} onChange={handlePropertySelect} required>
                <option value="">-- Select a property --</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name} - NFT #{property.nft_token_id} ({property.price} ETH)
                  </option>
                ))}
              </select>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Loan Amount (ETH)</label>
                <input
                  type="number"
                  step="0.001"
                  value={form.loanAmount}
                  onChange={(event) => setForm((current) => ({ ...current, loanAmount: event.target.value }))}
                  placeholder="e.g. 10"
                  required
                />
              </div>
              <div className="form-group">
                <label>Interest Rate (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.interestRate}
                  onChange={(event) => setForm((current) => ({ ...current, interestRate: event.target.value }))}
                  placeholder="e.g. 10"
                  required
                />
              </div>
              <div className="form-group">
                <label>Duration (months)</label>
                <input
                  type="number"
                  value={form.durationMonths}
                  onChange={(event) => setForm((current) => ({ ...current, durationMonths: event.target.value }))}
                  placeholder="e.g. 12"
                  required
                />
              </div>
            </div>

            {!account ? (
              <button type="button" className="btn btn-primary" onClick={connectWallet}>
                Connect Wallet First
              </button>
            ) : (
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Processing...' : 'Submit Loan Application'}
              </button>
            )}
          </form>
        </div>

        {loanAmount > 0 && months > 0 && (
          <div className="card loan-preview">
            <h2>Loan Preview</h2>
            <div className="preview-grid">
              <div className="preview-item">
                <span>Principal</span>
                <strong>{loanAmount.toFixed(4)} ETH</strong>
              </div>
              <div className="preview-item">
                <span>Interest Rate</span>
                <strong>{rate}%</strong>
              </div>
              <div className="preview-item">
                <span>Duration</span>
                <strong>{months} months</strong>
              </div>
              <div className="preview-item">
                <span>Total Interest</span>
                <strong>{totalInterest.toFixed(4)} ETH</strong>
              </div>
              <div className="preview-item highlight">
                <span>Monthly EMI</span>
                <strong>{emiAmount.toFixed(4)} ETH</strong>
              </div>
              <div className="preview-item highlight">
                <span>Total Payable</span>
                <strong>{totalPayable.toFixed(4)} ETH</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
