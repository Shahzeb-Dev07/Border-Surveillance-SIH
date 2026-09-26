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
    } else {
      // Standby noise/placeholder
      ctx.fillStyle = '#0b1118';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#455a64';
      ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillText('CONNECTING TO RTSP STREAM...', w / 2 - 110, h / 2);
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
      const color = zone.color || '#ff3d71';

      if (zone.type === 'polygon' && zone.points.length >= 3) {
        // Draw filled translucent danger polygon
        ctx.beginPath();
        ctx.moveTo(zone.points[0].x * w, zone.points[0].y * h);
        for (let i = 1; i < zone.points.length; i++) {
          ctx.lineTo(zone.points[i].x * w, zone.points[i].y * h);
        }
        ctx.closePath();

        ctx.fillStyle = color.startsWith('#ff') ? 'rgba(255, 61, 113, 0.15)' : 'rgba(0, 229, 255, 0.12)';
        ctx.fill();

        // Glowing dashed perimeter
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Zone Tag Label
        const firstPt = zone.points[0];
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.fillStyle = color;
        ctx.fillText(`[ ${zone.name.toUpperCase()} ]`, firstPt.x * w + 6, firstPt.y * h - 6);
      } else if (zone.type === 'tripwire' && zone.points.length >= 2) {
        // Directional Tripwire Line
        const p1 = { x: zone.points[0].x * w, y: zone.points[0].y * h };
        const p2 = { x: zone.points[1].x * w, y: zone.points[1].y * h };

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.y, p2.y);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Tripwire arrow indicator
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.fillStyle = color;
        ctx.fillText(`TRIPWIRE: ${zone.name}`, midX - 30, midY - 8);
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

      const isSuspect = (obj.classLabel === 'person' && obj.dwellSec > 4);
      const isVehicle = obj.classLabel.includes('vehicle');
      const boxColor = isSuspect ? '#ff3d71' : (isVehicle ? '#ffb300' : '#00e5ff');

      // 1. Draw Trajectory Trail
      if (obj.trajectory && obj.trajectory.length > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(obj.trajectory[0].x * w, obj.trajectory[0].y * h);
        for (let i = 1; i < obj.trajectory.length; i++) {
          ctx.lineTo(obj.trajectory[i].x * w, obj.trajectory[i].y * h);
        }
        ctx.strokeStyle = isSuspect ? 'rgba(255, 61, 113, 0.4)' : 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.restore();
      }

      // 2. Draw Tactical Corner Brackets (High-tech C2 style)
      ctx.save();
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 2;
      const corner = Math.min(10, bw / 4, bh / 4);

      // Top-Left
      ctx.beginPath();
      ctx.moveTo(bx, by + corner);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + corner, by);
      ctx.stroke();

      // Top-Right
      ctx.beginPath();
      ctx.moveTo(bx + bw - corner, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw, by + corner);
      ctx.stroke();

      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(bx, by + bh - corner);
      ctx.lineTo(bx, by + bh);
      ctx.lineTo(bx + corner, by + bh);
      ctx.stroke();

      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(bx + bw - corner, by + bh);
      ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx + bw, by + bh - corner);
      ctx.stroke();

      // Translucent box fill
      ctx.fillStyle = isSuspect ? 'rgba(255, 61, 113, 0.12)' : 'rgba(0, 229, 255, 0.06)';
      ctx.fillRect(bx, by, bw, bh);

      // 3. Label Pill Top
      const confPct = Math.round((obj.confidence || 0.9) * 100);
      const labelText = `${obj.classLabel.toUpperCase()} [${obj.trackId || 'TRK'}] ${confPct}%`;
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(labelText).width;

      ctx.fillStyle = boxColor;
      ctx.fillRect(bx, by - 18, textWidth + 8, 16);

      ctx.fillStyle = '#000';
      ctx.fillText(labelText, bx + 4, by - 6);

      // 4. Dwell Time / Speed HUD (Over target)
      if (obj.dwellSec > 1) {
        const dwellText = `DWELL: ${obj.dwellSec.toFixed(1)}s`;
        ctx.font = '9px "JetBrains Mono", monospace';
        const dWidth = ctx.measureText(dwellText).width;

        ctx.fillStyle = isSuspect ? 'rgba(255, 61, 113, 0.85)' : 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(bx, by + bh + 4, dWidth + 6, 14);

        ctx.fillStyle = '#fff';
        ctx.fillText(dwellText, bx + 3, by + bh + 14);
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

        // Plate bounding frame
        ctx.strokeStyle = '#ffb300';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, pw, ph);

        // OCR Result Badge
        const tag = `ANPR: ${anpr.plateNumber} (${Math.round(anpr.confidence * 100)}%)`;
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        const tw = ctx.measureText(tag).width;

        ctx.fillStyle = '#ffb300';
        ctx.fillRect(px, py - 18, tw + 8, 16);
        ctx.fillStyle = '#000';
        ctx.fillText(tag, px + 4, py - 6);

        ctx.restore();
      }
    }

    if (this.meta && this.meta.face) {
      const face = this.meta.face;
      const fc = face.faceCrop;
      if (fc) {
        ctx.save();
        const fx = fc.x * w;
        const fy = fc.y * h;
        const fw = fc.w * w;
        const fh = fc.h * h;

        ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(fx, fy, fw, fh);

        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.9)';
        ctx.fillText('FACE DETECT: CONDITIONAL', fx - 10, fy - 4);
        ctx.restore();
      }
    }
  }

  _renderCctvWatermark(ctx, w, h) {
    const cam = this.currentCamera;
    const now = new Date();
    const timeStr = now.toISOString().replace('T', ' ').substring(0, 19) + ' IST';

    ctx.save();
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 4;

    // Top left watermark
    ctx.fillText(`[ ${cam.id} // ${cam.name.toUpperCase()} ]`, 16, 26);
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(0, 229, 255, 0.8)';
    ctx.fillText(`${cam.location} | ${cam.resolution} | FPS: ${cam.fps.toFixed(1)}`, 16, 42);

    // Top right timecode
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const timeWidth = ctx.measureText(timeStr).width;
    ctx.fillText(timeStr, w - timeWidth - 16, 26);

    ctx.restore();
  }
}

window.CanvasRenderer = CanvasRenderer;
