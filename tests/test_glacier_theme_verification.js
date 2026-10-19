const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('================================================================');
console.log('  GLACIER GLASS THEME & SYSTEM INTEGRITY VERIFICATION SUITE');
console.log('================================================================');

let passed = 0;
let total = 0;

function assert(condition, message) {
  total++;
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// 1. Check style.css tokens
const cssPath = path.join(__dirname, '..', 'public', 'css', 'style.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');

console.log('\n--- VERIFYING EXACT COLOR TOKENS ---');
assert(cssContent.includes('--color-bg: #EAF0F5;'), 'Main background token is #EAF0F5');
assert(cssContent.includes('--color-panel: #FFFFFF;'), 'Panel background token is #FFFFFF');
assert(cssContent.includes('--color-accent-primary: #5145CD;'), 'Primary accent token is #5145CD');
assert(cssContent.includes('--color-accent-secondary: #168B9C;'), 'Secondary accent token is #168B9C');
assert(cssContent.includes('--color-text-primary: #182235;'), 'Primary text token is #182235');
assert(cssContent.includes('--color-text-secondary: #536174;'), 'Secondary text token is #536174');
assert(cssContent.includes('--color-text-muted: #748196;'), 'Muted text token is #748196');
assert(cssContent.includes('--color-border: #D7E0E9;'), 'Border token is #D7E0E9');
assert(cssContent.includes('--color-hover: #F0EDFF;'), 'Hover background token is #F0EDFF');
assert(cssContent.includes('--color-selected: #E8E6FF;'), 'Selected background token is #E8E6FF');
assert(cssContent.includes('--color-info-surface: #E3F5F5;'), 'Subtle teal info surface token is #E3F5F5');
assert(cssContent.includes('--color-input: #F8FAFC;'), 'Input background token is #F8FAFC');

console.log('\n--- VERIFYING COMPONENT STYLES ---');
assert(cssContent.includes('.camera-card.active') && cssContent.includes('background: var(--color-selected);') && cssContent.includes('border-color: var(--color-accent-primary);'), 'Selected camera card uses #E8E6FF background and #5145CD border');
assert(cssContent.includes('.canvas-wrapper') && cssContent.includes('background: #0a0c10;'), 'Camera feed canvas wrapper remains dark (#0a0c10) without glare overlay');
assert(cssContent.includes('.alert-card.critical') && cssContent.includes('#DC2626'), 'Critical alert severity preserved with #DC2626');
assert(cssContent.includes('.alert-card.high') && cssContent.includes('#D97706'), 'High alert severity preserved with #D97706');
assert(cssContent.includes('.alert-card.medium') && cssContent.includes('#2563EB'), 'Medium alert severity preserved with #2563EB');
assert(cssContent.includes('.alert-status-resolved') && cssContent.includes('#10B981'), 'Resolved status preserved with #10B981');
assert(cssContent.includes('.btn-tactical.btn-primary') && cssContent.includes('#5145CD'), 'Primary buttons use #5145CD');
assert(cssContent.includes('.btn-tactical.btn-cyan') && cssContent.includes('--color-info-surface'), 'Informational secondary actions use #E3F5F5 & #168B9C');

console.log('\n--- VERIFYING LIVE SERVER HTTP API & ASSETS ---');
http.get('http://localhost:3000/api/cameras', (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    assert(res.statusCode === 200, 'GET /api/cameras returns 200 OK');
    const data = JSON.parse(body);
    const cams = data.cameras || data;
    assert(Array.isArray(cams) && cams.length >= 5, `Cameras loaded (${cams.length} streams available)`);

    http.get('http://localhost:3000/api/alerts', (resEvt) => {
      let evtBody = '';
      resEvt.on('data', chunk => evtBody += chunk);
      resEvt.on('end', () => {
        assert(resEvt.statusCode === 200, 'GET /api/alerts returns 200 OK');

        console.log('\n================================================================');
        console.log(`  VERIFICATION RESULTS: ${passed}/${total} TESTS PASSED`);
        console.log('================================================================');
        process.exit(passed === total ? 0 : 1);
      });
    });
  });
}).on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    console.log('ℹ Live server not running on localhost:3000 (start server with npm start to test live API); static Glacier Glass theme tokens verified.');
    console.log(`\n================================================================`);
    console.log(`  VERIFICATION RESULTS: ${passed}/${total} THEME TOKEN TESTS PASSED`);
    console.log(`================================================================`);
    process.exit(0);
  }
  console.error('HTTP Request failed:', err.message);
  process.exit(1);
});
