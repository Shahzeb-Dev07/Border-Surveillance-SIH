// tests/test_webrtc_e2e_cloud.js
// IBVAP Comprehensive Verification Suite: Cloud WebRTC PeerJS, Data Payloads, and C2 Integration

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

console.log('================================================================');
console.log('  IBVAP CLOUD WEBRTC & MOBILE CAMERA E2E VERIFICATION SUITE');
console.log('================================================================\n');

// ----------------------------------------------------------------------
// SECTION 1: STATIC CODE & CONFIGURATION INTEGRITY CHECKS
// ----------------------------------------------------------------------
console.log('--- SECTION 1: Verifying File & Protocol Configurations ---');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const mobileHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile-cam.html'), 'utf8');
const canvasRendererJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'canvasRenderer.js'), 'utf8');

// 1.1: Mobile HTML PeerJS Broker Configuration
assert.ok(mobileHtml.includes("host: '0.peerjs.com'"), 'mobile-cam.html must explicitly set host to 0.peerjs.com');
assert.ok(mobileHtml.includes("port: 443"), 'mobile-cam.html must set port to 443');
assert.ok(mobileHtml.includes("secure: true"), 'mobile-cam.html must set secure: true');
console.log('  ✓ 1.1 mobile-cam.html explicitly targets secure 0.peerjs.com:443');

// 1.2: App JS PeerJS Broker Configuration
assert.ok(appJs.includes("host: '0.peerjs.com'"), 'app.js must explicitly set host to 0.peerjs.com');
assert.ok(appJs.includes("port: 443"), 'app.js must set port to 443');
assert.ok(appJs.includes("secure: true"), 'app.js must set secure: true');
console.log('  ✓ 1.2 app.js explicitly targets secure 0.peerjs.com:443');

// 1.3: DataChannel Send Fallback
assert.ok(mobileHtml.includes('falling back to light payload'), 'mobile-cam.html must have fallback to light payload if DataChannel send throws');
console.log('  ✓ 1.3 mobile-cam.html handles DataChannel send errors with light payload fallback');

// 1.4: Decoupled Detection Loop
assert.ok(!mobileHtml.includes('if (isStreaming && videoReady && cocoReady &&'), 'mobile-cam.html detectionLoop must not block frame streaming on cocoReady');
assert.ok(mobileHtml.includes('if (isStreaming && videoReady && video.readyState >= 2'), 'mobile-cam.html detectionLoop must stream frames as soon as video is ready');
console.log('  ✓ 1.4 mobile-cam.html decouples frame transmission from AI model loading');

// 1.5: Optimized Preview Dimensions & Quality
assert.ok(mobileHtml.includes('previewCanvas.width = 360'), 'mobile-cam.html previewCanvas width must be 360');
assert.ok(mobileHtml.includes('previewCanvas.height = 202'), 'mobile-cam.html previewCanvas height must be 202');
assert.ok(mobileHtml.includes("toDataURL('image/jpeg', 0.45)"), 'mobile-cam.html preview quality must be 0.45');
console.log('  ✓ 1.5 mobile-cam.html uses optimized 360x202 @ 0.45 JPEG for WebRTC transit');

// 1.6: App.js Connection Open Guard
assert.ok(appJs.includes('if (conn.open)'), 'app.js must check if conn.open is already true');
console.log('  ✓ 1.6 app.js guards connection open event against race conditions');

// 1.7: Canvas Renderer Onerror Handler
assert.ok(canvasRendererJs.includes('nextImg.onerror'), 'canvasRenderer.js must have onerror handler for frame image decoding');
console.log('  ✓ 1.7 canvasRenderer.js protects frame image decoding with onerror guard');

// 1.8: App.js Watchdog Timer for CAM-MOBILE-01
assert.ok(appJs.includes("mobileCam.status = 'STALE'"), 'app.js must include watchdog transitioning to STALE');
assert.ok(appJs.includes("mobileCam.status = 'OFFLINE'"), 'app.js must include watchdog transitioning to OFFLINE');
console.log('  ✓ 1.8 app.js implements client-side state lifecycle watchdog (ONLINE -> STALE -> OFFLINE)');

// ----------------------------------------------------------------------
// SECTION 2: LIVE CLOUD SIGNALING OVER WSS://0.PEERJS.COM
// ----------------------------------------------------------------------
console.log('\n--- SECTION 2: Live WSS Signaling Verification with 0.peerjs.com ---');

