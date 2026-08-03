const crypto = require('crypto');

function getEncryptionKey() {
    const key = process.env.TOKENS_ENCRYPTION_KEY;
    if (!key) {
        console.error("❌ FATAL: TOKENS_ENCRYPTION_KEY is not defined in environment variables!");
        process.exit(1);
    }
    let keyBuffer;
    if (key.length === 64) {
        keyBuffer = Buffer.from(key, 'hex');
    } else {
        keyBuffer = Buffer.from(key, 'base64');
    }
    if (keyBuffer.length !== 32) {
        console.error("❌ FATAL: TOKENS_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters or 44 base64 characters)!");
        process.exit(1);
    }
    return keyBuffer;
}

function encrypt(text, tenantId, fieldName) {
    if (!text) return null;
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    
    // Associated Authenticated Data (AAD) to prevent block transposition/substitution
    const aad = Buffer.from(`${tenantId}:${fieldName}`, 'utf8');
    cipher.setAAD(aad);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(cipherText, tenantId, fieldName) {
    if (!cipherText) return null;
    if (!cipherText.startsWith('v1:')) {
        throw new Error("Plaintext credentials are not allowed. Decryption failed.");
    }
    
    const parts = cipherText.split(':');
    if (parts.length !== 4) {
        throw new Error("Invalid encrypted text format");
    }
    
    const [, ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    
    const aad = Buffer.from(`${tenantId}:${fieldName}`, 'utf8');
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

module.exports = { encrypt, decrypt };
