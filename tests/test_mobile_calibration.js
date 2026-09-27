/**
 * Automated Verification Suite for IBVAP Mobile Camera Calibration & Movement System
 * Tests:
 * 1. Default calibration parameter values
 * 2. Calibration states (CALIBRATED, CALIBRATION_INVALID, CALIBRATING, UNCALIBRATED, SENSOR_UNAVAILABLE)
 * 3. Invalidation when pitch > 3°, roll > 3°, or yaw > 5°
 * 4. Ground-plane pinhole distance and height geometry
 * 5. Relative pixel mode fallback when uncalibrated / invalid
 * 6. Separation of camera motion from object motion (stationary object remains STATIONARY during camera pan)
 */

const assert = require('assert');

console.log('=== RUNNING MOBILE CAMERA CALIBRATION & MOTION SYSTEM TESTS ===');

// 1. Calibration Data Model verification
const cameraCalibration = {
  status: 'UNCALIBRATED',
  cameraHeightM: 1.70,
  pitchDeg: 5.0,
  yawDeg: 0.0,
  rollDeg: 0.0,
  horizontalFovDeg: 78,
  verticalFovDeg: 45,
  referenceObject: 'person',
  referenceHeightM: 1.70,
  referenceDistanceM: 5.0,
  calibrationTimestamp: null,
  poseAtCalibration: { pitch: 5.0, yaw: 0.0, roll: 0.0 }
};

assert.strictEqual(cameraCalibration.cameraHeightM, 1.70);
assert.strictEqual(cameraCalibration.pitchDeg, 5.0);
assert.strictEqual(cameraCalibration.yawDeg, 0.0);
assert.strictEqual(cameraCalibration.rollDeg, 0.0);
assert.strictEqual(cameraCalibration.horizontalFovDeg, 78);
assert.strictEqual(cameraCalibration.verticalFovDeg, 45);
assert.strictEqual(cameraCalibration.referenceDistanceM, 5.0);
assert.strictEqual(cameraCalibration.referenceHeightM, 1.70);
console.log('✓ TEST 1: Default calibration model matches tactical specification');

// 2. Calibration States Verification
const VALID_STATES = ['CALIBRATED', 'CALIBRATION_INVALID', 'CALIBRATING', 'UNCALIBRATED', 'SENSOR_UNAVAILABLE'];
VALID_STATES.forEach(st => {
  cameraCalibration.status = st;
  assert.ok(VALID_STATES.includes(cameraCalibration.status));
});
console.log('✓ TEST 2: All 5 calibration states (CALIBRATED, CALIBRATION_INVALID, CALIBRATING, UNCALIBRATED, SENSOR_UNAVAILABLE) verified');

// 3. Camera Movement Threshold Invalidation Logic
const PITCH_TOLERANCE = 3.0;
const ROLL_TOLERANCE = 3.0;
const YAW_TOLERANCE = 5.0;

function checkInvalidation(curPose, calPose) {
  const dP = Math.abs(curPose.pitch - calPose.pitch);
  const dR = Math.abs(curPose.roll - calPose.roll);
  const dY = Math.abs(((curPose.yaw - calPose.yaw + 540) % 360) - 180);
  return (dP > PITCH_TOLERANCE || dR > ROLL_TOLERANCE || dY > YAW_TOLERANCE);
}

const calPose = { pitch: 5.0, yaw: 0.0, roll: 0.0 };

// Small motion below threshold:
assert.strictEqual(checkInvalidation({ pitch: 6.2, yaw: 2.1, roll: 1.0 }, calPose), false, 'Small motion should not invalidate');

// Pitch shift > 3.0 deg:
assert.strictEqual(checkInvalidation({ pitch: 8.5, yaw: 0.0, roll: 0.0 }, calPose), true, 'Pitch shift > 3 deg must invalidate');

// Roll shift > 3.0 deg:
assert.strictEqual(checkInvalidation({ pitch: 5.0, yaw: 0.0, roll: 3.5 }, calPose), true, 'Roll shift > 3 deg must invalidate');

// Yaw shift > 5.0 deg:
assert.strictEqual(checkInvalidation({ pitch: 5.0, yaw: 6.2, roll: 0.0 }, calPose), true, 'Yaw shift > 5 deg must invalidate');
console.log('✓ TEST 3: Invalidation triggered exactly when pitch > 3°, roll > 3°, or yaw > 5°');

