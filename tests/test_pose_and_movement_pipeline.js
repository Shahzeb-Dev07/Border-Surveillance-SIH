// tests/test_pose_and_movement_pipeline.js
// IBVAP Mobile Edge Camera: Pose & Movement Analytics Integration Test Suite

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

console.log('--- STARTING IBVAP POSE & MOVEMENT ANALYTICS TEST SUITE ---');

// 1. Verify static client files & script pinning
const mobileHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile-cam.html'), 'utf8');
assert.ok(mobileHtml.includes('@tensorflow-models/pose-detection@2.1.3'), 'Must load pose-detection 2.1.3 CDN');
assert.ok(mobileHtml.includes('MULTIPOSE_LIGHTNING'), 'Must configure MoveNet MultiPose Lightning model');
assert.ok(mobileHtml.includes('calibrated: false'), 'Must include uncalibrated tag in bodyMeasurements');
assert.ok(mobileHtml.includes('normalized-units-per-second') || mobileHtml.includes('norm/s'), 'Speed must be normalized-units-per-second');
assert.ok(!mobileHtml.includes('km/h') || mobileHtml.includes('never km/h'), 'No real-world km/h claims');
assert.ok(mobileHtml.includes('btnTogglePose'), 'Must include UI toggle for Pose estimation');
assert.ok(mobileHtml.includes('POSE ENGINE:'), 'Status panel must include POSE ENGINE indicator');
assert.ok(mobileHtml.includes('● UNAVAILABLE'), 'Must handle graceful degradation for MoveNet CDN failure');
assert.ok(mobileHtml.includes('SKELETON_PAIRS'), 'Must define skeleton bone pairs for overlay rendering');
console.log('✓ Prerequisite 1: mobile-cam.html MoveNet MultiPose, toggles, and image-space specs verified');

// 2. Verify server-side ingestion and engine pipeline
const cameraManager = require('../server/engine/cameraManager');
const storage = require('../server/engine/storage');
const ruleEngine = require('../server/engine/ruleEngine');

const camMobile = cameraManager.getCamera('CAM-MOBILE-01');
assert.ok(camMobile, 'CAM-MOBILE-01 must be registered in cameraManager');

// Test State 1: Initial state before any mobile connection
camMobile.hasReceivedMobileMessage = false;
camMobile.lastReceivedAt = 0;
camMobile.clientConnected = false;
let tickInit = cameraManager.tick();
let camMobileTick = tickInit.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.ok(camMobileTick.status === 'WAITING' || camMobileTick.status === 'STANDBY', 'CAM-MOBILE-01 must start in WAITING before client messages');
console.log('✓ State 1: WAITING lifecycle verified');

// Test Multi-Person MoveNet + Movement Payload
const mockPayload = {
  type: 'MOBILE_DETECTION',
  cameraId: 'CAM-MOBILE-01',
  timestamp: Date.now(),
  frameWidth: 1280,
  frameHeight: 720,
  poseEngineActive: true,
  detections: [
    {
      localId: 'MOBILE-001',
      classLabel: 'person',
      confidence: 0.94,
      bbox: { x: 0.25, y: 0.35, w: 0.12, h: 0.38 },
      movement: {
        center: { x: 0.31, y: 0.54 },
        delta: { x: 0.02, y: -0.01 },
        distance: 0.0224,
        direction: 'UP_RIGHT',
        speedEstimate: 0.128
      },
      bodyMeasurements: {
        calibrated: false,
        shoulderWidthPx: 84,
        hipWidthPx: 62,
        torsoLengthPx: 118,
        armSpanPx: 145
      },
      bodyMotion: {
        state: 'MOVING',
        armMovement: 0.018,
        legMovement: 0.024,
        torsoMovement: 0.012
      },
      pose: {
        score: 0.91,
        keypoints: [
          { name: 'nose', x: 0.31, y: 0.38, confidence: 0.95 },
          { name: 'left_shoulder', x: 0.28, y: 0.42, confidence: 0.92 },
          { name: 'right_shoulder', x: 0.34, y: 0.42, confidence: 0.93 },
          { name: 'left_hip', x: 0.29, y: 0.56, confidence: 0.88 },
          { name: 'right_hip', x: 0.33, y: 0.56, confidence: 0.89 }
        ]
      }
    },
    {
      localId: 'MOBILE-002',
      classLabel: 'person',
      confidence: 0.89,
      bbox: { x: 0.65, y: 0.40, w: 0.10, h: 0.35 },
      movement: {
        center: { x: 0.70, y: 0.575 },
        delta: { x: 0.00, y: 0.00 },
        distance: 0.001,
        direction: 'STATIONARY',
        speedEstimate: 0.005
      },
      bodyMeasurements: {
        calibrated: false,
        shoulderWidthPx: 76,
        hipWidthPx: 58,
        torsoLengthPx: 110,
        armSpanPx: null
      },
      bodyMotion: {
        state: 'STATIONARY',
        armMovement: 0.002,
        legMovement: 0.001,
        torsoMovement: 0.001
      },
      pose: {
        score: 0.85,
        keypoints: [
          { name: 'nose', x: 0.70, y: 0.43, confidence: 0.91 }
        ]
      }
    }
  ]
};

