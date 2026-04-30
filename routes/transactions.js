const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const TYPES = ['pemasukan','pengeluaran','calon_pemasukan','calon_pengeluaran'];
const FREQS = ['daily','weekly','biweekly','monthly','yearly'];

const rules = [
  body('desc').trim().notEmpty().withMessage('Deskripsi wajib diisi.').isLength({ max: 200 }).escape(),
  body('amt').isFloat({ min: 0.01 }).withMessage('Jumlah harus lebih dari 0.'),
  body('type').isIn(TYPES).withMessage('Tipe tidak valid.'),
  body('cat').trim().notEmpty().withMessage('Kategori wajib diisi.').isLength({ max: 100 }).escape(),
  body('date').isDate().withMessage('Format tanggal tidak valid.'),
  body('note').optional().trim().isLength({ max: 500 }).escape(),
  body('acc_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('rec').optional().isBoolean(),
  body('freq').optional({ nullable: true }).isIn([null, ...FREQS]),
  body('cnt').optional({ nullable: true }).isLength({ max: 10 }),
  body('end_date').optional({ nullable: true }).isDate(),
];

router.get('/', async (req, res) => {
  try {
    const r = await query(
      `SELECT t.*, a.name AS account_name FROM transactions t
       LEFT JOIN accounts a ON t.acc_id = a.id AND a.user_id = $1
       WHERE t.user_id = $1 ORDER BY t.date DESC, t.id DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Gagal memuat transaksi.' }); }
});

router.post('/', rules, async (req, res) => {
  const err = validationResult(req);
  if (!err.isEmpty()) return res.status(422).json({ error: err.array()[0].msg });
  const { desc, amt, type, cat, date, note, acc_id, rec, freq, cnt, end_date } = req.body;
  if (acc_id) {
    const chk = await query('SELECT id FROM accounts WHERE id=$1 AND user_id=$2', [acc_id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Akun tidak ditemukan.' });
  }
  try {
    const r = await query(
      `INSERT INTO transactions (description,amt,type,cat,date,note,acc_id,rec,freq,cnt,end_date,user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [desc, parseFloat(amt), type, cat, date, note||null, acc_id||null, !!rec, freq||null, cnt||null, end_date||null, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Gagal menyimpan transaksi.' }); }
});

router.put('/:id', [param('id').isInt(), ...rules], async (req, res) => {
  const err = validationResult(req);
  if (!err.isEmpty()) return res.status(422).json({ error: err.array()[0].msg });
  const { desc, amt, type, cat, date, note, acc_id, rec, freq, cnt, end_date } = req.body;
  if (acc_id) {
    const chk = await query('SELECT id FROM accounts WHERE id=$1 AND user_id=$2', [acc_id, req.user.id]);
    if (!chk.rows.length) return res.status(403).json({ error: 'Akun tidak ditemukan.' });
  }
  try {
    const r = await query(
      `UPDATE transactions SET description=$1,amt=$2,type=$3,cat=$4,date=$5,
       note=$6,acc_id=$7,rec=$8,freq=$9,cnt=$10,end_date=$11
       WHERE id=$12 AND user_id=$13 RETURNING *`,
      [desc, parseFloat(amt), type, cat, date, note||null, acc_id||null, !!rec,
       freq||null, cnt||null, end_date||null, parseInt(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Gagal memperbarui transaksi.' }); }
});

router.delete('/:id', param('id').isInt(), async (req, res) => {
  const err = validationResult(req);
  if (!err.isEmpty()) return res.status(422).json({ error: 'ID tidak valid.' });
  try {
    const r = await query('DELETE FROM transactions WHERE id=$1 AND user_id=$2 RETURNING id',
      [parseInt(req.params.id), req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Gagal menghapus transaksi.' }); }
});

module.exports = router;
