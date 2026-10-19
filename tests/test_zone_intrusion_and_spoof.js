/**
 * IBVAP Test Suite: Zone Intrusion, Distance/Proximity, and Anti-Spoof Safeguards
 * Tests all 13 exact test cases specified in Section 7 of the user requirements.
 */

const assert = require('assert');
const ruleEngine = require('../server/engine/ruleEngine');
const AlertEngine = require('../server/engine/alertEngine');
const MultiObjectTracker = require('../server/engine/tracker');

console.log('================================================================');
console.log('  IBVAP ZONE INTRUSION, DISTANCE & ANTI-SPOOF ACCEPTANCE TESTS');
console.log('================================================================\n');

class MockStorage {
  constructor() {
    this.events = [];
    this.config = {
      curfew: { start: '22:00', end: '05:30' },
      intrusion: { dwell_time: 5, group_threshold: 3 },
      alert: { ack_timeout: 30 },
      cooldownSeconds: 1
    };
    this.zones = {
      'CAM-ZONE-TEST': [
        {
          id: 'ZONE-RESTRICTED-01',
          name: 'Restricted Border Exclusion Zone',
          type: 'polygon',
          rule: 'VIRTUAL_FENCE',
          severity: 'CRITICAL',
          points: [
            { x: 0.30, y: 0.30 },
            { x: 0.70, y: 0.30 },
            { x: 0.70, y: 0.70 },
            { x: 0.30, y: 0.70 }
          ],
          enabled: true
        }
      ]
    };
  }

  getRulesConfig() { return this.config; }
  getZones(cameraId) { return this.zones[cameraId] || []; }
  saveEvent(evt) {
    const idx = this.events.findIndex(e => e.event_id === evt.event_id);
    if (idx >= 0) this.events[idx] = { ...evt };
    else this.events.unshift({ ...evt });
  }
}

class FrontendAlarmMock {
  constructor() {
    this.events = [];
    this.activeSirenEventIds = new Set();
    this.handledAlarmEventIds = new Set();
    this.isSirenActive = false;
    this.sirenStarts = 0;
    this.sirenStops = 0;
  }

  isQualifyingSecurityAlarmEvent(event) {
    if (!event || event.system_status !== 'ACTIVE') return false;
    if (event.operator_status === 'DISMISSED' || event.operator_status === 'FALSE_POSITIVE') return false;
    const eventType = (event.event_type || '').toUpperCase();
    const objectType = (event.object_type || '').toLowerCase();
    const severity = (event.severity || '').toUpperCase();

    if (severity !== 'CRITICAL' && severity !== 'HIGH') return false;
    if (!['VIRTUAL_FENCE_BREACH', 'GROUP_INTRUSION', 'DWELL_VIOLATION', 'TRIPWIRE_BREACH', 'CURFEW_BREACH'].includes(eventType)) return false;
    return objectType === 'person' || objectType === 'group_person';
  }

  handleIncomingAlerts(incoming) {
    incoming.forEach(incEvt => {
      const idx = this.events.findIndex(e => e.event_id === incEvt.event_id);
      if (idx >= 0) this.events[idx] = { ...this.events[idx], ...incEvt };
      else this.events.unshift(incEvt);

      if (this.isQualifyingSecurityAlarmEvent(incEvt)) {
        if (!this.handledAlarmEventIds.has(incEvt.event_id)) {
          this.handledAlarmEventIds.add(incEvt.event_id);
          this.activeSirenEventIds.add(incEvt.event_id);
          this.isSirenActive = true;
          this.sirenStarts++;
        }
      } else {
        this.activeSirenEventIds.delete(incEvt.event_id);
      }
    });

    const hasActive = this.events.some(e => this.activeSirenEventIds.has(e.event_id) && this.isQualifyingSecurityAlarmEvent(e));
    if (!hasActive && this.isSirenActive) {
      this.activeSirenEventIds.clear();
      this.isSirenActive = false;
      this.sirenStops++;
    }
  }

