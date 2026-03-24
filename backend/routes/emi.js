import express from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { ensureEmiScheduleForLoan, getEmiSchedule } from '../services/loanLifecycle.js';

const router = express.Router();

router.get('/:loanId', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const loan = await db.prepare(`
      SELECT *
      FROM loans
      WHERE id = ? AND borrower_id = ?
    `).get(req.params.loanId, req.user.userId);

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

export default router;
