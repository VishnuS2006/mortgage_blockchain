import express from 'express';
import db from '../db/database.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { getLoanStatusSummary } from '../services/loanLifecycle.js';

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const requestedLoanId = Number(req.query.loanId);

    if (requestedLoanId) {
      const summary = await getLoanStatusSummary(
        requestedLoanId,
        req.user.role === 'borrower' ? req.user.userId : null
      );

      if (!summary) {
        return res.status(404).json({ error: 'Loan not found' });
      }

      return res.json({ loanStatus: summary });
    }

    const whereClause = req.user.role === 'borrower' ? 'WHERE borrower_id = ?' : '';
    const params = req.user.role === 'borrower' ? [req.user.userId] : [];
    const loans = await db.prepare(`
      SELECT id
      FROM loans
      ${whereClause}
      ORDER BY created_at DESC
    `).all(...params);

    const summaries = [];
    for (const loan of loans) {
      const summary = await getLoanStatusSummary(
        loan.id,
        req.user.role === 'borrower' ? req.user.userId : null
      );
      if (summary) {
        summaries.push(summary);
      }
    }

    res.json({ loanStatuses: summaries });
  } catch (err) {
    console.error('Get loan status error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
