import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import propertyRoutes from './routes/property.js';
import loanRoutes from './routes/loanRoutes.js';
import lenderRoutes from './routes/lender.js';
import investmentRoutes from './routes/investments.js';
import paymentRoutes from './routes/payment.js';
import emiRoutes from './routes/emi.js';
import payEmiRoutes from './routes/payEmi.js';
import loanStatusRoutes from './routes/loanStatus.js';
import ipfsRoutes from './routes/ipfs.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/lender', lenderRoutes);
app.use('/api/investments', investmentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/emi', emiRoutes);
app.use('/api/pay-emi', payEmiRoutes);
app.use('/api/loan-status', loanStatusRoutes);
app.use('/api/ipfs', ipfsRoutes);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(err.statusCode || 500).json({
    error: err.message || 'Internal server error',
  });
});

const server = app.listen(PORT, () => {
  console.log(`Mortgage Backend running on http://localhost:${PORT}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`Mortgage Backend already running on http://localhost:${PORT}`);
    process.exit(0);
  }

  console.error('Server startup error:', error);
  process.exit(1);
});
