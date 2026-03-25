import express from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { ensureEmiScheduleForLoan, getEmiSchedule, markNextEmiPaid } from '../services/loanLifecycle.js';

const router = express.Router();

async function recordLoanPayment(userId, loanId, amount, txHash) {
  const paymentAmount = Number(amount);
  if (!loanId || !paymentAmount || !txHash) {
    return { status: 400, body: { error: 'Loan ID, amount, and transaction hash are required' } };
  }

  const loan = await db.prepare(`
    SELECT *
    FROM loans
    WHERE id = ? AND borrower_id = ?
  `).get(loanId, userId);

  if (!loan) {
    return { status: 404, body: { error: 'Loan not found' } };
  }

  await ensureEmiScheduleForLoan(loanId, loan.funded_at ? new Date(loan.funded_at) : new Date());

  const result = await db.prepare(
    'INSERT INTO payments (loan_id, amount, tx_hash) VALUES (?, ?, ?)'
  ).run(loanId, paymentAmount, txHash);

  const paidEmi = await markNextEmiPaid(loanId, txHash, new Date());
  const newAmountPaid = Number(loan.amount_paid || 0) + paymentAmount;
  const newRemaining = Number(loan.total_payable || 0) - newAmountPaid;
  const newStatus = newRemaining <= 0 ? 'Completed' : 'Active';

  await db.prepare(`
    UPDATE loans
    SET amount_paid = ?,
        remaining_balance = ?,
        status = ?,
        last_payment_at = CURRENT_TIMESTAMP,
        completed_at = CASE WHEN ? = 'Completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
        defaulted_at = CASE WHEN ? = 'Defaulted' THEN CURRENT_TIMESTAMP ELSE defaulted_at END
    WHERE id = ?
  `).run(
    newAmountPaid,
    Math.max(0, newRemaining),
    newStatus,
    newStatus,
    newStatus,
    loanId
  );

  const schedule = await getEmiSchedule(loanId);

  return {
    status: 201,
    body: {
      message: 'Payment recorded',
      payment: {
        id: result.lastInsertRowid,
        loanId,
        amount: paymentAmount,
        txHash,
        amountPaid: newAmountPaid,
        remainingBalance: Math.max(0, newRemaining),
        loanStatus: newStatus,
        emi: paidEmi,
      },
      emiSchedule: schedule,
    },
  };
}

router.post('/record', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const { loanId, amount, txHash } = req.body;
    const result = await recordLoanPayment(req.user.userId, loanId, amount, txHash);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('Record payment error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.get('/loan/:loanId', authMiddleware, async (req, res) => {
  try {
    const loanId = Number(req.params.loanId);
    if (!loanId) {
      return res.status(400).json({ error: 'Loan ID must be numeric' });
    }

    const loan = req.user.role === 'lender'
      ? await db.prepare(`
          SELECT id
          FROM loans
          WHERE id = ?
        `).get(loanId)
      : await db.prepare(`
          SELECT id
          FROM loans
          WHERE id = ? AND borrower_id = ?
        `).get(loanId, req.user.userId);

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    const payments = await db.prepare(
      'SELECT * FROM payments WHERE loan_id = ? ORDER BY created_at DESC'
    ).all(loanId);

    res.json({ payments });
  } catch (err) {
    console.error('Get payments error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export { recordLoanPayment };
export default router;
