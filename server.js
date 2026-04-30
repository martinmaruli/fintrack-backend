require('dotenv').config();
const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(helmet());

// Parse allowed origins from env (comma-separated)
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);

app.use(cors({
  origin: function(origin, cb) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return cb(null, true);
    // Normalize origin (remove trailing slash)
    const norm = origin.replace(/\/$/, '');
    if (allowedOrigins.includes(norm)) return cb(null, true);
    // In development, allow all
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    console.error('CORS blocked:', origin, '| Allowed:', allowedOrigins);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: false,
}));

app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

app.use(rateLimit({
  windowMs: 60 * 1000, max: 100,
  message: { error: 'Terlalu banyak request. Coba lagi dalam 1 menit.' },
  standardHeaders: true, legacyHeaders: false,
}));

app.use('/api/auth',         require('./routes/auth'));
app.use('/api/accounts',     require('./routes/accounts'));
app.use('/api/transactions', require('./routes/transactions'));

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use((_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan server.' });
});

app.listen(PORT, () => console.log(`FinTrack API running on port ${PORT}`));
module.exports = app;
