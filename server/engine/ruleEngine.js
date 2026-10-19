// Deterministic, explainable, and auditable rule engine
// Downstream of "what/where is the object" (Section 4 & 13)

class RuleEngine {
  constructor() {
    this.zoneDwellState = new Map(); // key `${trackId}_${zoneId}` -> { firstEntered, lastSeen, dwellSec, confirmFrames }
  }

  // Ray-casting point-in-polygon algorithm
  _pointInPolygon(point, vs) {
    const x = point.x;
    const y = point.y;
    let inside = false;

    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i].x;
      const yi = vs[i].y;
      const xj = vs[j].x;
      const yj = vs[j].y;

      const intersect = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }

    return inside;
  }

  // Distance from point to line segment
  _distToSegment(p, v, w) {
    const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  }

  // Distance from point to polygon boundary
  _distToPolygon(point, vs) {
    if (!vs || vs.length === 0) return Infinity;
    let minDist = Infinity;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const d = this._distToSegment(point, vs[j], vs[i]);
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  // Check if trajectory line segment crossed a tripwire line segment
  _lineCrossed(p1, p2, l1, l2) {
    function ccw(A, B, C) {
      return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    }
    return (ccw(p1, l1, l2) !== ccw(p2, l1, l2)) && (ccw(p1, p2, l1) !== ccw(p1, p2, l2));
  }

  _isCurfewActive(config) {
    if (!config || !config.curfew || config.curfew.enabled !== true) {
      return false;
    }
    const curfewConfig = config.curfew;
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();

    const startStr = curfewConfig.start || '22:00';
    const endStr = curfewConfig.end || '05:30';
    const [sH, sM] = startStr.split(':').map(Number);
    const [eH, eM] = endStr.split(':').map(Number);
    const startMins = sH * 60 + sM;
    const endMins = eH * 60 + eM;

    if (startMins > endMins) {
      // Over midnight (e.g. 22:00 to 05:30)
      return currentMins >= startMins || currentMins <= endMins;
    }
    return currentMins >= startMins && currentMins <= endMins;
  }

  // Heuristic presentation-attack / photo / screen verification
  _detectPresentationAttack(obj, allObjects) {
    const isPerson = (obj.classLabel || '').toLowerCase() === 'person';
    if (!isPerson) return { isSpoof: false };

    // 1. Screen / device co-occurrence and containment check
    // If a person is displayed on a phone, tablet, laptop, or TV, standard object detectors
    // often detect both 'cell phone'/'laptop'/'tv' and 'person' overlapping or containing each other.
    const screenClasses = ['cell phone', 'phone', 'laptop', 'tv', 'remote', 'book', 'tablet'];
    for (const other of allObjects) {
      if (other === obj) continue;
      const otherClass = (other.classLabel || '').toLowerCase();
      if (screenClasses.includes(otherClass) && other.bbox) {
        // Calculate overlap / containment
        const xA = Math.max(obj.bbox.x, other.bbox.x);
        const yA = Math.max(obj.bbox.y, other.bbox.y);
        const xB = Math.min(obj.bbox.x + obj.bbox.w, other.bbox.x + other.bbox.w);
        const yB = Math.min(obj.bbox.y + obj.bbox.h, other.bbox.y + other.bbox.h);
        const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
        const personArea = obj.bbox.w * obj.bbox.h;

        if (personArea > 0 && (interArea / personArea) > 0.35) {
          return {
            isSpoof: true,
            reason: `SCREEN_PRESENTATION_ATTACK_DETECTED: Overlaps with detected ${otherClass} (${Math.round((interArea / personArea) * 100)}% overlap)`
          };
        }
      }
    }

    // 2. Static Floating Photo Check
    // A printed photo held up to a camera typically has its bottom edge floating in the air (y < 0.45)
    // while having disproportionately large dimensions (w > 0.28, h > 0.40) and completely zero speed.
    const groundY = obj.groundPoint ? obj.groundPoint.y : (obj.bbox.y + obj.bbox.h);
    const isFloatingMidair = groundY < 0.42;
    const isDisproportionatelyLarge = (obj.bbox.w > 0.28 || obj.bbox.h > 0.45);
    const isCompletelyRigid = (obj.speed || 0) < 0.15 && (obj.hits >= 4);

    if (isFloatingMidair && isDisproportionatelyLarge && isCompletelyRigid) {
      return {
        isSpoof: true,
        reason: `STATIC_PHOTO_ANOMALY: Floating elevation (${groundY.toFixed(2)}) and rigid scale without ground contact`
      };
    }

    return { isSpoof: false };
  }

  evaluate(trackedObjects, zones, config, cameraContext = {}) {
    const triggers = [];
    const now = Date.now();
    const isCurfew = this._isCurfewActive(config);
    const cameraId = cameraContext.id || 'CAM-UNKNOWN';

    // Extract SOP thresholds
    const minHeight = (config.tuning && config.tuning.min_bbox_height_px) || config.minBboxHeightPx || 20;
    const persistence = (config.tuning && config.tuning.multi_frame_persistence) || config.multiFramePersistence || 3;
    const defaultDwell = (config.intrusion && config.intrusion.dwell_time) || config.dwellThresholdSec || 5;
    const defaultVehicleStop = (config.vehicle && config.vehicle.stationary_limit) || config.vehicleStopThresholdSec || 6;
    const groupLimit = (config.intrusion && config.intrusion.group_threshold) || config.groupThresholdCount || 3;
    const minConfirmFrames = (config.tuning && config.tuning.zone_confirm_frames) || 3;

    for (const obj of trackedObjects) {
      // 1. Filter out sub-threshold objects (insects, leaf movement)
      const bboxHeightNorm = obj.bbox.h;
      if (bboxHeightNorm * 1080 < minHeight) {
        continue;
      }

      // 2. Minimum confidence threshold check
      const minConfidence = (config.tuning && config.tuning.min_confidence) || 0.60;
      if (typeof obj.confidence === 'number' && obj.confidence < minConfidence) {
        continue;
      }

      // 3. Anti-Spoofing / Presentation Attack Check
      const spoofCheck = this._detectPresentationAttack(obj, trackedObjects);
      if (spoofCheck.isSpoof) {
        obj.isPhotoSpoof = true;
        obj.presentationAttackDetected = true;
        obj.spoofReason = spoofCheck.reason;
        console.warn(`[ANTI_SPOOF] camera=${cameraId} track=${obj.trackId} class=${obj.classLabel} REJECTED: ${spoofCheck.reason}`);
        // Suppress automatic intrusion alarm for suspected photo/screen presentation
        continue;
      }

      // 4. Multi-frame persistence check (reject single-frame flicker)
      if (obj.hits < persistence) {
        console.log(`[ZONE_EVAL] camera=${cameraId} track=${obj.trackId} hits=${obj.hits}/${persistence} result=PENDING reason=INSUFFICIENT_TRACK_PERSISTENCE`);
        continue;
      }

      // Ground contact point approximation (bottom-center of bounding box)
      const groundPoint = obj.groundPoint || {
        x: obj.bbox.x + obj.bbox.w / 2,
        y: obj.bbox.y + obj.bbox.h
      };

      const centroid = obj.centroid || {
        x: obj.bbox.x + obj.bbox.w / 2,
        y: obj.bbox.y + obj.bbox.h / 2
      };

      // Previous centroid for tripwire crossing checks
      const traj = obj.trajectory || [];
      const prevCentroid = traj.length >= 2 ? traj[traj.length - 2] : centroid;

      // 5. Curfew Alert
      if (isCurfew && (obj.classLabel === 'person' || obj.classLabel === 'civilian_vehicle')) {
        triggers.push({
          ruleId: 'RULE-CURFEW-VIOLATION',
          ruleName: 'Curfew Hours Movement Breach',
          ruleType: 'CURFEW_BREACH',
          trackId: obj.trackId,
          objectType: obj.classLabel,
          confidence: obj.confidence,
          severity: 'CRITICAL',
          details: `Detected ${obj.classLabel} movement during strict curfew window.`,
          zoneId: null,
          zoneName: 'Global Sector Curfew',
          dwellSec: obj.dwellSec,
          proximity: obj.proximity || null
        });
      }

      // 6. Check against configured camera zones
      for (const zone of zones) {
        if (!zone.enabled) continue;

        if (zone.type === 'polygon') {
          // Use the person's bottom-center bounding-box point as default ground-contact approximation
          const isInside = this._pointInPolygon(groundPoint, zone.points);
          const stateKey = `${cameraId}_${obj.trackId}_${zone.id}`;

          // Determine zone boundary relationship
          let zoneStatus = 'OUTSIDE';
          if (isInside) {
            zoneStatus = this.zoneDwellState.has(stateKey) ? 'INSIDE' : 'ENTERING';
          } else {
            const distToBorder = this._distToPolygon(groundPoint, zone.points);
            zoneStatus = (distToBorder <= 0.06) ? 'APPROACHING' : 'OUTSIDE';
          }
          obj.zoneStatus = zoneStatus;

          if (isInside) {
            let dwellState = this.zoneDwellState.get(stateKey);
            if (!dwellState) {
              dwellState = {
                firstEntered: now,
                lastSeen: now,
                dwellSec: 0,
                confirmFrames: 1
              };
              this.zoneDwellState.set(stateKey, dwellState);
            } else {
              dwellState.lastSeen = now;
              dwellState.dwellSec = (now - dwellState.firstEntered) / 1000;
              dwellState.confirmFrames = (dwellState.confirmFrames || 0) + 1;
            }

            // Multi-frame confirmation window in zone
            const requiredConfirm = zone.confirmFrames || minConfirmFrames;
            if (dwellState.confirmFrames < requiredConfirm) {
              console.log(`[ZONE_EVAL] camera=${cameraId} track=${obj.trackId} zone=${zone.name} status=INSIDE confirm=${dwellState.confirmFrames}/${requiredConfirm} result=PENDING reason=ZONE_INTRUSION_NOT_CONFIRMED`);
              continue; // Awaiting multi-frame zone confirmation
            }

            console.log(`[ZONE_EVAL] camera=${cameraId} track=${obj.trackId} zone=${zone.name} status=INSIDE confirm=${dwellState.confirmFrames}/${requiredConfirm} ground=(${groundPoint.x.toFixed(3)}, ${groundPoint.y.toFixed(3)}) proximity=${obj.proximity?.displayDistance || 'UNKNOWN'} result=CONFIRMED`);

            // A. Virtual Fence Breach (Zero tolerance intrusion upon confirmation)
            if (zone.rule === 'VIRTUAL_FENCE') {
              const allowedClasses = (zone.targetClasses || ['person']).map(c => c.toLowerCase());
              const objClass = (obj.classLabel || '').toLowerCase();
              if (allowedClasses.includes(objClass)) {
                triggers.push({
                  ruleId: `RULE-FENCE-${zone.id}`,
                  ruleName: `Virtual Fence Breach: ${zone.name}`,
                  ruleType: 'VIRTUAL_FENCE_BREACH',
                  trackId: obj.trackId,
                  objectType: obj.classLabel,
                  confidence: obj.confidence,
                  severity: zone.severity || 'CRITICAL',
                  details: `${obj.classLabel.toUpperCase()} crossed into restricted border exclusion zone ${zone.name}.`,
                  zoneId: zone.id,
                  zoneName: zone.name,
                  dwellSec: dwellState.dwellSec,
                  proximity: obj.proximity || null,
                  groundPoint: groundPoint
                });
              }
            }

            // B. Dwell Time Violation (Loitering)
            const threshold = zone.dwellThresholdSec || defaultDwell;
            if (zone.rule === 'DWELL_VIOLATION') {
              const allowedClasses = (zone.targetClasses || ['person']).map(c => c.toLowerCase());
              const objClass = (obj.classLabel || '').toLowerCase();
              if (allowedClasses.includes(objClass) && dwellState.dwellSec >= threshold) {
                triggers.push({
                  ruleId: `RULE-DWELL-${zone.id}`,
                  ruleName: `Suspicious Loitering: ${zone.name}`,
                  ruleType: 'DWELL_VIOLATION',
                  trackId: obj.trackId,
                  objectType: obj.classLabel,
                  confidence: obj.confidence,
                  severity: zone.severity || 'HIGH',
                  details: `${obj.classLabel} lingering in ${zone.name} for ${Math.round(dwellState.dwellSec)}s (Threshold: ${threshold}s).`,
                  zoneId: zone.id,
                  zoneName: zone.name,
                  dwellSec: dwellState.dwellSec,
                  proximity: obj.proximity || null,
                  groundPoint: groundPoint
                });
              }
            }

            // C. Stationary Vehicle in Restricted Lane
            const vehicleClasses = ['civilian_vehicle', 'military_vehicle', 'vehicle', 'car', 'truck', 'bus'];
            const isVehicle = vehicleClasses.includes((obj.classLabel || '').toLowerCase());
            if (zone.rule === 'STATIONARY_VEHICLE' && isVehicle) {
              const stopThreshold = zone.dwellThresholdSec || defaultVehicleStop;
              if (dwellState.dwellSec >= stopThreshold && (obj.speed || 0) < 4.0) {
                triggers.push({
                  ruleId: `RULE-STOPPED-VEHICLE-${zone.id}`,
                  ruleName: `Stationary Vehicle Alert: ${zone.name}`,
                  ruleType: 'STATIONARY_VEHICLE',
                  trackId: obj.trackId,
                  objectType: obj.classLabel,
                  confidence: obj.confidence,
                  severity: zone.severity || 'HIGH',
                  details: `Vehicle stopped inside inspection corridor for ${Math.round(dwellState.dwellSec)}s (Limit: ${stopThreshold}s).`,
                  zoneId: zone.id,
                  zoneName: zone.name,
                  dwellSec: dwellState.dwellSec,
                  proximity: obj.proximity || null,
                  groundPoint: groundPoint
                });
              }
            }
          } else {
            // Person is OUTSIDE or merely APPROACHING the restricted zone
            console.log(`[ZONE_EVAL] camera=${cameraId} track=${obj.trackId} zone=${zone.name} status=${zoneStatus} ground=(${groundPoint.x.toFixed(3)}, ${groundPoint.y.toFixed(3)}) proximity=${obj.proximity?.displayDistance || 'UNKNOWN'} result=REJECTED reason=PERSON_OUTSIDE_ZONE`);

            // Left the zone - clean up state after 6s grace
            const dwellState = this.zoneDwellState.get(stateKey);
            if (dwellState && (now - dwellState.lastSeen > 6000)) {
              this.zoneDwellState.delete(stateKey);
            }
          }
        } else if (zone.type === 'tripwire' && zone.points.length >= 2) {
          // Directional Tripwire crossing check
          const crossed = this._lineCrossed(prevCentroid, centroid, zone.points[0], zone.points[1]);
          if (crossed) {
            const allowedClasses = (zone.targetClasses || ['person', 'civilian_vehicle', 'military_vehicle']).map(c => c.toLowerCase());
            const objClass = (obj.classLabel || '').toLowerCase();
            if (allowedClasses.includes(objClass)) {
              triggers.push({
                ruleId: `RULE-TRIPWIRE-${zone.id}`,
                ruleName: `Directional Tripwire Breach: ${zone.name}`,
                ruleType: 'TRIPWIRE_BREACH',
                trackId: obj.trackId,
                objectType: obj.classLabel,
                confidence: obj.confidence,
                severity: zone.severity || 'HIGH',
                details: `Object ${obj.trackId} breached directional tripwire ${zone.name}.`,
                zoneId: zone.id,
                zoneName: zone.name,
                dwellSec: obj.dwellSec || 1,
                proximity: obj.proximity || null,
                groundPoint: groundPoint
              });
            }
          }
        }
      }
    }

    // 7. Group Intrusion Check
    const activePersons = trackedObjects.filter(o => (o.classLabel || '').toLowerCase() === 'person' && o.hits >= persistence && !o.isPhotoSpoof);
    if (activePersons.length >= groupLimit) {
      triggers.push({
        ruleId: 'RULE-GROUP-INTRUSION',
        ruleName: `Group Gathering / Intrusion (${activePersons.length} Persons)`,
        ruleType: 'GROUP_INTRUSION',
        trackId: activePersons.map(p => p.trackId).join(','),
        objectType: 'group_person',
        confidence: 0.94,
        severity: 'CRITICAL',
        details: `Cluster of ${activePersons.length} individuals detected simultaneously within camera sector.`,
        zoneId: null,
        zoneName: 'Multi-Target Cluster',
        dwellSec: Math.max(...activePersons.map(p => p.dwellSec || 0))
      });
    }

    return triggers;
  }

  // Clear dwell and zone confirmation state when camera disconnects or resets
  clearCameraState(cameraId) {
    if (!this.zoneDwellState) return;
    for (const [key] of this.zoneDwellState.entries()) {
      if (!cameraId || key.startsWith(cameraId)) {
        this.zoneDwellState.delete(key);
      }
    }
  }
}

module.exports = new RuleEngine();
