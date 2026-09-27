const assert = require('assert');
const { WebSocket } = require('ws');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

console.log('=== TESTING PHONE MULTI-OBJECT DETECTION & CENTER FOCUS INTEGRATION ===');

async function testPhoneFeatures() {
  const wsOperator = new WebSocket('ws://localhost:3000');

  // 1. Wait for INIT
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for operator INIT')), 5000);
    wsOperator.on('open', () => console.log('✓ Operator connected to ws://localhost:3000'));
    wsOperator.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'INIT') {
          clearTimeout(timeout);
          resolve();
        }
      } catch (e) {}
    });
    wsOperator.on('error', reject);
  });

  // 2. Connect Mobile Phone Client
  const wsPhone = new WebSocket('ws://localhost:3000');
  await new Promise((resolve, reject) => {
    wsPhone.on('open', resolve);
    wsPhone.on('error', reject);
  });
  console.log('✓ Phone WebSocket connected');

  wsPhone.send(JSON.stringify({
    type: 'MOBILE_CAMERA_CONNECT',
    cameraId: 'CAM-MOBILE-01',
    device: 'mobile'
  }));

  // 3. Test Multi-Class Object Detections & Frame Image Streaming
  const sampleFrameImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...mockFrameData...';
  const objectDetections = [
    { classLabel: 'cell phone', confidence: 0.94, bbox: { x: 0.35, y: 0.40, w: 0.15, h: 0.25 } },
    { classLabel: 'bottle', confidence: 0.88, bbox: { x: 0.60, y: 0.45, w: 0.10, h: 0.30 } },
    { classLabel: 'person', confidence: 0.96, bbox: { x: 0.10, y: 0.20, w: 0.25, h: 0.70 } }
  ];

  const detectionPayload = {
    type: 'MOBILE_DETECTION',
    cameraId: 'CAM-MOBILE-01',
    timestamp: Date.now(),
    frameImage: sampleFrameImage,
    frameWidth: 1280,
    frameHeight: 720,
    detections: objectDetections
  };

  // Wait for CAMERA_UPDATE containing our frameImage and object detections
  // Wait for CAMERA_UPDATE containing our frameImage and object detections
  const updatePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for CAMERA_UPDATE with frameImage and activeDetections')), 5000);
    function onMsg(data) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'CAMERA_UPDATE') {
          const mobileCam = (msg.data.cameras || []).find(c => c.id === 'CAM-MOBILE-01');
          if (mobileCam && mobileCam.frameImage === sampleFrameImage && mobileCam.activeDetections && mobileCam.activeDetections.length > 0) {
            clearTimeout(timeout);
            wsOperator.off('message', onMsg);
            resolve(mobileCam);
          }
        }
      } catch (e) {}
    }
    wsOperator.on('message', onMsg);
  });

  // Send detection payload multiple times (simulate video stream across ticks)
  for (let i = 0; i < 6; i++) {
    wsPhone.send(JSON.stringify(detectionPayload));
    await new Promise(r => setTimeout(r, 125));
  }

  const updatedCam = await updatePromise;
  assert.ok(updatedCam, 'CAM-MOBILE-01 should be updated');
  assert.strictEqual(updatedCam.frameImage, sampleFrameImage, 'Live frameImage must be broadcast to operator');
  console.log('✓ Verified: Phone camera live video frameImage broadcast through C2 pipeline');

  // Verify multi-class object tracking
  const trackedClasses = updatedCam.activeDetections.map(d => d.classLabel);
  console.log(`✓ Active tracked classes on CAM-MOBILE-01: ${trackedClasses.join(', ')}`);
  assert.ok(trackedClasses.includes('cell phone') || trackedClasses.includes('bottle') || trackedClasses.includes('person'),
    'Should track multiple detected object classes from phone camera');

  // 4. Test Remote Center Focus Request (Phone requests dashboard center viewport)
  const focusPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for FOCUS_CAMERA broadcast')), 4000);
    function onMsg(data) {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'FOCUS_CAMERA' && msg.data.cameraId === 'CAM-MOBILE-01') {
          clearTimeout(timeout);
          wsOperator.off('message', onMsg);
          resolve(msg.data);
        }
      } catch (e) {}
    }
    wsOperator.on('message', onMsg);
  });

  wsPhone.send(JSON.stringify({
    type: 'MOBILE_REQUEST_FOCUS',
    cameraId: 'CAM-MOBILE-01',
    timestamp: Date.now()
  }));

  const focusResult = await focusPromise;
  assert.strictEqual(focusResult.cameraId, 'CAM-MOBILE-01');
  console.log('✓ Verified: MOBILE_REQUEST_FOCUS broadcasts FOCUS_CAMERA to center viewport');

  // Cleanup
  wsPhone.close();
  wsOperator.close();
  console.log('=== ALL PHONE CAMERA OBJECT DETECTION & CENTER TESTS PASSED! ===');
  process.exit(0);
}

testPhoneFeatures().catch(err => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
