const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { encrypt, decrypt, encryptDeterministic, decryptDeterministic } = require('../services/encryption');

const router = express.Router();
router.use(requireAuth);

const TYPES = ['pemasukan','pengeluaran','calon_pemasukan','calon_pengeluaran'];
const FREQS = ['monthly'];

function decryptRow(row) {
  if (row.description) row.description = decrypt(row.description);
  if (row.cat) row.cat = decrypt(row.cat);
  if (row.note) row.note = decrypt(row.note);
  if (row.account_name) row.account_name = decrypt(row.account_name);
  if (row.type) row.type = decryptDeterministic(row.type);
  return row;
}

const rules = [
  body('desc').trim().notEmpty().withMessage('Deskripsi wajib diisi.').isLength({ max: 200 }).escape(),
  body('amt').isFloat({ min: 0.01 }).withMessage('Jumlah harus lebih dari 0.'),
  body('type').isIn(TYPES).withMessage('Tipe tidak valid.'),
  body('cat').trim().notEmpty().withMessage('Kategori wajib diisi.').isLength({ max: 100 }).escape(),
  body('date').isDate().withMessage('Format tanggal tidak valid.').custom((value, { req }) => {
    if (req.body.type === 'pemasukan' || req.body.type === 'pengeluaran') {
      const today = new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
      if (value > today) {
        throw new Error('Tanggal tidak boleh lebih dari hari ini untuk tipe transaksi ini.');
      }
    }
    return true;
  }),
  body('note').optional().trim().isLength({ max: 500 }).escape(),
  body('acc_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('rec').optional().isBoolean(),
  body('freq').optional({ nullable: true }).custom(value => {
    if (value === null || value === 'monthly') return true;
    if (/^custom_\d+$/.test(value)) {
      const days = parseInt(value.split('_')[1]);
      if (days > 0) return true;
    }
    throw new Error('Frekuensi tidak valid.');
  }),
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
    res.json(r.rows.map(decryptRow));
  } catch (e) { res.status(500).json({ error: 'Gagal memuat transaksi.' }); }
});

