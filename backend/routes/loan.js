import express from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// POST /api/loans/apply — Record a loan application
router.post('/apply', authMiddleware, async (req, res) => {
  try {
    const { propertyId, nftId, loanAmount, interestRate, durationMonths, blockchainLoanId, txHash } = req.body;

    if (!loanAmount || !interestRate || !durationMonths) {
      return res.status(400).json({ error: 'Loan amount, interest rate, and duration are required' });
    }

    // Calculate EMI and totals
    const totalInterest = (loanAmount * interestRate * durationMonths) / (12 * 100);
    const totalPayable = loanAmount + totalInterest;
    const emiAmount = totalPayable / durationMonths;

    const result = await db.prepare(`
      INSERT INTO loans (borrower_id, property_id, nft_id, loan_amount, interest_rate, duration_months, 
                         emi_amount, total_payable, remaining_balance, blockchain_loan_id, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, propertyId || null, nftId || null,
      loanAmount, interestRate, durationMonths,
      emiAmount, totalPayable, totalPayable,
      blockchainLoanId || null, txHash || ''
    );

    res.status(201).json({
      message: 'Loan application recorded',
      loan: {
        id: result.lastInsertRowid,
        loanAmount,
        interestRate,
        durationMonths,
        emiAmount: Math.round(emiAmount * 100) / 100,
        totalPayable: Math.round(totalPayable * 100) / 100,
        status: 'Pending',
      },
    });
  } catch (err) {
    console.error('Apply loan error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// GET /api/loans/my-loans — All loans for the borrower
router.get('/my-loans', authMiddleware, async (req, res) => {
  try {
    const loans = await db.prepare(`
      SELECT l.*, p.name as property_name, p.location as property_location
      FROM loans l
      LEFT JOIN properties p ON l.property_id = p.id
      WHERE l.borrower_id = ?
      ORDER BY l.created_at DESC
    `).all(req.user.id);

    res.json({ loans });
  } catch (err) {
    console.error('Get loans error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// GET /api/loans/:id — Single loan details
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const loan = await db.prepare(`
      SELECT l.*, p.name as property_name, p.location as property_location, p.image_ipfs
      FROM loans l
      LEFT JOIN properties p ON l.property_id = p.id
      WHERE l.id = ? AND l.borrower_id = ?
    `).get(req.params.id, req.user.id);

    if (!loan) return res.status(404).json({ error: 'Loan not found' });

    // Get payment history for this loan
    const payments = await db.prepare(
      'SELECT * FROM payments WHERE loan_id = ? ORDER BY created_at DESC'
    ).all(req.params.id);

    res.json({ loan, payments });
  } catch (err) {
    console.error('Get loan error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// PUT /api/loans/:id/status — Update loan status (for blockchain sync)
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status, amountPaid, remainingBalance } = req.body;
    
    const updates = [];
    const values = [];
    
    if (status) { updates.push('status = ?'); values.push(status); }
    if (amountPaid !== undefined) { updates.push('amount_paid = ?'); values.push(amountPaid); }
    if (remainingBalance !== undefined) { updates.push('remaining_balance = ?'); values.push(remainingBalance); }
    
    if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });
    
    values.push(req.params.id, req.user.id);
    await db.prepare(`UPDATE loans SET ${updates.join(', ')} WHERE id = ? AND borrower_id = ?`).run(...values);

    res.json({ message: 'Loan updated' });
  } catch (err) {
    console.error('Update loan error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
