const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const apiRoutes = require('./routes/api');
const cameraManager = require('./engine/cameraManager');
const storage = require('./engine/storage');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API
app.use('/api', apiRoutes);

// Fallback to index.html for SPA
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/assets')) {
    return res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  }
  next();
});

// Create HTTP server & WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Broadcast helper
function broadcast(payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  console.log('[WS] Operator client connected to IBVAP C2 stream');

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
      }
    } catch (err) {
      console.error('[WS] Message error:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[WS] Operator client disconnected');
  });
});

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

// Start server
server.listen(PORT, () => {
  console.log(`===================================================================`);
  console.log(` IBVAP - Intelligent Border Video Analytics Platform (SIH 2026)   `);
  console.log(` Operational Command & Control Node running on port ${PORT}      `);
  console.log(` Local URL: http://localhost:${PORT}                             `);
  console.log(` Architecture: Edge-First Hybrid AI with Local Durable Storage    `);
  console.log(`===================================================================`);
});
