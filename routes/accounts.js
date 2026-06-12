const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const rules = [
  body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 100 }).escape(),
  body('type').isIn(['bank','ewallet','cash']).withMessage('Invalid type.'),
  body('color').optional().matches(/^#[0-9A-Fa-f]{6}$/),
  body('emoji').optional().isLength({ max: 4 }),
  body('init').optional().isFloat({ min: 0 }),
];

router.get('/', async (req, res) => {
  try {
    const r = await query('SELECT * FROM accounts WHERE user_id = $1 ORDER BY id', [req.user.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: 'Failed to load accounts.' }); }
});

router.post('/', rules, async (req, res) => {
  const err = validationResult(req);
  if (!err.isEmpty()) return res.status(422).json({ error: err.array()[0].msg });
  const { name, type, color, emoji, init } = req.body;
  try {
    const r = await query(
      'INSERT INTO accounts (name,type,color,emoji,init,user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, type, color||'#4f98a3', emoji||'💳', parseFloat(init)||0, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to save account.' }); }
});

router.put('/:id', [param('id').isInt(), ...rules], async (req, res) => {
  const err = validationResult(req);
  if (!err.isEmpty()) return res.status(422).json({ error: err.array()[0].msg });
  const { name, type, color, emoji, init } = req.body;
  try {
    const r = await query(
      'UPDATE accounts SET name=$1,type=$2,color=$3,emoji=$4,init=$5 WHERE id=$6 AND user_id=$7 RETURNING *',
      [name, type, color||'#4f98a3', emoji||'💳', parseFloat(init)||0, parseInt(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Account not found.' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to update account.' }); }
});

router.delete('/:id', param('id').isInt(), async (req, res) => {
  const err = validationResult(req);
  if (!err.isEmpty()) return res.status(422).json({ error: 'Invalid ID.' });
  const id = parseInt(req.params.id);
  try {
    await query('DELETE FROM transactions WHERE acc_id=$1 AND user_id=$2', [id, req.user.id]);
    const r = await query('DELETE FROM accounts WHERE id=$1 AND user_id=$2 RETURNING id', [id, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Account not found.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete account.' }); }
});

module.exports = router;
