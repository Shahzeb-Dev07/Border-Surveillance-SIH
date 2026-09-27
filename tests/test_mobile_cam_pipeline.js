const assert = require('assert');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('ws');

const cameraManager = require('../server/engine/cameraManager');
const storage = require('../server/engine/storage');
const ruleEngine = require('../server/engine/ruleEngine');

console.log('--- STARTING MOBILE-CAM PIPELINE VERIFICATION ---');

// 1. Verify CAM-MOBILE-01 Zone in storage
const zones = storage.getZones('CAM-MOBILE-01');
assert.ok(zones && zones.length > 0, 'CAM-MOBILE-01 must have a default zone configured');
const vfence = zones.find(z => z.rule === 'VIRTUAL_FENCE');
assert.ok(vfence, 'CAM-MOBILE-01 must have a VIRTUAL_FENCE rule');
assert.strictEqual(vfence.points.length, 4, 'VIRTUAL_FENCE should have 4 corner points');
console.log('✓ Storage: CAM-MOBILE-01 full-frame VIRTUAL_FENCE zone confirmed');

// 2. Ingest mock mobile detection
const testDetections = [
  {
    classLabel: 'person',
    confidence: 0.94,
    bbox: { x: 0.40, y: 0.30, w: 0.20, h: 0.45 }
  }
];

cameraManager.ingestMobileDetections('CAM-MOBILE-01', testDetections);
const cam = cameraManager.getCamera('CAM-MOBILE-01');
assert.strictEqual(cam.status, 'ONLINE', 'Camera should be ONLINE after ingestion');
assert.strictEqual(cam.latestMobileDetections.length, 1, 'Should have 1 stashed detection');

// 3. Tick cameraManager and check tracking + alert generation
let tickRes = cameraManager.tick();
let updatedCam = tickRes.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.ok(updatedCam.activeDetections.length > 0, 'IoU tracker should produce active detection');

// Tick again to build track hits and trigger rule
for (let i = 0; i < 5; i++) {
  cameraManager.ingestMobileDetections('CAM-MOBILE-01', testDetections);
  tickRes = cameraManager.tick();
}

console.log('✓ Pipeline Tick: Tracker and Rule Engine processed mobile person detection');
assert.ok(tickRes.events, 'Events array must be present');
const activeIncident = storage.getEvents().find(e => e.camera_id === 'CAM-MOBILE-01');
assert.ok(activeIncident, 'Alert engine should create an incident for CAM-MOBILE-01 intrusion');
console.log(`✓ Alert Engine: Incident created -> ID: ${activeIncident.event_id}, Status: ${activeIncident.system_status}, Severity: ${activeIncident.severity}`);

// 4. Verify SSL Certificate files
const keyPath = path.join(__dirname, '..', 'certs', 'key.pem');
const certPath = path.join(__dirname, '..', 'certs', 'cert.pem');
assert.ok(fs.existsSync(keyPath), 'certs/key.pem must exist');
assert.ok(fs.existsSync(certPath), 'certs/cert.pem must exist');
console.log('✓ Security: SSL certificates key.pem and cert.pem confirmed');

// 5. Verify mobile-cam.html content requirements
const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile-cam.html'), 'utf8');
assert.ok(htmlContent.includes('id="cameraVideo"'), 'mobile-cam.html must include cameraVideo element');
assert.ok(htmlContent.includes('autoplay'), 'video must have autoplay');
assert.ok(htmlContent.includes('playsinline'), 'video must have playsinline');
assert.ok(htmlContent.includes('muted'), 'video must have muted');
assert.ok(htmlContent.includes('window.isSecureContext'), 'mobile-cam.html must gate on isSecureContext');
assert.ok(htmlContent.includes('NotAllowedError'), 'mobile-cam.html must handle NotAllowedError');
assert.ok(htmlContent.includes('NotFoundError'), 'mobile-cam.html must handle NotFoundError');
assert.ok(htmlContent.includes('NotReadableError'), 'mobile-cam.html must handle NotReadableError');
assert.ok(htmlContent.includes('OverconstrainedError'), 'mobile-cam.html must handle OverconstrainedError');
assert.ok(htmlContent.includes('SecurityError'), 'mobile-cam.html must handle SecurityError');
assert.ok(htmlContent.includes('@tensorflow/tfjs@4.20.0'), 'TF.js must be pinned');
assert.ok(htmlContent.includes('@tensorflow-models/coco-ssd@2.2.3'), 'COCO-SSD must be pinned');
assert.ok(htmlContent.includes('setTimeout(detectionLoop, 175)'), 'Detection loop must use setTimeout chaining');
assert.ok(htmlContent.includes('btnSwitchCam'), 'Switch camera button must exist');
console.log('✓ HTML & Client Specs: All mobile-cam.html constraints verified');

console.log('=== ALL MOBILE-CAM TESTS PASSED ===');
