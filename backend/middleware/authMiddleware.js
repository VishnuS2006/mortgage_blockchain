import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'mortgage-bc-secret-key-2024';

function buildTokenPayload(user) {
  return {
    userId: user.id,
    role: user.role || 'borrower',
    walletAddress: user.wallet_address ?? null,
    email: user.email,
    name: user.name,
  };
}

function signAuthToken(user) {
  return jwt.sign(buildTokenPayload(user), JWT_SECRET, {
    expiresIn: '7d',
  });
}

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      ...decoded,
      id: decoded.userId,
      userId: decoded.userId,
      role: decoded.role || 'borrower',
      walletAddress: decoded.walletAddress ?? null,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export { buildTokenPayload, JWT_SECRET, signAuthToken };
