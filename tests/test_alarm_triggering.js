const assert = require('assert');
const ruleEngine = require('../server/engine/ruleEngine');
const AlertEngine = require('../server/engine/alertEngine');
const storage = require('../server/engine/storage');
const MultiObjectTracker = require('../server/engine/tracker');

console.log('================================================================');
console.log('  IBVAP ALARM TRIGGERING & INTRUSION ACCEPTANCE TEST SUITE');
console.log('================================================================');

// Mock storage for deterministic isolated testing
class MockStorage {
  constructor() {
    this.events = [];
    this.config = {
      curfew: { start: '22:00', end: '05:30' },
      intrusion: { dwell_time: 5, group_threshold: 3 },
      vehicle: { stationary_limit: 6 },
      alert: { ack_timeout: 30 },
      tuning: { min_bbox_height_px: 20, multi_frame_persistence: 3, cooldown_seconds: 1, min_confidence: 0.60 }
    };
    this.zones = {
      'CAM-TEST-01': [
        {
          id: 'ZONE-RESTRICTED-01',
          name: 'Restricted Exclusion Zone',
          type: 'polygon',
          rule: 'VIRTUAL_FENCE',
          severity: 'CRITICAL',
          points: [
            { x: 0.20, y: 0.20 },
            { x: 0.80, y: 0.20 },
            { x: 0.80, y: 0.80 },
            { x: 0.20, y: 0.80 }
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

// Frontend Alarm State Simulation (matches public/js/app.js & audioAlert.js logic)
class FrontendAlarmController {
  constructor() {
    this.events = [];
    this.handledAlarmEventIds = new Set();
    this.activeSirenEventIds = new Set();
    this.isSirenActive = false;
    this.audioCalls = {
      playAlertPing: [],
      startSirenCount: 0,
      stopSirenCount: 0
    };
  }

  tacticalAudio = {
    playAlertPing: (sev) => { this.audioCalls.playAlertPing.push(sev); },
    startSiren: () => { this.audioCalls.startSirenCount++; this.isSirenActive = true; },
    stopSiren: () => { this.audioCalls.stopSirenCount++; this.isSirenActive = false; }
  };

  isQualifyingSecurityAlarmEvent(event) {
    if (!event || event.system_status !== 'ACTIVE') return false;
    if (event.operator_status === 'DISMISSED' || event.operator_status === 'FALSE_POSITIVE') return false;

    const eventType = (event.event_type || '').toUpperCase();
    const objectType = (event.object_type || '').toLowerCase();
    const severity = (event.severity || '').toUpperCase();

    if (severity !== 'CRITICAL' && severity !== 'HIGH') return false;

    const intrusionEventTypes = [
      'VIRTUAL_FENCE_BREACH',
      'GROUP_INTRUSION',
      'DWELL_VIOLATION',
      'TRIPWIRE_BREACH',
      'CURFEW_BREACH'
    ];
    if (!intrusionEventTypes.includes(eventType)) return false;

    const isPerson = objectType === 'person' || objectType === 'group_person';
    if (!isPerson) return false;

    return true;
  }

  handleInit(initialEvents = []) {
    this.events = [...initialEvents];
    // Rule 1: Initial page load must register all existing events so none trigger alarm audio on page load
    this.events.forEach(e => {
      if (e && e.event_id) {
        this.handledAlarmEventIds.add(e.event_id);
      }
    });
    this.activeSirenEventIds.clear();
    this.tacticalAudio.stopSiren();
    this.isSirenActive = false;
  }

  handleIncomingAlerts(incoming) {
    let newlyTriggeredQualifyingEvent = null;

    incoming.forEach(incEvt => {
      const idx = this.events.findIndex(e => e.event_id === incEvt.event_id);
      if (idx >= 0) {
        this.events[idx] = { ...this.events[idx], ...incEvt };
      } else {
        this.events.unshift(incEvt);
      }

      if (this.isQualifyingSecurityAlarmEvent(incEvt)) {
        if (!this.handledAlarmEventIds.has(incEvt.event_id)) {
          this.handledAlarmEventIds.add(incEvt.event_id);
          this.activeSirenEventIds.add(incEvt.event_id);
          newlyTriggeredQualifyingEvent = incEvt;
        }
      } else {
        this.activeSirenEventIds.delete(incEvt.event_id);
      }
    });

    if (newlyTriggeredQualifyingEvent) {
      this.tacticalAudio.playAlertPing('CRITICAL');
      this.tacticalAudio.startSiren();
      this.isSirenActive = true;
    } else {
      const hasActiveQualifying = this.events.some(e =>
        (this.activeSirenEventIds.size === 0 ? false : this.activeSirenEventIds.has(e.event_id)) &&
        this.isQualifyingSecurityAlarmEvent(e)
      );
      if (!hasActiveQualifying && this.isSirenActive) {
        this.activeSirenEventIds.clear();
        this.tacticalAudio.stopSiren();
        this.isSirenActive = false;
      }
    }
  }
}

async function runTests() {
  const mockStorage = new MockStorage();
  const alertEngine = new AlertEngine(mockStorage);
  const tracker = new MultiObjectTracker();
  const mockCamera = {
    id: 'CAM-TEST-01',
    name: 'Test Border Sector',
    location: 'BP 101 Restricted',
    mode: 'DAYLIGHT_RGB',
    fps: 15.0,
    snapshotUri: '/assets/test.jpg'
  };

  const frontend = new FrontendAlarmController();

  console.log('\n--- TEST 1: Page Load -> No Alarm ---');
  // Simulate page load where backend events exist (e.g. stale or historical active events)
  const staleEvent = {
    event_id: 'EVT-STALE-001',
    camera_id: 'CAM-TEST-01',
    event_type: 'VIRTUAL_FENCE_BREACH',
    object_type: 'person',
    severity: 'CRITICAL',
    system_status: 'ACTIVE'
  };
  frontend.handleInit([staleEvent]);
  assert.strictEqual(frontend.isSirenActive, false, 'Siren must NOT be active on page load');
  assert.strictEqual(frontend.audioCalls.startSirenCount, 0, 'startSiren must NOT be called on page load');
  assert.strictEqual(frontend.audioCalls.playAlertPing.length, 0, 'No alert ping on page load');
  console.log('  ✓ Verified: Page load with existing events produces zero audible alarms');

  console.log('\n--- TEST 2: No Detections -> No Alarm ---');
  frontend.handleIncomingAlerts([]);
  assert.strictEqual(frontend.isSirenActive, false, 'Siren must remain silent when no detections exist');
  assert.strictEqual(frontend.audioCalls.startSirenCount, 0, 'startSiren not called for empty events');
  console.log('  ✓ Verified: Zero detections produces zero audible alarms');

  console.log('\n--- TEST 3: Person Outside Restricted Zone -> No Intrusion Alarm ---');
  // Person at (0.05, 0.05) - outside the restricted zone ([0.20, 0.20]..[0.80, 0.80])
  const outsidePersonDet = [{
    classLabel: 'person',
    confidence: 0.95,
    bbox: { x: 0.04, y: 0.04, w: 0.04, h: 0.10 } // centroid: (0.06, 0.09)
  }];

  let triggers = [];
  for (let f = 0; f < 5; f++) {
    const tracked = tracker.update(outsidePersonDet, 15);
    triggers = ruleEngine.evaluate(tracked, mockStorage.getZones('CAM-TEST-01'), mockStorage.getRulesConfig(), mockCamera);
  }
  assert.strictEqual(triggers.length, 0, 'Person outside restricted zone must not generate any rule triggers');
  const outsideEvents = alertEngine.processTriggers(triggers, mockCamera, {});
  assert.strictEqual(outsideEvents.length, 0, 'No events generated for person outside zone');
  frontend.handleIncomingAlerts(outsideEvents);
  assert.strictEqual(frontend.isSirenActive, false, 'Siren must not activate for person outside zone');
  assert.strictEqual(frontend.audioCalls.startSirenCount, 0, 'startSiren not called');
  console.log('  ✓ Verified: Person detected outside restricted zone triggers no alarm');

  console.log('\n--- TEST 4: Person Enters Restricted Zone -> Alarm Triggers ---');
  // Person enters restricted zone at centroid (0.45, 0.45)
  const insidePersonDet = [{
    classLabel: 'person',
    confidence: 0.94,
    bbox: { x: 0.40, y: 0.40, w: 0.10, h: 0.20 } // centroid: (0.45, 0.50)
  }];

  let insideEvents = [];
  for (let f = 0; f < 5; f++) {
    const tracked = tracker.update(insidePersonDet, 15);
    triggers = ruleEngine.evaluate(tracked, mockStorage.getZones('CAM-TEST-01'), mockStorage.getRulesConfig(), mockCamera);
    const evts = alertEngine.processTriggers(triggers, mockCamera, {});
    if (evts.length > 0) insideEvents = evts;
  }

  assert.ok(triggers.length > 0, 'Rule engine must trigger for person inside restricted zone');
  assert.strictEqual(triggers[0].ruleType, 'VIRTUAL_FENCE_BREACH');
  assert.strictEqual(triggers[0].objectType, 'person');
  assert.ok(insideEvents.length > 0, 'Alert engine must emit breach event');
  const activeBreach = insideEvents[0];
  assert.strictEqual(activeBreach.system_status, 'ACTIVE');
  assert.strictEqual(activeBreach.severity, 'CRITICAL');

  frontend.handleIncomingAlerts(insideEvents);
  assert.strictEqual(frontend.isSirenActive, true, 'Siren must be active for valid person intrusion');
  assert.strictEqual(frontend.audioCalls.startSirenCount, 1, 'startSiren must be called exactly once');
  assert.strictEqual(frontend.audioCalls.playAlertPing.length, 1, 'playAlertPing must be called');
  assert.strictEqual(frontend.audioCalls.playAlertPing[0], 'CRITICAL');
  console.log('  ✓ Verified: Person entering restricted zone triggers audible security alarm');

  console.log('\n--- TEST 5: Unrelated Object Detected -> No Person-Intrusion Alarm ---');
  // Unrelated objects (wildlife, vehicles, phone, bottle, trees) inside the zone
  const unrelatedTracker = new MultiObjectTracker();
  const unrelatedObjects = [
    { classLabel: 'wildlife', confidence: 0.90, bbox: { x: 0.40, y: 0.40, w: 0.10, h: 0.10 } },
    { classLabel: 'civilian_vehicle', confidence: 0.95, bbox: { x: 0.40, y: 0.40, w: 0.20, h: 0.20 } },
    { classLabel: 'cell phone', confidence: 0.92, bbox: { x: 0.40, y: 0.40, w: 0.05, h: 0.10 } },
    { classLabel: 'bottle', confidence: 0.88, bbox: { x: 0.40, y: 0.40, w: 0.05, h: 0.10 } },
    { classLabel: 'dog', confidence: 0.85, bbox: { x: 0.40, y: 0.40, w: 0.10, h: 0.10 } }
  ];

  for (const obj of unrelatedObjects) {
    let unTrigs = [];
    for (let f = 0; f < 5; f++) {
      const tracked = unrelatedTracker.update([obj], 15);
      unTrigs = ruleEngine.evaluate(tracked, mockStorage.getZones('CAM-TEST-01'), mockStorage.getRulesConfig(), mockCamera);
    }
    const intrusionTrigs = unTrigs.filter(t => t.ruleType === 'VIRTUAL_FENCE_BREACH');
    assert.strictEqual(intrusionTrigs.length, 0, `Unrelated object "${obj.classLabel}" must NOT trigger virtual fence breach`);

    // Verify frontend validation rejects unrelated object alerts from activating alarm
    const mockUnrelatedEvent = {
      event_id: `EVT-UNRELATED-${obj.classLabel}`,
      camera_id: 'CAM-TEST-01',
      event_type: 'VIRTUAL_FENCE_BREACH',
      object_type: obj.classLabel,
      severity: 'CRITICAL',
      system_status: 'ACTIVE'
    };
    assert.strictEqual(frontend.isQualifyingSecurityAlarmEvent(mockUnrelatedEvent), false,
      `Frontend must reject "${obj.classLabel}" from qualifying for intrusion alarm`);
  }
  console.log('  ✓ Verified: Vehicles, wildlife, and unrelated objects do NOT trigger person-intrusion alarm');

  console.log('\n--- TEST 6: Duplicate Event -> No Repeated Alarm Flood ---');
  // Feed subsequent frames for the same ongoing breach
  const initialSirenCount = frontend.audioCalls.startSirenCount;
  const initialPingCount = frontend.audioCalls.playAlertPing.length;

  for (let frame = 1; frame <= 10; frame++) {
    const tracked = tracker.update(insidePersonDet, 15);
    triggers = ruleEngine.evaluate(tracked, mockStorage.getZones('CAM-TEST-01'), mockStorage.getRulesConfig(), mockCamera);
    const updatedEvents = alertEngine.processTriggers(triggers, mockCamera, {});
    assert.strictEqual(updatedEvents.length, 1);
    assert.strictEqual(updatedEvents[0].event_id, activeBreach.event_id, 'Must keep identical event_id across frames');

    frontend.handleIncomingAlerts(updatedEvents);
    // Anti-flooding check: audio alarm and ping must NOT re-fire for ongoing event
    assert.strictEqual(frontend.audioCalls.startSirenCount, initialSirenCount, 'startSiren must NOT re-fire for ongoing event');
    assert.strictEqual(frontend.audioCalls.playAlertPing.length, initialPingCount, 'playAlertPing must NOT re-fire for ongoing event');
  }
  console.log('  ✓ Verified: Ongoing event updates in-place without duplicate alarm flood');

  console.log('\n--- TEST 7: Event Resolution & Valid New Intrusion After Cooldown ---');
  // Intruder leaves sector
  console.log('  Simulating intruder departure...');
  let resolvedEvent = null;

  // Simulate passage of time > 5000ms with no triggers to resolve
  const origNow = Date.now;
  let simulatedTime = Date.now();
  Date.now = () => simulatedTime;

  // Advance time past 5s inactive threshold
  simulatedTime += 6000;
  const resolutionEvents = alertEngine.processTriggers([], mockCamera, {});
  resolvedEvent = resolutionEvents.find(e => e.event_id === activeBreach.event_id && e.system_status === 'RESOLVED');
  assert.ok(resolvedEvent, 'Alert engine must resolve event when intruder leaves');

  frontend.handleIncomingAlerts([resolvedEvent]);
  assert.strictEqual(frontend.isSirenActive, false, 'Siren must stop when breach event resolves');
  assert.ok(frontend.audioCalls.stopSirenCount >= 1, 'stopSiren must be called upon resolution');
  console.log('  ✓ Verified: Alarm stops cleanly when breach resolves');

  // Verify cooldown suppresses immediate re-trigger
  simulatedTime += 2000; // 2s into 20s cooldown window
  const immediateReentryTrigs = ruleEngine.evaluate(tracker.update(insidePersonDet, 15), mockStorage.getZones('CAM-TEST-01'), mockStorage.getRulesConfig(), mockCamera);
  const suppressedEvents = alertEngine.processTriggers(immediateReentryTrigs, mockCamera, {});
  assert.strictEqual(suppressedEvents.length, 0, 'Re-entry during cooldown window must be suppressed');
  console.log('  ✓ Verified: Re-entry during cooldown window is suppressed');

  // Advance time past cooldown period (default 20s cooldown)
  simulatedTime += 25000;
  let newIntrusionEvents = [];
  for (let f = 0; f < 5; f++) {
    const tracked = tracker.update(insidePersonDet, 15);
    triggers = ruleEngine.evaluate(tracked, mockStorage.getZones('CAM-TEST-01'), mockStorage.getRulesConfig(), mockCamera);
    const evts = alertEngine.processTriggers(triggers, mockCamera, {});
    if (evts.length > 0) newIntrusionEvents = evts;
  }

  Date.now = origNow; // Restore original time

  assert.ok(newIntrusionEvents.length > 0, 'Alert engine must generate new event after cooldown expires');
  const freshEvent = newIntrusionEvents[0];
  assert.notStrictEqual(freshEvent.event_id, activeBreach.event_id, 'New intrusion must have a fresh event_id');
  assert.strictEqual(freshEvent.system_status, 'ACTIVE');

  frontend.handleIncomingAlerts([freshEvent]);
  assert.strictEqual(frontend.isSirenActive, true, 'Siren must activate again for valid new intrusion after cooldown');
  assert.strictEqual(frontend.audioCalls.startSirenCount, initialSirenCount + 1, 'startSiren must trigger for new intrusion');
  assert.strictEqual(frontend.audioCalls.playAlertPing.length, initialPingCount + 1, 'playAlertPing must trigger for new intrusion');
  console.log('  ✓ Verified: Valid new intrusion after cooldown triggers alarm again');

  console.log('\n================================================================');
  console.log('  ALL 7 ALARM TRIGGERING ACCEPTANCE TESTS PASSED SUCCESSFULLY!  ');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
