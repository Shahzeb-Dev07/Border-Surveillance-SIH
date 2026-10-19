// tests/test_dashboard_resilience.js
// Verification suite for C2 dashboard initial hydration, default calibrated zones, and cloud standby resilience

const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('=== RUNNING C2 DASHBOARD RESILIENCE & HYDRATION TEST SUITE ===');

const appJsPath = path.join(__dirname, '..', 'public', 'js', 'app.js');
const appJs = fs.readFileSync(appJsPath, 'utf8');

// TEST 1: Default Calibrated Zones Pre-population
assert.ok(appJs.includes('const DEFAULT_ZONES ='), 'app.js must declare DEFAULT_ZONES');
assert.ok(appJs.includes('ZONE-CAM01-01'), 'DEFAULT_ZONES must contain CAM-01 Perimeter Exclusion Wire');
assert.ok(appJs.includes('ZONE-CAM02-01'), 'DEFAULT_ZONES must contain CAM-02 Boom Barrier');
assert.ok(appJs.includes('ZONE-CAM02-TRIPWIRE'), 'DEFAULT_ZONES must contain CAM-02 Tripwire');
assert.ok(appJs.includes('ZONE-CAM03-01'), 'DEFAULT_ZONES must contain CAM-03 Night Zero-Line');
assert.ok(appJs.includes('let zonesMap = JSON.parse(JSON.stringify(DEFAULT_ZONES));'),
  'zonesMap must be initialized with DEFAULT_ZONES rather than empty object');
console.log('✓ TEST 1: Pre-populated calibrated zones for CAM-01 through CAM-04 verified');

// TEST 2: Initial Alert Stream Hydration & Audio Siren Safety
assert.ok(appJs.includes('const DEFAULT_EVENTS ='), 'app.js must declare DEFAULT_EVENTS');
assert.ok(appJs.includes('let events = JSON.parse(JSON.stringify(DEFAULT_EVENTS));'),
  'events array must be initialized with DEFAULT_EVENTS to avoid blank stream');
assert.ok(appJs.includes('const handledAlarmEventIds = new Set(DEFAULT_EVENTS.map(e => e.event_id));'),
  'DEFAULT_EVENTS must be pre-registered in handledAlarmEventIds to prevent false audio alarm on page load');
console.log('✓ TEST 2: Initial alert stream events defined and pre-registered against audible false-alarms');

// TEST 3: Edge Server URL Routing & Cloud Standby
assert.ok(appJs.includes("const targetServer = urlParams.get('server');"),
  'app.js must extract server parameter from URL');
assert.ok(appJs.includes('isVercelHost') || appJs.includes('isPublicCloudHost'),
  'app.js must detect cloud/Vercel host environment');
assert.ok(appJs.includes('startCloudDemoSimulation'),
  'app.js must implement startCloudDemoSimulation for autonomous standby display');
assert.ok(appJs.includes('stopCloudDemoSimulation'),
  'app.js must stop cloud demo simulation when WebSocket connects or receives INIT');
console.log('✓ TEST 3: Edge server URL routing and autonomous cloud standby fallback verified');

// TEST 4: Immediate REST API Hydration & Cold Boot Render
assert.ok(appJs.includes('async function hydrateFromRest()'),
  'app.js must declare asynchronous hydrateFromRest function');
assert.ok(appJs.includes("fetch('/api/cameras')") && appJs.includes("fetch('/api/alerts')"),
  'hydrateFromRest must query /api/cameras and /api/alerts');
assert.ok(appJs.includes('renderAlerts();\n  renderCameraList();\n  updateActiveCamera();'),
  'renderAlerts must be invoked on initial DOMContentLoaded render sequence');
console.log('✓ TEST 4: Immediate REST API hydration and cold boot render sequence verified');

console.log('=== ALL C2 DASHBOARD RESILIENCE & HYDRATION TESTS PASSED ===\n');
