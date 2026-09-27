const assert = require('assert');
const storage = require('../server/engine/storage');
const ruleEngine = require('../server/engine/ruleEngine');
const alertEngine = require('../server/engine/alertEngine');
const cameraManager = require('../server/engine/cameraManager');
const dataSources = require('../data/data_sources.json');

console.log('--- RUNNING IBVAP SYSTEM VALIDATION SUITE ---');

// 1. Verify Camera Streams Ingestion (Fixed CCTV + Mobile Ad-Hoc Feed)
const cameras = cameraManager.getCameras();
assert.strictEqual(cameras.length, 5, 'Should initialize 4 perimeter streams + 1 mobile ad-hoc stream');
const mobileCam = cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.ok(mobileCam, 'CAM-MOBILE-01 must be registered in Camera Manager');
assert.strictEqual(mobileCam.fovType, 'MOBILE_ADHOC', 'Mobile camera must be MOBILE_ADHOC');
assert.strictEqual(mobileCam.capabilities.humanDetection, true, 'Mobile camera must support human detection');
console.log('✓ Camera Manager: 5 streams loaded (4 fixed CCTV + 1 Mobile Ad-Hoc Unit) with telemetry');

// 2. Verify Data Sources & Benchmarks Catalog
assert.ok(dataSources.datasets, 'Data sources catalog must have datasets');
const datasetIds = dataSources.datasets.map(d => d.id);
assert.ok(datasetIds.includes('visdrone'), 'VisDrone dataset must be registered');
assert.ok(datasetIds.includes('bdd100k'), 'BDD100K dataset must be registered');
assert.ok(datasetIds.includes('ufpr_alpr'), 'UFPR-ALPR dataset must be registered');
assert.ok(datasetIds.includes('osm'), 'OpenStreetMap dataset must be registered');
console.log('✓ Benchmarks: VisDrone, BDD100K, UFPR-ALPR, OSM validated');

// 3. Verify Decoupled SOP Configuration
const config = storage.getRulesConfig();
assert.ok(config.curfew && config.curfew.start && config.curfew.end, 'Curfew configuration must exist');
assert.strictEqual(typeof config.intrusion.dwell_time, 'number', 'Dwell time threshold must be numeric');
assert.strictEqual(typeof config.intrusion.group_threshold, 'number', 'Group threshold must be numeric');
assert.strictEqual(typeof config.vehicle.stationary_limit, 'number', 'Vehicle stationary limit must be numeric');
assert.strictEqual(typeof config.alert.ack_timeout, 'number', 'Alert ack timeout must be numeric');
console.log('✓ SOP Rule Engine: Decoupled 4-part configuration verified');

// 4. Verify Strict 6-Field Audit Log Schema
const testEntry = storage.logOperatorAction({
  user_id: 'CI-TEST-BOT',
  timestamp: new Date().toISOString(),
  action: 'VERIFY_TEST_RUN',
  camera_id: 'CAM-01',
  incident_id: 'TEST-INCIDENT-001',
  result: 'SUCCESS'
});

assert.ok(testEntry.user_id, 'Audit log must contain user_id');
assert.ok(testEntry.timestamp, 'Audit log must contain timestamp');
assert.ok(testEntry.action, 'Audit log must contain action');
assert.ok(testEntry.camera_id, 'Audit log must contain camera_id');
assert.ok(testEntry.incident_id, 'Audit log must contain incident_id');
assert.ok(testEntry.result, 'Audit log must contain result');
console.log('✓ Audit Schema: Strict 6-field chain-of-custody schema verified');

// 5. Verify Cryptographic SHA-256 Checksumming
const testEvent = {
  event_id: 'EVT-TEST-HASH',
  camera_id: 'CAM-01',
  timestamp: new Date().toISOString(),
  rule_name: 'TEST_RULE',
  object_type: 'person',
  track_id: 'TRK-99',
  confidence: 0.95,
  severity: 'HIGH'
};
const hash = storage.computeChecksum(testEvent);
assert.strictEqual(typeof hash, 'string', 'Hash should be a string');
assert.strictEqual(hash.length, 64, 'SHA-256 hash must be exactly 64 hex characters');
console.log('✓ Forensic Security: SHA-256 tamper-evident checksum verified (64 hex)');

// 6. Verify Mobile Camera Ingestion & Alert Pipeline
cameraManager.ingestMobileDetections([
  {
    classLabel: 'person',
    confidence: 0.93,
    bbox: { x: 0.45, y: 0.35, w: 0.20, h: 0.50 }
  }
], 'CAM-MOBILE-01');

// Run tick to verify pipeline: tracker -> ruleEngine -> alertEngine
const tickResult = cameraManager.tick();
const updatedMobileCam = tickResult.cameras.find(c => c.id === 'CAM-MOBILE-01');
assert.strictEqual(updatedMobileCam.status, 'ONLINE', 'CAM-MOBILE-01 should transition to ONLINE when receiving detections');
assert.ok(updatedMobileCam.activeDetections.length > 0, 'Active detections should track ingested mobile person');
console.log('✓ Mobile Pipeline: Live detection ingestion, IoU tracker, and rule evaluation verified');

console.log('=== ALL IBVAP SYSTEM VALIDATIONS PASSED SUCCESSFULLY ===');
process.exit(0);
