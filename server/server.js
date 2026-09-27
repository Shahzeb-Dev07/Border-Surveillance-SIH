const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const apiRoutes = require('./routes/api');
const cameraManager = require('./engine/cameraManager');
const storage = require('./engine/storage');

const app = express();
const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

const { getLocalIp } = require('./utils/network');

const lanIp = getLocalIp();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API
app.use('/api', apiRoutes);

// Mobile Camera Web App route (TensorFlow.js COCO-SSD Edge Ingestion)
app.get('/mobile-cam', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mobile-cam.html'));
});

// Fallback to index.html for SPA
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/assets') && req.path !== '/mobile-cam') {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  next();
});

// 1. Create HTTP server & WebSocket server (bound to 0.0.0.0 for all interfaces)
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 2. Create HTTPS server & WebSocket server for secure camera context
let httpsServer = null;
let wssSecure = null;

const keyPath = path.join(__dirname, '..', 'certs', 'key.pem');
const certPath = path.join(__dirname, '..', 'certs', 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };
  httpsServer = https.createServer(httpsOptions, app);
  wssSecure = new WebSocketServer({ server: httpsServer });
} else {
  console.warn('[HTTPS] SSL certificates not found in ./certs/ (key.pem, cert.pem). HTTPS listener disabled.');
}

// Unified Broadcast helper across both HTTP & HTTPS WebSocket clients
function broadcast(payload) {
  const data = JSON.stringify(payload);
  const sendToClients = (serverInstance) => {
    if (!serverInstance) return;
    serverInstance.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  };
  sendToClients(wss);
  sendToClients(wssSecure);
}

const mobileCameraClients = new Map(); // cameraId -> ws

// Immediate broadcast helper on camera state changes
function broadcastCameraUpdate() {
  broadcast({
    type: 'CAMERA_UPDATE',
    data: {
      cameras: cameraManager.cameras.map(c => ({
        id: c.id,
        name: c.name,
        bop: c.bop,
        location: c.location,
        snapshotUri: c.snapshotUri,
        resolution: c.resolution,
        mode: c.mode,
        fps: c.fps,
        latencyMs: c.latencyMs,
        status: c.status,
        activeDetections: c.activeDetections || [],
        meta: c.currentMeta || {}
      })),
      telemetry: {
        ...cameraManager.edgeTelemetry,
        offlineQueueCount: storage.offlineQueue.length,
        totalEventsStored: storage.events.length
      }
    }
  });
}

// Hook cameraManager status transitions to broadcast immediately
cameraManager.onStatusChange = () => {
  broadcastCameraUpdate();
};

// Extracted shared WebSocket connection & message handling
function handleWsConnection(ws, req, isSecure = false) {
  console.log('[WS] Client connected to IBVAP C2 stream');

  // Send initial snapshot
  ws.send(JSON.stringify({
    type: 'INIT',
    data: {
      cameras: cameraManager.getCameras(),
      zones: storage.zones,
      config: storage.getRulesConfig(),
      wanConnected: storage.wanConnected,
      offlineQueueCount: storage.offlineQueue.length,
      events: storage.getEvents()
    }
  }));

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
      } else if (msg.type === 'TOGGLE_WAN') {
        const result = storage.toggleWan(msg.status);
        broadcast({
          type: 'WAN_STATE_CHANGE',
          data: result
        });
      } else if (msg.type === 'MOBILE_CAMERA_CONNECT') {
        const cameraId = msg.cameraId || 'CAM-MOBILE-01';
        mobileCameraClients.set(cameraId, ws);
        ws.mobileCameraId = cameraId;
        console.log(`[MOBILE] ${cameraId} connected`);
        cameraManager.registerMobileConnect(cameraId);
        broadcastCameraUpdate();
      } else if (msg.type === 'MOBILE_HEARTBEAT') {
        const cameraId = msg.cameraId || 'CAM-MOBILE-01';
        if (!ws.mobileCameraId) {
          ws.mobileCameraId = cameraId;
          mobileCameraClients.set(cameraId, ws);
        }
        cameraManager.ingestMobileHeartbeat(cameraId);
      } else if (msg.type === 'MOBILE_DETECTION') {
        const cameraId = msg.cameraId || 'CAM-MOBILE-01';
        if (!ws.mobileCameraId) {
          ws.mobileCameraId = cameraId;
          mobileCameraClients.set(cameraId, ws);
        }
        const detections = Array.isArray(msg.detections) ? msg.detections : [];
        const highestConf = detections.reduce((max, d) => Math.max(max, d.confidence || 0), 0);
        const confPct = Math.round(highestConf * 100);

        console.log('[MOBILE] Detection received');
        console.log(`[MOBILE] Camera: ${cameraId}`);
        console.log(`[MOBILE] Persons: ${detections.length}`);
        console.log(`[MOBILE] Confidence: ${confPct}%`);

        cameraManager.ingestMobileDetections(cameraId, detections, msg);
      }
    } catch (err) {
      console.error('[WS] Message error:', err.message);
    }
  });

  ws.on('close', () => {
    if (ws.mobileCameraId) {
      const cid = ws.mobileCameraId;
      console.log(`[MOBILE] ${cid} disconnected`);
      if (mobileCameraClients.get(cid) === ws) {
        mobileCameraClients.delete(cid);
      }
      cameraManager.handleMobileDisconnect(cid);
      broadcastCameraUpdate();
    }
    console.log('[WS] Client disconnected');
  });
}

// Attach shared handler to both listeners
wss.on('connection', (ws, req) => handleWsConnection(ws, req, false));
if (wssSecure) {
  wssSecure.on('connection', (ws, req) => handleWsConnection(ws, req, true));
}

// Analytics Engine Loop (Runs at 8 Hz for smooth tracking & real-time alerts)
let tickCount = 0;
setInterval(() => {
  const tickResult = cameraManager.tick();
  tickCount++;

  // Broadcast camera frames & active tracks to operators
  broadcast({
    type: 'CAMERA_UPDATE',
    data: {
      cameras: tickResult.cameras,
      telemetry: tickResult.telemetry
    }
  });

  // If new or updated anti-flooding events occurred, broadcast them
  if (tickResult.events && tickResult.events.length > 0) {
    broadcast({
      type: 'ALERTS_UPDATE',
      data: tickResult.events
    });
  }
}, 125); // 8 FPS edge sampling

// Start HTTP server on 0.0.0.0
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================================`);
  console.log(` IBVAP - Intelligent Border Video Analytics Platform (SIH 2026)   `);
  console.log(` Operational Command & Control Node running:                       `);
  console.log(`   - HTTP Local Desktop:  http://localhost:${PORT}                  `);
  console.log(`   - HTTP LAN Access:     http://${lanIp}:${PORT}                   `);
  if (httpsServer) {
    console.log(`   - HTTPS Mobile Cam:    https://${lanIp}:${HTTPS_PORT}/mobile-cam    `);
  } else {
    console.log(`   - HTTPS Mobile Cam:    WARNING: HTTPS unavailable (run: npm run setup-certs)`);
  }
  console.log(` Architecture: Edge-First C2 & Decoupled Rules Engine (Prototype) `);
  console.log(`===================================================================`);
});

// Start HTTPS server on 0.0.0.0 if certs are present
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`[HTTPS] Secure Mobile Cam server listening on https://0.0.0.0:${HTTPS_PORT}`);
  });
}
