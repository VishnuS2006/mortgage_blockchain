import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../../context/WalletRuntimeContext';
import { ensureSupportedNetwork, getSigner, getPropertyNFTContract } from '../../utils/contract';
import { uploadFileToIPFS, uploadJSONToIPFS } from '../../utils/ipfsClient';
import api from '../../utils/api';
import toast from 'react-hot-toast';
import './Pages.css';

export default function UploadProperty() {
  const { account, connectWallet, isWalletMismatch } = useWallet();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: '',
    location: '',
    price: '',
    description: '',
  });
  const [imageFile, setImageFile] = useState(null);
  const [preview, setPreview] = useState(null);

  const handleImageChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      setImageFile(file);
      setPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!account) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!imageFile) {
      toast.error('Please upload a property image');
      return;
    }

    if (isWalletMismatch) {
      toast.error('The connected wallet does not match the wallet linked to this account');
      return;
    }

    setLoading(true);

    try {
      await ensureSupportedNetwork();

      setStep(1);
      toast.loading('Uploading image to IPFS...', { id: 'upload' });
      const imageResult = await uploadFileToIPFS(imageFile);

      const metadata = {
        name: form.name,
        description: form.description,
        image: imageResult.url,
        attributes: [
          { trait_type: 'Location', value: form.location },
          { trait_type: 'Price', value: `${form.price} ETH` },
        ],
      };
      const metadataResult = await uploadJSONToIPFS(metadata);
      toast.dismiss('upload');
      toast.success('Files uploaded to IPFS');

      setStep(2);
      toast.loading('Minting NFT in MetaMask...', { id: 'mint' });
      const signer = await getSigner();
      const nftContract = await getPropertyNFTContract(signer);
      const tx = typeof nftContract.mintPropertyDetailed === 'function'
        ? await nftContract.mintPropertyDetailed(
            account,
            metadataResult.url,
            form.name,
            form.location,
            BigInt(Math.round(Number(form.price || 0) * 1e18))
          )
        : await nftContract.mintProperty(account, metadataResult.url);
      const receipt = await tx.wait();

      const eventLog = receipt.logs.find((log) => {
        try {
          return nftContract.interface.parseLog(log)?.name === 'PropertyMinted';
        } catch {
          return false;
        }
      });
      const tokenId = eventLog ? nftContract.interface.parseLog(eventLog).args.tokenId.toString() : null;

      toast.dismiss('mint');
      toast.success(tokenId ? `NFT minted as token #${tokenId}` : 'NFT minted successfully');

      await api.post('/properties/upload', {
        name: form.name,
        location: form.location,
        price: parseFloat(form.price),
        description: form.description,
        imageIpfs: imageResult.url,
        metadataIpfs: metadataResult.url,
        nftTokenId: tokenId ? parseInt(tokenId, 10) : null,
        txHash: receipt.hash,
      });

      setStep(3);
      toast.success('Property uploaded successfully');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (err) {
      console.error('Upload error:', err);
      toast.dismiss('upload');
      toast.dismiss('mint');
      toast.error(err.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const steps = ['Fill Details', 'Upload to IPFS', 'Mint NFT', 'Complete'];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Upload Property</h1>
        <p>Pin property data to IPFS and mint the NFT before applying for a loan.</p>
      </div>

      <div className="progress-bar">
        {steps.map((label, index) => (
          <div
            key={label}
            className={`progress-step ${index <= step ? 'active' : ''} ${index < step ? 'done' : ''}`}
          >
            <div className="step-circle">{index < step ? 'OK' : index + 1}</div>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label>Property Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. Luxury Villa"
                required
              />
            </div>
            <div className="form-group">
              <label>Location</label>
              <input
                type="text"
                value={form.location}
                onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                placeholder="e.g. Mumbai, India"
                required
              />
            </div>
            <div className="form-group">
              <label>Price (ETH)</label>
              <input
                type="number"
                step="0.001"
                value={form.price}
                onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                placeholder="e.g. 50"
                required
              />
            </div>
            <div className="form-group full-width">
              <label>Description</label>
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="Describe the property..."
                rows={3}
              />
            </div>
            <div className="form-group full-width">
              <label>Property Image</label>
              <div className="file-upload">
                <input type="file" accept="image/*" onChange={handleImageChange} id="property-image" />
                <label htmlFor="property-image" className="file-upload-label">
                  {preview ? (
                    <img src={preview} alt="Preview" className="image-preview" />
                  ) : (
                    <div className="upload-placeholder">
                      <span>IMG</span>
                      <p>Click to upload image</p>
                    </div>
                  )}
                </label>
              </div>
            </div>
          </div>

          {!account ? (
            <button type="button" className="btn btn-primary" onClick={connectWallet}>
              Connect Wallet First
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? `Step ${step + 1}/4: ${steps[step]}...` : 'Upload and Mint NFT'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
