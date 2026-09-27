const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getLocalIp } = require('../server/utils/network');

const CERTS_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERTS_DIR, 'key.pem');
const CERT_PATH = path.join(CERTS_DIR, 'cert.pem');

console.log('=== IBVAP SSL Certificate Setup ===');

if (!fs.existsSync(CERTS_DIR)) {
  fs.mkdirSync(CERTS_DIR, { recursive: true });
}

if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH) && fs.statSync(KEY_PATH).size > 0 && fs.statSync(CERT_PATH).size > 0) {
  console.log('✓ Valid SSL certificates already exist:');
  console.log(`  Key:  ${KEY_PATH}`);
  console.log(`  Cert: ${CERT_PATH}`);
  console.log('No generation needed. Server will listen on HTTPS port 3443.');
  process.exit(0);
}

const lanIp = getLocalIp();
console.log(`Detected LAN IP for certificate CN: ${lanIp}`);

try {
  console.log('Generating self-signed SSL certificate using OpenSSL...');
  execSync(
    `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${KEY_PATH}" -out "${CERT_PATH}" -days 365 -subj "/CN=${lanIp}"`,
    { stdio: 'inherit' }
  );
  console.log('✓ Successfully generated SSL certificates:');
  console.log(`  Key:  ${KEY_PATH}`);
  console.log(`  Cert: ${CERT_PATH}`);
  console.log('To automatically trust on mobile without security warnings, you can also use mkcert:');
  console.log(`  mkcert -install && mkcert ${lanIp} localhost`);
} catch (err) {
  console.error('Failed to generate certificates automatically with OpenSSL:', err.message);
  console.log('\nPlease generate certificates manually using one of the following:');
  console.log(`Option 1 (mkcert, recommended): mkcert -install && mkcert ${lanIp} localhost`);
  console.log(`Option 2 (OpenSSL fallback): openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/key.pem -out certs/cert.pem -days 365 -subj "/CN=${lanIp}"`);
  process.exit(1);
}
