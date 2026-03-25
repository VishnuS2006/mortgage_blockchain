import express from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { ensureEmiScheduleForLoan, getEmiSchedule } from '../services/loanLifecycle.js';
import { recordLoanPayment } from './payment.js';

const router = express.Router();

async function getVisibleLoan(loanId, user) {
  if (user.role === 'lender') {
    return db.prepare(`
      SELECT *
      FROM loans
      WHERE id = ?
    `).get(loanId);
  }

  return db.prepare(`
    SELECT *
    FROM loans
    WHERE id = ? AND borrower_id = ?
  `).get(loanId, user.userId);
}

router.get('/:loanId', authMiddleware, async (req, res) => {
  try {
    const loan = await getVisibleLoan(req.params.loanId, req.user);

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    await ensureEmiScheduleForLoan(loan.id, loan.funded_at ? new Date(loan.funded_at) : new Date());
    const schedule = await getEmiSchedule(loan.id);

    res.json({ loanId: loan.id, emiSchedule: schedule });
  } catch (err) {
    console.error('Get EMI schedule error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.post('/pay', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const { loanId, amount, txHash } = req.body;
    const result = await recordLoanPayment(req.user.userId, loanId, amount, txHash);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('Pay EMI via /api/emi/pay error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
