const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendOTPEmail } = require('../services/email');
const { encryptDeterministic, decryptDeterministic } = require('../services/encryption');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Terlalu banyak percobaan. Coba lagi 15 menit lagi.' },
  standardHeaders: true, legacyHeaders: false,
});

const registerRules = [
  body('email').isEmail().withMessage('Format email tidak valid.').normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password minimal 8 karakter.')
    .matches(/[A-Z]/).withMessage('Password harus mengandung huruf kapital.')
    .matches(/[0-9]/).withMessage('Password harus mengandung angka.'),
];
const loginRules = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
];

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

function signTempToken(userId, scope) {
  return jwt.sign({ id: userId, scope }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

function verifyTempToken(token, expectedScope) {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.scope !== expectedScope) return null;
    return decoded;
  } catch (err) {
    return null;
  }
}

function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// POST /api/auth/register
router.post('/register', authLimiter, registerRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ error: errors.array()[0].msg });

  const { email, password } = req.body;
  try {
    const encryptedEmail = encryptDeterministic(email);
    const existing = await query('SELECT id FROM users WHERE email = $1', [encryptedEmail]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email sudah terdaftar.' });

    const hash = await bcrypt.hash(password, 12);
    const otpCode = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    
    // We assume the db_migrations.sql has been run
    const result = await query(
      'INSERT INTO users (email, password_hash, otp_code, otp_expires_at) VALUES ($1, $2, $3, $4) RETURNING id, email',
      [encryptedEmail, hash, otpCode, otpExpires]
    );
    const user = result.rows[0];
    if (user) user.email = decryptDeterministic(user.email);
    
    // Send email (await it so Vercel doesn't freeze the container before logging)
    await sendOTPEmail(email, otpCode).catch(err => console.error('Failed to send OTP:', err));
    
    // Return temp token for OTP verification step
    return res.status(201).json({ temp_token: signTempToken(user.id, 'otp'), message: 'OTP sent to email' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { temp_token, otp_code } = req.body;
  if (!temp_token || !otp_code) return res.status(400).json({ error: 'Missing token or OTP' });
  
  const decoded = verifyTempToken(temp_token, 'otp');
  if (!decoded) return res.status(401).json({ error: 'Sesi kedaluwarsa atau tidak valid.' });
  
  try {
    const result = await query('SELECT otp_code, otp_expires_at FROM users WHERE id = $1', [decoded.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });
    if (user.otp_code !== otp_code || new Date() > user.otp_expires_at) {
      return res.status(400).json({ error: 'OTP salah atau sudah kedaluwarsa.' });
    }
    
    // Mark verified
    await query('UPDATE users SET is_verified = true, otp_code = NULL, otp_expires_at = NULL WHERE id = $1', [decoded.id]);
    
    // Return token for the set-pin step
    return res.json({ temp_token: signTempToken(decoded.id, 'set_pin'), message: 'Email verified' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/auth/set-pin
router.post('/set-pin', async (req, res) => {
  const { temp_token, pin } = req.body;
  if (!temp_token || !pin || pin.length !== 6) return res.status(400).json({ error: 'Invalid input. PIN must be 6 digits.' });
  
  const decoded = verifyTempToken(temp_token, 'set_pin');
  if (!decoded) return res.status(401).json({ error: 'Sesi kedaluwarsa atau tidak valid.' });
  
  try {
    const pinHash = await bcrypt.hash(pin, 12);
    const result = await query('UPDATE users SET pin_hash = $1 WHERE id = $2 RETURNING id, email', [pinHash, decoded.id]);
    
    // Full login success!
    const user = result.rows[0];
    if (user) user.email = decryptDeterministic(user.email);
    return res.json({ token: signToken(user), user: { id: user.id, email: user.email }, message: 'Registration complete' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/auth/login
router.post('/login', authLimiter, loginRules, async (req, res) => {
  const { email, password } = req.body;
  try {
    const encryptedEmail = encryptDeterministic(email);
    const result = await query('SELECT id, email, password_hash, is_verified, pin_hash FROM users WHERE email = $1', [encryptedEmail]);
    const user = result.rows[0];
    if (user) user.email = decryptDeterministic(user.email);
    const dummy = '$2a$12$dummyhashtopreventtimingattacksxxx';
    const valid = await bcrypt.compare(password, user ? user.password_hash : dummy);
    if (!user || !valid)
      return res.status(401).json({ error: 'Email atau password salah.' });
      
    if (!user.is_verified) {
      // Allow them to verify again. Generate new OTP
      const otpCode = generateOTP();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
      await query('UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE id = $3', [otpCode, otpExpires, user.id]);
      await sendOTPEmail(email, otpCode).catch(err => console.error('Failed to send OTP:', err));
      return res.status(403).json({ error: 'Email belum diverifikasi. Cek email untuk OTP baru.', temp_token: signTempToken(user.id, 'otp'), requires_otp: true });
    }
    
    if (!user.pin_hash) {
      // For backwards compatibility or if they somehow skipped it
      return res.json({ temp_token: signTempToken(user.id, 'set_pin'), requires_set_pin: true });
    }

    // Return temp token for PIN verification step
    return res.json({ temp_token: signTempToken(user.id, 'pin'), requires_pin: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// POST /api/auth/verify-pin
router.post('/verify-pin', authLimiter, async (req, res) => {
  const { temp_token, pin } = req.body;
  if (!temp_token || !pin) return res.status(400).json({ error: 'Missing token or PIN' });
  
  const decoded = verifyTempToken(temp_token, 'pin');
  if (!decoded) return res.status(401).json({ error: 'Sesi kedaluwarsa atau tidak valid.' });
  
  try {
    const result = await query('SELECT id, email, pin_hash FROM users WHERE id = $1', [decoded.id]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User tidak ditemukan.' });
    if (user) user.email = decryptDeterministic(user.email);
    
    const valid = await bcrypt.compare(pin, user.pin_hash);
    if (!valid) return res.status(401).json({ error: 'PIN salah.' });
    
    return res.json({ token: signToken(user), user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await query('SELECT id, email, created_at FROM users WHERE id = $1', [req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'User tidak ditemukan.' });
    const user = result.rows[0];
    if (user) user.email = decryptDeterministic(user.email);
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;