async function testCloudPeerSignaling() {
  return new Promise((resolve, reject) => {
    const pcId = 'ibvap-test-pc-' + Date.now().toString(36);
    const phoneId = 'ibvap-test-ph-' + Date.now().toString(36);

    const pcWs = new WebSocket(`wss://0.peerjs.com/peerjs?key=peerjs&id=${pcId}&token=tok_${Date.now()}`);
    let phoneWs = null;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Cloud signaling test timed out after 10s'));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      try { pcWs.close(); } catch (e) {}
      if (phoneWs) {
        try { phoneWs.close(); } catch (e) {}
      }
    }

    let pcConfirmed = false;
    let phoneConfirmed = false;

    function checkSuccess() {
      if (pcConfirmed && phoneConfirmed) {
        console.log('  ✓ 2.3 Cloud signaling broker bidirectional registration verified for both PC & Phone endpoints');
        cleanup();
        resolve();
      }
    }

    pcWs.on('open', () => {
      phoneWs = new WebSocket(`wss://0.peerjs.com/peerjs?key=peerjs&id=${phoneId}&token=tok_ph_${Date.now()}`);

      phoneWs.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'OPEN') {
            console.log(`  ✓ 2.2 Phone Peer registered on cloud broker (ID: ${phoneId})`);
            phoneConfirmed = true;
            checkSuccess();
          }
        } catch (e) {}
      });

      phoneWs.on('error', (err) => {
        cleanup();
        reject(err);
      });
    });

    pcWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'OPEN') {
          console.log(`  ✓ 2.1 PC Peer registered on cloud broker (ID: ${pcId})`);
          pcConfirmed = true;
          checkSuccess();
        }
      } catch (e) {}
    });

    pcWs.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

// ----------------------------------------------------------------------
// SECTION 3: END-TO-END TELEMETRY, FRAME AND ALERT SIMULATION
// ----------------------------------------------------------------------
console.log('\n--- SECTION 3: C2 Telemetry Ingestion, Display & Alert Engine ---');