// New menu-specific API routes
router.get('/summary', async (req, res) => {
  try {
    const r = await query(`SELECT type, SUM(amt) as total FROM transactions WHERE user_id = $1 GROUP BY type`, [req.user.id]);
    const sums = { pemasukan: 0, pengeluaran: 0, calon_pemasukan: 0, calon_pengeluaran: 0 };
    r.rows.forEach(row => {
      const dt = decryptDeterministic(row.type);
      sums[dt] = parseFloat(row.total) || 0;
    });
    const accR = await query(`SELECT SUM(init) as total_init FROM accounts WHERE user_id = $1`, [req.user.id]);
    const initBal = parseFloat(accR.rows[0]?.total_init) || 0;
    res.json({
      income: sums.pemasukan,
      expense: sums.pengeluaran,
      projected_income: sums.calon_pemasukan,
      projected_expense: sums.calon_pengeluaran,
      balance: initBal + sums.pemasukan - sums.pengeluaran,
      projected_balance: (initBal + sums.pemasukan - sums.pengeluaran) + sums.calon_pemasukan - sums.calon_pengeluaran
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Gagal memuat summary.' }); }
});

router.get('/dashboard', async (req, res) => {
  try {
    const r = await query(
      `SELECT t.*, a.name AS account_name FROM transactions t
       LEFT JOIN accounts a ON t.acc_id = a.id AND a.user_id = $1
       WHERE t.user_id = $1 ORDER BY t.date DESC, t.id DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(r.rows.map(decryptRow));
  } catch (e) { res.status(500).json({ error: 'Gagal memuat dashboard.' }); }
});

router.get('/income', async (req, res) => {
  try {
    const r = await query(
      `SELECT t.*, a.name AS account_name FROM transactions t
       LEFT JOIN accounts a ON t.acc_id = a.id AND a.user_id = $1
       WHERE t.user_id = $1 AND t.type = $2 ORDER BY t.date DESC, t.id DESC`,
      [req.user.id, encryptDeterministic('pemasukan')]
    );
    res.json(r.rows.map(decryptRow));
  } catch (e) { res.status(500).json({ error: 'Gagal memuat income.' }); }
});

router.get('/outcome', async (req, res) => {
  try {
    const r = await query(
      `SELECT t.*, a.name AS account_name FROM transactions t
       LEFT JOIN accounts a ON t.acc_id = a.id AND a.user_id = $1
       WHERE t.user_id = $1 AND t.type = $2 ORDER BY t.date DESC, t.id DESC`,
      [req.user.id, encryptDeterministic('pengeluaran')]
    );
    res.json(r.rows.map(decryptRow));
  } catch (e) { res.status(500).json({ error: 'Gagal memuat outcome.' }); }
});

router.get('/projected-income', async (req, res) => {
  try {
    const r = await query(
      `SELECT t.*, a.name AS account_name FROM transactions t
       LEFT JOIN accounts a ON t.acc_id = a.id AND a.user_id = $1
       WHERE t.user_id = $1 AND t.type = $2 ORDER BY t.date DESC, t.id DESC`,
      [req.user.id, encryptDeterministic('calon_pemasukan')]
    );
    res.json(r.rows.map(decryptRow));
  } catch (e) { res.status(500).json({ error: 'Gagal memuat projected income.' }); }
});

router.get('/projected-outcome', async (req, res) => {
  try {
    const r = await query(
      `SELECT t.*, a.name AS account_name FROM transactions t
       LEFT JOIN accounts a ON t.acc_id = a.id AND a.user_id = $1
       WHERE t.user_id = $1 AND t.type = $2 ORDER BY t.date DESC, t.id DESC`,
      [req.user.id, encryptDeterministic('calon_pengeluaran')]
    );
    res.json(r.rows.map(decryptRow));
  } catch (e) { res.status(500).json({ error: 'Gagal memuat projected outcome.' }); }
});

router.get('/report', async (req, res) => {
  try {
    const r = await query(
      `SELECT t.*, a.name AS account_name FROM transactions t
       LEFT JOIN accounts a ON t.acc_id = a.id AND a.user_id = $1
       WHERE t.user_id = $1 ORDER BY t.date DESC, t.id DESC`,
      [req.user.id]
    );
    res.json(r.rows.map(decryptRow));
  } catch (e) { res.status(500).json({ error: 'Gagal memuat report.' }); }
});

router.post('/auto-process', async (req, res) => {
  try {
    const today = req.body.today || new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0];
    const r = await query(
      `SELECT * FROM transactions
       WHERE user_id = $1 AND type IN ($2, $3)
       AND date <= $4`,
      [req.user.id, encryptDeterministic('calon_pemasukan'), encryptDeterministic('calon_pengeluaran'), today]
    );

    let processedCount = 0;
    
    const formatDate = (d) => {
      const dt = new Date(d);
      return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
    };

    for (let t of r.rows) {
      const actualType = decryptDeterministic(t.type) === 'calon_pemasukan' ? 'pemasukan' : 'pengeluaran';
      let currentFormatDate = formatDate(t.date);
      
      let iters = 0;
      let deleteIt = false;
      let nextCntStr = t.cnt;

      while (currentFormatDate <= today && iters < 100) {
        iters++;
        let decryptedNote = decrypt(t.note);
        let isPaused = decryptedNote && decryptedNote.includes('[PAUSED]');
        let isStopped = decryptedNote && decryptedNote.includes('[STOPPED]');

        if (!isPaused && !isStopped) {
          // Insert actual
          let newNote = decryptedNote ? decryptedNote + ' (Auto)' : '(Auto)';
          await query(
            `INSERT INTO transactions (description, amt, type, cat, date, note, acc_id, user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [encrypt(decrypt(t.description)), t.amt, encryptDeterministic(actualType), encrypt(decrypt(t.cat)), currentFormatDate, encrypt(newNote), t.acc_id, req.user.id]
          );
          processedCount++;
        }

        if (!t.rec) {
          deleteIt = true;
          break; // One time
        } else {
          // calculate next date
          const dt = new Date(currentFormatDate);
          if (t.freq === 'monthly') dt.setMonth(dt.getMonth() + 1);
          else if (t.freq && t.freq.startsWith('custom_')) dt.setDate(dt.getDate() + parseInt(t.freq.split('_')[1]));
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
      [encrypt(desc), parseFloat(amt), encryptDeterministic(type), encrypt(cat), date, note ? encrypt(note) : null, acc_id||null, !!rec, freq||null, cnt||null, end_date||null, req.user.id]
    );
    res.status(201).json(decryptRow(r.rows[0]));
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
      [encrypt(desc), parseFloat(amt), encryptDeterministic(type), encrypt(cat), date, note ? encrypt(note) : null, acc_id||null, !!rec,
       freq||null, cnt||null, end_date||null, parseInt(req.params.id), req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    res.json(decryptRow(r.rows[0]));
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
