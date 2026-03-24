import express from 'express';
import bcrypt from 'bcrypt';
import db from '../db/database.js';
import { authMiddleware, signAuthToken } from '../middleware/authMiddleware.js';

const router = express.Router();
const VALID_ROLES = new Set(['borrower', 'lender']);

function normalizeRole(role) {
  const normalized = String(role || 'borrower').trim().toLowerCase();
  return VALID_ROLES.has(normalized) ? normalized : null;
}

function sanitizeUser(user) {
  const normalizedRole = normalizeRole(user.role) || 'borrower';

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: normalizedRole,
    walletAddress: user.wallet_address ?? null,
    wallet_address: user.wallet_address ?? null,
    createdAt: user.created_at ?? null,
    created_at: user.created_at ?? null,
  };
}

async function findUserById(id) {
  return db.prepare(`
    SELECT
      id,
      name,
      email,
      COALESCE(role, 'borrower') AS role,
      COALESCE(wallet_address, walletAddress) AS wallet_address,
      created_at
    FROM borrowers
    WHERE id = ?
  `).get(id);
}

async function handleRegister(req, res) {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = normalizeRole(req.body.role);
    const walletAddress = String(
      req.body.walletAddress || req.body.wallet_address || ''
    ).trim() || null;
    const walletSignature = String(
      req.body.walletSignature || req.body.wallet_signature || ''
    ).trim() || null;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (!role) {
      return res.status(400).json({ error: 'Role must be borrower or lender' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingUser = await db.prepare(
      'SELECT id FROM borrowers WHERE LOWER(email) = LOWER(?)'
    ).get(email);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    if (walletAddress) {
      const existingWallet = await db.prepare(
        'SELECT id FROM borrowers WHERE LOWER(COALESCE(wallet_address, walletAddress)) = LOWER(?)'
      ).get(walletAddress);

      if (existingWallet) {
        return res.status(409).json({ error: 'Wallet already linked to another account' });
      }
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await db.prepare(`
      INSERT INTO borrowers (name, email, password_hash, role, walletAddress, wallet_address, wallet_signature)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, email, passwordHash, role, walletAddress, walletAddress, walletSignature);

    const user = {
      id: result.lastInsertRowid,
      name,
      email,
      role,
      wallet_address: walletAddress,
      created_at: new Date().toISOString(),
    };

    const token = signAuthToken(user);

    res.status(201).json({
      message: 'Account created successfully',
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

router.post('/register', handleRegister);
router.post('/signup', handleRegister);

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await db.prepare(`
      SELECT
        id,
        name,
        email,
        password_hash,
        COALESCE(role, 'borrower') AS role,
        COALESCE(wallet_address, walletAddress) AS wallet_address,
        created_at
      FROM borrowers
      WHERE LOWER(email) = LOWER(?)
    `).get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signAuthToken(user);

    res.json({
      message: 'Login successful',
      token,
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.post('/link-wallet', authMiddleware, async (req, res) => {
  try {
    const walletAddress = String(
      req.body.walletAddress || req.body.wallet_address || ''
    ).trim();
    const walletSignature = String(
      req.body.walletSignature || req.body.wallet_signature || ''
    ).trim() || null;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const existingWallet = await db.prepare(`
      SELECT id
      FROM borrowers
      WHERE LOWER(COALESCE(wallet_address, walletAddress)) = LOWER(?)
        AND id != ?
    `).get(walletAddress, req.user.userId);

    if (existingWallet) {
      return res.status(409).json({ error: 'Wallet already linked to another account' });
    }

    await db.prepare(`
      UPDATE borrowers
      SET walletAddress = ?, wallet_address = ?, wallet_signature = ?
      WHERE id = ?
    `).run(walletAddress, walletAddress, walletSignature, req.user.userId);

    const user = await findUserById(req.user.userId);

    res.json({
      message: 'Wallet linked successfully',
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error('Link wallet error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

export default router;
