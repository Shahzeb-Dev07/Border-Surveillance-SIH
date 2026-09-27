const MultiObjectTracker = require('./tracker');
const ruleEngine = require('./ruleEngine');
const AlertEngine = require('./alertEngine');
const storage = require('./storage');

class CameraManager {
  constructor() {
    this.alertEngine = new AlertEngine(storage);

    this.cameras = [
      {
        id: 'CAM-01',
        name: 'Perimeter Watchtower Alpha',
        bop: 'BOP 14 - Kakrahwa Sector',
        location: 'Border Pillar 552/3 - Main Perimeter Fence',
        rtspUrl: 'rtsp://10.14.20.101:554/live/stream1',
        snapshotUri: '/assets/cam_bop_01_perimeter.jpg',
        resolution: '1920x1080 @ 15fps',
        mode: 'DAYLIGHT_RGB',
        fovType: 'WIDE_PERIMETER',
        capabilities: {
          humanDetection: true,
          humanTracking: true,
          virtualFence: true,
          anpr: false, // Explicitly disabled on wide FOV (Section 3)
          faceRecognition: false, // Explicitly disabled on wide FOV (Section 3)
          nightIr: false
        },
        fps: 15.0,
        latencyMs: 18.2,
        status: 'ONLINE',
        tracker: new MultiObjectTracker(),
        simTime: 0
      },
      {
        id: 'CAM-02',
        name: 'Checkpost Barrier Choke Point',
        bop: 'BOP 14 - Kakrahwa Sector',
        location: 'Inbound Vehicle Inspection Lane',
        rtspUrl: 'rtsp://10.14.20.102:554/live/stream1',
        snapshotUri: '/assets/cam_bop_01_chokepoint.jpg',
        resolution: '1920x1080 @ 20fps',
        mode: 'DAYLIGHT_RGB',
        fovType: 'CHOKE_POINT_INSPECTION',
        capabilities: {
          humanDetection: true,
          humanTracking: true,
          virtualFence: true,
          anpr: true, // CONDITIONAL CAPABILITY - Choke point geometry supported!
          faceRecognition: true, // CONDITIONAL CAPABILITY - Gate distance supported!
          nightIr: false
        },
        fps: 20.0,
        latencyMs: 22.4,
        status: 'ONLINE',
        tracker: new MultiObjectTracker(),
        simTime: 0
      },
      {
        id: 'CAM-03',
        name: 'Sector 4 Ridge Zero-Line (Night IR)',
        bop: 'BOP 18 - Mahadeva Ridge',
        location: 'Zero-Line Restricted Wire Sector 4',
        rtspUrl: 'rtsp://10.18.30.103:554/live/stream1',
        snapshotUri: '/assets/cam_bop_02_night_ir.jpg',
        resolution: '1280x720 @ 12fps',
        mode: 'NIGHT_IR_ILLUMINATED',
        fovType: 'PERIMETER_IR_ZONE',
        capabilities: {
          humanDetection: true,
          humanTracking: true,
          virtualFence: true,
          anpr: false,
          faceRecognition: false,
          nightIr: true // High contrast IR silhouette mode
        },
        fps: 12.0,
        latencyMs: 31.0,
        status: 'ONLINE',
        tracker: new MultiObjectTracker(),
        simTime: 0
      },
      {
        id: 'CAM-04',
        name: 'High Altitude Patrol Road',
        bop: 'BOP 22 - Sonauli Sector',
        location: 'Border Patrol Access Road KM 12',
        rtspUrl: 'rtsp://10.22.40.104:554/live/stream1',
        snapshotUri: '/assets/cam_bop_03_road_patrol.jpg',
        resolution: '1920x1080 @ 15fps',
        mode: 'DAYLIGHT_RGB',
        fovType: 'HIGHWAY_TRANSIT',
        capabilities: {
          humanDetection: true,
          humanTracking: true,
          virtualFence: true,
          anpr: false,
          faceRecognition: false,
          nightIr: false
        },
        fps: 15.0,
        latencyMs: 19.5,
        status: 'ONLINE',
        tracker: new MultiObjectTracker(),
        simTime: 0
      },
      {
        id: 'CAM-MOBILE-01',
        name: 'Mobile Recon Patrol (Smartphone Ad-Hoc Feed)',
        bop: 'Mobile QRT Recon Unit',
        location: 'Tactical Recon Point // Dynamic Smartphone Feed',
        rtspUrl: 'webrtc://edge-mobile-stream/live',
        snapshotUri: '/assets/cam_bop_mobile.jpg',
        resolution: 'Mobile 720p @ 8fps',
        mode: 'DAYLIGHT_RGB',
        fovType: 'MOBILE_ADHOC',
        capabilities: {
          humanDetection: true,
          humanTracking: true,
          virtualFence: true,
          anpr: false,
          faceRecognition: false,
          nightIr: false
        },
        fps: 8.0,
        latencyMs: 14.5,
        status: 'WAITING',
        hasReceivedConnect: false,
        tracker: new MultiObjectTracker(),
        simTime: 0,
        isMobile: true
      }
    ];

    // Mobile camera runtime state
    this.latestMobileDetections = [];
    this.lastMobileSeen = 0;

    // Hardware Telemetry Simulation
    this.edgeTelemetry = {
      cpuUsagePercent: 34.2,
      gpuUsagePercent: 52.8,
      gpuTempC: 56.4,
      ramUsagePercent: 41.5,
      inferenceLatencyMs: 19.4,
      networkThroughputKbps: 420,
      wanStatus: 'CONNECTED',
      fpsAggregate: 15.2,
      falseAlertRatePercent: 2.1
    };
  }