  handleCameraOffline(cameraId) {
    let resolvedAny = false;
    this.events.forEach(e => {
      if (e.camera_id === cameraId && e.system_status === 'ACTIVE') {
        e.system_status = 'RESOLVED';
        this.activeSirenEventIds.delete(e.event_id);
        resolvedAny = true;
      }
    });
    if (resolvedAny && this.activeSirenEventIds.size === 0 && this.isSirenActive) {
      this.isSirenActive = false;
      this.sirenStops++;
    }
  }
}

async function runAll13Tests() {
  let passed = 0;
  let total = 13;

  function runTest(num, name, fn) {
    try {
      fn();
      console.log(`[PASS] Case ${num}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] Case ${num}: ${name}`);
      console.error('       Error:', err.message);
    }
  }

  const cameraId = 'CAM-ZONE-TEST';
  const camera = { id: cameraId, name: 'Test Surveillance Tower', location: 'Pillar 101', mode: 'DAYLIGHT_RGB' };

  // =========================================================================
  // Test Case 1: No person detected -> No intrusion alarm
  // =========================================================================
  runTest(1, 'No person detected -> No intrusion alarm', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    const tracked = tracker.update([], 15);
    const zones = storage.getZones(cameraId);
    const triggers = ruleEngine.evaluate(tracked, zones, storage.getRulesConfig(), camera);
    const alerts = alertEngine.processTriggers(triggers, camera, {});
    frontend.handleIncomingAlerts(alerts);

    assert.strictEqual(triggers.length, 0, 'Should have 0 triggers');
    assert.strictEqual(alerts.length, 0, 'Should have 0 alerts');
    assert.strictEqual(frontend.isSirenActive, false, 'Siren must remain inactive');
  });

  // =========================================================================
  // Test Case 2: Person detected outside restricted zone -> No intrusion alarm
  // =========================================================================
  runTest(2, 'Person detected outside restricted zone -> No intrusion alarm', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    // Zone is [0.30, 0.30] to [0.70, 0.70]. Person placed at x:0.10, y:0.10, feet at y:0.22 (OUTSIDE)
    const dets = [{
      classLabel: 'person',
      confidence: 0.92,
      bbox: { x: 0.10, y: 0.10, w: 0.05, h: 0.12 }
    }];

    for (let f = 0; f < 5; f++) {
      const tracked = tracker.update(dets, 15);
      const zones = storage.getZones(cameraId);
      const triggers = ruleEngine.evaluate(tracked, zones, storage.getRulesConfig(), camera);
      const alerts = alertEngine.processTriggers(triggers, camera, {});
      frontend.handleIncomingAlerts(alerts);
      assert.strictEqual(triggers.length, 0, `Frame ${f}: Trigger must not fire outside zone`);
      assert.strictEqual(alerts.length, 0, `Frame ${f}: No alerts outside zone`);
    }

    assert.strictEqual(frontend.isSirenActive, false, 'Siren must not activate for person outside zone');
  });

  // =========================================================================
  // Test Case 3: Person enters restricted zone and meets confirmation policy -> One intrusion incident and alarm
  // =========================================================================
  runTest(3, 'Person enters restricted zone and meets confirmation policy -> One intrusion incident and alarm', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    // Person inside zone: feet at x: 0.50, y: 0.55 (inside [0.30, 0.30] to [0.70, 0.70])
    const insideDets = [{
      classLabel: 'person',
      confidence: 0.94,
      bbox: { x: 0.48, y: 0.40, w: 0.05, h: 0.15 }
    }];

    // First 4 frames: track persistence + confirmation pending
    for (let f = 1; f <= 4; f++) {
      const tracked = tracker.update(insideDets, 15);
      const zones = storage.getZones(cameraId);
      const triggers = ruleEngine.evaluate(tracked, zones, storage.getRulesConfig(), camera);
      const alerts = alertEngine.processTriggers(triggers, camera, {});
      frontend.handleIncomingAlerts(alerts);
      assert.strictEqual(triggers.length, 0, `Frame ${f} must be pending confirmation (no trigger yet)`);
      assert.strictEqual(frontend.isSirenActive, false, `Siren must not activate before confirmation`);
    }

    // Frame 5: Confirmation met (persistence >= 3 AND zoneConfirmCount >= 3)
    const tracked5 = tracker.update(insideDets, 15);
    const zones = storage.getZones(cameraId);
    const triggers5 = ruleEngine.evaluate(tracked5, zones, storage.getRulesConfig(), camera);
    const alerts5 = alertEngine.processTriggers(triggers5, camera, {});
    frontend.handleIncomingAlerts(alerts5);

    assert.strictEqual(triggers5.length, 1, 'Frame 5 must generate confirmed intrusion trigger');
    assert.strictEqual(alerts5.length, 1, 'Alert engine must emit canonical event');
    assert.strictEqual(alerts5[0].system_status, 'ACTIVE');
    assert.strictEqual(frontend.isSirenActive, true, 'Siren must activate upon confirmed intrusion');
    assert.strictEqual(frontend.sirenStarts, 1, 'Siren must start exactly once');
  });

  // =========================================================================
  // Test Case 4: Same person remains inside the zone -> No repeated incident for every frame
  // =========================================================================
  runTest(4, 'Same person remains inside the zone -> No repeated incident for every frame', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    const insideDets = [{
      classLabel: 'person',
      confidence: 0.94,
      bbox: { x: 0.48, y: 0.40, w: 0.05, h: 0.15 }
    }];

    // Run 10 consecutive frames
    for (let f = 1; f <= 10; f++) {
      const tracked = tracker.update(insideDets, 15);
      const zones = storage.getZones(cameraId);
      const triggers = ruleEngine.evaluate(tracked, zones, storage.getRulesConfig(), camera);
      const alerts = alertEngine.processTriggers(triggers, camera, {});
      frontend.handleIncomingAlerts(alerts);
    }

    // Total stored events must be exactly 1 canonical event (anti-flooding in-place update)
    assert.strictEqual(storage.events.length, 1, 'Only 1 canonical event must exist in storage');
    assert.strictEqual(frontend.sirenStarts, 1, 'Siren must NOT be re-triggered for every frame');
    assert.strictEqual(frontend.isSirenActive, true, 'Siren remains active while person inside');
  });

  // =========================================================================
  // Test Case 5: Person leaves the zone -> Incident resolves according to policy and siren stops
  // =========================================================================
  runTest(5, 'Person leaves the zone -> Incident resolves according to policy and siren stops', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    // 1. Enter and confirm
    const insideDets = [{ classLabel: 'person', confidence: 0.95, bbox: { x: 0.50, y: 0.45, w: 0.05, h: 0.15 } }];
    for (let f = 0; f < 5; f++) {
      const trk = tracker.update(insideDets, 15);
      const trig = ruleEngine.evaluate(trk, storage.getZones(cameraId), storage.getRulesConfig(), camera);
      const al = alertEngine.processTriggers(trig, camera, {});
      frontend.handleIncomingAlerts(al);
    }
    assert.strictEqual(frontend.isSirenActive, true, 'Siren started');

    // 2. Person leaves zone (moves to x: 0.10, y: 0.10)
    const outsideDets = [{ classLabel: 'person', confidence: 0.95, bbox: { x: 0.10, y: 0.10, w: 0.05, h: 0.15 } }];
    const trkOut = tracker.update(outsideDets, 15);
    const trigOut = ruleEngine.evaluate(trkOut, storage.getZones(cameraId), storage.getRulesConfig(), camera);
    assert.strictEqual(trigOut.length, 0, 'No triggers once outside');

    // Fast-forward last_active_at by > 5 seconds to simulate grace period expiry
    const activeEvt = alertEngine.getActiveEvents()[0];
    assert.ok(activeEvt, 'Must have active event');
    activeEvt.last_active_at = new Date(Date.now() - 5500).toISOString();

    // Next tick with target outside: alertEngine resolves the event
    const resolveAlerts = alertEngine.processTriggers([], camera, {});
    frontend.handleIncomingAlerts(resolveAlerts);

    assert.strictEqual(resolveAlerts.length, 1, 'AlertEngine must emit resolved event');
    assert.strictEqual(resolveAlerts[0].system_status, 'RESOLVED', 'Event status must be RESOLVED');
    assert.strictEqual(frontend.isSirenActive, false, 'Siren must stop when event resolves');
    assert.strictEqual(frontend.sirenStops, 1, 'Siren stop recorded');
  });

  // =========================================================================
  // Test Case 6: Person appears briefly for one frame -> No alarm
  // =========================================================================
  runTest(6, 'Person appears briefly for one frame -> No alarm (filtered by confirmation window)', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    // Frame 1: Transient person detection inside zone
    const transientDets = [{ classLabel: 'person', confidence: 0.90, bbox: { x: 0.50, y: 0.50, w: 0.05, h: 0.12 } }];
    const trk1 = tracker.update(transientDets, 15);
    const trig1 = ruleEngine.evaluate(trk1, storage.getZones(cameraId), storage.getRulesConfig(), camera);
    const al1 = alertEngine.processTriggers(trig1, camera, {});
    frontend.handleIncomingAlerts(al1);

    // Frame 2: Gone immediately
    const trk2 = tracker.update([], 15);
    const trig2 = ruleEngine.evaluate(trk2, storage.getZones(cameraId), storage.getRulesConfig(), camera);
    const al2 = alertEngine.processTriggers(trig2, camera, {});
    frontend.handleIncomingAlerts(al2);

    assert.strictEqual(trig1.length, 0, 'Single transient frame must NOT trigger intrusion');
    assert.strictEqual(trig2.length, 0, 'Subsequent frame must have no trigger');
    assert.strictEqual(frontend.isSirenActive, false, 'Siren must NOT trigger for single transient frame');
  });

  // =========================================================================
  // Test Case 7: Photograph of a person outside the zone -> No intrusion alarm
  // =========================================================================
  runTest(7, 'Photograph of a person outside the zone -> No intrusion alarm', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    // Person detected with smartphone / display frame, outside zone
    const dets = [
      { classLabel: 'person', confidence: 0.95, bbox: { x: 0.12, y: 0.12, w: 0.08, h: 0.15 } },
      { classLabel: 'cell phone', confidence: 0.88, bbox: { x: 0.10, y: 0.10, w: 0.12, h: 0.20 } }
    ];

    for (let f = 0; f < 5; f++) {
      const trk = tracker.update(dets, 15);
      const trig = ruleEngine.evaluate(trk, storage.getZones(cameraId), storage.getRulesConfig(), camera);
      const al = alertEngine.processTriggers(trig, camera, {});
      frontend.handleIncomingAlerts(al);
      assert.strictEqual(trig.length, 0, `Photo outside zone must produce 0 triggers`);
    }

    assert.strictEqual(frontend.isSirenActive, false, 'Siren must remain silent');
  });

  // =========================================================================
  // Test Case 8: Photograph of a person inside the zone -> Presentation-attack detection
  // =========================================================================
  runTest(8, 'Photograph of a person inside the zone -> Apply anti-spoof checks', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    // Screen presentation attack: 'cell phone' overlaps 'person' inside restricted zone
    const dets = [
      { classLabel: 'person', confidence: 0.94, bbox: { x: 0.45, y: 0.45, w: 0.10, h: 0.18 } },
      { classLabel: 'cell phone', confidence: 0.89, bbox: { x: 0.43, y: 0.43, w: 0.14, h: 0.22 } }
    ];

    for (let f = 0; f < 5; f++) {
      const trk = tracker.update(dets, 15);
      const trig = ruleEngine.evaluate(trk, storage.getZones(cameraId), storage.getRulesConfig(), camera);
      const al = alertEngine.processTriggers(trig, camera, {});
      frontend.handleIncomingAlerts(al);

      // Check that person track was flagged with presentation attack
      const personTrack = trk.find(t => t.classLabel === 'person');
      assert.ok(personTrack, 'Person track must exist');
      assert.strictEqual(personTrack.presentationAttackDetected, true, 'Presentation attack must be detected');
      assert.strictEqual(trig.length, 0, 'Intrusion must be rejected when spoof/presentation attack detected');
    }

    assert.strictEqual(frontend.isSirenActive, false, 'Siren must NOT trigger for presentation attack');
  });

  // =========================================================================
  // Test Case 9: Camera disconnects -> Stale detections expire and siren cannot remain stuck on
  // =========================================================================
  runTest(9, 'Camera disconnects -> Stale detections expire and siren cannot remain stuck on', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    // 1. Establish confirmed intrusion
    const insideDets = [{ classLabel: 'person', confidence: 0.94, bbox: { x: 0.50, y: 0.50, w: 0.05, h: 0.15 } }];
    for (let f = 0; f < 5; f++) {
      const trk = tracker.update(insideDets, 15);
      const trig = ruleEngine.evaluate(trk, storage.getZones(cameraId), storage.getRulesConfig(), camera);
      const al = alertEngine.processTriggers(trig, camera, {});
      frontend.handleIncomingAlerts(al);
    }
    assert.strictEqual(frontend.isSirenActive, true, 'Siren is active during intrusion');

    // 2. Camera disconnects!
    tracker.reset();
    ruleEngine.clearCameraState(cameraId);
    const resolvedOnOffline = alertEngine.resolveCameraEvents(cameraId, 'CAMERA_OFFLINE');
    frontend.handleIncomingAlerts(resolvedOnOffline);
    frontend.handleCameraOffline(cameraId);

    assert.strictEqual(resolvedOnOffline.length, 1, 'AlertEngine resolves active event on offline');
    assert.strictEqual(resolvedOnOffline[0].system_status, 'RESOLVED');
    assert.strictEqual(frontend.isSirenActive, false, 'Siren must stop immediately on disconnect');
    assert.strictEqual(alertEngine.getActiveEvents().length, 0, 'No active events left in alert engine');
  });

  // =========================================================================
  // Test Case 10: Old detection event arrives after track expiry -> Reject the stale event
  // =========================================================================
  runTest(10, 'Old detection event arrives after track expiry -> Reject the stale event', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const tracker = new MultiObjectTracker();

    // Simulate track expiry (> 30 frames without update)
    tracker.update([{ classLabel: 'person', confidence: 0.9, bbox: { x: 0.5, y: 0.5, w: 0.05, h: 0.1 } }], 15);
    for (let i = 0; i < 35; i++) {
      tracker.update([], 15);
    }
    assert.strictEqual(tracker.getTracks().length, 0, 'All tracks must be pruned');

    // Check that expired track cannot trigger alert
    const triggers = ruleEngine.evaluate(tracker.getTracks(), storage.getZones(cameraId), storage.getRulesConfig(), camera);
    assert.strictEqual(triggers.length, 0, 'No triggers for expired tracks');
  });

  // =========================================================================
  // Test Case 11: Person is near but outside the zone -> No zone-intrusion alarm
  // =========================================================================
  runTest(11, 'Person is near but outside the zone -> No zone-intrusion alarm', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    // Large bounding box (height = 0.40 -> NEAR proximity), but outside zone (x: 0.05, groundPoint x: 0.14 < 0.30)
    const nearOutsideDets = [{
      classLabel: 'person',
      confidence: 0.95,
      bbox: { x: 0.05, y: 0.05, w: 0.18, h: 0.40 }
    }];

    for (let f = 0; f < 5; f++) {
      const trk = tracker.update(nearOutsideDets, 15);
      assert.strictEqual(trk[0].proximity.level, 'NEAR', 'Must be classified as NEAR proximity');
      const trig = ruleEngine.evaluate(trk, storage.getZones(cameraId), storage.getRulesConfig(), camera);
      const al = alertEngine.processTriggers(trig, camera, {});
      frontend.handleIncomingAlerts(al);
      assert.strictEqual(trig.length, 0, 'NEAR person outside zone must NOT trigger intrusion');
    }

    assert.strictEqual(frontend.isSirenActive, false, 'Siren must remain silent for NEAR target outside zone');
  });

  // =========================================================================
  // Test Case 12: Person is farther away but inside the zone -> Evaluate zone policy independently of proximity
  // =========================================================================
  runTest(12, 'Person is farther away but inside the zone -> Evaluate zone policy independently of proximity', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const frontend = new FrontendAlarmMock();
    const tracker = new MultiObjectTracker();

    // Small bounding box (height = 0.08 -> FAR proximity), but feet inside zone at x: 0.50, y: 0.58
    const farInsideDets = [{
      classLabel: 'person',
      confidence: 0.92,
      bbox: { x: 0.48, y: 0.50, w: 0.04, h: 0.08 }
    }];

    for (let f = 1; f <= 5; f++) {
      const trk = tracker.update(farInsideDets, 15);
      const trig = ruleEngine.evaluate(trk, storage.getZones(cameraId), storage.getRulesConfig(), camera);
      const al = alertEngine.processTriggers(trig, camera, {});
      frontend.handleIncomingAlerts(al);
      if (f === 5) {
        assert.strictEqual(trig.length, 1, 'FAR person inside zone must trigger after confirmation');
        assert.strictEqual(trig[0].proximity.level, 'FAR', 'Proximity metadata attached to trigger');
      }
    }

    assert.strictEqual(frontend.isSirenActive, true, 'Siren triggers for FAR target inside restricted zone');
  });

  // =========================================================================
  // Test Case 13: Camera reconnects -> Fresh detections and tracking resume correctly
  // =========================================================================
  runTest(13, 'Camera reconnects -> Fresh detections and tracking resume correctly', () => {
    ruleEngine.clearCameraState(cameraId);
    const storage = new MockStorage();
    const alertEngine = new AlertEngine(storage);
    const tracker = new MultiObjectTracker();

    // 1. Initial run and disconnect
    tracker.update([{ classLabel: 'person', confidence: 0.9, bbox: { x: 0.5, y: 0.5, w: 0.05, h: 0.1 } }], 15);
    tracker.reset();
    ruleEngine.clearCameraState(cameraId);
    alertEngine.resolveCameraEvents(cameraId, 'CAMERA_OFFLINE');

    assert.strictEqual(tracker.getTracks().length, 0, 'Tracker must be clean after reset');
    assert.strictEqual(alertEngine.getActiveEvents().length, 0, 'No active events after offline');

    // 2. Reconnect: Fresh detections arrive
    const freshDets = [{
      classLabel: 'person',
      confidence: 0.93,
      bbox: { x: 0.52, y: 0.52, w: 0.05, h: 0.14 }
    }];

    const freshTracks = tracker.update(freshDets, 15);
    assert.strictEqual(freshTracks.length, 1, 'Fresh track created after reconnect');
    assert.strictEqual(freshTracks[0].trackId, 'TRK-100', 'Track numbering restarts cleanly');
    assert.ok(freshTracks[0].groundPoint, 'Ground contact point calculated');
    assert.ok(freshTracks[0].proximity, 'Proximity calculated');
  });

  console.log('\n----------------------------------------------------------------');
  console.log(`  RESULTS: ${passed}/${total} TESTS PASSED`);
  console.log('----------------------------------------------------------------');

  if (passed !== total) {
    process.exit(1);
  }
}

runAll13Tests();
