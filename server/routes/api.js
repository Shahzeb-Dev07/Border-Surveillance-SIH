const express = require('express');
const router = express.Router();
const storage = require('../engine/storage');
const cameraManager = require('../engine/cameraManager');

// 1. Camera Endpoints
router.get('/cameras', (req, res) => {
  res.json({
    success: true,
    cameras: cameraManager.getCameras()
  });
});

router.get('/cameras/:id/zones', (req, res) => {
  const zones = storage.getZones(req.params.id);
  res.json({ success: true, zones });
});

router.post('/cameras/:id/zones', (req, res) => {
  const { zones } = req.body;
  if (!Array.isArray(zones)) {
    return res.status(400).json({ success: false, error: 'zones must be an array' });
  }
  const updated = storage.saveZones(req.params.id, zones);
  res.json({ success: true, zones: updated });
});

// 2. Alert & Event Endpoints
router.get('/alerts', (req, res) => {
  const { camera_id, severity, operator_status } = req.query;
  const events = storage.getEvents({ camera_id, severity, operator_status });
  res.json({
    success: true,
    total: events.length,
    events
  });
});

router.post('/alerts/:id/action', (req, res) => {
  const eventId = req.params.id;
  const { action, notes, operator_id } = req.body;

  if (!action) {
    return res.status(400).json({ success: false, error: 'Action is required' });
  }

  const patch = {
    operator_status: action,
    handled_by: operator_id || 'OP-SSB-4491',
    operator_notes: notes || '',
    handled_at: new Date().toISOString()
  };

  const updatedEvent = storage.updateEvent(eventId, patch);
  if (!updatedEvent) {
    return res.status(404).json({ success: false, error: 'Event not found' });
  }

  // Record tamper-evident audit log strictly matching required schema:
  // user_id, timestamp, action, camera_id, incident_id, result
  const auditEntry = storage.logOperatorAction({
    user_id: operator_id || req.body.user_id || 'OP-SSB-4491',
    timestamp: new Date().toISOString(),
    action: action,
    camera_id: updatedEvent.camera_id,
    incident_id: eventId,
    result: 'SUCCESS',
    notes: notes || `Operator performed ${action} on incident ${eventId}`
  });

  res.json({
    success: true,
    event: updatedEvent,
    auditEntry
  });
});

// 3. System Telemetry & WAN Simulation
router.get('/telemetry', (req, res) => {
  res.json({
    success: true,
    telemetry: {
      ...cameraManager.edgeTelemetry,
      wanConnected: storage.wanConnected,
      offlineQueueCount: storage.offlineQueue.length,
      totalEventsStored: storage.events.length
    }
  });
});

router.post('/system/wan-toggle', (req, res) => {
  const { status } = req.body;
  const result = storage.toggleWan(status);
  res.json({
    success: true,
    wanConnected: result.wanConnected,
    offlineQueueLength: result.offlineQueueLength,
    syncedCount: result.syncedCount,
    message: result.wanConnected 
      ? `WAN Reconnected: Edge synchronized ${result.syncedCount} events to Central C2 storage.`
      : 'WAN Severed: Edge entered autonomous offline resilience mode. Local alerting active.'
  });
});

// 4. Audit Log & Evidence Chain-of-Custody
router.get('/audit-logs', (req, res) => {
  res.json({
    success: true,
    auditLogs: storage.getAuditLogs()
  });
});

// 5. Data Sources & Operational SOP
router.get('/data-sources', (req, res) => {
  res.json({
    success: true,
    data: storage.getDataSources()
  });
});

// 6. Prototype Governance & RBAC Roles
router.get('/governance', (req, res) => {
  res.json({
    success: true,
    governance: storage.getGovernancePolicy()
  });
});

// 7. Rule Configuration Studio
router.get('/rules/config', (req, res) => {
  res.json({
    success: true,
    config: storage.getRulesConfig()
  });
});

router.post('/rules/config', (req, res) => {
  const updated = storage.updateRulesConfig(req.body);
  storage.logOperatorAction({
    user_id: req.body.user_id || req.body.operator_id || 'ADMIN-SYS-99',
    timestamp: new Date().toISOString(),
    action: 'CONFIGURE_SOP_RULES',
    camera_id: 'GLOBAL_SYSTEM',
    incident_id: 'SYSTEM-RULE-CONFIG',
    result: 'SUCCESS',
    notes: 'Updated SOP thresholds (curfew, dwell time, group threshold, vehicle stationary limit).'
  });
  res.json({
    success: true,
    config: updated
  });
});

module.exports = router;
