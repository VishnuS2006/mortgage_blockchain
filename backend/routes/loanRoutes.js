import express from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';

const router = express.Router();

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapLoanStatusFilter(status) {
  const normalized = String(status || '').trim().toLowerCase();
  const map = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    funded: 'Active',
    active: 'Active',
    completed: 'Completed',
    defaulted: 'Defaulted',
    cancelled: 'Cancelled',
  };

  return map[normalized] || null;
}

const loanSelect = `
  SELECT
    l.*,
    COALESCE(l.contractLoanId, l.blockchain_loan_id) AS contractLoanId,
    b.name AS borrower_name,
    b.email AS borrower_email,
    b.wallet_address AS borrower_wallet_address,
    p.name AS property_name,
    p.location AS property_location,
    p.image_ipfs,
    p.metadata_ipfs,
    COALESCE(NULLIF(p.metadata_ipfs, ''), NULLIF(p.image_ipfs, '')) AS ipfsHash,
    COALESCE(p.metadata_ipfs, p.image_ipfs) AS property_ipfs,
    reviewer.name AS reviewed_by_name,
    reviewer.email AS reviewed_by_email,
    reviewer.role AS reviewed_by_role
  FROM loans l
  LEFT JOIN borrowers b ON l.borrower_id = b.id
  LEFT JOIN properties p ON l.property_id = p.id
  LEFT JOIN borrowers reviewer ON l.reviewed_by = reviewer.id
`;

async function getLoanById(loanId) {
  return db.prepare(`
    SELECT
      l.id,
      l.status,
      l.reviewed_by,
      l.lender_id,
      l.borrower_id,
      COALESCE(l.contractLoanId, l.blockchain_loan_id) AS contractLoanId
    FROM loans l
    WHERE l.id = ?
  `).get(loanId);
}

async function getLoanDetails(loanId) {
  return db.prepare(`
    ${loanSelect}
    WHERE l.id = ?
  `).get(loanId);
}

async function getRegisteredWallet(userId) {
  const lender = await db.prepare(`
    SELECT COALESCE(wallet_address, walletAddress) AS walletAddress
    FROM borrowers
    WHERE id = ?
  `).get(userId);

  return lender?.walletAddress || null;
}

