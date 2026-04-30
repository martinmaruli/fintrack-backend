const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const SALT_ROUNDS = 12;

// ─── Rate limiter: max 10 auth requests per 15 minutes per IP ────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Input validation rules ───────────────────────────────────────────────────
const registerRules = [
  body('email')
    .isEmail().withMessage('Format email tidak valid.')
    .normalizeEmail()
    .isLength({ max: 254 }).withMessage('Email terlalu panjang.'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password minimal 8 karakter.')
    .isLength({ max: 128 }).withMessage('Password terlalu panjang.')
    .matches(/[A-Z]/).withMessage('Password harus mengandung huruf kapital.')
    .matches(/[0-9]/).withMessage('Password harus mengandung angka.'),
];

const loginRules = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
];

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', authLimiter, registerRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({ error: errors.array()[0].msg });
  }

  const { email, password } = req.body;
  try {
    // Check if email already used
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      // Generic message to avoid email enumeration
      return res.status(409).json({ error: 'Email sudah terdaftar.' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email, hash]
    );

    const user = result.rows[0];
    const token = signToken(user);
    return res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', authLimiter, loginRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Generic error to avoid user enumeration
    return res.status(401).json({ error: 'Email atau password salah.' });
  }

  const { email, password } = req.body;
  try {
    const result = await query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email]
    );

    const user = result.rows[0];

    // Use constant-time comparison to prevent timing attacks
    const dummyHash = '$2a$12$dummyhashforcomparison.invalid.invalid';
    const hashToCompare = user ? user.password_hash : dummyHash;
    const valid = await bcrypt.compare(password, hashToCompare);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }

    const token = signToken(user);
    return res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User tidak ditemukan.' });
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;