  // Generates synthetic spatial-temporal detections for each camera scenario
  // In this prototype, detections and choke-point metadata are simulated to drive the downstream
  // C2 rule engine, multi-object tracker, and anti-flooding aggregator without requiring an edge GPU.
  // Production deployment would replace this with ONNX Runtime YOLOv8/ByteTrack stream inference.
  _generateDetections(camera) {
    const t = camera.simTime;
    const dets = [];
    const meta = { anpr: null, face: null };

    if (camera.id === 'CAM-01') {
      // Scenario 1: Perimeter watchtower
      // Object A: Border Patrol Soldier walking along road (normal routine)
      const soldierY = 0.50 + 0.15 * Math.sin(t * 0.08);
      const soldierX = 0.55 + (soldierY - 0.50) * 0.4;
      dets.push({
        classLabel: 'patrol_soldier',
        confidence: 0.94,
        bbox: {
          x: soldierX,
          y: soldierY,
          w: 0.045,
          h: 0.12
        }
      });

      // Object B: Suspect Person loitering & approaching exclusion fence
      // Periodically moves close to the barbed wire exclusion zone
      const cycle = (t % 60);
      let suspectX = 0.28;
      let suspectY = 0.65;

      if (cycle < 25) {
        // Lingers near fence (triggers dwell & fence breach)
        suspectX = 0.26 + 0.04 * Math.sin(cycle * 0.2);
        suspectY = 0.68 + 0.03 * Math.cos(cycle * 0.2);
      } else {
        // Moves back toward rocks
        suspectX = 0.38 + (cycle - 25) * 0.015;
        suspectY = 0.58 + (cycle - 25) * 0.008;
      }

      dets.push({
        classLabel: 'person',
        confidence: 0.91,
        bbox: {
          x: suspectX,
          y: suspectY,
          w: 0.048,
          h: 0.125
        }
      });

      // Occasional wildlife in background scrub (Section 9 false-positive test case)
      if (cycle > 40 && cycle < 55) {
        dets.push({
          classLabel: 'wildlife',
          confidence: 0.72,
          bbox: {
            x: 0.82 + 0.02 * Math.sin(t * 0.3),
            y: 0.42,
            w: 0.03,
            h: 0.04
          }
        });
      }
    } else if (camera.id === 'CAM-02') {
      // Scenario 2: Checkpoint Choke Point
      // Vehicle approaching boom barrier & stopping for inspection
      const cycle = (t % 45);
      let vehY = 0.52;
      let vehX = 0.46;
      let vehSpeed = 0;

      if (cycle < 10) {
        vehY = 0.40 + cycle * 0.012;
        vehSpeed = 14 - cycle * 1.2;
      } else if (cycle < 35) {
        // Stopped stationary at boom barrier
        vehY = 0.53;
        vehSpeed = 0.2;
      } else {
        // Clears barrier
        vehY = 0.53 + (cycle - 35) * 0.025;
        vehSpeed = 18;
      }

      dets.push({
        classLabel: 'civilian_vehicle',
        confidence: 0.96,
        speed: vehSpeed,
        bbox: {
          x: vehX - 0.07,
          y: vehY,
          w: 0.15,
          h: 0.14
        }
      });

      // ANPR extraction active at barrier (choke point geometry)
      if (cycle >= 8 && cycle <= 36) {
        meta.anpr = {
          plateNumber: 'UP-55-AF-1084',
          confidence: 0.88,
          plateCrop: { x: 0.47, y: 0.63, w: 0.07, h: 0.03 },
          multiFrameValidationPassed: true
        };

        meta.face = {
          confidence: 0.79,
          faceCrop: { x: 0.44, y: 0.54, w: 0.025, h: 0.035 },
          matchScore: 0.68,
          status: 'POSSIBLE_MATCH_UNCONFIRMED'
        };
      }

      // Checkpoint Guard
      dets.push({
        classLabel: 'patrol_soldier',
        confidence: 0.92,
        bbox: {
          x: 0.53,
          y: 0.52,
          w: 0.035,
          h: 0.10
        }
      });
    } else if (camera.id === 'CAM-03') {
      // Scenario 3: Night IR Sector 4
      // Night infiltrator walking along the zero-line illuminated wire
      const cycle = (t % 50);
      const infilY = 0.62 + 0.12 * Math.sin(cycle * 0.12);
      const infilX = 0.52 - (infilY - 0.62) * 0.2;

      dets.push({
        classLabel: 'person',
        confidence: 0.89, // IR silhouette confidence
        bbox: {
          x: infilX,
          y: infilY,
          w: 0.052,
          h: 0.15
        }
      });
    } else if (camera.id === 'CAM-04') {
      // Scenario 4: Highway Transit
      const cycle = (t % 40);
      const carProg = (cycle / 40);
      // Curve trajectory
      const curveX = 0.72 - carProg * 0.45;
      const curveY = 0.52 + carProg * 0.28;

      dets.push({
        classLabel: 'military_vehicle',
        confidence: 0.95,
        bbox: {
          x: curveX,
          y: curveY,
          w: 0.11,
          h: 0.12
        }
      });
    }

    return { dets, meta };
  }

