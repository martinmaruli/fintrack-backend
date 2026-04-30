const express = require('express');
const { body, param, query: qv, validationResult } = require('express-validator');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES = ['pemasukan','pengeluaran','calon_pemasukan','calon_pengeluaran'];
const VALID_FREQS = ['daily','weekly','biweekly','monthly','yearly'];

const trxRules = [
  body('desc').trim().notEmpty().withMessage('Deskripsi wajib diisi.')
    .isLength({ max: 200 }).escape(),
  body('amt').isFloat({ min: 0.01 }).withMessage('Jumlah harus lebih dari 0.'),
  body('type').isIn(VALID_TYPES).withMessage('Tipe transaksi tidak valid.'),
  body('cat').trim().notEmpty().withMessage('Kategori wajib diisi.')
    .isLength({ max: 100 }).escape(),
  body('date').isDate().withMessage('Format tanggal tidak valid.'),
  body('note').optional().trim().isLength({ max: 500 }).escape(),
  body('acc_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('rec').optional().isBoolean(),
  body('freq').optional({ nullable: true }).isIn([null, ...VALID_FREQS]),
  body('cnt').optional({ nullable: true }).isLength({ max: 10 }),
  body('end_date').optional({ nullable: true }).isDate(),
];

// ─── GET /api/transactions ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT t.*, a.name AS account_name
       FROM transactions t
       LEFT JOIN accounts a ON t.acc_id = a.id AND a.user_id = $1
       WHERE t.user_id = $1
       ORDER BY t.date DESC, t.id DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memuat transaksi.' });
  }
});

// ─── POST /api/transactions ───────────────────────────────────────────────────
router.post('/', trxRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ error: errors.array()[0].msg });

  const { desc, amt, type, cat, date, note, acc_id, rec, freq, cnt, end_date } = req.body;

  // Validate acc_id belongs to this user
  if (acc_id) {
    const accCheck = await query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [acc_id, req.user.id]
    );
    if (!accCheck.rows.length)
      return res.status(403).json({ error: 'Akun tidak ditemukan.' });
  }

  try {
    const result = await query(
      `INSERT INTO transactions
        (description, amt, type, cat, date, note, acc_id, rec, freq, cnt, end_date, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [desc, parseFloat(amt), type, cat, date,
       note || null, acc_id || null, !!rec,
       freq || null, cnt || null, end_date || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan transaksi.' });
  }
});

// ─── PUT /api/transactions/:id ────────────────────────────────────────────────
router.put('/:id', [param('id').isInt(), ...trxRules], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ error: errors.array()[0].msg });

  const { desc, amt, type, cat, date, note, acc_id, rec, freq, cnt, end_date } = req.body;
  const trxId = parseInt(req.params.id);

  if (acc_id) {
    const accCheck = await query(
      'SELECT id FROM accounts WHERE id = $1 AND user_id = $2',
      [acc_id, req.user.id]
    );
    if (!accCheck.rows.length)
      return res.status(403).json({ error: 'Akun tidak ditemukan.' });
  }

  try {
    const result = await query(
      `UPDATE transactions SET
        description=$1, amt=$2, type=$3, cat=$4, date=$5,
        note=$6, acc_id=$7, rec=$8, freq=$9, cnt=$10, end_date=$11
       WHERE id=$12 AND user_id=$13 RETURNING *`,
      [desc, parseFloat(amt), type, cat, date,
       note || null, acc_id || null, !!rec,
       freq || null, cnt || null, end_date || null,
       trxId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui transaksi.' });
  }
});

// ─── DELETE /api/transactions/:id ─────────────────────────────────────────────
router.delete('/:id', param('id').isInt(), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ error: 'ID tidak valid.' });

  try {
    const result = await query(
      'DELETE FROM transactions WHERE id=$1 AND user_id=$2 RETURNING id',
      [parseInt(req.params.id), req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus transaksi.' });
  }
});

module.exports = router;