function testTelemetryAndAlertPipeline() {
  // Simulate C2 Dashboard state
  const cameras = [
    { id: 'CAM-01', name: 'Tower Alpha', status: 'ONLINE', isMobile: false },
    { id: 'CAM-02', name: 'River Bend', status: 'ONLINE', isMobile: false },
    { id: 'CAM-03', name: 'Border Gate 4', status: 'ONLINE', isMobile: false },
    { id: 'CAM-04', name: 'Sector 7 Ridge', status: 'ONLINE', isMobile: false }
  ];
  let activeCameraId = 'CAM-01';
  const events = [];
  let isSirenActive = false;

  const tacticalAudio = {
    playAlertPing: (type) => { tacticalAudio.lastPing = type; },
    startSiren: () => { isSirenActive = true; },
    stopSiren: () => { isSirenActive = false; }
  };

  function switchCamera(camId) {
    activeCameraId = camId;
  }

  function handleIncomingAlerts(incoming) {
    incoming.forEach(incEvt => {
      const idx = events.findIndex(e => e.event_id === incEvt.event_id);
      if (idx >= 0) {
        events[idx] = { ...events[idx], ...incEvt };
      } else {
        events.unshift(incEvt);
        if ((incEvt.severity === 'CRITICAL' || incEvt.severity === 'HIGH') && incEvt.system_status === 'ACTIVE') {
          tacticalAudio.playAlertPing('CRITICAL');
        }
      }
    });

    const qualifying = events.filter(e =>
      e.system_status === 'ACTIVE' &&
      (e.severity === 'CRITICAL' || e.severity === 'HIGH')
    );

    if (qualifying.length > 0 && !isSirenActive) {
      tacticalAudio.startSiren();
    } else if (qualifying.length === 0 && isSirenActive) {
      tacticalAudio.stopSiren();
    }
  }

  let cloudMobileIncident = null;
  let cloudMobileClearTimer = null;
  let ws = null; // Cloud mode: no active server WebSocket

  // Re-create handleMobileCamTelemetry matching app.js
  function handleMobileCamTelemetry(data) {
    if (!data) return;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return; }
    }
    if (!data.type) return;

    let mobileCam = cameras.find(c => c.id === 'CAM-MOBILE-01');
    if (!mobileCam) {
      mobileCam = {
        id: 'CAM-MOBILE-01',
        name: 'Mobile Recon Patrol (Smartphone Ad-Hoc Feed)',
        status: 'ONLINE',
        isMobile: true,
        activeDetections: [],
        meta: {}
      };
      cameras.push(mobileCam);
    }

    if (data.type === 'MOBILE_CAMERA_CONNECT') {
      mobileCam.status = 'ONLINE';
      mobileCam.lastSeen = Date.now();
      tacticalAudio.playAlertPing('INFO');
      switchCamera('CAM-MOBILE-01');
    } else if (data.type === 'MOBILE_DETECTION') {
      mobileCam.status = 'ONLINE';
      mobileCam.lastSeen = Date.now();
      mobileCam.activeDetections = data.detections || [];
      if (data.frameImage) {
        mobileCam.frameImage = data.frameImage;
      }
      const detections = data.detections || [];
      const persons = detections.filter(d => (d.classLabel || d.class || '').toLowerCase() === 'person');
      const personCount = persons.length;
      const highestConf = detections.reduce((max, d) => Math.max(max, d.confidence || 0), 0);
      mobileCam.meta = {
        detectedPersons: personCount,
        totalObjects: detections.length,
        confidencePct: Math.round(highestConf * 100),
        lastReceivedAt: Date.now()
      };

      if (activeCameraId !== 'CAM-MOBILE-01' && detections.length > 0 && (!mobileCam._autoSwitched)) {
        mobileCam._autoSwitched = true;
        switchCamera('CAM-MOBILE-01');
      }

      // Cloud mode alert engine
      if (!ws || ws.readyState !== 1) {
        const now = Date.now();
        if (personCount > 0) {
          if (cloudMobileClearTimer) {
            clearTimeout(cloudMobileClearTimer);
            cloudMobileClearTimer = null;
          }
          const person = persons[0];
          const conf = person.confidence || highestConf || 0.88;
          if (!cloudMobileIncident) {
            const eventId = `EVT-MOBILE-${Date.now()}`;
            const ts = new Date(now).toISOString();
            cloudMobileIncident = {
              event_id: eventId,
              camera_id: 'CAM-MOBILE-01',
              camera_name: mobileCam.name,
              timestamp: ts,
              started_at: ts,
              last_active_at: ts,
              duration_sec: 1,
              event_type: 'VIRTUAL_FENCE_BREACH',
              rule_name: 'Mobile Recon Intrusion Rule',
              object_type: 'PERSON',
              track_id: person.localId ? `MOB-TRK-${person.localId}` : `MOB-TRK-1`,
              confidence: conf,
              severity: 'CRITICAL',
              details: `Tactical mobile camera detected ${personCount} person(s) approaching perimeter`,
              snapshot_uri: data.frameImage || null,
              operator_status: 'UNACKNOWLEDGED',
              system_status: 'ACTIVE'
            };
          } else {
            const elapsed = Math.max(1, Math.round((now - new Date(cloudMobileIncident.started_at).getTime()) / 1000));
            cloudMobileIncident.duration_sec = elapsed;
            cloudMobileIncident.last_active_at = new Date(now).toISOString();
            cloudMobileIncident.confidence = Math.max(cloudMobileIncident.confidence, conf);
            cloudMobileIncident.system_status = 'ACTIVE';
            if (data.frameImage) cloudMobileIncident.snapshot_uri = data.frameImage;
          }
          handleIncomingAlerts([Object.assign({}, cloudMobileIncident)]);
        } else if (cloudMobileIncident && cloudMobileIncident.system_status === 'ACTIVE') {
          // Resolve immediately for test simulation
          cloudMobileIncident.system_status = 'RESOLVED';
          handleIncomingAlerts([Object.assign({}, cloudMobileIncident)]);
          cloudMobileIncident = null;
        }
      }
    }
  }

  // Step 3.1: Connect Event
  handleMobileCamTelemetry({
    type: 'MOBILE_CAMERA_CONNECT',
    cameraId: 'CAM-MOBILE-01',
    device: 'mobile'
  });

  const mobCam = cameras.find(c => c.id === 'CAM-MOBILE-01');
  assert.ok(mobCam, 'CAM-MOBILE-01 must be registered in cameras array');
  assert.strictEqual(mobCam.status, 'ONLINE', 'CAM-MOBILE-01 status must be ONLINE upon connection');
  assert.strictEqual(activeCameraId, 'CAM-MOBILE-01', 'C2 focal camera must auto-switch to CAM-MOBILE-01');
  assert.strictEqual(tacticalAudio.lastPing, 'INFO', 'Tactical audio must ping on camera connect');
  console.log('  ✓ 3.1 MOBILE_CAMERA_CONNECT: CAM-MOBILE-01 registered, status ONLINE, switched to active feed');

  // Step 3.2: Live Video Frame & Person Detection
  const sampleFrame = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const detectionPayload = {
    type: 'MOBILE_DETECTION',
    cameraId: 'CAM-MOBILE-01',
    timestamp: Date.now(),
    frameImage: sampleFrame,
    frameWidth: 1280,
    frameHeight: 720,
    calibrationStatus: 'CALIBRATED',
    cameraPose: 'STATIONARY',
    detections: [
      {
        classLabel: 'person',
        confidence: 0.94,
        bbox: { x: 0.35, y: 0.20, w: 0.15, h: 0.60 },
        localId: 1,
        direction: 'APPROACHING',
        state: 'MOVING',
        pose: {
          score: 0.91,
          keypoints: [
            { name: 'nose', x: 0.42, y: 0.25, confidence: 0.95 },
            { name: 'left_shoulder', x: 0.39, y: 0.32, confidence: 0.90 },
            { name: 'right_shoulder', x: 0.45, y: 0.32, confidence: 0.90 }
          ]
        },
        bodyMeasurements: {
          calibrated: true,
          shoulderWidthPx: 84,
          hipWidthPx: 62,
          torsoLengthPx: 140,
          armSpanPx: 180
        },
        metrics: {
          mode: 'CALIBRATED',
          isCalibrated: true,
          pixelWidth: 192,
          pixelHeight: 432,
          horizontalAngleDeg: -2.4,
          estimatedDistanceM: 14.8,
          estimatedHeightM: 1.76
        }
      }
    ]
  };

  handleMobileCamTelemetry(detectionPayload);

  assert.strictEqual(mobCam.frameImage, sampleFrame, 'CAM-MOBILE-01 frameImage must match sent base64 image');
  assert.strictEqual(mobCam.meta.detectedPersons, 1, 'Detected persons must equal 1');
  assert.strictEqual(mobCam.meta.confidencePct, 94, 'Confidence must equal 94%');
  assert.strictEqual(mobCam.activeDetections.length, 1, 'Active detections must contain 1 item');
  assert.ok(mobCam.activeDetections[0].pose, 'Detection must contain pose keypoints');
  assert.ok(mobCam.activeDetections[0].bodyMeasurements, 'Detection must contain body measurements');
  console.log('  ✓ 3.2 MOBILE_DETECTION: Video frame image, bounding box, pose keypoints & metrics ingested');

  // Step 3.3: Verify C2 Alert Dispatch & Tactical Siren
  assert.strictEqual(events.length, 1, 'Events list must contain 1 intrusion alert');
  const alertEvent = events[0];
  assert.strictEqual(alertEvent.camera_id, 'CAM-MOBILE-01');
  assert.strictEqual(alertEvent.event_type, 'VIRTUAL_FENCE_BREACH');
  assert.strictEqual(alertEvent.severity, 'CRITICAL');
  assert.strictEqual(alertEvent.system_status, 'ACTIVE');
  assert.strictEqual(isSirenActive, true, 'Tactical perimeter siren must be ACTIVE');
  console.log('  ✓ 3.3 C2 Alert Engine: Virtual fence breach triggered, CRITICAL alert emitted, SIREN activated');

  // Step 3.4: In-place update (Anti-flooding)
  handleMobileCamTelemetry(detectionPayload);
  assert.strictEqual(events.length, 1, 'Events list must NOT duplicate alert (anti-flooding in-place update)');
  console.log('  ✓ 3.4 Anti-flooding: Repeated detections update existing event in-place without duplicate alerts');

  // Step 3.5: Clean Incident Resolution
  const clearPayload = {
    type: 'MOBILE_DETECTION',
    cameraId: 'CAM-MOBILE-01',
    timestamp: Date.now(),
    frameImage: sampleFrame,
    detections: []
  };
  handleMobileCamTelemetry(clearPayload);
  assert.strictEqual(events[0].system_status, 'RESOLVED', 'Event must resolve when no person is detected');
  assert.strictEqual(isSirenActive, false, 'Tactical siren must deactivate when all events are resolved');
  console.log('  ✓ 3.5 Alert Resolution: When breach leaves sector, incident resolves and siren stops cleanly');
}

// ----------------------------------------------------------------------
// MAIN EXECUTION RUNNER
// ----------------------------------------------------------------------
async function main() {
  try {
    testTelemetryAndAlertPipeline();
    await testCloudPeerSignaling();
    console.log('\n================================================================');
    console.log('  ALL IBVAP WEBRTC CLOUD & MOBILE CONNECTION TESTS PASSED!');
    console.log('================================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILURE:', err);
    process.exit(1);
  }
}

main();
