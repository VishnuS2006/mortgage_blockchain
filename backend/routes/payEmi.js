import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { roleMiddleware } from '../middleware/roleMiddleware.js';
import { recordLoanPayment } from './payment.js';

const router = express.Router();

router.post('/', authMiddleware, roleMiddleware('borrower'), async (req, res) => {
  try {
    const { loanId, amount, txHash } = req.body;
    const result = await recordLoanPayment(req.user.userId, loanId, amount, txHash);
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('Pay EMI route error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
