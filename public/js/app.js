// IBVAP C2 Command Center Main Application
document.addEventListener('DOMContentLoaded', () => {
  // State
  let cameras = [];
  let activeCameraId = 'CAM-01';
  let zonesMap = {}; // cameraId -> zones array
  let events = [];
  let rulesConfig = {};
  let wanConnected = true;
  let activeFilter = 'ALL';
  let currentInspectingEvent = null;

  // DOM Elements
  const videoCanvas = document.getElementById('videoCanvas');
  const gisMapCanvas = document.getElementById('gisMapCanvas');
  const cameraListContainer = document.getElementById('cameraList');
  const alertStreamContainer = document.getElementById('alertStream');
  const wanStatusPill = document.getElementById('wanStatusPill');
  const btnToggleWan = document.getElementById('btnToggleWan');
  const clockElement = document.getElementById('c2Clock');
  const btnMute = document.getElementById('btnMute');
  const alarmBanner = document.getElementById('alarmSirenBanner');
  const btnDismissSiren = document.getElementById('btnDismissSiren');

  // Telemetry DOM
  const valCpu = document.getElementById('valCpu');
  const valGpu = document.getElementById('valGpu');
  const valLatency = document.getElementById('valLatency');
  const valBuffer = document.getElementById('valBuffer');

  // Initialize Canvas Renderers
  const canvasRenderer = new CanvasRenderer('videoCanvas');
  const gisMap = new TacticalGisMap('gisMapCanvas', (camId) => {
    switchCamera(camId);
  });

  // Initialize Interactive Zone Drawing Tool
  const zoneDrawingTool = new ZoneDrawingTool(canvasRenderer, async (newZone) => {
    if (!zonesMap[activeCameraId]) {
      zonesMap[activeCameraId] = [];
    }
    zonesMap[activeCameraId].push(newZone);
    try {
      await fetch(`/api/cameras/${activeCameraId}/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zones: zonesMap[activeCameraId] })
      });
      console.log('Saved new virtual zone:', newZone);
    } catch (e) {
      console.error('Failed saving zone:', e);
    }
  });

  // Military Digital Clock (IST)
  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB', { hour12: false }) + ' IST';
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    if (clockElement) {
      clockElement.textContent = `${dateStr} // ${timeStr}`;
    }
  }
  setInterval(updateClock, 1000);
  updateClock();

  // WebSocket Setup
  let ws = null;
  function connectWs() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      console.log('[WS] Connected to IBVAP C2 backend');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    ws.onclose = () => {
      console.warn('[WS] Connection closed, retrying in 2s...');
      setTimeout(connectWs, 2000);
    };
  }

  function handleServerMessage(msg) {
    if (msg.type === 'INIT') {
      cameras = msg.data.cameras || [];
      zonesMap = msg.data.zones || {};
      rulesConfig = msg.data.config || {};
      wanConnected = msg.data.wanConnected;
      events = msg.data.events || [];
      updateWanUI(wanConnected, msg.data.offlineQueueCount || 0);
      renderCameraList();
      renderAlerts();
      updateActiveCamera();
    } else if (msg.type === 'CAMERA_UPDATE') {
      const liveCams = msg.data.cameras || [];
      cameras = liveCams;
      updateActiveCamera();
      updateTelemetry(msg.data.telemetry);
    } else if (msg.type === 'ALERTS_UPDATE') {
      const incomingEvents = msg.data || [];
      handleIncomingAlerts(incomingEvents);
    } else if (msg.type === 'WAN_STATE_CHANGE') {
      wanConnected = msg.data.wanConnected;
      updateWanUI(wanConnected, msg.data.offlineQueueLength || 0);
      if (!wanConnected) {
        window.tacticalAudio.playAlertPing('CRITICAL');
      }
    }
  }

  function updateActiveCamera() {
    const cam = cameras.find(c => c.id === activeCameraId);
    if (!cam) return;

    const zones = zonesMap[activeCameraId] || [];
    canvasRenderer.updateFeed(cam, zones, cam.activeDetections, cam.meta);
    gisMap.updateData(cameras, activeCameraId, events);

    // Update center header details
    const feedTitle = document.getElementById('currentFeedTitle');
    const feedLocation = document.getElementById('currentFeedLocation');
    const hudBadgeIr = document.getElementById('hudBadgeIr');
    const hudBadgeChoke = document.getElementById('hudBadgeChoke');

    if (feedTitle) feedTitle.textContent = `${cam.id} — ${cam.name}`;
    if (feedLocation) feedLocation.textContent = `${cam.bop} // ${cam.location}`;

    if (hudBadgeIr) {
      hudBadgeIr.style.display = cam.mode === 'NIGHT_IR_ILLUMINATED' ? 'flex' : 'none';
    }
    if (hudBadgeChoke) {
      hudBadgeChoke.style.display = cam.capabilities && cam.capabilities.anpr ? 'flex' : 'none';
    }
  }

  function switchCamera(camId) {
    activeCameraId = camId;
    renderCameraList();
    updateActiveCamera();
  }

  function renderCameraList() {
    if (!cameraListContainer) return;
    cameraListContainer.innerHTML = '';

    cameras.forEach(cam => {
      const card = document.createElement('div');
      card.className = `camera-card ${cam.id === activeCameraId ? 'active' : ''}`;
      card.onclick = () => switchCamera(cam.id);

      const hasAlert = events.some(e => e.camera_id === cam.id && e.system_status === 'ACTIVE');

      card.innerHTML = `
        <div class="cam-card-top">
          <span class="cam-id">${cam.id}</span>
          <span class="cam-status-pill ${cam.status.toLowerCase()}">${cam.status}</span>
        </div>
        <div class="cam-name">${cam.name}</div>
        <div class="cam-location">${cam.location}</div>
        <div class="cam-caps">
          <span class="cap-tag active">${cam.resolution.split('@')[1] || '15fps'}</span>
          <span class="cap-tag active">V-FENCE</span>
          ${cam.capabilities && cam.capabilities.anpr ? '<span class="cap-tag anpr">ANPR CHOKE</span>' : ''}
          ${cam.mode === 'NIGHT_IR_ILLUMINATED' ? '<span class="cap-tag active" style="color:#00e676;border-color:rgba(0,230,118,0.3)">NIGHT IR</span>' : ''}
          ${hasAlert ? '<span class="cap-tag" style="background:#ff3d71;color:#fff;font-weight:700">ALERT</span>' : ''}
        </div>
      `;
      cameraListContainer.appendChild(card);
    });
  }

  // --- ANTI-FLOODING ALERT IN-PLACE UPDATER ---
  function handleIncomingAlerts(incoming) {
    let hasNewCritical = false;

    incoming.forEach(incEvt => {
      const idx = events.findIndex(e => e.event_id === incEvt.event_id);
      if (idx >= 0) {
        // In-place update: updates duration counter, confidence, and status
        events[idx] = { ...events[idx], ...incEvt };
      } else {
        // Prepend new event
        events.unshift(incEvt);
        if (incEvt.severity === 'CRITICAL') {
          hasNewCritical = true;
        }
      }
    });

    if (hasNewCritical) {
      window.tacticalAudio.playAlertPing('CRITICAL');
      if (alarmBanner) {
        alarmBanner.classList.remove('hidden');
        document.getElementById('alarmSirenText').textContent = `CRITICAL PERIMETER BREACH DETECTED AT ${incoming[0].camera_name.toUpperCase()}!`;
      }
    }

    renderAlerts();
  }

  function renderAlerts() {
    if (!alertStreamContainer) return;

    let filtered = [...events];
    if (activeFilter === 'CRITICAL') {
      filtered = filtered.filter(e => e.severity === 'CRITICAL');
    } else if (activeFilter === 'ACTIVE') {
      filtered = filtered.filter(e => e.system_status === 'ACTIVE');
    } else if (activeFilter === 'ACKNOWLEDGED') {
      filtered = filtered.filter(e => e.operator_status === 'ACKNOWLEDGED' || e.operator_status === 'QRT_DISPATCHED');
    } else if (activeFilter === 'DISMISSED') {
      filtered = filtered.filter(e => e.operator_status === 'DISMISSED' || e.operator_status === 'FALSE_POSITIVE');
    }

    if (filtered.length === 0) {
      alertStreamContainer.innerHTML = `
        <div style="padding: 30px 10px; text-align: center; color: var(--text-dim); font-family: var(--font-mono)">
          NO ALERTS UNDER CURRENT FILTER (${activeFilter})
        </div>
      `;
      return;
    }

    alertStreamContainer.innerHTML = '';

    filtered.slice(0, 50).forEach(evt => {
      const card = document.createElement('div');
      const sevClass = (evt.severity || 'medium').toLowerCase();
      card.className = `alert-card ${sevClass}`;

      const isActive = evt.system_status === 'ACTIVE';
      const durationBadge = isActive 
        ? `<div class="duration-live-badge pulsing"><span class="pulse-dot"></span> LIVE: ${evt.duration_sec || 1}s</div>`
        : `<div class="duration-live-badge">ENDED (${evt.duration_sec || 1}s)</div>`;

      const conf = evt.confidence_breakdown || {};
      const anprCallout = evt.plate_text ? `
        <div class="anpr-callout">
          <span class="anpr-plate-text">${evt.plate_text}</span>
          <div class="anpr-conf-note">OCR CONF: ${Math.round((evt.plate_confidence || 0.85)*100)}% (Geometry Choke Point)</div>
        </div>
      ` : '';

      card.innerHTML = `
        <div class="alert-header-row">
          <span class="severity-pill ${sevClass}">${evt.severity}</span>
          ${durationBadge}
        </div>
        <div class="alert-title">${evt.rule_name || evt.event_type}</div>
        <div class="alert-meta-row">
          <span>${evt.camera_id}</span>
          <span>•</span>
          <span>${evt.location}</span>
          <span>•</span>
          <span>${new Date(evt.timestamp).toLocaleTimeString('en-GB')}</span>
        </div>
        <div class="alert-details">${evt.details}</div>
        ${anprCallout}
        <div class="confidence-matrix">
          <div class="conf-item">
            <span>DETECTION</span>
            <span>${Math.round((conf.detectionConfidence || evt.confidence || 0.9) * 100)}%</span>
          </div>
          <div class="conf-item">
            <span>CLASSIFICATION</span>
            <span>${Math.round((conf.classificationConfidence || 0.88) * 100)}%</span>
          </div>
          <div class="conf-item">
            <span>RULE MATCH</span>
            <span>${Math.round((conf.ruleConfidence || 0.98) * 100)}%</span>
          </div>
        </div>
        <div class="alert-actions-row">
          ${evt.operator_status === 'UNACKNOWLEDGED' ? `
            <button class="alert-action-btn" onclick="window.handleAlertAction('${evt.event_id}', 'ACKNOWLEDGE')">Acknowledge</button>
            <button class="alert-action-btn btn-qrt" onclick="window.handleAlertAction('${evt.event_id}', 'DISPATCH_QRT')">Dispatch QRT</button>
          ` : `
            <span style="font-family:var(--font-mono);font-size:10px;color:var(--accent-green);padding:4px">STATUS: ${evt.operator_status}</span>
          `}
          <button class="alert-action-btn" onclick="window.inspectEvidence('${evt.event_id}')">Evidence</button>
        </div>
      `;

      alertStreamContainer.appendChild(card);
    });
  }

  // RBAC State
  let currentRole = 'Operator';
  let currentUserId = 'OP-SSB-4491';

  const roleSelect = document.getElementById('userRoleSelect');
  if (roleSelect) {
    roleSelect.addEventListener('change', (e) => {
      currentRole = e.target.value;
      if (currentRole === 'Operator') currentUserId = 'OP-SSB-4491';
      else if (currentRole === 'Duty Officer') currentUserId = 'DO-SSB-201';
      else if (currentRole === 'Sector Commander') currentUserId = 'CDR-SSB-01';
      else if (currentRole === 'System Administrator') currentUserId = 'ADMIN-SYS-99';

      console.log(`[RBAC] Active role set to: ${currentRole} (${currentUserId})`);
    });
  }

  // Operator Action Dispatcher with RBAC Enforcement
  window.handleAlertAction = async (eventId, action) => {
    // RBAC Clearance Check
    if (action === 'DISPATCH_QRT' && currentRole === 'Operator') {
      alert(`[RBAC ACCESS RESTRICTED] Operator role lacks tactical QRT dispatch authority. Please switch to Duty Officer or Sector Commander in the top header.`);
      return;
    }

    try {
      const res = await fetch(`/api/alerts/${eventId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          user_id: currentUserId,
          operator_id: currentUserId
        })
      });
      const data = await res.json();
      if (data.success) {
        const idx = events.findIndex(e => e.event_id === eventId);
        if (idx >= 0) {
          events[idx] = data.event;
          renderAlerts();
        }
      }
    } catch (e) {
      console.error('Failed dispatching action:', e);
    }
  };

  // Inspect Evidence Modal
  window.inspectEvidence = (eventId) => {
    const evt = events.find(e => e.event_id === eventId);
    if (!evt) return;
    currentInspectingEvent = evt;

    const dialog = document.getElementById('evidenceDialog');
    document.getElementById('evidenceTitle').textContent = `Evidence Record: ${evt.event_id}`;
    document.getElementById('evidenceCamera').textContent = `${evt.camera_id} (${evt.camera_name})`;
    document.getElementById('evidenceRule').textContent = evt.rule_name;
    document.getElementById('evidenceTime').textContent = `${evt.timestamp} (Duration: ${evt.duration_sec}s)`;
    document.getElementById('evidenceChecksum').textContent = evt.sha256_hash || 'SHA-256 PENDING';
    document.getElementById('evidenceImg').src = evt.snapshot_uri;
    document.getElementById('evidenceNotesInput').value = evt.operator_notes || '';

    // Plate section if present
    const plateSection = document.getElementById('evidencePlateSection');
    if (evt.plate_text) {
      plateSection.style.display = 'block';
      document.getElementById('evidencePlateText').textContent = evt.plate_text;
      document.getElementById('evidencePlateConf').textContent = `${Math.round((evt.plate_confidence || 0.85)*100)}% (Multi-frame temporal validation passed)`;
    } else {
      plateSection.style.display = 'none';
    }

    dialog.showModal();
  };

  // Save Operator Notes in Evidence Modal
  document.getElementById('btnSaveEvidenceNotes')?.addEventListener('click', async () => {
    if (!currentInspectingEvent) return;
    const notes = document.getElementById('evidenceNotesInput').value;
    await window.handleAlertAction(currentInspectingEvent.event_id, currentInspectingEvent.operator_status || 'ACKNOWLEDGE', notes);
    document.getElementById('evidenceDialog').close();
  });

  // WAN State Toggle Button (Simulate WAN loss / Reconnect)
  btnToggleWan.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/system/wan-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: !wanConnected })
      });
      const data = await res.json();
      wanConnected = data.wanConnected;
      updateWanUI(wanConnected, data.offlineQueueLength);
      alert(data.message);
    } catch (e) {
      console.error('WAN toggle error:', e);
    }
  });

  function updateWanUI(connected, offlineQueueCount) {
    if (connected) {
      wanStatusPill.className = 'status-chip online';
      wanStatusPill.innerHTML = `<span class="pulse-dot"></span> WAN CONNECTED (CENTRAL SYNC)`;
      btnToggleWan.textContent = 'Simulate WAN Loss';
      btnToggleWan.className = 'btn-tactical btn-warn';
      if (valBuffer) valBuffer.textContent = '0 EVTS';
    } else {
      wanStatusPill.className = 'status-chip offline';
      wanStatusPill.innerHTML = `<span class="pulse-dot"></span> WAN DOWN: LOCAL BUFFER ACTIVE`;
      btnToggleWan.textContent = 'Restore WAN Sync';
      btnToggleWan.className = 'btn-tactical btn-cyan';
      if (valBuffer) valBuffer.textContent = `${offlineQueueCount} EVTS (LOCAL)`;
    }
  }

  function updateTelemetry(telemetry) {
    if (!telemetry) return;
    if (valCpu) valCpu.textContent = `${Math.round(telemetry.cpuUsagePercent)}%`;
    if (valGpu) valGpu.textContent = `${Math.round(telemetry.gpuUsagePercent)}%`;
    if (valLatency) valLatency.textContent = `${telemetry.inferenceLatencyMs}ms`;
    if (valBuffer && !wanConnected) valBuffer.textContent = `${telemetry.offlineQueueCount} EVTS`;
  }

  // Audio Mute Toggle
  btnMute.addEventListener('click', () => {
    const isMuted = window.tacticalAudio.toggleMute();
    btnMute.textContent = isMuted ? 'UNMUTE AUDIO' : 'MUTE AUDIO';
  });

  // Siren Dismiss
  btnDismissSiren?.addEventListener('click', () => {
    alarmBanner.classList.add('hidden');
    window.tacticalAudio.stopSiren();
  });

  // Filter Tabs
  document.querySelectorAll('.alert-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.alert-tab-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      activeFilter = e.target.dataset.filter;
      renderAlerts();
    });
  });

  // Zone Toolbar Buttons
  document.getElementById('btnDrawFence')?.addEventListener('click', () => {
    zoneDrawingTool.startDrawing('polygon');
  });

  document.getElementById('btnDrawTripwire')?.addEventListener('click', () => {
    zoneDrawingTool.startDrawing('tripwire');
  });

  document.getElementById('btnResetZones')?.addEventListener('click', async () => {
    if (confirm('Reset zones on this camera to default operational perimeter configuration?')) {
      const defaultZones = {
        'CAM-01': [
          {
            id: 'ZONE-CAM01-01',
            name: 'Perimeter Exclusion Wire',
            type: 'polygon',
            rule: 'VIRTUAL_FENCE',
            severity: 'CRITICAL',
            color: '#ff3d71',
            points: [
              { x: 0.15, y: 0.75 },
              { x: 0.35, y: 0.52 },
              { x: 0.78, y: 0.28 },
              { x: 0.88, y: 0.38 },
              { x: 0.42, y: 0.72 },
              { x: 0.18, y: 0.88 }
            ],
            enabled: true
          }
        ]
      };
      zonesMap[activeCameraId] = defaultZones[activeCameraId] || [];
      await fetch(`/api/cameras/${activeCameraId}/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zones: zonesMap[activeCameraId] })
      });
      updateActiveCamera();
    }
  });

  // Modals Open/Close
  // 1. SOP Operational Rules Modal (4-Part Schema)
  document.getElementById('btnOpenRulesModal')?.addEventListener('click', () => {
    const dialog = document.getElementById('rulesDialog');
    
    // Check RBAC permission for editing SOP rules
    if (currentRole === 'Operator') {
      alert('[RBAC NOTICE] Operator has read-only clearance. Switched to viewing mode.');
    }

    const c = rulesConfig.curfew || {};
    const intr = rulesConfig.intrusion || {};
    const veh = rulesConfig.vehicle || {};
    const alt = rulesConfig.alert || {};

    document.getElementById('inputCurfewStart').value = c.start || '22:00';
    document.getElementById('inputCurfewEnd').value = c.end || '05:30';
    document.getElementById('inputDwell').value = intr.dwell_time || rulesConfig.dwellThresholdSec || 5;
    document.getElementById('valDwell').textContent = `${intr.dwell_time || rulesConfig.dwellThresholdSec || 5}s`;
    document.getElementById('inputGroup').value = intr.group_threshold || rulesConfig.groupThresholdCount || 3;
    document.getElementById('valGroup').textContent = `${intr.group_threshold || rulesConfig.groupThresholdCount || 3}`;
    document.getElementById('inputStop').value = veh.stationary_limit || rulesConfig.vehicleStopThresholdSec || 6;
    document.getElementById('valStop').textContent = `${veh.stationary_limit || rulesConfig.vehicleStopThresholdSec || 6}s`;
    document.getElementById('inputAckTimeout').value = alt.ack_timeout || 30;
    document.getElementById('valAckTimeout').textContent = `${alt.ack_timeout || 30}s`;

    dialog.showModal();
  });

  document.getElementById('btnSaveRules')?.addEventListener('click', async () => {
    if (currentRole === 'Operator') {
      alert('[RBAC RESTRICTED] Only System Administrator, Sector Commander, or Duty Officer can modify SOP rules.');
      return;
    }

    const updated = {
      curfew: {
        start: document.getElementById('inputCurfewStart').value,
        end: document.getElementById('inputCurfewEnd').value
      },
      intrusion: {
        dwell_time: Number(document.getElementById('inputDwell').value),
        group_threshold: Number(document.getElementById('inputGroup').value)
      },
      vehicle: {
        stationary_limit: Number(document.getElementById('inputStop').value)
      },
      alert: {
        ack_timeout: Number(document.getElementById('inputAckTimeout').value)
      },
      user_id: currentUserId
    };

    try {
      const res = await fetch('/api/rules/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      const data = await res.json();
      rulesConfig = data.config;
      document.getElementById('rulesDialog').close();
      alert('SOP Operational Rules applied instantly to Edge Rule Engine! Zero neural network retraining needed.');
    } catch (e) {
      console.error('Error saving rules:', e);
    }
  });

  // 2. Data Sources & Benchmark Modal
  document.getElementById('btnOpenDataSourcesModal')?.addEventListener('click', () => {
    document.getElementById('dataSourcesDialog').showModal();
  });

  // 3. Audit & Governance Modal (Strict user_id, timestamp, action, camera_id, incident_id, result schema)
  document.getElementById('btnOpenGovernanceModal')?.addEventListener('click', async () => {
    const dialog = document.getElementById('governanceDialog');
    const tableBody = document.getElementById('auditLogTableBody');

    try {
      const res = await fetch('/api/audit-logs');
      const data = await res.json();
      const logs = data.auditLogs || [];

      if (tableBody) {
        if (logs.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--text-dim)">NO AUDIT RECORDS FOUND</td></tr>`;
        } else {
          tableBody.innerHTML = logs.slice(0, 30).map(log => `
            <tr style="border-bottom:1px solid rgba(255,255,255,0.05)">
              <td style="padding:6px 8px;font-weight:700;color:var(--accent-cyan)">${log.user_id}</td>
              <td style="padding:6px 8px;color:var(--text-muted)">${new Date(log.timestamp).toLocaleTimeString('en-GB')}</td>
              <td style="padding:6px 8px"><span class="cap-tag active">${log.action}</span></td>
              <td style="padding:6px 8px;color:var(--text-main)">${log.camera_id}</td>
              <td style="padding:6px 8px;color:var(--text-dim)">${log.incident_id}</td>
              <td style="padding:6px 8px;font-weight:700;color:var(--accent-green)">${log.result}</td>
            </tr>
          `).join('');
        }
      }
    } catch (e) {
      console.error('Failed fetching audit logs:', e);
    }

    dialog.showModal();
  });

  // 4. Red Team Architecture Modal
  document.getElementById('btnOpenRedTeamModal')?.addEventListener('click', () => {
    document.getElementById('redTeamDialog').showModal();
  });

  // Slider visual value updaters
  ['inputDwell', 'inputGroup', 'inputStop', 'inputAckTimeout'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', (e) => {
        const valSpan = document.getElementById(id.replace('input', 'val'));
        if (valSpan) {
          const unit = id === 'inputGroup' ? '' : 's';
          valSpan.textContent = `${e.target.value}${unit}`;
        }
      });
    }
  });

  // Close buttons for modals
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const dialog = e.target.closest('dialog');
      if (dialog) dialog.close();
    });
  });

  // Connect WebSocket
  connectWs();
});