  // Ingests real mobile detections from smartphone client
  ingestMobileDetections(arg1, arg2, arg3) {
    let cameraId = 'CAM-MOBILE-01';
    let detections = [];
    let metaInfo = {};

    if (typeof arg1 === 'string') {
      cameraId = arg1;
      if (Array.isArray(arg2)) {
        detections = arg2;
        metaInfo = arg3 || {};
      } else if (arg2 && typeof arg2 === 'object') {
        detections = arg2.detections || [];
        metaInfo = arg2;
      }
    } else if (Array.isArray(arg1)) {
      detections = arg1;
      if (typeof arg2 === 'string') cameraId = arg2;
      metaInfo = arg3 || {};
    } else if (arg1 && typeof arg1 === 'object') {
      cameraId = arg1.cameraId || 'CAM-MOBILE-01';
      detections = arg1.detections || [];
      metaInfo = arg1;
    }

    const cam = this.getCamera(cameraId);
    if (!cam) return;
    const now = Date.now();
    cam.hasReceivedConnect = true;
    cam.hasReceivedMobileMessage = true;
    cam.lastReceivedAt = now;
    cam.clientConnected = true;
    this.mobileClientConnected = true;
    const prevStatus = cam.status;
    cam.status = 'ONLINE';
    if (cam.status !== prevStatus && this.onStatusChange) {
      this.onStatusChange(cam);
    }

    // Store rich non-authoritative client telemetry for dashboard display
    cam.mobileTelemetry = {
      timestamp: now,
      frameWidth: metaInfo.frameWidth || 1280,
      frameHeight: metaInfo.frameHeight || 720,
      poseEngineActive: metaInfo.poseEngineActive !== undefined ? !!metaInfo.poseEngineActive : true,
      detections: detections
    };

    // Extract ONLY standard { classLabel, confidence, bbox } for tracker.js
    cam.latestMobileDetections = detections.map(d => ({
      classLabel: d.classLabel || 'person',
      confidence: typeof d.confidence === 'number' ? d.confidence : 0.9,
      bbox: d.bbox || { x: 0, y: 0, w: 0.1, h: 0.2 }
    }));

    cam.lastKnownPersonCount = cam.latestMobileDetections.length;
    this.latestMobileDetections = cam.latestMobileDetections;
    this.lastMobileSeen = now;
  }

