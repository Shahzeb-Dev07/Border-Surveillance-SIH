// IBVAP C2 Command Center Main Application
document.addEventListener('DOMContentLoaded', () => {
  // State
  const DEFAULT_CAMERAS = [
    {
      id: 'CAM-01',
      name: 'Perimeter Watchtower Alpha',
      bop: 'BOP 14 - Kakrahwa Sector',
      location: 'Border Pillar 552/3 - Main Perimeter Fence',
      resolution: '1920x1080 @ 15fps',
      mode: 'DAYLIGHT_RGB',
      fovType: 'WIDE_PERIMETER',
      capabilities: { humanDetection: true, humanTracking: true, virtualFence: true, anpr: false, faceRecognition: false, nightIr: false },
      fps: 15.0,
      latencyMs: 18.2,
      status: 'ONLINE'
    },
    {
      id: 'CAM-02',
      name: 'Checkpost Barrier Choke Point',
      bop: 'BOP 14 - Kakrahwa Sector',
      location: 'Inbound Vehicle Inspection Lane',
      resolution: '1920x1080 @ 20fps',
      mode: 'DAYLIGHT_RGB',
      fovType: 'CHOKE_POINT_INSPECTION',
      capabilities: { humanDetection: true, humanTracking: true, virtualFence: true, anpr: true, faceRecognition: true, nightIr: false },
      fps: 20.0,
      latencyMs: 22.4,
      status: 'ONLINE'
    },
    {
      id: 'CAM-03',
      name: 'Sector 4 Ridge Zero-Line (Night IR)',
      bop: 'BOP 18 - Mahadeva Ridge',
      location: 'Zero-Line Restricted Wire Sector 4',
      resolution: '1280x720 @ 12fps',
      mode: 'NIGHT_IR_ILLUMINATED',
      fovType: 'PERIMETER_IR_ZONE',
      capabilities: { humanDetection: true, humanTracking: true, virtualFence: true, anpr: false, faceRecognition: false, nightIr: true },
      fps: 12.0,
      latencyMs: 31.0,
      status: 'ONLINE'
    },
    {
      id: 'CAM-04',
      name: 'High Altitude Patrol Road',
      bop: 'BOP 22 - Sonauli Sector',
      location: 'Border Patrol Access Road KM 12',
      resolution: '1920x1080 @ 15fps',
      mode: 'DAYLIGHT_RGB',
      fovType: 'HIGHWAY_TRANSIT',
      capabilities: { humanDetection: true, humanTracking: true, virtualFence: true, anpr: false, faceRecognition: false, nightIr: false },
      fps: 15.0,
      latencyMs: 19.5,
      status: 'ONLINE'
    },
    {
      id: 'CAM-MOBILE-01',
      name: 'Mobile Recon Patrol (Smartphone Ad-Hoc Feed)',
      bop: 'Mobile QRT Recon Unit',
      location: 'Tactical Recon Point // Dynamic Smartphone Feed',
      resolution: 'Mobile 720p @ 8fps',
      mode: 'DAYLIGHT_RGB',
      fovType: 'MOBILE_ADHOC',
      capabilities: { humanDetection: true, humanTracking: true, virtualFence: true, anpr: false, faceRecognition: false, nightIr: false },
      fps: 8.0,
      latencyMs: 14.5,
      status: 'WAITING',
      isMobile: true
    }
  ];

  let cameras = JSON.parse(JSON.stringify(DEFAULT_CAMERAS));
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

  // Sidebar Tabs (Cameras vs Sector Map)
  const tabCamerasBtn = document.getElementById('tabCamerasBtn');
  const tabMapBtn = document.getElementById('tabMapBtn');
  const gisMapPanel = document.getElementById('gisMapPanel');

  if (tabCamerasBtn && tabMapBtn) {
    tabCamerasBtn.addEventListener('click', () => {
      tabCamerasBtn.classList.add('active');
      tabMapBtn.classList.remove('active');
      if (cameraListContainer) cameraListContainer.style.display = 'flex';
      if (gisMapPanel) gisMapPanel.style.display = 'none';
    });
    tabMapBtn.addEventListener('click', () => {
      tabMapBtn.classList.add('active');
      tabCamerasBtn.classList.remove('active');
      if (cameraListContainer) cameraListContainer.style.display = 'none';
      if (gisMapPanel) {
        gisMapPanel.style.display = 'block';
        gisMap.updateData(cameras, activeCameraId, events);
      }
    });
  }

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
      updateMobileCamModalStatus();
    } else if (msg.type === 'CAMERA_UPDATE') {
      const liveCams = msg.data.cameras || [];
      cameras = liveCams;
      updateActiveCamera();
      updateTelemetry(msg.data.telemetry);
      updateMobileCamModalStatus();
      renderCameraList();
    } else if (msg.type === 'ALERTS_UPDATE') {
      const incomingEvents = msg.data || [];
      handleIncomingAlerts(incomingEvents);
    } else if (msg.type === 'WAN_STATE_CHANGE') {
      wanConnected = msg.data.wanConnected;
      updateWanUI(wanConnected, msg.data.offlineQueueLength || 0);
      if (!wanConnected) {
        window.tacticalAudio.playAlertPing('CRITICAL');
      }
    } else if (msg.type === 'FOCUS_CAMERA') {
      if (msg.data && msg.data.cameraId) {
        switchCamera(msg.data.cameraId);
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
    const liveFeedBadge = document.getElementById('liveFeedBadge');
    const btnSwitchCenterToPhone = document.getElementById('btnSwitchCenterToPhone');
    const btnSwitchCenterToPhoneText = document.getElementById('btnSwitchCenterToPhoneText');
    const canvasCrosshairOverlay = document.getElementById('canvasCrosshairOverlay');

    if (feedTitle) feedTitle.textContent = `${cam.id} — ${cam.name}`;
    if (feedLocation) feedLocation.textContent = `${cam.bop} // ${cam.location}`;

    if (hudBadgeIr) {
      hudBadgeIr.style.display = cam.mode === 'NIGHT_IR_ILLUMINATED' ? 'flex' : 'none';
    }
    if (hudBadgeChoke) {
      hudBadgeChoke.style.display = cam.capabilities && cam.capabilities.anpr ? 'flex' : 'none';
    }

    // Dynamic Live Rec / Sensor Badge
    if (liveFeedBadge) {
      if (cam.id === 'CAM-MOBILE-01') {
        const isOnline = cam.status === 'ONLINE';
        const color = isOnline ? 'var(--accent-green)' : (cam.status === 'STALE' ? 'var(--accent-amber)' : '#90a4ae');
        const text = isOnline ? 'SMARTPHONE LIVE SENSOR' : (cam.status === 'STALE' ? 'PHONE STREAM STALE' : 'PHONE SENSOR STANDBY');
        liveFeedBadge.innerHTML = `<span class="live-rec-dot" style="background:${color}"></span> ${text}`;
      } else {
        liveFeedBadge.innerHTML = `<span class="live-rec-dot"></span> SIMULATED FEED`;
      }
    }

    // Switch to Phone Button State
    if (btnSwitchCenterToPhone) {
      if (activeCameraId === 'CAM-MOBILE-01') {
        btnSwitchCenterToPhone.style.borderColor = 'var(--accent-green)';
        btnSwitchCenterToPhone.style.color = 'var(--accent-green)';
        btnSwitchCenterToPhone.style.background = 'rgba(0, 230, 118, 0.12)';
        if (btnSwitchCenterToPhoneText) btnSwitchCenterToPhoneText.textContent = '✓ Phone Active in Centre';
      } else {
        btnSwitchCenterToPhone.style.borderColor = 'var(--accent-amber)';
        btnSwitchCenterToPhone.style.color = 'var(--accent-amber)';
        btnSwitchCenterToPhone.style.background = '';
        if (btnSwitchCenterToPhoneText) btnSwitchCenterToPhoneText.textContent = '📱 Use Phone Camera in Centre';
      }
    }

    // Crosshair overlay HUD text (kept empty for clean professional view)
    if (canvasCrosshairOverlay) {
      canvasCrosshairOverlay.innerHTML = '';
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

    const tabCamCount = document.getElementById('tabCamCount');
    if (tabCamCount) tabCamCount.textContent = cameras.length;

    cameras.forEach(cam => {
      const card = document.createElement('div');
      card.className = `camera-card ${cam.id === activeCameraId ? 'active' : ''}`;
      card.onclick = () => switchCamera(cam.id);

      const hasAlert = events.some(e => e.camera_id === cam.id && e.system_status === 'ACTIVE');
      const isMobileCam = cam.isMobile || cam.id === 'CAM-MOBILE-01';
      const isOnline = cam.status === 'ONLINE';

      let statusLabel = isOnline ? 'Online' : (cam.status === 'STALE' ? 'Paused' : 'Offline');
      let statusClass = isOnline ? 'online' : (cam.status === 'STALE' ? 'stale' : 'offline');

      let mobileNotice = '';
      if (isMobileCam) {
        if (isOnline) {
          const count = (cam.activeDetections || []).length;
          mobileNotice = `<div class="cam-sub-meta online">Streaming live from mobile (${count} objects detected)</div>`;
        } else {
          mobileNotice = `<div class="cam-sub-meta text-muted">Smartphone standby (Tap to connect)</div>`;
        }
      }

      card.innerHTML = `
        <div class="cam-card-top">
          <div class="cam-title-group">
            <span class="cam-name">${cam.name}</span>
            <span class="cam-id">${cam.id}</span>
          </div>
          <div class="cam-status-indicator ${statusClass}">
            <span class="cam-dot"></span>
            <span>${statusLabel}</span>
          </div>
        </div>
        <div class="cam-location">${cam.location}</div>
        ${hasAlert ? `<div class="cam-alert-flag"><span class="pulse-dot"></span> Active Incident</div>` : ''}
        ${mobileNotice}
      `;
      cameraListContainer.appendChild(card);
    });
  }

  // --- ANTI-FLOODING ALERT IN-PLACE UPDATER & ALARM BUFFER ---
  let isSirenActive = false;

  function handleIncomingAlerts(incoming) {
    let newCriticalCameraName = '';

    // 1. Merge incoming events into local state
    incoming.forEach(incEvt => {
      const idx = events.findIndex(e => e.event_id === incEvt.event_id);
      if (idx >= 0) {
        // In-place update: updates duration counter, confidence, and status
        events[idx] = { ...events[idx], ...incEvt };
      } else {
        // Prepend new event
        events.unshift(incEvt);
        // Fire alert ping exactly once per new critical/high event
        if ((incEvt.severity === 'CRITICAL' || incEvt.severity === 'HIGH') && incEvt.system_status === 'ACTIVE') {
          window.tacticalAudio.playAlertPing('CRITICAL');
          newCriticalCameraName = incEvt.camera_name || incEvt.camera_id;
        }
      }
    });

    // 2. Derive alarm state from the FULL current events array (not just incoming batch)
    const qualifying = events.filter(e =>
      e.system_status === 'ACTIVE' &&
      (e.severity === 'CRITICAL' || e.severity === 'HIGH')
    );

    if (qualifying.length > 0 && !isSirenActive) {
      // Transition: no alarm -> alarm
      window.tacticalAudio.startSiren();
      isSirenActive = true;
      console.log('[AUDIO] SIREN START');
      const displayName = newCriticalCameraName || qualifying[0].camera_name || qualifying[0].camera_id;
      if (alarmBanner) {
        alarmBanner.classList.remove('hidden');
        document.getElementById('alarmSirenText').textContent = `CRITICAL PERIMETER BREACH DETECTED AT ${displayName.toUpperCase()}!`;
      }
    } else if (qualifying.length > 0 && isSirenActive) {
      // Alarm continues — update banner text if needed, but don't restart siren
      if (alarmBanner && alarmBanner.classList.contains('hidden')) {
        alarmBanner.classList.remove('hidden');
      }
    } else if (qualifying.length === 0 && isSirenActive) {
      // Transition: alarm -> no alarm (all incidents resolved)
      window.tacticalAudio.stopSiren();
      isSirenActive = false;
      console.log('[AUDIO] SIREN STOP');
      if (alarmBanner) {
        alarmBanner.classList.add('hidden');
      }
    } else if (qualifying.length === 0 && !isSirenActive) {
      // No alarm, no qualifying events — ensure banner is hidden
      if (alarmBanner && !alarmBanner.classList.contains('hidden')) {
        alarmBanner.classList.add('hidden');
      }
    }

    renderAlerts();
    renderCameraList();
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
        <div style="padding: 30px 10px; text-align: center; color: var(--text-tertiary); font-size: 13px;">
          No incidents under current filter (${activeFilter.toLowerCase()})
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
        ? `<div class="duration-live-badge pulsing"><span class="pulse-dot"></span> Live (${evt.duration_sec || 1}s)</div>`
        : `<div class="duration-live-badge">Resolved</div>`;

      const anprCallout = evt.plate_text ? `
        <div class="anpr-plate-pill">
          <span>License Plate:</span>
          <strong>${evt.plate_text}</strong>
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
          <span>·</span>
          <span>${evt.location}</span>
          <span>·</span>
          <span>${new Date(evt.timestamp).toLocaleTimeString('en-GB')}</span>
        </div>
        <div class="alert-details">${evt.details}</div>
        ${anprCallout}
        <div class="alert-actions-row">
          ${evt.operator_status === 'UNACKNOWLEDGED' ? `
            <button class="alert-action-btn primary" onclick="window.handleAlertAction('${evt.event_id}', 'ACKNOWLEDGE')">Acknowledge</button>
            ${evt.severity === 'CRITICAL' ? `<button class="alert-action-btn btn-qrt" onclick="window.handleAlertAction('${evt.event_id}', 'DISPATCH_QRT')">Dispatch QRT</button>` : ''}
          ` : `
            <span class="alert-status-resolved">✓ ${evt.operator_status}</span>
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
        ],
        'CAM-MOBILE-01': [
          {
            id: 'ZONE-MOBILE-01',
            name: 'Mobile Patrol Exclusion Zone',
            type: 'polygon',
            rule: 'VIRTUAL_FENCE',
            severity: 'CRITICAL',
            color: '#ff3d71',
            points: [
              { x: 0.02, y: 0.02 },
              { x: 0.98, y: 0.02 },
              { x: 0.98, y: 0.98 },
              { x: 0.02, y: 0.98 }
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

  // Close buttons for modals & click outside to close
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
  });

  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const dialog = e.target.closest('dialog');
      if (dialog) dialog.close();
    });
  });

  // Tactical Audio Alarm & Siren Controls
  btnMute?.addEventListener('click', () => {
    const isMuted = window.tacticalAudio.toggleMute();
    btnMute.textContent = isMuted ? 'UNMUTE AUDIO' : 'MUTE AUDIO';
    btnMute.style.color = isMuted ? 'var(--accent-red)' : '';
  });

  btnDismissSiren?.addEventListener('click', () => {
    window.tacticalAudio.stopSiren();
    alarmBanner?.classList.add('hidden');
  });

  // -------------------------------------------------------------
  // Mobile Camera Connect Modal UX & Telemetry Wiring (CAM-MOBILE-01)
  // -------------------------------------------------------------
  let currentMobileUrl = '';
  const btnOpenMobileCamModal = document.getElementById('btnOpenMobileCamModal');
  const mobileCamDialog = document.getElementById('mobileCamDialog');
  const modalLanIp = document.getElementById('modalLanIp');
  const modalMobileUrl = document.getElementById('modalMobileUrl');
  const modalModeBadge = document.getElementById('modalModeBadge');
  const inputCustomServerIp = document.getElementById('inputCustomServerIp');
  const btnApplyCustomIp = document.getElementById('btnApplyCustomIp');
  const mobileCamHttpsWarning = document.getElementById('mobileCamHttpsWarning');
  const mobileCamConnectFlow = document.getElementById('mobileCamConnectFlow');
  const mobileCamQrCode = document.getElementById('mobileCamQrCode');
  const btnCopyMobileUrl = document.getElementById('btnCopyMobileUrl');
  const copyUrlFeedback = document.getElementById('copyUrlFeedback');
  const btnOpenMobilePreview = document.getElementById('btnOpenMobilePreview');

  // PeerJS WebRTC & BroadcastChannel Uplink for Mobile Camera
  let peer = null;
  let peerId = 'ibvap-' + Math.random().toString(36).substring(2, 8);
  const mobileCamBc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ibvap_mobile_cam') : null;

  if (mobileCamBc) {
    mobileCamBc.onmessage = (evt) => {
      handleMobileCamTelemetry(evt.data);
    };
  }

  function initPeer() {
    if (typeof Peer === 'undefined') return;
    try {
      peer = new Peer(peerId);
      peer.on('open', (id) => {
        console.log('[PEER] C2 Console PeerJS initialized with ID:', id);
        peerId = id;
      });
      peer.on('connection', (conn) => {
        console.log('[PEER] Mobile phone camera connected via WebRTC PeerJS!');
        conn.on('data', (data) => {
          handleMobileCamTelemetry(data);
        });
        conn.on('close', () => {
          console.log('[PEER] Mobile camera peer connection closed');
          const mobileCam = cameras.find(c => c.id === 'CAM-MOBILE-01');
          if (mobileCam && mobileCam.status === 'ONLINE') {
            mobileCam.status = 'WAITING';
            renderCameraList();
            updateActiveCamera();
            updateMobileCamModalStatus();
          }
        });
      });
      peer.on('error', (err) => {
        console.warn('[PEER] Peer error:', err.type || err);
      });
    } catch (e) {
      console.warn('[PEER] Peer initialization skipped:', e);
    }
  }

  function handleMobileCamTelemetry(data) {
    if (!data || !data.type) return;
    let mobileCam = cameras.find(c => c.id === 'CAM-MOBILE-01');
    if (!mobileCam) {
      mobileCam = {
        id: 'CAM-MOBILE-01',
        name: 'Mobile Recon Patrol (Smartphone Ad-Hoc Feed)',
        bop: 'Mobile QRT Recon Unit',
        location: 'Tactical Recon Point // Dynamic Smartphone Feed',
        resolution: 'Mobile 720p',
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
      window.tacticalAudio?.playAlertPing('INFO');
      renderCameraList();
      updateActiveCamera();
      updateMobileCamModalStatus();
    } else if (data.type === 'MOBILE_HEARTBEAT') {
      mobileCam.status = 'ONLINE';
      mobileCam.lastSeen = Date.now();
      updateMobileCamModalStatus();
    } else if (data.type === 'MOBILE_DETECTION') {
      mobileCam.status = 'ONLINE';
      mobileCam.lastSeen = Date.now();
      mobileCam.activeDetections = data.detections || [];
      if (data.frameImage) {
        mobileCam.frameImage = data.frameImage;
      }
      const detections = data.detections || [];
      const persons = detections.filter(d => d.classLabel === 'person').length;
      const highestConf = detections.reduce((max, d) => Math.max(max, d.confidence || 0), 0);
      mobileCam.meta = {
        detectedPersons: persons,
        totalObjects: detections.length,
        confidencePct: Math.round(highestConf * 100),
        lastReceivedAt: Date.now()
      };

      updateActiveCamera();
      renderCameraList();
      updateMobileCamModalStatus();
    } else if (data.type === 'MOBILE_REQUEST_FOCUS') {
      switchCamera('CAM-MOBILE-01');
    }
  }

  function computeMobileCamUrl(customHost) {
    const isPublicCloud = window.location.protocol === 'https:' &&
      !window.location.hostname.match(/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/);

    if (customHost && customHost.trim()) {
      const trimmed = customHost.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const port = trimmed.includes(':') ? '' : ':3443';
      const peerQuery = peerId ? `?peer=${peerId}` : '';
      return `https://${trimmed}${port}/mobile-cam.html${peerQuery}`;
    }

    if (isPublicCloud) {
      const peerQuery = peerId ? `?peer=${peerId}` : '';
      return `${window.location.origin}/mobile-cam.html${peerQuery}`;
    }

    const host = window.location.hostname || 'localhost';
    const peerQuery = peerId ? `?peer=${peerId}` : '';
    return `https://${host}:3443/mobile-cam.html${peerQuery}`;
  }

  function renderMobileCamQr(url) {
    currentMobileUrl = url;
    if (modalMobileUrl) modalMobileUrl.textContent = url;
    if (mobileCamQrCode && typeof QRCode !== 'undefined') {
      mobileCamQrCode.innerHTML = '';
      new QRCode(mobileCamQrCode, {
        text: url,
        width: 140,
        height: 140,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  }

  btnApplyCustomIp?.addEventListener('click', () => {
    const custom = inputCustomServerIp ? inputCustomServerIp.value : '';
    const url = computeMobileCamUrl(custom);
    renderMobileCamQr(url);
  });

  // Open modal in-place without navigating away from the dashboard tab
  btnOpenMobileCamModal?.addEventListener('click', async () => {
    const isPublicCloud = window.location.protocol === 'https:' &&
      !window.location.hostname.match(/^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/);

    if (modalModeBadge) {
      modalModeBadge.textContent = isPublicCloud ? 'CLOUD WEBRTC' : 'LOCAL WI-FI';
      modalModeBadge.style.color = isPublicCloud ? 'var(--accent-cyan)' : 'var(--accent-green)';
    }

    if (isPublicCloud) {
      if (modalLanIp) modalLanIp.textContent = window.location.hostname;
      const url = computeMobileCamUrl(inputCustomServerIp?.value);
      renderMobileCamQr(url);
      if (mobileCamHttpsWarning) mobileCamHttpsWarning.style.display = 'none';
      if (mobileCamConnectFlow) mobileCamConnectFlow.style.display = 'block';
      updateMobileCamModalStatus();
      mobileCamDialog?.showModal();
      return;
    }

    try {
      if (modalLanIp) modalLanIp.textContent = 'Detecting LAN IP...';
      if (modalMobileUrl) modalMobileUrl.textContent = 'Loading endpoint...';

      const res = await fetch('/api/mobile-cam-info');
      const info = await res.json();

      const host = info.lanIp || window.location.hostname;
      if (modalLanIp) modalLanIp.textContent = host;

      const url = info.mobileUrl ? `${info.mobileUrl}.html?peer=${peerId}` : computeMobileCamUrl(inputCustomServerIp?.value);
      renderMobileCamQr(url);

      if (info.httpsAvailable) {
        if (mobileCamHttpsWarning) mobileCamHttpsWarning.style.display = 'none';
        if (mobileCamConnectFlow) mobileCamConnectFlow.style.display = 'block';
      } else {
        if (mobileCamConnectFlow) mobileCamConnectFlow.style.display = 'none';
        if (mobileCamHttpsWarning) mobileCamHttpsWarning.style.display = 'block';
      }
      updateMobileCamModalStatus();
      mobileCamDialog?.showModal();
    } catch (err) {
      console.warn('[MOBILE-CAM] Could not fetch local endpoint info, using fallback:', err.message);
      if (modalLanIp) modalLanIp.textContent = window.location.hostname;
      const url = computeMobileCamUrl(inputCustomServerIp?.value);
      renderMobileCamQr(url);
      if (mobileCamHttpsWarning) mobileCamHttpsWarning.style.display = 'none';
      if (mobileCamConnectFlow) mobileCamConnectFlow.style.display = 'block';
      updateMobileCamModalStatus();
      mobileCamDialog?.showModal();
    }
  });

  // Copy mobile URL to clipboard
  btnCopyMobileUrl?.addEventListener('click', async () => {
    if (!currentMobileUrl) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(currentMobileUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = currentMobileUrl;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      if (copyUrlFeedback) {
        copyUrlFeedback.style.display = 'inline';
        setTimeout(() => {
          copyUrlFeedback.style.display = 'none';
        }, 2500);
      }
    } catch (e) {
      console.error('[MOBILE-CAM] Copy failed:', e);
    }
  });

  // Open preview in new tab on current device
  btnOpenMobilePreview?.addEventListener('click', () => {
    if (currentMobileUrl) {
      window.open(currentMobileUrl, '_blank');
    }
  });

  // Set Phone in Center button inside modal
  const btnModalSetPhoneCenter = document.getElementById('btnModalSetPhoneCenter');
  btnModalSetPhoneCenter?.addEventListener('click', () => {
    switchCamera('CAM-MOBILE-01');
    mobileCamDialog?.close();
  });

  // Switch Center to Phone button in main viewport header
  const btnSwitchCenterToPhone = document.getElementById('btnSwitchCenterToPhone');
  btnSwitchCenterToPhone?.addEventListener('click', () => {
    if (activeCameraId === 'CAM-MOBILE-01') {
      switchCamera('CAM-01');
    } else {
      switchCamera('CAM-MOBILE-01');
      const mobileCam = cameras.find(c => c.id === 'CAM-MOBILE-01');
      if (!mobileCam || mobileCam.status !== 'ONLINE') {
        btnOpenMobileCamModal?.click();
      }
    }
  });

  // Updates live phone connection telemetry inside the connection modal (7 Debug Fields)
  function updateMobileCamModalStatus() {
    const elQr = document.getElementById('debugFieldQr');
    const elPhone = document.getElementById('debugFieldPhone');
    const elWs = document.getElementById('debugFieldWs');
    const elCamId = document.getElementById('debugFieldCamId');
    const elLastDetect = document.getElementById('debugFieldLastDetect');
    const elPersons = document.getElementById('debugFieldPersons');
    const elConfidence = document.getElementById('debugFieldConfidence');
    const dot = document.getElementById('modalStatusDot');
    const stateText = document.getElementById('modalStatusStateText');

    if (!elPhone) return;

    if (elQr) elQr.textContent = 'READY';
    if (elCamId) elCamId.textContent = 'CAM-MOBILE-01';

    const mobileCam = cameras.find(c => c.id === 'CAM-MOBILE-01');
    if (!mobileCam) return;

    const status = mobileCam.status || 'WAITING';
    const meta = mobileCam.meta || {};
    const activeDets = mobileCam.activeDetections || [];
    const personDets = activeDets.filter(d => (d.classLabel || d.class || '').toLowerCase() === 'person');
    const personsCount = personDets.length;
    const highestConf = personDets.reduce((max, d) => Math.max(max, d.confidence || 0), 0);

    // Phase 1.2 / Final Rule State Mapping:
    // QR: READY
    // PHONE: WAITING / CONNECTED
    // WEBSOCKET: WAITING / CONNECTED
    // CAMERA ID: CAM-MOBILE-01
    // LAST DETECTION: -- / "<n>s ago"
    // PERSONS: -- / <count>
    // CONFIDENCE: -- / <pct>%
    if (status === 'ONLINE') {
      if (dot) {
        dot.className = 'dot green';
        dot.style.background = '';
      }
      if (stateText) {
        stateText.textContent = 'ONLINE';
        stateText.style.color = 'var(--accent-green)';
      }
      elPhone.textContent = 'CONNECTED';
      elPhone.style.color = 'var(--accent-green)';
      elWs.textContent = 'CONNECTED';
      elWs.style.color = 'var(--accent-green)';
    } else if (status === 'STALE') {
      if (dot) {
        dot.className = 'dot amber';
        dot.style.background = '';
      }
      if (stateText) {
        stateText.textContent = 'STALE';
        stateText.style.color = 'var(--accent-amber)';
      }
      elPhone.textContent = 'STALE';
      elPhone.style.color = 'var(--accent-amber)';
      elWs.textContent = 'CONNECTED';
      elWs.style.color = 'var(--accent-amber)';
    } else if (status === 'OFFLINE') {
      if (dot) {
        dot.className = 'dot';
        dot.style.background = '#90a4ae';
      }
      if (stateText) {
        stateText.textContent = 'OFFLINE';
        stateText.style.color = '#90a4ae';
      }
      elPhone.textContent = 'OFFLINE';
      elPhone.style.color = '#90a4ae';
      elWs.textContent = 'OFFLINE';
      elWs.style.color = '#90a4ae';
    } else {
      // WAITING (initial state before phone connects)
      if (dot) {
        dot.className = 'dot amber';
        dot.style.background = '';
      }
      if (stateText) {
        stateText.textContent = 'WAITING';
        stateText.style.color = 'var(--text-muted)';
      }
      elPhone.textContent = 'WAITING';
      elPhone.style.color = 'var(--accent-amber)';
      elWs.textContent = 'WAITING';
      elWs.style.color = 'var(--accent-amber)';
    }

    // LAST DETECTION: -- / "<n>s ago"
    if (elLastDetect) {
      if (!meta.lastReceivedAt) {
        elLastDetect.textContent = '--';
        elLastDetect.style.color = 'var(--text-dim)';
      } else {
        const secAgo = Math.max(0, ((Date.now() - meta.lastReceivedAt) / 1000)).toFixed(1);
        elLastDetect.textContent = `${secAgo}s ago`;
        elLastDetect.style.color = Number(secAgo) <= 3 ? 'var(--accent-cyan)' : 'var(--text-dim)';
      }
    }

    // PERSONS: -- / <count>
    if (elPersons) {
      if (status === 'ONLINE') {
        elPersons.textContent = personsCount.toString();
        elPersons.style.color = 'var(--accent-green)';
      } else if (status === 'STALE') {
        const count = meta.lastKnownPersonCount !== undefined ? meta.lastKnownPersonCount : personsCount;
        elPersons.textContent = `${count}`;
        elPersons.style.color = 'var(--accent-amber)';
      } else {
        elPersons.textContent = '--';
        elPersons.style.color = 'var(--text-dim)';
      }
    }

    // CONFIDENCE: -- / <pct>%
    if (elConfidence) {
      if (status === 'ONLINE' && highestConf > 0) {
        elConfidence.textContent = `${Math.round(highestConf * 100)}%`;
        elConfidence.style.color = 'var(--accent-cyan)';
      } else {
        elConfidence.textContent = '--';
        elConfidence.style.color = 'var(--text-dim)';
      }
    }
  }

  // Initial UI Render & Peer Initialization
  renderCameraList();
  updateActiveCamera();
  initPeer();

  // Connect WebSocket
  connectWs();
});
