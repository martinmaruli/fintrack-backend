const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth); // All routes require auth

const accountRules = [
  body('name').trim().notEmpty().withMessage('Nama akun wajib diisi.')
    .isLength({ max: 100 }).withMessage('Nama terlalu panjang.').escape(),
  body('type').isIn(['bank','ewallet','cash']).withMessage('Tipe akun tidak valid.'),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Format warna tidak valid.'),
  body('emoji').optional().isLength({ max: 4 }),
  body('init').optional().isFloat({ min: 0 }).withMessage('Saldo awal tidak valid.'),
];

// ─── GET /api/accounts ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM accounts WHERE user_id = $1 ORDER BY id',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat akun.' });
  }
});

// ─── POST /api/accounts ───────────────────────────────────────────────────────
router.post('/', accountRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ error: errors.array()[0].msg });

  const { name, type, color, emoji, init } = req.body;
  try {
    const result = await query(
      `INSERT INTO accounts (name, type, color, emoji, init, user_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, type, color || '#4f98a3', emoji || '💳', parseFloat(init) || 0, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan akun.' });
  }
});

// ─── PUT /api/accounts/:id ────────────────────────────────────────────────────
router.put('/:id', [param('id').isInt(), ...accountRules], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ error: errors.array()[0].msg });

  const { name, type, color, emoji, init } = req.body;
  try {
    const result = await query(
      `UPDATE accounts SET name=$1, type=$2, color=$3, emoji=$4, init=$5
       WHERE id=$6 AND user_id=$7 RETURNING *`,
      [name, type, color || '#4f98a3', emoji || '💳', parseFloat(init) || 0,
       parseInt(req.params.id), req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui akun.' });
  }
});

// ─── DELETE /api/accounts/:id ─────────────────────────────────────────────────
router.delete('/:id', param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ error: 'ID tidak valid.' });

  const accId = parseInt(req.params.id);
  try {
    // Delete linked transactions first
    await query(
      'DELETE FROM transactions WHERE acc_id = $1 AND user_id = $2',
      [accId, req.user.id]
    );
    const result = await query(
      'DELETE FROM accounts WHERE id = $1 AND user_id = $2 RETURNING id',
      [accId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus akun.' });
  }
});

module.exports = router;