  registerMobileConnect(cameraId = 'CAM-MOBILE-01') {
    const cam = this.getCamera(cameraId);
    if (!cam) return;
    const now = Date.now();
    cam.hasReceivedConnect = true;
    cam.hasReceivedMobileMessage = true;
    cam.clientConnected = true;
    this.mobileClientConnected = true;
    cam.lastReceivedAt = now;
    const prev = cam.status;
    cam.status = 'ONLINE';
    if (cam.status !== prev && this.onStatusChange) {
      this.onStatusChange(cam);
    }
  }

  ingestMobileHeartbeat(cameraId = 'CAM-MOBILE-01') {
    const cam = this.getCamera(cameraId);
    if (!cam) return;
    const now = Date.now();
    cam.hasReceivedConnect = true;
    cam.hasReceivedMobileMessage = true;
    cam.clientConnected = true;
    this.mobileClientConnected = true;
    cam.lastReceivedAt = now;
    const prev = cam.status;
    if (cam.status !== 'ONLINE') {
      cam.status = 'ONLINE';
      if (this.onStatusChange) {
        this.onStatusChange(cam);
      }
    }
  }

  handleMobileDisconnect(cameraId = 'CAM-MOBILE-01') {
    const cam = this.getCamera(cameraId);
    if (cam) {
      cam.clientConnected = false;
      this.mobileClientConnected = false;
      const prev = cam.status;
      cam.status = 'OFFLINE';
      if (cam.status !== prev && this.onStatusChange) {
        this.onStatusChange(cam);
      }
    }
  }

  setMobileClientConnected(connected = true) {
    const cam = this.getCamera('CAM-MOBILE-01');
    if (cam) {
      cam.clientConnected = connected;
      this.mobileClientConnected = connected;
      const prev = cam.status;
      if (!connected && (cam.hasReceivedMobileMessage || cam.hasReceivedConnect)) {
        cam.status = 'OFFLINE';
      }
      if (cam.status !== prev && this.onStatusChange) {
        this.onStatusChange(cam);
      }
    }
  }

