import express from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { ensureEmiScheduleForLoan } from '../services/loanLifecycle.js';

const router = express.Router();

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeInvestmentStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  const map = {
    pending: 'pending',
    confirmed: 'confirmed',
    failed: 'failed',
  };

  return map[normalized] || null;
}

const investmentSelect = `
  SELECT
    i.*,
    l.status AS loan_status,
    l.loan_amount,
    l.interest_rate,
    COALESCE(l.contractLoanId, l.blockchain_loan_id) AS blockchain_loan_id,
    COALESCE(l.contractLoanId, l.blockchain_loan_id) AS contractLoanId,
    b.name AS borrower_name,
    p.name AS property_name,
    p.location AS property_location,
    COALESCE(NULLIF(p.metadata_ipfs, ''), NULLIF(p.image_ipfs, '')) AS ipfsHash,
    COALESCE(p.metadata_ipfs, p.image_ipfs) AS property_ipfs
  FROM investments i
  INNER JOIN loans l ON i.loan_id = l.id
  LEFT JOIN borrowers b ON l.borrower_id = b.id
  LEFT JOIN properties p ON l.property_id = p.id
`;

router.get('/', authMiddleware, roleMiddleware('lender'), async (req, res) => {
  try {
    const filters = ['i.lender_id = ?'];
    const values = [req.user.userId];

    const status = normalizeInvestmentStatus(req.query.status);
    if (status) {
      filters.push('i.status = ?');
      values.push(status);
    }

    const sort = String(req.query.sort || 'newest').trim().toLowerCase();
    const orderByMap = {
      newest: 'i.created_at DESC',
      oldest: 'i.created_at ASC',
      'highest amount': 'i.amount DESC',
      highest: 'i.amount DESC',
    };
    const orderBy = orderByMap[sort] || orderByMap.newest;

    const investments = await db.prepare(`
      ${investmentSelect}
      WHERE ${filters.join(' AND ')}
      ORDER BY ${orderBy}
    `).all(...values);

    res.json({ investments });
  } catch (err) {
    console.error('Get investments error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.post('/', authMiddleware, roleMiddleware('lender'), async (req, res) => {
  try {
    const loanId = toNumber(req.body.loanId);
    const amount = toNumber(req.body.amount);
    const txHash = String(req.body.txHash || '').trim();
    const status = normalizeInvestmentStatus(req.body.status) || 'confirmed';
    const walletAddress = String(
      req.body.walletAddress || req.body.wallet_address || req.user.walletAddress || ''
    ).trim() || null;

    if (!loanId || !amount || !txHash) {
      return res.status(400).json({ error: 'Loan ID, amount, and transaction hash are required' });
    }

    const lender = await db.prepare(`
      SELECT COALESCE(wallet_address, walletAddress) AS walletAddress
      FROM borrowers
      WHERE id = ?
    `).get(req.user.userId);

    if (
      lender?.walletAddress &&
      walletAddress &&
      lender.walletAddress.toLowerCase() !== walletAddress.toLowerCase()
    ) {
      return res.status(403).json({ error: 'Only the registered lender wallet can fund this loan' });
    }

    const loan = await db.prepare(`
      SELECT id, status, reviewed_by, lender_id, interest_rate
      FROM loans
      WHERE id = ?
    `).get(loanId);

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'Approved') {
      return res.status(409).json({ error: 'Loan must be approved before funding' });
    }

    if (loan.reviewed_by && loan.reviewed_by !== req.user.userId) {
      return res.status(403).json({ error: 'Only the approving lender can fund this loan' });
    }

    const existingInvestment = await db.prepare(`
      SELECT id
      FROM investments
      WHERE loan_id = ?
    `).get(loanId);

    if (existingInvestment) {
      return res.status(409).json({ error: 'This loan already has an investment record' });
    }

    const result = await db.prepare(`
      INSERT INTO investments (
        lender_id,
        loan_id,
        tx_hash,
        amount,
        status,
        wallet_address,
        interest_rate
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.userId,
      loanId,
      txHash,
      amount,
      status,
      walletAddress,
      loan.interest_rate
    );

    await db.prepare(`
      UPDATE loans
      SET status = 'Active',
          lender_id = ?,
          reviewed_by = COALESCE(reviewed_by, ?),
          tx_hash = ?,
          funded_at = CURRENT_TIMESTAMP,
          verification_status = COALESCE(NULLIF(verification_status, ''), 'verified')
      WHERE id = ?
    `).run(req.user.userId, req.user.userId, txHash, loanId);

    await ensureEmiScheduleForLoan(loanId, new Date());

    const investment = await db.prepare(`
      ${investmentSelect}
      WHERE i.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
      message: 'Investment recorded successfully',
      investment,
    });
  } catch (err) {
    console.error('Create investment error:', err);
    if (String(err.message || '').includes('UNIQUE constraint failed: investments.tx_hash')) {
      return res.status(409).json({ error: 'This transaction hash has already been recorded' });
    }

    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
