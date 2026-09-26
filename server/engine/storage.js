const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit_log.json');
const ZONES_FILE = path.join(DATA_DIR, 'zones.json');
const CONFIG_FILE = path.join(DATA_DIR, 'rules_config.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class StorageEngine {
  constructor() {
    this.events = this._loadJson(EVENTS_FILE, []);
    this.auditLogs = this._loadJson(AUDIT_FILE, []);
    this.zones = this._loadJson(ZONES_FILE, this._defaultZones());
    this.rulesConfig = this._loadJson(CONFIG_FILE, this._defaultRulesConfig());
    
    // WAN state: true = connected to Central C2, false = isolated at BOP Edge
    this.wanConnected = true;
    this.offlineQueue = [];
    
    // Restore any previously unsynced events into offline queue if started in disconnected mode
    this.events.forEach(evt => {
      if (evt.sync_status === 'LOCAL_BUFFERED') {
        this.offlineQueue.push(evt.event_id);
      }
    });
  }

  _loadJson(filePath, defaultValue) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn(`[StorageEngine] Warning loading ${filePath}:`, err.message);
    }
    this._saveJson(filePath, defaultValue);
    return defaultValue;
  }

  _saveJson(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`[StorageEngine] Failed writing ${filePath}:`, err.message);
    }
  }

  _defaultZones() {
    return {
      'CAM-01': [
        {
          id: 'ZONE-CAM01-01',
          name: 'Perimeter Exclusion Wire',
          type: 'polygon',
          rule: 'VIRTUAL_FENCE',
          severity: 'CRITICAL',
          color: '#ff3d71',
          // Normalized coordinates (0.0 to 1.0) on the CCTV frame
          points: [
            { x: 0.15, y: 0.75 },
            { x: 0.35, y: 0.52 },
            { x: 0.78, y: 0.28 },
            { x: 0.88, y: 0.38 },
            { x: 0.42, y: 0.72 },
            { x: 0.18, y: 0.88 }
          ],
          enabled: true
        },
        {
          id: 'ZONE-CAM01-02',
          name: 'Patrol Track Loitering Zone',
          type: 'polygon',
          rule: 'DWELL_VIOLATION',
          dwellThresholdSec: 6,
          severity: 'HIGH',
          color: '#ffaa00',
          points: [
            { x: 0.48, y: 0.55 },
            { x: 0.65, y: 0.40 },
            { x: 0.78, y: 0.60 },
            { x: 0.58, y: 0.82 }
          ],
          enabled: true
        }
      ],
      'CAM-02': [
        {
          id: 'ZONE-CAM02-01',
          name: 'Boom Barrier Choke Point',
          type: 'polygon',
          rule: 'STATIONARY_VEHICLE',
          dwellThresholdSec: 5,
          severity: 'HIGH',
          color: '#00e5ff',
          points: [
            { x: 0.36, y: 0.50 },
            { x: 0.58, y: 0.50 },
            { x: 0.64, y: 0.70 },
            { x: 0.32, y: 0.70 }
          ],
          enabled: true
        },
        {
          id: 'ZONE-CAM02-TRIPWIRE',
          name: 'Checkpost Entry Tripwire',
          type: 'tripwire',
          rule: 'DIRECTIONAL_CROSSING',
          direction: 'INBOUND',
          severity: 'MEDIUM',
          color: '#00e676',
          points: [
            { x: 0.25, y: 0.62 },
            { x: 0.68, y: 0.62 }
          ],
          enabled: true
        }
      ],
      'CAM-03': [
        {
          id: 'ZONE-CAM03-01',
          name: 'Night Zero-Line Sector 4',
          type: 'polygon',
          rule: 'VIRTUAL_FENCE',
          severity: 'CRITICAL',
          color: '#ff3d71',
          points: [
            { x: 0.08, y: 0.85 },
            { x: 0.30, y: 0.48 },
            { x: 0.70, y: 0.26 },
            { x: 0.85, y: 0.32 },
            { x: 0.40, y: 0.70 },
            { x: 0.12, y: 0.95 }
          ],
          enabled: true
        }
      ],
      'CAM-04': [
        {
          id: 'ZONE-CAM04-01',
          name: 'Ridge Road Curve Check',
          type: 'polygon',
          rule: 'VIRTUAL_FENCE',
          severity: 'HIGH',
          color: '#ffaa00',
          points: [
            { x: 0.52, y: 0.38 },
            { x: 0.72, y: 0.38 },
            { x: 0.82, y: 0.58 },
            { x: 0.58, y: 0.58 }
          ],
          enabled: true
        }
      ]
    };
  }

  _defaultRulesConfig() {
    return {
      curfew: {
        start: '22:00',
        end: '05:30'
      },
      intrusion: {
        dwell_time: 5,
        group_threshold: 3
      },
      vehicle: {
        stationary_limit: 6
      },
      alert: {
        ack_timeout: 30
      },
      tuning: {
        min_bbox_height_px: 20,
        multi_frame_persistence: 3,
        cooldown_seconds: 25
      }
    };
  }

  computeChecksum(record) {
    const canonical = JSON.stringify({
      event_id: record.event_id,
      camera_id: record.camera_id,
      timestamp: record.timestamp,
      event_type: record.event_type,
      object_type: record.object_type,
      track_id: record.track_id,
      confidence: record.confidence,
      severity: record.severity
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  saveEvent(event) {
    // Generate tamper-evident SHA-256 hash
    event.sha256_hash = this.computeChecksum(event);
    
    // Check WAN status
    if (this.wanConnected) {
      event.sync_status = 'SYNCED_TO_CENTRAL';
      event.synced_at = new Date().toISOString();
    } else {
      event.sync_status = 'LOCAL_BUFFERED';
      event.synced_at = null;
      this.offlineQueue.push(event.event_id);
    }

    // Check if event already exists (deduplication update)
    const existingIndex = this.events.findIndex(e => e.event_id === event.event_id);
    if (existingIndex >= 0) {
      this.events[existingIndex] = { ...this.events[existingIndex], ...event };
    } else {
      this.events.unshift(event);
      // Keep in-memory store bounded to latest 200 events
      if (this.events.length > 200) {
        this.events.pop();
      }
    }

    this._saveJson(EVENTS_FILE, this.events);
    return event;
  }

  updateEvent(eventId, patch) {
    const idx = this.events.findIndex(e => e.event_id === eventId);
    if (idx >= 0) {
      this.events[idx] = { ...this.events[idx], ...patch };
      this.events[idx].sha256_hash = this.computeChecksum(this.events[idx]);
      this._saveJson(EVENTS_FILE, this.events);
      return this.events[idx];
    }
    return null;
  }

  // Strictly implements the required Audit Log schema:
  // user_id, timestamp, action, camera_id, incident_id, result
  logOperatorAction(entryData) {
    const entry = {
      user_id: entryData.user_id || entryData.operator_id || 'OP-SSB-4491',
      timestamp: new Date().toISOString(),
      action: entryData.action || entryData.action_type || 'ACKNOWLEDGE',
      camera_id: entryData.camera_id || 'CAM-01',
      incident_id: entryData.incident_id || entryData.event_id || 'N/A',
      result: entryData.result || 'SUCCESS',
      notes: entryData.notes || '',
      checksum: crypto.createHash('sha256').update(JSON.stringify(entryData)).digest('hex').substring(0, 16)
    };

    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 500) {
      this.auditLogs.pop();
    }
    this._saveJson(AUDIT_FILE, this.auditLogs);
    return entry;
  }

  toggleWan(status) {
    this.wanConnected = status !== undefined ? status : !this.wanConnected;
    let syncedCount = 0;

    if (this.wanConnected && this.offlineQueue.length > 0) {
      // Idempotent sync of queued events
      const now = new Date().toISOString();
      this.events.forEach(evt => {
        if (evt.sync_status === 'LOCAL_BUFFERED') {
          evt.sync_status = 'SYNCED_TO_CENTRAL';
          evt.synced_at = now;
          syncedCount++;
        }
      });
      this.offlineQueue = [];
      this._saveJson(EVENTS_FILE, this.events);

      this.logOperatorAction({
        operator_id: 'SYSTEM_DAEMON',
        event_id: 'SYSTEM-WAN-RESYNC',
        action_type: 'WAN_RESYNC_COMPLETED',
        notes: `Successfully synced ${syncedCount} queued events to Central C2 storage with zero loss.`
      });
    }

    return {
      wanConnected: this.wanConnected,
      offlineQueueLength: this.offlineQueue.length,
      syncedCount
    };
  }

  getEvents(filters = {}) {
    let result = [...this.events];
    if (filters.camera_id) {
      result = result.filter(e => e.camera_id === filters.camera_id);
    }
    if (filters.severity) {
      result = result.filter(e => e.severity === filters.severity);
    }
    if (filters.operator_status) {
      result = result.filter(e => e.operator_status === filters.operator_status);
    }
    return result;
  }

  getZones(cameraId) {
    if (cameraId) {
      return this.zones[cameraId] || [];
    }
    return this.zones;
  }

  saveZones(cameraId, zonesList) {
    this.zones[cameraId] = zonesList;
    this._saveJson(ZONES_FILE, this.zones);
    this.logOperatorAction({
      operator_id: 'OP-SSB-4491',
      event_id: `ZONE-UPDATE-${cameraId}`,
      action_type: 'ZONE_EDIT',
      notes: `Updated ${zonesList.length} virtual zones/tripwires for camera ${cameraId}.`
    });
    return this.zones[cameraId];
  }

  getRulesConfig() {
    return this.rulesConfig;
  }

  updateRulesConfig(newConfig) {
    this.rulesConfig = { ...this.rulesConfig, ...newConfig };
    this._saveJson(CONFIG_FILE, this.rulesConfig);
    return this.rulesConfig;
  }

  getAuditLogs() {
    return this.auditLogs;
  }

  getDataSources() {
    const dataSourcesFile = path.join(DATA_DIR, 'data_sources.json');
    return this._loadJson(dataSourcesFile, {});
  }

  getGovernancePolicy() {
    const dataSources = this.getDataSources();
    return dataSources.governance_prototype || {};
  }
}

module.exports = new StorageEngine();