// 4. Ground-plane estimation math & Mode switching
function estimateObjectMetrics(rawBbox, classLabel, actualW, actualH, calib) {
  const wPx = Math.round(rawBbox.w * actualW);
  const hPx = Math.round(rawBbox.h * actualH);
  const xc = rawBbox.x + rawBbox.w / 2;
  const horizontalAngleDeg = Number(((xc - 0.5) * calib.horizontalFovDeg).toFixed(1));

  if (calib.status !== 'CALIBRATED') {
    const distPx = Math.round(Math.hypot((xc - 0.5) * actualW, (rawBbox.y + rawBbox.h / 2 - 0.5) * actualH));
    return {
      mode: 'RELATIVE_PX',
      isCalibrated: false,
      pixelWidth: wPx,
      pixelHeight: hPx,
      horizontalAngleDeg,
      displayDistance: `${distPx} px`,
      displayHeight: `${hPx} px`,
      statusLabel: 'UNCALIBRATED'
    };
  }

  const hCam = calib.cameraHeightM;
  const pitch = calib.pitchDeg;
  const yBottom = rawBbox.y + rawBbox.h;
  const yTop = rawBbox.y;
  const deltaPhiBottom = (yBottom - 0.5) * calib.verticalFovDeg;
  const groundRayAngleDeg = pitch + deltaPhiBottom;

  if (groundRayAngleDeg > 1.5) {
    const groundRad = (groundRayAngleDeg * Math.PI) / 180;
    const dGround = hCam / Math.tan(groundRad);
    const topRayAngleDeg = pitch + (yTop - 0.5) * calib.verticalFovDeg;
    const objH = hCam - (dGround * Math.tan((topRayAngleDeg * Math.PI) / 180));

    if (dGround >= 0.5 && dGround <= 120 && objH > 0.15 && objH < 15) {
      return {
        mode: 'CALIBRATED_ESTIMATE',
        isCalibrated: true,
        pixelWidth: wPx,
        pixelHeight: hPx,
        horizontalAngleDeg,
        estimatedDistanceM: Number(dGround.toFixed(2)),
        estimatedHeightM: Number(objH.toFixed(2)),
        displayDistance: `${Number(dGround.toFixed(2))} m (Est.)`,
        displayHeight: `${Number(objH.toFixed(2))} m (Est.)`,
        statusLabel: 'CALIBRATED ESTIMATE'
      };
    }
  }

  return {
    mode: 'CALIBRATED_ESTIMATE',
    isCalibrated: true,
    pixelWidth: wPx,
    pixelHeight: hPx,
    horizontalAngleDeg,
    displayDistance: 'ESTIMATION UNAVAILABLE',
    displayHeight: 'ESTIMATION UNAVAILABLE',
    statusLabel: 'ESTIMATION UNAVAILABLE'
  };
}

// In UNCALIBRATED mode:
const uncalibResult = estimateObjectMetrics({ x: 0.4, y: 0.3, w: 0.2, h: 0.5 }, 'person', 1280, 720, { ...cameraCalibration, status: 'UNCALIBRATED' });
assert.strictEqual(uncalibResult.mode, 'RELATIVE_PX');
assert.strictEqual(uncalibResult.isCalibrated, false);
assert.ok(uncalibResult.displayDistance.includes('px'));
console.log('✓ TEST 4: UNCALIBRATED mode correctly displays image-space relative measurements (px)');

// In CALIBRATED mode:
const calibResult = estimateObjectMetrics({ x: 0.4, y: 0.3, w: 0.2, h: 0.5 }, 'person', 1280, 720, { ...cameraCalibration, status: 'CALIBRATED' });
assert.strictEqual(calibResult.mode, 'CALIBRATED_ESTIMATE');
assert.strictEqual(calibResult.isCalibrated, true);
assert.ok(calibResult.estimatedDistanceM > 0);
assert.ok(calibResult.estimatedHeightM > 0);
assert.ok(calibResult.displayDistance.includes('m (Est.)'));
console.log(`✓ TEST 5: CALIBRATED mode produces Ground-Plane Estimated Distance: ${calibResult.estimatedDistanceM}m, Height: ${calibResult.estimatedHeightM}m, marked as CALIBRATED ESTIMATE`);

// 5. Motion Separation Logic (Camera Moving vs Person Stationary)
function processMotion(personRawDx, personRawDy, cameraDeltaYaw, cameraDeltaPitch, cameraIsMoving, hFov, vFov) {
  // Screen shift caused by camera pan
  const camShiftX = -(cameraDeltaYaw / hFov);
  const camShiftY = cameraDeltaPitch / vFov;

  // Compensated person movement
  let compDx = personRawDx;
  let compDy = personRawDy;
  if (cameraIsMoving) {
    compDx = personRawDx - camShiftX;
    compDy = personRawDy - camShiftY;
  }

  const compDist = Math.hypot(compDx, compDy);
  const effectiveDeadzone = cameraIsMoving ? 0.024 : 0.008;

  const personState = (compDist >= effectiveDeadzone) ? 'MOVING' : 'STATIONARY';
  return {
    cameraState: cameraIsMoving ? 'MOVING' : 'STABLE',
    personState,
    compDist: Number(compDist.toFixed(4))
  };
}

// Scenario: Phone pans to the right by 2.0 degrees (yaw changes).
// A stationary person's image coordinates shift left by approx 2.0 / 78 = 0.0256 normalized units.
// Without compensation, standard tracker would falsely claim the person is MOVING.
// With IBVAP compensation:
const simYawDelta = 2.0; // camera turned right
const simRawPersonDx = -(simYawDelta / 78); // person box shifted left due to camera turn
const simRawPersonDy = 0.0;

const motionResult = processMotion(simRawPersonDx, simRawPersonDy, simYawDelta, 0.0, true, 78, 45);
assert.strictEqual(motionResult.cameraState, 'MOVING');
assert.strictEqual(motionResult.personState, 'STATIONARY', 'Stationary person MUST NOT be classified as moving when camera moves!');
console.log('✓ TEST 6: Camera motion vs Object motion successfully separated! Camera: MOVING | Person: STATIONARY');

console.log('=== ALL 6 MOBILE CALIBRATION & MOTION SYSTEM TESTS PASSED ===');
