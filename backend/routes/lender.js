import express from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';

const router = express.Router();

const reviewableStatuses = new Set(['Pending', 'Approved', 'Rejected']);
const immutableStatuses = new Set(['Active', 'Completed', 'Defaulted', 'Cancelled']);

const loanWithRelationsSelect = `
  SELECT
    l.*,
    COALESCE(l.contractLoanId, l.blockchain_loan_id) AS contractLoanId,
    b.name AS borrower_name,
    b.email AS borrower_email,
    p.name AS property_name,
    p.location AS property_location,
    COALESCE(NULLIF(p.metadata_ipfs, ''), NULLIF(p.image_ipfs, '')) AS ipfsHash,
    COALESCE(p.metadata_ipfs, p.image_ipfs) AS property_ipfs
  FROM loans l
  LEFT JOIN borrowers b ON l.borrower_id = b.id
  LEFT JOIN properties p ON l.property_id = p.id
  WHERE l.id = ?
`;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function getLoanById(loanId) {
  return db.prepare(`
    SELECT id, status, reviewed_by, lender_id, borrower_id
    FROM loans
    WHERE id = ?
  `).get(loanId);
}

async function getLoanDetails(loanId) {
  return db.prepare(loanWithRelationsSelect).get(loanId);
}

router.post('/approve-loan/:id', authMiddleware, roleMiddleware('lender'), async (req, res) => {
  try {
    const loanId = toNumber(req.params.id);
    if (!loanId) {
      return res.status(400).json({ error: 'Loan ID must be numeric' });
    }

    const loan = await getLoanById(loanId);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (immutableStatuses.has(loan.status)) {
      return res.status(409).json({ error: `Loan cannot be approved while ${loan.status.toLowerCase()}` });
    }

    if (loan.status === 'Approved' && loan.reviewed_by && loan.reviewed_by !== req.user.userId) {
      return res.status(409).json({ error: 'Loan has already been approved by another lender' });
    }

    await db.prepare(`
      UPDATE loans
      SET status = 'Approved',
          reviewed_by = ?,
          lender_id = NULL,
          reviewed_at = CURRENT_TIMESTAMP,
          approved_at = CURRENT_TIMESTAMP,
          verification_status = 'verified',
          rejected_at = NULL,
          rejection_reason = NULL
      WHERE id = ?
    `).run(req.user.userId, loanId);

    const updatedLoan = await getLoanDetails(loanId);

    res.json({
      message: 'Loan approved successfully',
      loan: updatedLoan,
    });
  } catch (err) {
    console.error('Approve loan error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.post('/reject-loan/:id', authMiddleware, roleMiddleware('lender'), async (req, res) => {
  try {
    const loanId = toNumber(req.params.id);
    const rejectionReason = String(req.body.reason || req.body.rejectionReason || '').trim();

    if (!loanId) {
      return res.status(400).json({ error: 'Loan ID must be numeric' });
    }

    const loan = await getLoanById(loanId);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (!reviewableStatuses.has(loan.status) || immutableStatuses.has(loan.status)) {
      return res.status(409).json({ error: `Loan cannot be rejected while ${loan.status.toLowerCase()}` });
    }

    if (loan.status === 'Approved' && loan.reviewed_by && loan.reviewed_by !== req.user.userId) {
      return res.status(409).json({ error: 'Loan has already been approved by another lender' });
    }

    await db.prepare(`
      UPDATE loans
      SET status = 'Rejected',
          reviewed_by = ?,
          lender_id = NULL,
          reviewed_at = CURRENT_TIMESTAMP,
          verification_status = COALESCE(NULLIF(verification_status, ''), 'verified'),
          approved_at = NULL,
          rejected_at = CURRENT_TIMESTAMP,
          rejection_reason = ?
      WHERE id = ?
    `).run(req.user.userId, rejectionReason || null, loanId);

    const updatedLoan = await getLoanDetails(loanId);

    res.json({
      message: 'Loan rejected successfully',
      loan: updatedLoan,
    });
  } catch (err) {
    console.error('Reject loan error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