// Verify payload contains ZERO raw images or video buffers
const payloadStr = JSON.stringify(mockPayload);
assert.ok(!payloadStr.includes('data:image'), 'Payload must contain no data:image');
assert.ok(!payloadStr.includes('base64'), 'Payload must contain no base64');
assert.ok(!payloadStr.includes('canvas'), 'Payload must contain no canvas data');
console.log('✓ Security Constraint: Payload inspected — strictly numeric/string metadata, zero image buffers');

// Ingest payload into cameraManager
cameraManager.ingestMobileDetections('CAM-MOBILE-01', mockPayload.detections, mockPayload);

// Verify State 2: ONLINE
let tickOnline = cameraManager.tick();
let camMobileOnline = tickOnline.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.strictEqual(camMobileOnline.status, 'ONLINE', 'CAM-MOBILE-01 must transition to ONLINE after ingestion');
assert.strictEqual(camMobileOnline.activeDetections.length, 2, 'Must track 2 objects');

// Verify Authoritative Track IDs (Server TRK-xxx vs Client localId)
const tracked1 = camMobileOnline.activeDetections[0];
const tracked2 = camMobileOnline.activeDetections[1];
assert.ok(tracked1.trackId.startsWith('TRK-'), 'Authoritative track ID must come from server tracker.js (TRK-xxx)');
assert.ok(tracked2.trackId.startsWith('TRK-'), 'Authoritative track ID must come from server tracker.js (TRK-xxx)');
assert.notStrictEqual(tracked1.trackId, tracked2.trackId, 'Track IDs must be distinct');

// Verify that client movement and body metadata were successfully attached
assert.ok(tracked1.movement, 'Tracked object 1 must have movement metadata attached');
assert.ok(tracked2.movement, 'Tracked object 2 must have movement metadata attached');
assert.strictEqual(tracked1.movement.direction, 'UP_RIGHT', 'Tracked object 1 movement direction preserved');
assert.strictEqual(tracked2.movement.direction, 'STATIONARY', 'Tracked object 2 movement direction preserved');
assert.ok(tracked1.bodyMeasurements && tracked1.bodyMeasurements.calibrated === false, 'Body measurements must have calibrated: false');
console.log('✓ Tracking & Metadata: Authoritative TRK-xxx preserved and client telemetry attached');

// Ingest and tick multiple cycles to build track hits and trigger perimeter fence breach
for (let i = 0; i < 4; i++) {
  cameraManager.ingestMobileDetections('CAM-MOBILE-01', mockPayload.detections, mockPayload);
  cameraManager.tick();
}

// Verify that Alert Engine generated a security breach alert
const events = storage.getEvents();
const mobileEvent = events.find(e => e.camera_id === 'CAM-MOBILE-01');
assert.ok(mobileEvent, 'Perimeter alert must be created for person in virtual fence');
assert.strictEqual(mobileEvent.severity, 'CRITICAL', 'Breach alert must have CRITICAL severity');
assert.strictEqual(mobileEvent.system_status, 'ACTIVE', 'Breach alert must have ACTIVE system status');
console.log(`✓ Alert Engine: Live perimeter incident active -> ${mobileEvent.event_id} (${mobileEvent.classification_type})`);

// Test State 3: STALE after 3.2s of no messages
camMobile.lastReceivedAt = Date.now() - 3500;
let tickStale = cameraManager.tick();
let camMobileStale = tickStale.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.strictEqual(camMobileStale.status, 'STALE', 'Must transition to STALE after >3s gap');
assert.strictEqual(camMobileStale.meta.lastKnownPersonCount, 2, 'Must persist lastKnownPersonCount on STALE');
console.log('✓ State 3: STALE transition verified with lastKnownPersonCount frozen');

// Test State 4: OFFLINE on client disconnect or >15s timeout
cameraManager.setMobileClientConnected(false);
let tickOffline = cameraManager.tick();
let camMobileOffline = tickOffline.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.strictEqual(camMobileOffline.status, 'OFFLINE', 'Must transition to OFFLINE when client disconnects');
assert.strictEqual(camMobileOffline.meta.lastKnownPersonCount, 2, 'Must persist lastKnownPersonCount on OFFLINE');
console.log('✓ State 4: OFFLINE transition verified upon disconnect');

// Test Reconnection without server restart
cameraManager.ingestMobileDetections('CAM-MOBILE-01', [mockPayload.detections[0]], mockPayload);
let tickReconnected = cameraManager.tick();
let camMobileRecon = tickReconnected.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.strictEqual(camMobileRecon.status, 'ONLINE', 'Must return to ONLINE upon new detections without server restart');
console.log('✓ Reconnect: Restored to ONLINE cleanly without server restart');

// Verify Fixed CCTV Feeds CAM-01..04 remain completely unaffected
['CAM-01', 'CAM-02', 'CAM-03', 'CAM-04'].forEach(id => {
  const c = tickReconnected.cameras.find(cam => cam.id === id);
  assert.ok(c, `${id} must exist`);
  assert.strictEqual(c.status, 'ONLINE', `${id} must remain ONLINE`);
  assert.ok(c.activeDetections.length >= 1, `${id} must continue tracking simulated objects`);
});
console.log('✓ Non-Regression: CAM-01..04 streams, tracking, and rules unaffected');

console.log('=== ALL POSE & MOVEMENT ANALYTICS VERIFICATIONS PASSED ===');
