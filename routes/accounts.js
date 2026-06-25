const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { encrypt, decrypt, encryptDeterministic, decryptDeterministic } = require('../services/encryption');

const router = express.Router();
router.use(requireAuth);

const rules = [
  body('name').trim().notEmpty().withMessage('Nama wajib diisi.').isLength({ max: 100 }).escape(),
  body('type').isIn(['bank','ewallet','cash']).withMessage('Tipe tidak valid.'),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
  body('emoji').optional().isLength({ max: 4 }),
  body('init').optional().isFloat({ min: 0 }),
];

router.get('/', async (req, res) => {
  try {
    const r = await query('SELECT * FROM accounts WHERE user_id = $1 ORDER BY id', [req.user.id]);
    const accounts = r.rows.map(acc => {
      acc.name = decrypt(acc.name);
      acc.type = decryptDeterministic(acc.type);
      acc.color = decrypt(acc.color);
      acc.emoji = decrypt(acc.emoji);
      return acc;
    });
    res.json(accounts);
  } catch (e) { res.status(500).json({ error: 'Gagal memuat akun.' }); }
});

router.post('/', rules, async (req, res) => {
  const err = validationResult(req);
  if (!err.isEmpty()) return res.status(422).json({ error: err.array()[0].msg });
  const { name, type, color, emoji, init } = req.body;
  try {
    const r = await query(
      'INSERT INTO accounts (name,type,color,emoji,init,user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [encrypt(name), encryptDeterministic(type), encrypt(color||'#4f98a3'), encrypt(emoji||'💳'), parseFloat(init)||0, req.user.id]
    );
    const acc = r.rows[0];
    if (acc) {
      acc.name = decrypt(acc.name);
      acc.type = decryptDeterministic(acc.type);
      acc.color = decrypt(acc.color);
      acc.emoji = decrypt(acc.emoji);
    }
    res.status(201).json(acc);
  } catch (e) { res.status(500).json({ error: 'Gagal menyimpan akun.' }); }
});

router.put('/:id', [param('id').isInt(), ...rules], async (req, res) => {
  const err = validationResult(req);
  if (!err.isEmpty()) return res.status(422).json({ error: err.array()[0].msg });
  const { name, type, color, emoji, init } = req.body;
  try {
    const r = await query(
      'UPDATE accounts SET name=$1,type=$2,color=$3,emoji=$4,init=$5 WHERE id=$6 AND user_id=$7 RETURNING *',
      [encrypt(name), encryptDeterministic(type), encrypt(color||'#4f98a3'), encrypt(emoji||'💳'), parseFloat(init)||0, parseInt(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
    const acc = r.rows[0];
    if (acc) {
      acc.name = decrypt(acc.name);
      acc.type = decryptDeterministic(acc.type);
      acc.color = decrypt(acc.color);
      acc.emoji = decrypt(acc.emoji);
    }
    res.json(acc);
  } catch (e) { res.status(500).json({ error: 'Gagal memperbarui akun.' }); }
});

router.delete('/:id', param('id').isInt(), async (req, res) => {
  const err = validationResult(req);
  if (!err.isEmpty()) return res.status(422).json({ error: 'ID tidak valid.' });
  const id = parseInt(req.params.id);
  try {
    await query('DELETE FROM transactions WHERE acc_id=$1 AND user_id=$2', [id, req.user.id]);
    const r = await query('DELETE FROM accounts WHERE id=$1 AND user_id=$2 RETURNING id', [id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Gagal menghapus akun.' }); }
});

module.exports = router;
