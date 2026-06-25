const crypto = require('crypto');

// Generate a valid 32-byte key from the environment variable or fallback
const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'fintrack_fallback_secret_key_32bytes';
const KEY = crypto.createHash('sha256').update(secret).digest();

// Static IV for deterministic encryption (e.g. for email search lookup)
const STATIC_IV = crypto.createHash('sha256').update(secret).digest().slice(0, 16);

const ALGORITHM = 'aes-256-cbc';

/**
 * Encrypts a string using a random IV (safe for description, notes, etc.)
 */
function encrypt(text) {
  if (text === null || text === undefined) return text;
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    let encrypted = cipher.update(String(text), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (err) {
    console.error('Encryption error:', err);
    return text;
  }
}

/**
 * Decrypts a string encrypted with a random IV.
 * Gracefully returns original text if format is invalid or decryption fails.
 */
function decrypt(cipherText) {
  if (!cipherText) return cipherText;
  try {
    const parts = String(cipherText).split(':');
    if (parts.length !== 2) return cipherText; // Return original if not in our format
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // Return original text to maintain backward compatibility
    return cipherText;
  }
}

/**
 * Encrypts a string deterministically (same input always produces same ciphertext)
 * Useful for fields we query by equality, like email.
 */
function encryptDeterministic(text) {
  if (text === null || text === undefined) return text;
  try {
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, STATIC_IV);
    let encrypted = cipher.update(String(text).toLowerCase().trim(), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return 'det:' + encrypted;
  } catch (err) {
    console.error('Deterministic encryption error:', err);
    return text;
  }
}

/**
 * Decrypts deterministically encrypted string.
 */
function decryptDeterministic(cipherText) {
  if (!cipherText) return cipherText;
  try {
    if (!String(cipherText).startsWith('det:')) return cipherText;
    const encrypted = String(cipherText).slice(4);
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, STATIC_IV);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    return cipherText;
  }
}

module.exports = {
  encrypt,
  decrypt,
  encryptDeterministic,
  decryptDeterministic
};
