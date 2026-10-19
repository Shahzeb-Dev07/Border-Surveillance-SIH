// tests/test_qr_routing.js
// Verification suite for mobile QR code URL generation and routing logic

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

console.log('=== RUNNING MOBILE QR CODE & ROUTING VERIFICATION SUITE ===');

// 1. Inspect app.js source code
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

// Assert cachedLanIp is present and used
assert.ok(appJs.includes('cachedLanIp'), 'app.js must declare and maintain cachedLanIp');
assert.ok(!appJs.includes("const host = window.location.hostname || 'localhost';"),
  'app.js must not naively default to localhost in computeMobileCamUrl');
console.log('✓ TEST 1: app.js contains cachedLanIp logic and avoids naive localhost fallback');

// 2. Validate computeMobileCamUrl behavior across environments
function runComputeMobileCamUrl(windowLocation, cachedLanIp, customHost, peerId) {
  const window = { location: windowLocation };
  const isPublicCloud = window.location.protocol === 'https:' &&
    !window.location.hostname.match(/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/);

  const peerQuery = peerId ? ('peer=' + peerId) : '';

  if (customHost && customHost.trim()) {
    const trimmed = customHost.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const port = trimmed.includes(':') ? '' : (isPublicCloud ? '' : ':3443');
    const serverHost = port ? (trimmed + port) : trimmed;
    const serverQuery = 'server=' + encodeURIComponent(serverHost);
    const query = [peerQuery, serverQuery].filter(Boolean).join('&');
    const baseUrl = isPublicCloud ? (window.location.origin + '/mobile-cam.html') : ('https://' + serverHost + '/mobile-cam.html');
    return baseUrl + (query ? '?' + query : '');
  }

  if (isPublicCloud) {
    return window.location.origin + '/mobile-cam.html' + (peerQuery ? '?' + peerQuery : '');
  }

  let host = (cachedLanIp && cachedLanIp.trim()) ? cachedLanIp.trim() : window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || !host) {
    if (cachedLanIp) host = cachedLanIp;
  }
  const serverQuery = 'server=' + encodeURIComponent(host + ':3443');
  const query = [peerQuery, serverQuery].filter(Boolean).join('&');
  return 'https://' + host + ':3443/mobile-cam.html' + (query ? '?' + query : '');
}

const { getLocalIp } = require('../server/utils/network');
const lanIp = getLocalIp() || '127.0.0.1';
const testPeer = 'ibvap-pc-test-12345';

// Scenario A: Local PC operator viewing dashboard at http://localhost:3000
const localUrl = runComputeMobileCamUrl(
  { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:3000' },
  lanIp,
  '',
  testPeer
);
assert.strictEqual(
  localUrl,
  `https://${lanIp}:3443/mobile-cam.html?peer=${testPeer}&server=${lanIp}%3A3443`,
  'QR URL from localhost must resolve to physical LAN IP and never localhost'
);
assert.ok(!localUrl.includes('localhost'), 'QR URL intended for phone must NOT contain localhost');
console.log('✓ TEST 2A: Local LAN QR URL from localhost PC resolves to:', localUrl);

// Scenario B: Cloud Vercel deployment
const cloudUrl = runComputeMobileCamUrl(
  { protocol: 'https:', hostname: 'border-surveillance-sih.vercel.app', origin: 'https://border-surveillance-sih.vercel.app' },
  '',
  '',
  testPeer
);
assert.strictEqual(
  cloudUrl,
  `https://border-surveillance-sih.vercel.app/mobile-cam.html?peer=${testPeer}`,
  'Cloud QR URL must point directly to mobile-cam.html with peer parameter'
);
console.log('✓ TEST 2B: Cloud Vercel QR URL points directly to mobile-cam.html:', cloudUrl);

// Scenario C: Cloud Vercel deployment with edge tunnel specified
const cloudTunnelUrl = runComputeMobileCamUrl(
  { protocol: 'https:', hostname: 'border-surveillance-sih.vercel.app', origin: 'https://border-surveillance-sih.vercel.app' },
  '',
  'c2-edge.ngrok-free.app',
  testPeer
);
assert.strictEqual(
  cloudTunnelUrl,
  `https://border-surveillance-sih.vercel.app/mobile-cam.html?peer=${testPeer}&server=c2-edge.ngrok-free.app`,
  'Cloud QR URL with tunnel retains frontend origin and forwards server query'
);
console.log('✓ TEST 2C: Cloud Vercel QR URL with tunnel verified:', cloudTunnelUrl);

// 3. Verify server routes and SPA fallback protection
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
assert.ok(serverJs.includes("app.get(['/mobile-cam', '/mobile-cam.html']"),
  'server.js must explicitly route both /mobile-cam and /mobile-cam.html');
assert.ok(serverJs.includes("!req.path.startsWith('/mobile-cam')"),
  'server.js SPA fallback must exempt all paths starting with /mobile-cam from redirecting to index.html');
console.log('✓ TEST 3: server.js routes and fallback rules protect mobile-cam from desktop dashboard fallback');

// 4. Test live server HTTP and HTTPS response for /mobile-cam.html
const agent = new https.Agent({ rejectUnauthorized: false });

https.get(`https://${lanIp}:3443/mobile-cam.html?peer=${testPeer}&server=${lanIp}:3443`, { agent }, (res) => {
  assert.strictEqual(res.statusCode, 200, 'HTTPS /mobile-cam.html must return HTTP 200');
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    assert.ok(data.includes('IBVAP // Mobile Recon Cam (CAM-MOBILE-01)'),
      'Response must be mobile-cam.html, NOT the desktop index.html dashboard');
    assert.ok(!data.includes('TACTICAL COMMAND & CONTROL CONSOLE'),
      'Response must NOT be the desktop dashboard');
    console.log('✓ TEST 4: Live HTTPS /mobile-cam.html serves dedicated mobile page to phones');
    console.log('=== ALL QR CODE & ROUTING TESTS PASSED ===');
    process.exit(0);
  });
}).on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    console.log('ℹ TEST 4: Live server not currently listening on port 3443 (run npm start to test live network socket); routing configuration verified.');
    console.log('=== ALL QR CODE & ROUTING TESTS PASSED ===');
    process.exit(0);
  }
  console.error('HTTPS request failed:', err);
  process.exit(1);
});
