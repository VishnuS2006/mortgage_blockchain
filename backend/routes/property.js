import express from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';

const router = express.Router();

// POST /api/properties/upload — Record a new property
router.post('/upload', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const { name, location, price, description, imageIpfs, metadataIpfs, nftTokenId, txHash } = req.body;
    const propertyPrice = Number(price);

    if (!name || !location || !propertyPrice) {
      return res.status(400).json({ error: 'Name, location, and price are required' });
    }

    const result = await db.prepare(`
      INSERT INTO properties (borrower_id, name, location, price, description, image_ipfs, metadata_ipfs, nft_token_id, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.user.userId, name, location, propertyPrice, description || '', imageIpfs || '', metadataIpfs || '', nftTokenId || null, txHash || '');

    res.status(201).json({
      message: 'Property recorded successfully',
      property: {
        id: result.lastInsertRowid,
        name,
        location,
        price: propertyPrice,
        ipfsHash: metadataIpfs || imageIpfs || '',
        property_ipfs: metadataIpfs || imageIpfs || '',
        nftTokenId,
        txHash,
      },
    });
  } catch (err) {
    console.error('Property upload error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// GET /api/properties/my-properties — Get all properties for the logged-in borrower
router.get('/my-properties', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const properties = await db.prepare(
      `
        SELECT
          *,
          COALESCE(NULLIF(metadata_ipfs, ''), NULLIF(image_ipfs, '')) AS ipfsHash,
          COALESCE(NULLIF(metadata_ipfs, ''), NULLIF(image_ipfs, '')) AS property_ipfs
        FROM properties
        WHERE borrower_id = ?
        ORDER BY created_at DESC
      `
    ).all(req.user.userId);

    res.json({ properties });
  } catch (err) {
    console.error('Get properties error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// GET /api/properties/:id — Get a single property
router.get('/:id', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const property = await db.prepare(
      `
        SELECT
          *,
          COALESCE(NULLIF(metadata_ipfs, ''), NULLIF(image_ipfs, '')) AS ipfsHash,
          COALESCE(NULLIF(metadata_ipfs, ''), NULLIF(image_ipfs, '')) AS property_ipfs
        FROM properties
        WHERE id = ? AND borrower_id = ?
      `
    ).get(req.params.id, req.user.userId);

    if (!property) return res.status(404).json({ error: 'Property not found' });
    res.json({ property });
  } catch (err) {
    console.error('Get property error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.get('/loan/:loanId', authMiddleware, async (req, res) => {
  try {
    const loanId = Number.parseInt(req.params.loanId, 10);

    if (!Number.isInteger(loanId) || loanId <= 0) {
      return res.status(400).json({ error: 'Invalid loan ID' });
    }

    const record = await db.prepare(
      `
        SELECT
          l.id AS loanId,
          l.borrower_id,
          l.nft_id,
          COALESCE(l.contractLoanId, l.blockchain_loan_id) AS contractLoanId,
          p.id AS propertyId,
          p.name,
          p.location,
          p.price,
          p.description,
          p.image_ipfs,
          p.metadata_ipfs,
          p.nft_token_id,
          p.tx_hash,
          COALESCE(NULLIF(p.metadata_ipfs, ''), NULLIF(p.image_ipfs, '')) AS ipfsHash,
          COALESCE(NULLIF(p.metadata_ipfs, ''), NULLIF(p.image_ipfs, '')) AS property_ipfs
        FROM loans l
        LEFT JOIN properties p ON p.id = l.property_id
        WHERE l.id = ?
      `
    ).get(loanId);

    if (!record || !record.propertyId) {
      return res.status(404).json({ error: 'Property not found for this loan' });
    }

    if (req.user.role !== 'lender' && record.borrower_id !== req.user.userId) {
      return res.status(403).json({ error: 'Not authorized to view this property' });
    }

    return res.json({
      property: {
        id: record.propertyId,
        loanId: record.loanId,
        name: record.name,
        location: record.location,
        price: record.price,
        description: record.description,
        image_ipfs: record.image_ipfs,
        metadata_ipfs: record.metadata_ipfs,
        ipfsHash: record.ipfsHash,
        propertyIPFSHash: record.ipfsHash,
        property_ipfs: record.property_ipfs,
        nftTokenId: record.nft_token_id,
        txHash: record.tx_hash,
        nftId: record.nft_id,
        contractLoanId: record.contractLoanId,
      },
    });
  } catch (err) {
    console.error('Get property for loan error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
