// Deterministic, explainable, and auditable rule engine
// Downstream of "what/where is the object" (Section 4 & 13)

class RuleEngine {
  constructor() {
    this.zoneDwellState = new Map(); // key `${trackId}_${zoneId}` -> { firstEntered, lastSeen, dwellSec }
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

  // Check if trajectory line segment crossed a tripwire line segment
  _lineCrossed(p1, p2, l1, l2) {
    function ccw(A, B, C) {
      return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    }
    return (ccw(p1, l1, l2) !== ccw(p2, l1, l2)) && (ccw(p1, p2, l1) !== ccw(p1, p2, l2));
  }

  _isCurfewActive(config) {
    const curfewConfig = config.curfew || { start: '22:00', end: '05:30' };
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

  evaluate(trackedObjects, zones, config, cameraContext) {
    const triggers = [];
    const now = Date.now();
    const isCurfew = this._isCurfewActive(config);

    // Extract SOP thresholds
    const minHeight = (config.tuning && config.tuning.min_bbox_height_px) || config.minBboxHeightPx || 20;
    const persistence = (config.tuning && config.tuning.multi_frame_persistence) || config.multiFramePersistence || 3;
    const defaultDwell = (config.intrusion && config.intrusion.dwell_time) || config.dwellThresholdSec || 5;
    const defaultVehicleStop = (config.vehicle && config.vehicle.stationary_limit) || config.vehicleStopThresholdSec || 6;
    const groupLimit = (config.intrusion && config.intrusion.group_threshold) || config.groupThresholdCount || 3;
    const curfewStartStr = (config.curfew && config.curfew.start) || '22:00';
    const curfewEndStr = (config.curfew && config.curfew.end) || '05:30';

    for (const obj of trackedObjects) {
      // Section 3 & 9 mitigation: Filter out sub-threshold objects (insects, leaf movement)
      const bboxHeightNorm = obj.bbox.h;
      if (bboxHeightNorm * 1080 < minHeight) {
        continue;
      }

      // Multi-frame persistence check
      if (obj.hits < persistence) {
        continue;
      }

      const centroid = {
        x: obj.bbox.x + obj.bbox.w / 2,
        y: obj.bbox.y + obj.bbox.h / 2
      };

      // Previous centroid for direction / crossing checks
      const traj = obj.trajectory || [];
      const prevCentroid = traj.length >= 2 ? traj[traj.length - 2] : centroid;

      // 1. Curfew Alert
      if (isCurfew && (obj.classLabel === 'person' || obj.classLabel === 'civilian_vehicle')) {
        triggers.push({
          ruleId: 'RULE-CURFEW-VIOLATION',
          ruleName: 'Curfew Hours Movement Breach',
          ruleType: 'CURFEW_BREACH',
          trackId: obj.trackId,
          objectType: obj.classLabel,
          confidence: obj.confidence,
          severity: 'CRITICAL',
          details: `Detected ${obj.classLabel} movement during strict curfew window (${config.curfewStart} - ${config.curfewEnd} IST).`,
          zoneId: null,
          zoneName: 'Global Sector Curfew',
          dwellSec: obj.dwellSec
        });
      }

      // Check against configured camera zones
      for (const zone of zones) {
        if (!zone.enabled) continue;

        if (zone.type === 'polygon') {
          const isInside = this._pointInPolygon(centroid, zone.points);
          const stateKey = `${obj.trackId}_${zone.id}`;

          if (isInside) {
            let dwellState = this.zoneDwellState.get(stateKey);
            if (!dwellState) {
              dwellState = { firstEntered: now, lastSeen: now, dwellSec: 0 };
              this.zoneDwellState.set(stateKey, dwellState);
            } else {
              dwellState.lastSeen = now;
              dwellState.dwellSec = (now - dwellState.firstEntered) / 1000;
            }

            // A. Virtual Fence Breach (Zero tolerance intrusion)
            if (zone.rule === 'VIRTUAL_FENCE') {
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
                dwellSec: dwellState.dwellSec
              });
            }

            // B. Dwell Time Violation (Loitering)
            const threshold = zone.dwellThresholdSec || defaultDwell;
            if (zone.rule === 'DWELL_VIOLATION' && dwellState.dwellSec >= threshold) {
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
                dwellSec: dwellState.dwellSec
              });
            }

            // C. Stationary Vehicle in Restricted Lane
            if (zone.rule === 'STATIONARY_VEHICLE' && obj.classLabel.includes('vehicle') || obj.classLabel === 'truck') {
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
                  dwellSec: dwellState.dwellSec
                });
              }
            }
          } else {
            // Left the zone - clean up state after 10s grace
            const dwellState = this.zoneDwellState.get(stateKey);
            if (dwellState && (now - dwellState.lastSeen > 10000)) {
              this.zoneDwellState.delete(stateKey);
            }
          }
        } else if (zone.type === 'tripwire' && zone.points.length >= 2) {
          // Directional Tripwire crossing check
          const crossed = this._lineCrossed(prevCentroid, centroid, zone.points[0], zone.points[1]);
          if (crossed) {
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
              dwellSec: obj.dwellSec || 1
            });
          }
        }
      }
    }

    // 2. Group Intrusion Check
    const activePersons = trackedObjects.filter(o => o.classLabel === 'person' && o.hits >= persistence);
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
}

module.exports = new RuleEngine();
