import { useEffect, useMemo, useState } from 'react';
import { FaMapMarkerAlt, FaTag } from 'react-icons/fa';
import { useParams } from 'react-router-dom';
import LoadingSpinner from '../../components/LoadingSpinner';
import api from '../../utils/api';
import { ensureBlockchainReady } from '../../utils/contract';
import '../borrower/Pages.css';

function getGatewayUrl(value) {
  if (!value) {
    return '';
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  return `https://gateway.pinata.cloud/ipfs/${value.replace(/^ipfs:\/\//, '')}`;
}

function parseCoordinates(location) {
  const value = String(location || '').trim();
  if (!value) {
    return null;
  }

  const match = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  const latitude = Number.parseFloat(match[1]);
  const longitude = Number.parseFloat(match[2]);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function buildGoogleMapsEmbedUrl(location) {
  const coords = parseCoordinates(location);
  if (coords) {
    return `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}&z=15&output=embed`;
  }

  const query = encodeURIComponent(String(location || '').trim());
  if (!query) {
    return '';
  }

  return `https://www.google.com/maps?q=${query}&z=15&output=embed`;
}

export default function PropertyView() {
  const { loanId } = useParams();
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadProperty() {
      setLoading(true);
      setError('');

      try {
        await ensureBlockchainReady({ requireWallet: false, requireMortgage: false });
        const loanResponse = await api.get(`/loans/${loanId}`);
        const loan = loanResponse.data.loan || null;

        if (!active) {
          return;
        }

        let nextProperty = loan
          ? {
              id: loan.property_id || null,
              loanId: loan.id,
              name: loan.property_name || `Property for Loan #${loanId}`,
              location: loan.property_location || '',
              price: loan.property_price || '',
              description: loan.property_description || '',
              image_ipfs: loan.image_ipfs || '',
              metadata_ipfs: loan.metadata_ipfs || '',
              ipfsHash: loan.ipfsHash || loan.property_ipfs || '',
              propertyIPFSHash: loan.ipfsHash || loan.property_ipfs || '',
              property_ipfs: loan.property_ipfs || '',
              nftTokenId: loan.nft_token_id || loan.nft_id || '',
              txHash: loan.tx_hash || '',
              nftId: loan.nft_id || '',
              contractLoanId: loan.contractLoanId || loan.blockchain_loan_id || '',
            }
          : null;

        try {
          const propertyResponse = await api.get(`/properties/loan/${loanId}`);
          if (propertyResponse.data?.property) {
            nextProperty = {
              ...nextProperty,
              ...propertyResponse.data.property,
            };
          }
        } catch {
          // Fall back to the joined loan record when the dedicated property route is unavailable.
        }

        setProperty(nextProperty);
      } catch (err) {
        console.error('Load property view error:', err);
        if (!active) {
          return;
        }
        setError(err.response?.data?.error || 'Failed to load property details');
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadProperty();
    return () => {
      active = false;
    };
  }, [loanId]);

  const imageUrl = useMemo(
    () => getGatewayUrl(property?.image_ipfs || property?.metadata_ipfs || property?.ipfsHash),
    [property]
  );
  const mapUrl = useMemo(() => buildGoogleMapsEmbedUrl(property?.location), [property]);

  if (loading) {
    return <LoadingSpinner text="Loading property details..." />;
  }

  if (error) {
    return (
      <div className="page">
        <div className="empty-state">
          <h2>Property unavailable</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="page">
        <div className="empty-state">
          <h2>Property unavailable</h2>
          <p>No property metadata is linked to this loan yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Property Details</h1>
          <p>Review the collateral details, metadata, and blockchain references for this mortgage application.</p>
        </div>
      </div>

      <div className="property-view-layout">
        <div className="card property-view-card">
          {imageUrl ? (
            <img src={imageUrl} alt={property.name || 'Property'} className="property-view-image" />
          ) : (
            <div className="property-view-fallback">No property image available</div>
          )}
        </div>

        <div className="card property-view-card">
          <h2>{property.name || `Property for Loan #${loanId}`}</h2>
          <p className="property-view-description">
            {property.description || 'No description is available for this property yet.'}
          </p>

          <div className="loan-details-grid">
            <div className="detail-item">
              <span>Location</span>
              <strong><FaMapMarkerAlt /> {property.location || 'Unknown'}</strong>
            </div>
            <div className="detail-item">
              <span>Estimated Value</span>
              <strong><FaTag /> {property.price ? `${property.price} ETH` : 'Unavailable'}</strong>
            </div>
            <div className="detail-item">
              <span>NFT Token ID</span>
              <strong>{property.nftTokenId || property.nftId || 'Unavailable'}</strong>
            </div>
            <div className="detail-item">
              <span>Contract Loan ID</span>
              <strong>{property.contractLoanId || 'Pending sync'}</strong>
            </div>
          </div>

          {mapUrl ? (
            <div className="property-map-wrap">
              <h3 className="property-map-title">Property Location</h3>
              <iframe
                title={`Property location for loan ${loanId}`}
                src={mapUrl}
                className="property-map-frame"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          ) : (
            <div className="property-view-fallback property-map-empty">
              Map preview is unavailable because no valid location coordinates or map query were stored.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
