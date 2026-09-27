// High-performance Canvas Renderer for Live Surveillance Feed & AI Overlays
class CanvasRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.cameraImages = new Map(); // id -> Image
    this.currentCamera = null;
    this.zones = [];
    this.activeDetections = [];
    this.meta = {};
    this.isNightIrMode = false;
    this.drawingState = {
      isDrawing: false,
      mode: 'polygon', // 'polygon' or 'tripwire'
      points: [],
      currentMouse: null
    };

    this._preloadImages();
    this._startLoop();
  }

  _preloadImages() {
    const feeds = [
      { id: 'CAM-01', url: '/assets/cam_bop_01_perimeter.jpg' },
      { id: 'CAM-02', url: '/assets/cam_bop_01_chokepoint.jpg' },
      { id: 'CAM-03', url: '/assets/cam_bop_02_night_ir.jpg' },
      { id: 'CAM-04', url: '/assets/cam_bop_03_road_patrol.jpg' }
    ];

    feeds.forEach(f => {
      const img = new Image();
      img.src = f.url;
      this.cameraImages.set(f.id, img);
    });
  }

  updateFeed(camera, zones, detections, meta) {
    this.currentCamera = camera;
    this.zones = zones || [];
    this.activeDetections = detections || [];
    this.meta = meta || {};
    this.isNightIrMode = camera.mode === 'NIGHT_IR_ILLUMINATED';
  }

  _startLoop() {
    const loop = () => {
      this.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  render() {
    if (!this.ctx || !this.canvas || !this.currentCamera) return;
    const ctx = this.ctx;
    const w = this.canvas.width = this.canvas.clientWidth;
    const h = this.canvas.height = this.canvas.clientHeight;

    // Clear
    ctx.fillStyle = '#020406';
    ctx.fillRect(0, 0, w, h);

    // 1. Draw Base Surveillance Image
    const img = this.cameraImages.get(this.currentCamera.id);
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, 0, 0, w, h);
    } else if (this.currentCamera.id === 'CAM-MOBILE-01') {
      if (this.currentCamera.frameImage) {
        if (!this.mobileFrameImg) {
          this.mobileFrameImg = new Image();
        }
        if (this.mobileFrameImg.src !== this.currentCamera.frameImage) {
          this.mobileFrameImg.src = this.currentCamera.frameImage;
        }
        if (this.mobileFrameImg.complete && this.mobileFrameImg.naturalWidth > 0) {
          ctx.drawImage(this.mobileFrameImg, 0, 0, w, h);
          // Draw subtle tactical reticle & scanline for military C2 focal aesthetic
          ctx.save();
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.25)';
          ctx.lineWidth = 1;
          const cx = w / 2;
          const cy = h / 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 45, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(cx - 55, cy); ctx.lineTo(cx - 15, cy);
          ctx.moveTo(cx + 15, cy); ctx.lineTo(cx + 55, cy);
          ctx.moveTo(cx, cy - 55); ctx.lineTo(cx, cy - 15);
          ctx.moveTo(cx, cy + 15); ctx.lineTo(cx, cy + 55);
          ctx.stroke();
          ctx.restore();
        } else {
          this._renderMobileFeedBackdrop(ctx, w, h);
        }
      } else {
        this._renderMobileFeedBackdrop(ctx, w, h);
      }
    } else {
      // Standby noise/placeholder
      ctx.fillStyle = '#0b1118';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#455a64';
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillText('CONNECTING TO CAMERA FEED...', w / 2 - 110, h / 2);
    }

    // Apply Night / IR Contrast Enhancer Filter if active
    if (this.isNightIrMode) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 40, 20, 0.12)';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // 2. Draw Configured Virtual Zones & Fences
    this._renderZones(ctx, w, h);

    // 3. Draw In-Progress Operator Drawing Preview
    this._renderDrawingPreview(ctx, w, h);

    // 4. Draw Active Detections, Trajectories, and HUDs
    this._renderDetections(ctx, w, h);

    // 5. Draw Choke Point ANPR & Face Overlays
    this._renderChokePointAnpr(ctx, w, h);

    // 6. Draw CCTV Digital Watermark & Timestamp
    this._renderCctvWatermark(ctx, w, h);
  }

  _renderZones(ctx, w, h) {
    for (const zone of this.zones) {
      if (!zone.enabled || !zone.points || zone.points.length < 2) continue;

      ctx.save();
      const isRed = (zone.color || '').startsWith('#ff') || zone.type === 'polygon';
      const strokeColor = isRed ? 'rgba(231, 76, 94, 0.7)' : 'rgba(91, 138, 245, 0.7)';
      const fillColor = isRed ? 'rgba(231, 76, 94, 0.06)' : 'rgba(91, 138, 245, 0.05)';

      if (zone.type === 'polygon' && zone.points.length >= 3) {
        // Draw subtle translucent perimeter
        ctx.beginPath();
        ctx.moveTo(zone.points[0].x * w, zone.points[0].y * h);
        for (let i = 1; i < zone.points.length; i++) {
          ctx.lineTo(zone.points[i].x * w, zone.points[i].y * h);
        }
        ctx.closePath();

        ctx.fillStyle = fillColor;
        ctx.fill();

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Clean small zone label
        const firstPt = zone.points[0];
        ctx.font = '500 10px "Inter", sans-serif';
        ctx.fillStyle = strokeColor;
        const cleanName = zone.name.replace(/_/g, ' ');
        ctx.fillText(cleanName, firstPt.x * w + 6, firstPt.y * h - 6);
      } else if (zone.type === 'tripwire' && zone.points.length >= 2) {
        // Directional Tripwire Line
        const p1 = { x: zone.points[0].x * w, y: zone.points[0].y * h };
        const p2 = { x: zone.points[1].x * w, y: zone.points[1].y * h };

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.y, p2.y);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.font = '500 10px "Inter", sans-serif';
        ctx.fillStyle = strokeColor;
        ctx.fillText(zone.name, midX - 20, midY - 6);
      }
      ctx.restore();
    }
  }

  _renderDrawingPreview(ctx, w, h) {
    if (!this.drawingState.isDrawing) return;
    const pts = this.drawingState.points;
    const mouse = this.drawingState.currentMouse;

    ctx.save();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);

    if (pts.length > 0) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x * w, pts[i].y * h);
      }
      if (mouse) {
        ctx.lineTo(mouse.x * w, mouse.y * h);
      }
      ctx.stroke();
    }

    // Points vertices
    for (const pt of pts) {
      ctx.fillStyle = '#00e5ff';
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * h, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('CLICK TO ADD VERTEX | DOUBLE-CLICK TO FINISH', 20, h - 25);
    ctx.restore();
  }

  _renderDetections(ctx, w, h) {
    for (const obj of this.activeDetections) {
      const bx = obj.bbox.x * w;
      const by = obj.bbox.y * h;
      const bw = obj.bbox.w * w;
      const bh = obj.bbox.h * h;

      const cl = (obj.classLabel || 'object').toLowerCase();
      const isSuspect = (cl === 'person' && obj.dwellSec > 4);
      const isVehicle = ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'vehicle'].includes(cl);
      const isDevice = ['cell phone', 'phone', 'laptop', 'mouse', 'keyboard', 'tv', 'remote'].includes(cl);
      const isThreat = ['knife', 'scissors', 'weapon', 'gun'].includes(cl);

      let boxColor = '#34c759'; // Clean emerald green for authorized/standard
      if (isThreat || isSuspect) boxColor = '#e74c5e'; // Clean red for breach/alert
      else if (isVehicle) boxColor = '#f5a623'; // Amber for vehicle
      else if (cl === 'person') boxColor = isSuspect ? '#e74c5e' : '#34c759';

      // 1. Crisp Professional Bounding Box
      ctx.save();
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, bw, bh);

      // Subtle 4% box fill for clear target identification
      ctx.fillStyle = isSuspect ? 'rgba(231, 76, 94, 0.08)' : (isThreat ? 'rgba(231, 76, 94, 0.08)' : 'rgba(52, 199, 89, 0.04)');
      ctx.fillRect(bx, by, bw, bh);

      // 2. Clean Label Pill at Top
      const confPct = Math.round((obj.confidence || 0.9) * 100);
      let labelName = (obj.classLabel || 'object').replace(/_/g, ' ');
      // Capitalize first letter
      labelName = labelName.charAt(0).toUpperCase() + labelName.slice(1);
      const tagText = isSuspect ? `${labelName} · Alert` : `${labelName} ${confPct}%`;

      ctx.font = '500 11px "Inter", -apple-system, sans-serif';
      const textWidth = ctx.measureText(tagText).width;
      const pillW = textWidth + 10;
      const pillH = 18;
      const pillY = by >= pillH ? by - pillH : by;

      ctx.fillStyle = isSuspect ? '#e74c5e' : '#1c1f27';
      ctx.fillRect(bx, pillY, pillW, pillH);

      if (!isSuspect) {
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, pillY, pillW, pillH);
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillText(tagText, bx + 5, pillY + 13);
      ctx.restore();

      // 6. MoveNet Pose Skeleton Overlay (if pose keypoints attached)
      if (obj.pose && Array.isArray(obj.pose.keypoints)) {
        const kpMap = {};
        for (const kp of obj.pose.keypoints) {
          if (kp.confidence >= 0.3) {
            kpMap[kp.name] = { x: kp.x * w, y: kp.y * h };
          }
        }
        const pairs = [
          ['left_shoulder', 'right_shoulder'],
          ['left_shoulder', 'left_elbow'],
          ['left_elbow', 'left_wrist'],
          ['right_shoulder', 'right_elbow'],
          ['right_elbow', 'right_wrist'],
          ['left_shoulder', 'left_hip'],
          ['right_shoulder', 'right_hip'],
          ['left_hip', 'right_hip'],
          ['left_hip', 'left_knee'],
          ['left_knee', 'left_ankle'],
          ['right_hip', 'right_knee'],
          ['right_knee', 'right_ankle']
        ];
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 230, 118, 0.7)';
        ctx.lineWidth = 1.5;
        for (const [p1, p2] of pairs) {
          if (kpMap[p1] && kpMap[p2]) {
            ctx.beginPath();
            ctx.moveTo(kpMap[p1].x, kpMap[p1].y);
            ctx.lineTo(kpMap[p2].x, kpMap[p2].y);
            ctx.stroke();
          }
        }
        ctx.fillStyle = '#00e5ff';
        for (const k in kpMap) {
          ctx.beginPath();
          ctx.arc(kpMap[k].x, kpMap[k].y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }
  }

  _renderChokePointAnpr(ctx, w, h) {
    if (this.meta && this.meta.anpr) {
      const anpr = this.meta.anpr;
      const crop = anpr.plateCrop;
      if (crop) {
        ctx.save();
        const px = crop.x * w;
        const py = crop.y * h;
        const pw = crop.w * w;
        const ph = crop.h * h;

        ctx.strokeStyle = '#f5a623';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, pw, ph);

        const tag = `Plate: ${anpr.plateNumber}`;
        ctx.font = '500 11px "Inter", -apple-system, sans-serif';
        const tw = ctx.measureText(tag).width;

        ctx.fillStyle = '#1c1f27';
        ctx.fillRect(px, py - 18, tw + 8, 18);
        ctx.strokeStyle = '#f5a623';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py - 18, tw + 8, 18);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(tag, px + 4, py - 5);

        ctx.restore();
      }
    }
  }

  _renderMobileFeedBackdrop(ctx, w, h) {
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const status = this.currentCamera.status;

    ctx.save();
    ctx.textAlign = 'center';
    
    // Draw camera icon circle
    ctx.beginPath();
    ctx.arc(cx, cy - 30, 28, 0, Math.PI * 2);
    ctx.fillStyle = '#1c1f27';
    ctx.fill();
    ctx.strokeStyle = '#2a2e38';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '600 14px "Inter", -apple-system, sans-serif';
    if (status === 'ONLINE') {
      ctx.fillStyle = '#34c759';
      ctx.fillText('Mobile Camera Connected', cx, cy + 20);
      ctx.font = '400 12px "Inter", sans-serif';
      ctx.fillStyle = '#9aa0ae';
      ctx.fillText('Streaming detections from connected device', cx, cy + 40);
    } else if (status === 'STALE') {
      ctx.fillStyle = '#f5a623';
      ctx.fillText('Mobile Stream Paused', cx, cy + 20);
      ctx.font = '400 12px "Inter", sans-serif';
      ctx.fillStyle = '#9aa0ae';
      ctx.fillText('Reopen phone browser to resume stream', cx, cy + 40);
    } else {
      ctx.fillStyle = '#9aa0ae';
      ctx.fillText('Mobile Camera Standby', cx, cy + 20);
      ctx.font = '400 12px "Inter", sans-serif';
      ctx.fillStyle = '#636a78';
      ctx.fillText('Click "Mobile Camera" in the top bar to connect a smartphone', cx, cy + 40);
    }
    ctx.restore();
  }

  _renderCctvWatermark(ctx, w, h) {
    const cam = this.currentCamera;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB') + ' IST';

    ctx.save();
    ctx.font = '500 11px "Inter", -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 3;

    // Clean subtle bottom-left camera title & time
    ctx.fillText(`${cam.id} · ${cam.name} · ${timeStr}`, 14, h - 14);
    ctx.restore();
  }
}

window.CanvasRenderer = CanvasRenderer;
