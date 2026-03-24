import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authMiddleware } from '../middleware/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// Setup upload directory
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/ipfs/upload-file — Upload file locally (IPFS fallback)
router.post('/upload-file', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const fileUrl = `http://localhost:${process.env.PORT || 5000}/uploads/${req.file.filename}`;
  const fakeHash = 'Qm' + Buffer.from(req.file.filename).toString('base64').slice(0, 44);
  res.json({ IpfsHash: fakeHash, url: fileUrl });
});

// POST /api/ipfs/upload-json — Upload JSON metadata locally (IPFS fallback)
router.post('/upload-json', authMiddleware, (req, res) => {
  const { metadata } = req.body;
  if (!metadata) return res.status(400).json({ error: 'No metadata provided' });
  const filename = `metadata-${Date.now()}.json`;
  fs.writeFileSync(path.join(uploadDir, filename), JSON.stringify(metadata, null, 2));
  const fileUrl = `http://localhost:${process.env.PORT || 5000}/uploads/${filename}`;
  const fakeHash = 'Qm' + Buffer.from(filename).toString('base64').slice(0, 44);
  res.json({ IpfsHash: fakeHash, url: fileUrl });
});

export default router;
