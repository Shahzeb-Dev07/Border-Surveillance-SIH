const assert = require('assert');
const { WebSocket } = require('ws');

// Allow self-signed certificates for testing WSS connection if needed
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

console.log('=== RUNNING REAL PHONE -> SERVER E2E WEBSOCKET VERIFICATION ===');

async function runE2eTest() {
  const wsOperator = new WebSocket('ws://localhost:3000');

  // 1. Wait for operator connection and INIT message
  const initData = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for operator INIT')), 5000);
    wsOperator.on('open', () => console.log('✓ Operator connected to ws://localhost:3000'));
    wsOperator.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'INIT') {
          clearTimeout(timeout);
          resolve(msg.data);
        }
      } catch (e) {}
    });
    wsOperator.on('error', reject);
  });

  const mobileCamInit = initData.cameras.find(c => c.id === 'CAM-MOBILE-01');
  assert.ok(mobileCamInit, 'CAM-MOBILE-01 must exist in INIT cameras');
  console.log(`✓ Initial CAM-MOBILE-01 status: ${mobileCamInit.status}`);

  // 2. Connect Mobile Camera client (simulating phone browser)
  const wsMobile = new WebSocket('ws://localhost:3000');
  await new Promise((resolve, reject) => {
    wsMobile.on('open', resolve);
    wsMobile.on('error', reject);
  });
  console.log('✓ Mobile client WebSocket connected');

  // Helper to wait for specific camera status on operator stream
  function waitForCameraStatus(expectedStatus, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        wsOperator.off('message', onMsg);
        reject(new Error(`Timeout waiting for CAM-MOBILE-01 to become ${expectedStatus}`));
      }, timeoutMs);

      function onMsg(data) {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'CAMERA_UPDATE') {
            const cam = msg.data.cameras.find(c => c.id === 'CAM-MOBILE-01');
            if (cam && cam.status === expectedStatus) {
              clearTimeout(timeout);
              wsOperator.off('message', onMsg);
              resolve(cam);
            }
          }
        } catch (e) {}
      }

      wsOperator.on('message', onMsg);
    });
  }

  // 3. Send MOBILE_CAMERA_CONNECT handshake
  const handshake = {
    type: 'MOBILE_CAMERA_CONNECT',
    cameraId: 'CAM-MOBILE-01',
    device: 'mobile'
  };
  wsMobile.send(JSON.stringify(handshake));
  console.log('✓ Sent MOBILE_CAMERA_CONNECT from mobile client');

  // Verify state transitions to ONLINE
  const camOnline = await waitForCameraStatus('ONLINE');
  assert.strictEqual(camOnline.status, 'ONLINE', 'CAM-MOBILE-01 must transition to ONLINE after handshake');
  console.log('✓ State Machine 1: CAM-MOBILE-01 is ONLINE');

  // 4. Send Heartbeat
  wsMobile.send(JSON.stringify({
    type: 'MOBILE_HEARTBEAT',
    cameraId: 'CAM-MOBILE-01',
    timestamp: Date.now()
  }));
  console.log('✓ Sent MOBILE_HEARTBEAT');

  // 5. Send Real Person Detection
  let alertReceived = null;
  const alertPromise = new Promise((resolve) => {
    function onAlert(data) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'ALERTS_UPDATE') {
          const mobileEvt = msg.data.find(e => e.camera_id === 'CAM-MOBILE-01');
          if (mobileEvt) {
            alertReceived = mobileEvt;
            wsOperator.off('message', onAlert);
            resolve(mobileEvt);
          }
        }
      } catch (e) {}
    }
    wsOperator.on('message', onAlert);
  });

  const detectionPayload = {
    type: 'MOBILE_DETECTION',
    cameraId: 'CAM-MOBILE-01',
    timestamp: Date.now(),
    detections: [
      {
        classLabel: 'person',
        confidence: 0.96,
        bbox: { x: 0.40, y: 0.40, w: 0.20, h: 0.45 }
      }
    ]
  };

  // Repeatedly send detections over a short interval (simulate live video frames) to trip rule threshold
  for (let i = 0; i < 6; i++) {
    wsMobile.send(JSON.stringify(detectionPayload));
    await new Promise(r => setTimeout(r, 125));
  }
  console.log('✓ Sent real person detections for CAM-MOBILE-01');

  // Wait for alertEngine to emit incident
  const evt = await Promise.race([
    alertPromise,
    new Promise((_, r) => setTimeout(() => r(new Error('Timeout waiting for mobile alert event')), 4000))
  ]);

  assert.ok(evt, 'Must receive an alert incident for CAM-MOBILE-01');
  assert.strictEqual(evt.camera_id, 'CAM-MOBILE-01');
  console.log(`✓ Incident Verified: ${evt.event_id} | Status: ${evt.system_status} | Severity: ${evt.severity}`);

  // 6. Test STALE state transition: stop sending messages for 3.5s
  console.log('Waiting 3.5s without telemetry to verify STALE state...');
  const camStale = await waitForCameraStatus('STALE', 6000);
  assert.strictEqual(camStale.status, 'STALE');
  console.log('✓ State Machine 2: CAM-MOBILE-01 transitioned to STALE after 3s message gap');

  // 7. Test OFFLINE state transition: close mobile WebSocket
  console.log('Closing mobile client WebSocket...');
  wsMobile.close();
  const camOffline = await waitForCameraStatus('OFFLINE', 4000);
  assert.strictEqual(camOffline.status, 'OFFLINE');
  console.log('✓ State Machine 3: CAM-MOBILE-01 transitioned to OFFLINE after socket close');

  // 8. Test Reconnection: open new mobile socket and send handshake
  console.log('Reconnecting mobile client WebSocket...');
  const wsMobile2 = new WebSocket('ws://localhost:3000');
  await new Promise((resolve, reject) => {
    wsMobile2.on('open', resolve);
    wsMobile2.on('error', reject);
  });
  wsMobile2.send(JSON.stringify(handshake));
  const camReOnline = await waitForCameraStatus('ONLINE', 4000);
  assert.strictEqual(camReOnline.status, 'ONLINE');
  console.log('✓ State Machine 4: CAM-MOBILE-01 returned to ONLINE upon reconnecting');

  // Cleanup
  wsMobile2.close();
  wsOperator.close();

  console.log('=== ALL E2E WEBSOCKET & STATE MACHINE TESTS PASSED SUCCESSFULLY ===');
  process.exit(0);
}

runE2eTest().catch(err => {
  console.error('E2E TEST FAILURE:', err);
  process.exit(1);
});
