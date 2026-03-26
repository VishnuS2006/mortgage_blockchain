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
  const [lockedProperties, setLockedProperties] = useState([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [form, setForm] = useState({
    propertyId: '',
    nftId: '',
    loanAmount: '',
    interestRate: '',
    durationMonths: '',
  });

  useEffect(() => {
    let cancelled = false;

    const loadEligibleProperties = async () => {
      setPropertiesLoading(true);

      try {
        const [propertyRes, loansRes] = await Promise.all([
          api.get('/properties/my-properties'),
          api.get('/loans/my-loans'),
        ]);
        const dbProperties = propertyRes.data.properties.filter((property) => property.nft_token_id);
        const borrowerLoans = loansRes.data.loans || [];
        const latestLoanByNftId = new Map();
        const visibleLockedStatuses = new Set(['Pending', 'Rejected']);

        borrowerLoans.forEach((loan) => {
          if (!loan.nft_id) {
            return;
          }

          const existing = latestLoanByNftId.get(Number(loan.nft_id));
          if (!existing || Number(loan.id) > Number(existing.id)) {
            latestLoanByNftId.set(Number(loan.nft_id), loan);
          }
        });

        if (!account) {
          if (!cancelled) {
            setProperties(dbProperties);
            setLockedProperties([]);
          }
          return;
        }

        await ensureSupportedNetwork();
        const provider = await getProvider();
        const nftContract = await getPropertyNFTContract(provider);
        const addresses = getContractAddresses();
        const escrowAddress = String(addresses?.propertyEscrow || '').toLowerCase();

        const ownedProperties = [];
        const escrowLockedProperties = [];

        await Promise.all(
          dbProperties.map(async (property) => {
            try {
              const owner = await nftContract.ownerOf(property.nft_token_id);
              const normalizedOwner = owner.toLowerCase();

              if (normalizedOwner === account.toLowerCase()) {
                ownedProperties.push(property);
                return;
              }

              if (escrowAddress && normalizedOwner === escrowAddress) {
                const relatedLoan = latestLoanByNftId.get(Number(property.nft_token_id));
                if (!relatedLoan || visibleLockedStatuses.has(relatedLoan.status)) {
                  escrowLockedProperties.push({
                    ...property,
                    loanStatus: relatedLoan?.status || 'Locked',
                    loanId: relatedLoan?.id || null,
                  });
                }
              }
            } catch {
              // Ignore NFTs that cannot be resolved from the configured contract.
            }
          })
        );

        if (!cancelled) {
          setProperties(ownedProperties);
          setLockedProperties(escrowLockedProperties);

          if (dbProperties.length > 0 && ownedProperties.length === 0 && escrowLockedProperties.length === 0) {
            toast.error('No eligible property NFTs were found in the connected wallet');
          }
        }
      } catch (err) {
        console.error('Load eligible properties error:', err);
        if (!cancelled) {
          setProperties([]);
          setLockedProperties([]);
          toast.error('Failed to load eligible property NFTs');
        }
      } finally {
        if (!cancelled) {
          setPropertiesLoading(false);
        }
      }
    };

    loadEligibleProperties();

    return () => {
      cancelled = true;
    };
  }, [account]);

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

      const provider = await getProvider();
      const signer = await provider.getSigner();
      const nftContract = await getPropertyNFTContract(signer);
      const addresses = getContractAddresses();
      const escrowAddress = addresses?.propertyEscrow;
      const nftId = BigInt(form.nftId);

      if (!escrowAddress) {
        throw new Error('PropertyEscrow contract is not configured');
      }

      const owner = await nftContract.ownerOf(nftId);
      if (owner.toLowerCase() !== account.toLowerCase()) {
        throw new Error('The connected wallet does not own this property NFT');
      }

      const approvedAddress = await nftContract.getApproved(nftId);
      const isOperatorApproved = await nftContract.isApprovedForAll(account, escrowAddress);

      if (approvedAddress.toLowerCase() !== escrowAddress.toLowerCase() && !isOperatorApproved) {
        toast.loading('Approving NFT transfer in MetaMask...', { id: 'approve' });
        const approveTx = await nftContract.approve(escrowAddress, nftId);
        await approveTx.wait();
        toast.dismiss('approve');
        toast.success('NFT transfer approved');
      }

      toast.loading('Submitting loan application in MetaMask...', { id: 'apply' });
      const loanContract = await getMortgageLoanContract(signer);
      const loanAmountWei = parseEther(form.loanAmount);
      const interestBps = Math.round(parseFloat(form.interestRate) * 100);

      await loanContract.applyLoan.staticCall(
        addresses.propertyNFT,
        nftId,
        loanAmountWei,
        interestBps,
        parseInt(form.durationMonths, 10)
      );

      const tx = await loanContract.applyLoan(
        addresses.propertyNFT,
        nftId,
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
              <select value={form.propertyId} onChange={handlePropertySelect} required disabled={propertiesLoading}>
                <option value="">-- Select a property --</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name} - NFT #{property.nft_token_id} ({property.price} ETH)
                  </option>
                ))}
              </select>
              {!propertiesLoading && properties.length === 0 && (
                <small>
                  {lockedProperties.length > 0
                    ? 'Your property NFTs are currently locked in escrow for existing loans.'
                    : 'No property NFTs owned by the connected wallet are available for collateral.'}
                </small>
              )}
              {!propertiesLoading && lockedProperties.length > 0 && (
                <div className="locked-property-notices">
                  <ul className="locked-property-list">
                    {lockedProperties
                      .slice()
                      .sort((left, right) => Number(left.nft_token_id) - Number(right.nft_token_id))
                      .map((property) => (
                        <li key={property.id} className="locked-property-item">
                          <div className="locked-property-main">
                            <strong>NFT #{property.nft_token_id}</strong>
                            <span>{property.name}</span>
                          </div>
                          <div className="locked-property-meta">
                            <span className="status-badge locked-loan-badge">{property.loanStatus}</span>
                            {property.loanId ? <span>Loan #{property.loanId}</span> : null}
                          </div>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
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
