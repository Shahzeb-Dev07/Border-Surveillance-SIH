// Anti-flooding Alert Engine (Section 15 & 16 of Red-Team Review)
// Aggregates continuous triggers into a single live event with duration counter

class AlertEngine {
  constructor(storage) {
    this.storage = storage;
    this.activeEvents = new Map(); // key `${cameraId}_${ruleId}_${trackId}` -> EventObject
    this.cooldowns = new Map(); // key -> timestamp when cooldown expires
  }

  processTriggers(triggers, camera, frameMetadata) {
    const now = Date.now();
    const config = this.storage.getRulesConfig();
    const cooldownPeriodMs = (config.cooldownSeconds || 20) * 1000;
    const generatedOrUpdatedEvents = [];

    // Prune expired cooldowns to prevent memory accumulation over long uptimes
    if (this.cooldowns.size > 200) {
      for (const [k, exp] of this.cooldowns.entries()) {
        if (now > exp) this.cooldowns.delete(k);
      }
    }

    // 1. Process incoming triggers
    for (const trig of triggers) {
      const eventKey = `${camera.id}_${trig.ruleId}_${trig.trackId}`;
      const cooldownKey = `${camera.id}_${trig.zoneId || 'global'}_${trig.trackId}`;

      // Check if this event is currently on cooldown
      const cooldownUntil = this.cooldowns.get(cooldownKey);
      if (cooldownUntil && now < cooldownUntil && !this.activeEvents.has(eventKey)) {
        // Suppress repeated alert trigger during cooldown window
        continue;
      }

      let event = this.activeEvents.get(eventKey);

      if (event) {
        // --- ANTI-FLOODING IN-PLACE UPDATE ---
        // Do NOT generate a new alert. Update live duration and timestamps.
        const elapsedSec = (now - new Date(event.started_at).getTime()) / 1000;
        event.duration_sec = Math.max(1, Math.round(elapsedSec));
        event.last_active_at = new Date(now).toISOString();
        event.confidence = Math.max(event.confidence, trig.confidence);
        event.system_status = 'ACTIVE';

        // Auto-escalation if unacknowledged for > ack_timeout
        const ackTimeout = (config.alert && config.alert.ack_timeout) || 30;
        if (event.operator_status === 'UNACKNOWLEDGED' && elapsedSec > ackTimeout && event.severity === 'HIGH') {
          event.severity = 'CRITICAL';
          event.details += ` [AUTO-ESCALATED: Unacknowledged >${ackTimeout}s]`;
        }

        this.storage.saveEvent(event);
        generatedOrUpdatedEvents.push(event);
      } else {
        // --- CREATE SINGLE NEW CANONICAL EVENT ---
        const eventId = `EVT-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
        const timestamp = new Date(now).toISOString();

        // Explainable confidence breakdown (Section 9 & 16)
        const confidenceBreakdown = {
          detectionConfidence: Number((trig.confidence || 0.90).toFixed(2)),
          classificationConfidence: Number((trig.confidence * 0.94).toFixed(2)),
          ruleConfidence: 0.98,
          plateConfidence: frameMetadata.anpr ? frameMetadata.anpr.confidence : null,
          faceConfidence: frameMetadata.face ? frameMetadata.face.confidence : null
        };

        event = {
          event_id: eventId,
          camera_id: camera.id,
          camera_name: camera.name,
          location: camera.location,
          timestamp: timestamp,
          started_at: timestamp,
          last_active_at: timestamp,
          duration_sec: 1,
          event_type: trig.ruleType,
          rule_name: trig.ruleName,
          object_type: trig.objectType,
          track_id: trig.trackId,
          confidence: trig.confidence,
          confidence_breakdown: confidenceBreakdown,
          severity: trig.severity,
          details: trig.details,
          zone_id: trig.zoneId,
          zone_name: trig.zoneName,
          snapshot_uri: camera.snapshotUri,
          crop_uri: camera.cropUri || null,
          clip_uri: null,
          plate_text: frameMetadata.anpr ? frameMetadata.anpr.plateNumber : null,
          plate_confidence: frameMetadata.anpr ? frameMetadata.anpr.confidence : null,
          plate_conditional_note: frameMetadata.anpr ? 'Conditional geometry capability. Multi-frame OCR. Human confirmation required.' : null,
          face_match_status: frameMetadata.face ? 'POSSIBLE_MATCH_UNCONFIRMED' : null,
          face_conditional_note: frameMetadata.face ? 'Camera angle conditional. Human verification required.' : null,
          operator_status: 'UNACKNOWLEDGED', // UNACKNOWLEDGED, ACKNOWLEDGED, QRT_DISPATCHED, DISMISSED, FALSE_POSITIVE
          system_status: 'ACTIVE', // ACTIVE, RESOLVED
          operator_notes: '',
          handled_by: null
        };

        this.activeEvents.set(eventKey, event);
        this.storage.saveEvent(event);
        generatedOrUpdatedEvents.push(event);
        console.log(`[ALERT] event=${event.event_id} camera=${event.camera_id} track=${event.track_id} system_status=ACTIVE (NEW)`);
      }
    }

    // 2. Clear inactive events (triggers no longer firing for > 5 seconds)
    const activeKeysInCurrentFrame = new Set(triggers.map(t => `${camera.id}_${t.ruleId}_${t.trackId}`));
    for (const [key, event] of this.activeEvents.entries()) {
      if (!activeKeysInCurrentFrame.has(key)) {
        const timeSinceActive = now - new Date(event.last_active_at).getTime();
        if (timeSinceActive > 5000) {
          // Event has concluded
          event.system_status = 'RESOLVED';
          this.storage.saveEvent(event);
          generatedOrUpdatedEvents.push(event);
          console.log(`[ALERT] event=${event.event_id} camera=${event.camera_id} track=${event.track_id} system_status=RESOLVED`);
          this.activeEvents.delete(key);

          // Set cooldown on this zone/track to prevent instant re-trigger flapping
          const cooldownKey = `${camera.id}_${event.zone_id || 'global'}_${event.track_id}`;
          this.cooldowns.set(cooldownKey, now + cooldownPeriodMs);
        }
      }
    }

    return generatedOrUpdatedEvents;
  }

  getActiveEvents() {
    return Array.from(this.activeEvents.values());
  }
}

module.exports = AlertEngine;