router.post('/apply', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const {
      propertyId,
      nftId,
      loanAmount,
      interestRate,
      durationMonths,
      blockchainLoanId,
      contractLoanId,
      txHash,
    } = req.body;
    const requestedLoanAmount = Number(loanAmount);
    const requestedInterestRate = Number(interestRate);
    const requestedDurationMonths = Number(durationMonths);

    if (!requestedLoanAmount || !requestedInterestRate || !requestedDurationMonths) {
      return res.status(400).json({ error: 'Loan amount, interest rate, and duration are required' });
    }

    const totalInterest = (requestedLoanAmount * requestedInterestRate * requestedDurationMonths) / (12 * 100);
    const totalPayable = requestedLoanAmount + totalInterest;
    const emiAmount = totalPayable / requestedDurationMonths;

    const result = await db.prepare(`
      INSERT INTO loans (
        borrower_id,
        property_id,
        nft_id,
        loan_amount,
        interest_rate,
        duration_months,
        emi_amount,
        total_payable,
        remaining_balance,
        blockchain_loan_id,
        contractLoanId,
        tx_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.userId,
      propertyId || null,
      nftId || null,
      requestedLoanAmount,
      requestedInterestRate,
      requestedDurationMonths,
      emiAmount,
      totalPayable,
      totalPayable,
      contractLoanId || blockchainLoanId || null,
      contractLoanId || blockchainLoanId || null,
      txHash || ''
    );

    res.status(201).json({
      message: 'Loan application recorded',
      loan: {
        id: result.lastInsertRowid,
        loanAmount: requestedLoanAmount,
        interestRate: requestedInterestRate,
        durationMonths: requestedDurationMonths,
        emiAmount: Math.round(emiAmount * 100) / 100,
        totalPayable: Math.round(totalPayable * 100) / 100,
        status: 'Pending',
        contractLoanId: contractLoanId || blockchainLoanId || null,
      },
    });
  } catch (err) {
    console.error('Apply loan error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.get('/', authMiddleware, roleMiddleware('lender'), async (req, res) => {
  try {
    const filters = [];
    const values = [];

    const status = mapLoanStatusFilter(req.query.status);
    if (status) {
      filters.push('l.status = ?');
      values.push(status);
    }

    const search = String(req.query.search || '').trim();
    if (search) {
      const searchPattern = `%${search.toLowerCase()}%`;
      filters.push(`(
        CAST(l.id AS TEXT) LIKE ?
        OR LOWER(b.name) LIKE ?
        OR LOWER(b.email) LIKE ?
        OR LOWER(COALESCE(p.name, '')) LIKE ?
        OR LOWER(COALESCE(p.location, '')) LIKE ?
      )`);
      values.push(`%${search}%`, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const loans = await db.prepare(`
      ${loanSelect}
      ${whereClause}
      ORDER BY l.created_at DESC
    `).all(...values);

    res.json({ loans });
  } catch (err) {
    console.error('Get lender loans error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.get('/my-loans', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const loans = await db.prepare(`
      ${loanSelect}
      WHERE l.borrower_id = ?
      ORDER BY l.created_at DESC
    `).all(req.user.userId);

    res.json({ loans });
  } catch (err) {
    console.error('Get borrower loans error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const loanId = toNumber(req.params.id);
    if (!loanId) {
      return res.status(400).json({ error: 'Loan ID must be numeric' });
    }

    let loan;
    if (req.user.role === 'lender') {
      loan = await db.prepare(`
        ${loanSelect}
        WHERE l.id = ?
      `).get(loanId);
    } else {
      loan = await db.prepare(`
        ${loanSelect}
        WHERE l.id = ? AND l.borrower_id = ?
      `).get(loanId, req.user.userId);
    }

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    const payments = await db.prepare(`
      SELECT *
      FROM payments
      WHERE loan_id = ?
      ORDER BY created_at DESC
    `).all(loanId);

    res.json({ loan, payments });
  } catch (err) {
    console.error('Get loan error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.put('/:id/status', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const loanId = toNumber(req.params.id);
    const requestedStatus = String(req.body.status || '').trim();

    if (!loanId) {
      return res.status(400).json({ error: 'Loan ID must be numeric' });
    }

    if (requestedStatus !== 'Cancelled') {
      return res.status(400).json({
        error: 'Borrowers can only mark a loan as cancelled after reclaiming collateral',
      });
    }

    const existingLoan = await db.prepare(`
      SELECT id, status
      FROM loans
      WHERE id = ? AND borrower_id = ?
    `).get(loanId, req.user.userId);

    if (!existingLoan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (!['Pending', 'Rejected'].includes(existingLoan.status)) {
      return res.status(409).json({
        error: `Loan cannot be cancelled while ${existingLoan.status.toLowerCase()}`,
      });
    }

    await db.prepare(`
      UPDATE loans
      SET status = 'Cancelled',
          remaining_balance = 0
      WHERE id = ? AND borrower_id = ?
    `).run(loanId, req.user.userId);

    const loan = await db.prepare(`
      ${loanSelect}
      WHERE l.id = ? AND l.borrower_id = ?
    `).get(loanId, req.user.userId);

    res.json({ message: 'Loan cancelled', loan });
  } catch (err) {
    console.error('Update loan error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.delete('/:id', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const loanId = toNumber(req.params.id);
    if (!loanId) {
      return res.status(400).json({ error: 'Loan ID must be numeric' });
    }

    const existingLoan = await db.prepare(`
      SELECT id, status, borrower_id, blockchain_loan_id
      , COALESCE(contractLoanId, blockchain_loan_id) AS contractLoanId
      FROM loans
      WHERE id = ? AND borrower_id = ?
    `).get(loanId, req.user.userId);

    if (!existingLoan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (existingLoan.status !== 'Pending') {
      return res.status(409).json({ error: 'Only pending loans can be deleted' });
    }

    await db.prepare(`
      DELETE FROM loans
      WHERE id = ? AND borrower_id = ?
    `).run(loanId, req.user.userId);

    res.json({
      message: 'Loan deleted',
      loan: {
        id: loanId,
        contractLoanId: existingLoan.contractLoanId,
      },
    });
  } catch (err) {
    console.error('Delete loan error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.put('/:id/approve', authMiddleware, roleMiddleware('lender'), async (req, res) => {
  try {
    const loanId = toNumber(req.params.id);
    if (!loanId) {
      return res.status(400).json({ error: 'Loan ID must be numeric' });
    }

    if (req.user.role !== 'lender') {
      return res.status(403).json({ error: 'Only lenders can approve loans' });
    }

    const registeredWallet = await getRegisteredWallet(req.user.userId);
    const activeWallet = String(req.body.walletAddress || req.user.walletAddress || '').trim() || null;
    if (registeredWallet && activeWallet && registeredWallet.toLowerCase() !== activeWallet.toLowerCase()) {
      return res.status(403).json({ error: 'Only the registered lender wallet can approve this loan' });
    }

    const loan = await getLoanById(loanId);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (['Active', 'Completed', 'Defaulted', 'Cancelled'].includes(loan.status)) {
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
    res.json({ message: 'Loan approved successfully', loan: updatedLoan });
  } catch (err) {
    console.error('Approve loan sync error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.put('/:id/reject', authMiddleware, roleMiddleware('lender'), async (req, res) => {
  try {
    const loanId = toNumber(req.params.id);
    const rejectionReason = String(req.body.reason || req.body.rejectionReason || '').trim();

    if (!loanId) {
      return res.status(400).json({ error: 'Loan ID must be numeric' });
    }

    if (req.user.role !== 'lender') {
      return res.status(403).json({ error: 'Only lenders can reject loans' });
    }

    const registeredWallet = await getRegisteredWallet(req.user.userId);
    const activeWallet = String(req.body.walletAddress || req.user.walletAddress || '').trim() || null;
    if (registeredWallet && activeWallet && registeredWallet.toLowerCase() !== activeWallet.toLowerCase()) {
      return res.status(403).json({ error: 'Only the registered lender wallet can reject this loan' });
    }

    const loan = await getLoanById(loanId);
    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (!['Pending', 'Approved', 'Rejected'].includes(loan.status)) {
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
    res.json({ message: 'Loan rejected successfully', loan: updatedLoan });
  } catch (err) {
    console.error('Reject loan sync error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