  tick() {
    const config = storage.getRulesConfig();
    const frameEvents = [];

    // Jitter telemetry slightly for realism
    this.edgeTelemetry.cpuUsagePercent = Math.min(95, Math.max(20, 32 + 5 * Math.sin(Date.now() / 3000) + Math.random() * 4));
    this.edgeTelemetry.gpuUsagePercent = Math.min(98, Math.max(30, 52 + 7 * Math.cos(Date.now() / 4000) + Math.random() * 5));
    this.edgeTelemetry.inferenceLatencyMs = Number((18.5 + Math.random() * 2.5).toFixed(1));
    this.edgeTelemetry.wanStatus = storage.wanConnected ? 'CONNECTED' : 'DISCONNECTED';

    for (const camera of this.cameras) {
      camera.simTime += 0.5; // step time

      // 1. Raw Detections (Use live ingested detections for mobile camera, synthetic for others)
      let dets, meta;
      if (camera.isMobile || camera.id === 'CAM-MOBILE-01') {
        const lastRx = camera.lastReceivedAt || 0;
        const timeSinceLastMobile = lastRx === 0 ? 0 : (Date.now() - lastRx);
        const prevStatus = camera.status;

        // State Machine:
        // WAITING — no MOBILE_CAMERA_CONNECT received yet this server run
        // ONLINE  — connected AND a MOBILE_DETECTION or MOBILE_HEARTBEAT received within the last ~3s
        // STALE   — connected, but nothing received in >3s
        // OFFLINE — the WebSocket for this client actually closed, or nothing received for >15s
        if (!camera.hasReceivedConnect && !camera.hasReceivedMobileMessage) {
          camera.status = 'WAITING';
          dets = [];
        } else if (camera.clientConnected === false || timeSinceLastMobile > 15000) {
          camera.status = 'OFFLINE';
          dets = [];
        } else if (timeSinceLastMobile > 3000) {
          camera.status = 'STALE';
          dets = [];
        } else {
          camera.status = 'ONLINE';
          dets = camera.latestMobileDetections || [];
          camera.lastKnownPersonCount = dets.length;
        }

        if (camera.status !== prevStatus && this.onStatusChange) {
          this.onStatusChange(camera);
        }

        meta = {
          sensor: 'SMARTPHONE_COCO_SSD',
          link: 'EDGE_WEBSOCKET_METADATA',
          bandwidthRate: '120_KBPS_METADATA_ONLY',
          detectionsCount: dets.length,
          lastKnownPersonCount: camera.lastKnownPersonCount || 0,
          lastSeenMs: timeSinceLastMobile,
          lastReceivedAt: lastRx,
          stale: camera.status === 'STALE',
          offline: camera.status === 'OFFLINE',
          hasConnectedClient: !!camera.clientConnected,
          hasReceivedMobileMessage: !!camera.hasReceivedConnect || !!camera.hasReceivedMobileMessage,
          mobileTelemetry: camera.mobileTelemetry || null
        };
      } else {
        const gen = this._generateDetections(camera);
        dets = gen.dets;
        meta = gen.meta;
      }

      // 2. Multi-Object Tracking (Lightweight IoU Tracker, ByteTrack-inspired)
      const trackedObjects = camera.tracker.update(dets, camera.fps);

      // Attach client movement & pose telemetry to server-side tracked objects for dashboard display
      if (camera.isMobile || camera.id === 'CAM-MOBILE-01') {
        const clientDets = (camera.mobileTelemetry && camera.mobileTelemetry.detections) || [];
        trackedObjects.forEach(tObj => {
          let bestMatch = null;
          let bestDist = 0.25;
          const tCentroid = { x: tObj.bbox.x + tObj.bbox.w / 2, y: tObj.bbox.y + tObj.bbox.h / 2 };

          for (const cDet of clientDets) {
            if (!cDet.bbox) continue;
            const cCentroid = { x: cDet.bbox.x + cDet.bbox.w / 2, y: cDet.bbox.y + cDet.bbox.h / 2 };
            const dist = Math.hypot(tCentroid.x - cCentroid.x, tCentroid.y - cCentroid.y);
            if (dist < bestDist) {
              bestDist = dist;
              bestMatch = cDet;
            }
          }

          if (bestMatch) {
            tObj.movement = bestMatch.movement || null;
            tObj.bodyMeasurements = bestMatch.bodyMeasurements || null;
            tObj.bodyMotion = bestMatch.bodyMotion || null;
            tObj.pose = bestMatch.pose || null;
            tObj.clientLocalId = bestMatch.localId || null;
          }
        });
      }

      // 3. Rule Engine Evaluation
      const zones = storage.getZones(camera.id);
      const triggers = ruleEngine.evaluate(trackedObjects, zones, config, {
        mode: camera.mode,
        id: camera.id
      });

      // 4. Anti-Flooding Alert Engine (aggregates into live continuous events)
      const events = this.alertEngine.processTriggers(triggers, camera, meta);
      if (events.length > 0) {
        frameEvents.push(...events);
      }

      // Update camera live state
      camera.activeDetections = trackedObjects;
      camera.currentMeta = meta;
    }

    return {
      cameras: this.cameras.map(c => ({
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
        ...this.edgeTelemetry,
        offlineQueueCount: storage.offlineQueue.length,
        totalEventsStored: storage.events.length
      },
      events: frameEvents
    };
  }

  getCameras() {
    return this.cameras.map(c => ({
      id: c.id,
      name: c.name,
      bop: c.bop,
      location: c.location,
      snapshotUri: c.snapshotUri,
      resolution: c.resolution,
      mode: c.mode,
      fovType: c.fovType,
      capabilities: c.capabilities,
      fps: c.fps,
      latencyMs: c.latencyMs,
      status: c.status,
      isMobile: !!c.isMobile
    }));
  }

  getCamera(id) {
    return this.cameras.find(c => c.id === id);
  }
}

module.exports = new CameraManager();
