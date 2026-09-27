const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getLocalIp } = require('../server/utils/network');
const app = require('../server/routes/api');
const storage = require('../server/engine/storage');
const cameraManager = require('../server/engine/cameraManager');

console.log('--- RUNNING INTERACTIVE CONTROLS AUDIT & API VERIFICATION ---');

// 1. Verify getLocalIp()
const ip = getLocalIp();
console.log('Detected LAN IP:', ip);
assert.ok(ip, 'Local IP must be detected');
assert.ok(!ip.startsWith('127.'), 'Local IP must not be loopback');
assert.match(ip, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/, 'Local IP must be valid IPv4');

// 2. Verify all Phase 2.1 Interactive Controls in index.html and app.js
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

const requiredControls = [
  { name: 'Mute Audio', id: 'btnMute', inHtml: true, inJs: true },
  { name: '+ Mobile Cam', id: 'btnOpenMobileCamModal', inHtml: true, inJs: true },
  { name: 'Data Sources & SOP', id: 'btnOpenDataSourcesModal', inHtml: true, inJs: true },
  { name: 'Audit & Governance', id: 'btnOpenGovernanceModal', inHtml: true, inJs: true },
  { name: 'Simulate WAN Loss / Restore', id: 'btnToggleWan', inHtml: true, inJs: true },
  { name: 'Role selector', id: 'userRoleSelect', inHtml: true, inJs: true },
  { name: 'Rule Studio', id: 'btnOpenRulesModal', inHtml: true, inJs: true },
  { name: 'Red-Team Architecture', id: 'btnOpenRedTeamModal', inHtml: true, inJs: true },
  { name: 'Draw Virtual Fence', id: 'btnDrawFence', inHtml: true, inJs: true },
  { name: 'Draw Tripwire Line', id: 'btnDrawTripwire', inHtml: true, inJs: true },
  { name: 'Reset Zones', id: 'btnResetZones', inHtml: true, inJs: true },
  { name: 'Dismiss Siren', id: 'btnDismissSiren', inHtml: true, inJs: true },
  { name: 'Copy Mobile URL', id: 'btnCopyMobileUrl', inHtml: true, inJs: true },
  { name: 'Preview Mobile URL', id: 'btnOpenMobilePreview', inHtml: true, inJs: true },
  { name: 'Save Rules', id: 'btnSaveRules', inHtml: true, inJs: true },
  { name: 'Save Evidence Notes', id: 'btnSaveEvidenceNotes', inHtml: true, inJs: true },
  { name: 'Mobile Cam Dialog', id: 'mobileCamDialog', inHtml: true, inJs: true },
  { name: 'Rules Dialog', id: 'rulesDialog', inHtml: true, inJs: true },
  { name: 'Data Sources Dialog', id: 'dataSourcesDialog', inHtml: true, inJs: true },
  { name: 'Governance Dialog', id: 'governanceDialog', inHtml: true, inJs: true },
  { name: 'Evidence Dialog', id: 'evidenceDialog', inHtml: true, inJs: true },
  { name: 'Red Team Dialog', id: 'redTeamDialog', inHtml: true, inJs: true }
];

requiredControls.forEach(ctrl => {
  if (ctrl.inHtml) {
    assert.ok(indexHtml.includes(`id="${ctrl.id}"`), `index.html must contain #${ctrl.id} (${ctrl.name})`);
  }
  if (ctrl.inJs) {
    assert.ok(appJs.includes(ctrl.id), `app.js must reference #${ctrl.id} (${ctrl.name})`);
  }
  console.log(`✓ Control Verified: ${ctrl.name} (#${ctrl.id})`);
});

// Verify alert action handlers in app.js
assert.ok(appJs.includes("handleAlertAction"), "app.js must export window.handleAlertAction");
assert.ok(appJs.includes("inspectEvidence"), "app.js must export window.inspectEvidence");
assert.ok(appJs.includes("btn-close-modal"), "app.js must close modals with .btn-close-modal");

// 3. Verify CameraManager Lifecycle: WAITING -> ONLINE -> STALE
const freshCam = cameraManager.getCamera('CAM-MOBILE-01');
freshCam.hasReceivedMobileMessage = false;
freshCam.hasReceivedConnect = false;
freshCam.lastReceivedAt = 0;
freshCam.status = 'WAITING';

// Before any detections:
let tick1 = cameraManager.tick();
let cam1 = tick1.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.ok(cam1.status === 'WAITING' || cam1.status === 'STANDBY', 'Before any phone connection, CAM-MOBILE-01 must be WAITING');
console.log('✓ Camera State 1: WAITING verified before client connection');

// Ingest detection -> ONLINE:
cameraManager.ingestMobileDetections('CAM-MOBILE-01', [
  { classLabel: 'person', confidence: 0.92, bbox: { x: 0.3, y: 0.3, w: 0.2, h: 0.5 } }
]);
let tick2 = cameraManager.tick();
let cam2 = tick2.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.strictEqual(cam2.status, 'ONLINE', 'Immediately after detection, CAM-MOBILE-01 must be ONLINE');
console.log('✓ Camera State 2: ONLINE verified upon receiving detections');

// Simulate 3.5s elapsed without detections -> STALE:
const internalCam = cameraManager.getCamera('CAM-MOBILE-01');
internalCam.lastReceivedAt = Date.now() - 3500;
let tick3 = cameraManager.tick();
let cam3 = tick3.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.strictEqual(cam3.status, 'STALE', 'When no detections for >3s, CAM-MOBILE-01 must be STALE');
console.log('✓ Camera State 3: STALE verified after 3.5s of no telemetry');

console.log('=== ALL AUDIT & LIFECYCLE CHECKS PASSED ===');
