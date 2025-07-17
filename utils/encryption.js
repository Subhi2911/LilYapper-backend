const crypto = require('crypto');

const algorithm = 'aes-256-cbc';
const key = crypto.scryptSync(process.env.ENCRYPTION_SECRET, 'salt', 32); // Make sure ENCRYPTION_SECRET is in your .env

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

function decrypt(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'string') return encryptedData;

  // Check if the format is iv:ciphertext
  const parts = encryptedData.split(':');
  if (parts.length !== 2) {
    // If not valid format, assume plaintext or old data, just return as is
    return encryptedData;
  }

  const iv = Buffer.from(parts[0], 'base64');
  const encryptedText = parts[1];

  try {
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    // On error, return encryptedData to avoid crashing
    console.error('Decryption failed:', err.message);
    return encryptedData;
  }
}

module.exports = { encrypt, decrypt };
