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

router.post('/auto-process', async (req, res) => {
  try {
    const today = req.body.today || new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
    const r = await query(
      `SELECT * FROM transactions
       WHERE user_id = $1 AND type IN ('calon_pemasukan', 'calon_pengeluaran')
       AND date <= $2`,
      [req.user.id, today]
    );

    let processedCount = 0;
    
    const formatDate = (d) => {
      const dt = new Date(d);
      return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
    };

    for (let t of r.rows) {
      const actualType = t.type === 'calon_pemasukan' ? 'pemasukan' : 'pengeluaran';
      let currentFormatDate = formatDate(t.date);
      
      let iters = 0;
      let deleteIt = false;
      let nextCntStr = t.cnt;

      while (currentFormatDate <= today && iters < 100) {
        iters++;
        // Insert actual
        let newNote = t.note ? t.note + ' (Auto)' : '(Auto)';
        await query(
          `INSERT INTO transactions (description, amt, type, cat, date, note, acc_id, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [t.description, t.amt, actualType, t.cat, currentFormatDate, newNote, t.acc_id, req.user.id]
        );
        processedCount++;

        if (!t.rec) {
          deleteIt = true;
          break; // One time
        } else {
          // calculate next date
          const dt = new Date(currentFormatDate);
          if (t.freq === 'monthly') dt.setMonth(dt.getMonth() + 1);
          else if (t.freq === 'weekly') dt.setDate(dt.getDate() + 7);
          else if (t.freq === 'biweekly') dt.setDate(dt.getDate() + 14);
          else if (t.freq === 'yearly') dt.setFullYear(dt.getFullYear() + 1);
          else if (t.freq === 'daily') dt.setDate(dt.getDate() + 1);
          else { deleteIt = true; break; } // safety fallback

          currentFormatDate = formatDate(dt);

          if (t.end_date) {
            const ed = formatDate(t.end_date);
            if (currentFormatDate > ed) {
              deleteIt = true;
              break;
            }
          }

          if (nextCntStr) {
            const c = parseInt(nextCntStr, 10);
            if (!isNaN(c)) {
              if (c <= 1) {
                deleteIt = true;
                break;
              } else {
                nextCntStr = (c - 1).toString();
              }
            }
          }
        }
      }

      if (deleteIt) {
        await query(`DELETE FROM transactions WHERE id = $1`, [t.id]);
      } else {
        await query(
          `UPDATE transactions SET date = $1, cnt = $2 WHERE id = $3`,
          [currentFormatDate, nextCntStr, t.id]
        );
      }
    }

    res.json({ success: true, processed: processedCount });
  } catch (e) {
    console.error('Auto-process error:', e);
    res.status(500).json({ error: 'Gagal memproses proyeksi otomatis.' });
  }
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
