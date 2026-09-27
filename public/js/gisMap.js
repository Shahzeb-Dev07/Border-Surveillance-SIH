// Tactical GIS / Border Outpost Map
class TacticalGisMap {
  constructor(canvasId, onSelectCamera) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.onSelectCamera = onSelectCamera;
    this.radarAngle = 0;
    this.cameras = [];
    this.activeCameraId = 'CAM-01';
    this.activeAlerts = [];

    // Static geographic nodes in sector
    this.nodes = [
      { id: 'CAM-01', name: 'Tower Alpha', bop: 'BOP 14', x: 0.32, y: 0.65, type: 'tower' },
      { id: 'CAM-02', name: 'Checkpost Gate', bop: 'BOP 14', x: 0.42, y: 0.52, type: 'chokepoint' },
      { id: 'CAM-03', name: 'Sector 4 Ridge', bop: 'BOP 18', x: 0.68, y: 0.38, type: 'ir_tower' },
      { id: 'CAM-04', name: 'Pass Road', bop: 'BOP 22', x: 0.85, y: 0.22, type: 'road' },
      { id: 'CAM-MOBILE-01', name: 'Mobile Patrol', bop: 'QRT Unit', x: 0.52, y: 0.68, type: 'mobile' }
    ];

    if (this.canvas) {
      this._bindEvents();
      this._startRenderLoop();
    }
  }

  _bindEvents() {
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clickX = (e.clientX - rect.left) / rect.width;
      const clickY = (e.clientY - rect.top) / rect.height;

      // Check distance to nodes
      for (const node of this.nodes) {
        const dist = Math.hypot(clickX - node.x, clickY - node.y);
        if (dist < 0.08) {
          if (this.onSelectCamera) {
            this.onSelectCamera(node.id);
          }
          break;
        }
      }
    });
  }

  updateData(cameras, activeCameraId, activeAlerts) {
    this.cameras = cameras;
    this.activeCameraId = activeCameraId;
    this.activeAlerts = activeAlerts || [];
  }

  _startRenderLoop() {
    const render = () => {
      this._draw();
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  _draw() {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width = this.canvas.clientWidth;
    const h = this.canvas.height = this.canvas.clientHeight;
    const ctx = this.ctx;

    // Background & terrain grid
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 24) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Border Zero-Line (Dashed Red Line)
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = 'rgba(255, 61, 113, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.05, h * 0.9);
    ctx.bezierCurveTo(w * 0.35, h * 0.7, w * 0.65, h * 0.4, w * 0.95, h * 0.15);
    ctx.stroke();
    ctx.restore();

    // Border Label
    ctx.fillStyle = 'rgba(255, 61, 113, 0.6)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText('--- INTERNATIONAL ZERO LINE (SSB SECTOR 14) ---', w * 0.2, h * 0.75);

    // Patrol Track Road (Dashed Grey Line)
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.1, h * 0.85);
    ctx.lineTo(w * 0.35, h * 0.62);
    ctx.lineTo(w * 0.45, h * 0.50);
    ctx.lineTo(w * 0.70, h * 0.35);
    ctx.lineTo(w * 0.90, h * 0.18);
    ctx.stroke();
    ctx.restore();

    // Radar Sweep from BOP-14 Main Tower
    const center = { x: w * 0.35, y: h * 0.62 };
    this.radarAngle += 0.025;
    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, 70, this.radarAngle, this.radarAngle + 0.5);
    ctx.lineTo(center.x, center.y);
    const grad = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, 70);
    grad.addColorStop(0, 'rgba(0, 229, 255, 0.25)');
    grad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // Concentric Range Rings
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
    ctx.beginPath();
    ctx.arc(center.x, center.y, 40, 0, Math.PI * 2);
    ctx.arc(center.x, center.y, 75, 0, Math.PI * 2);
    ctx.stroke();

    // Render Camera Nodes
    for (const node of this.nodes) {
      const nx = node.x * w;
      const ny = node.y * h;
      const isSelected = (node.id === this.activeCameraId);

      // Check if this node has active alerts
      const hasCritical = this.activeAlerts.some(a => a.camera_id === node.id && a.severity === 'CRITICAL' && a.system_status === 'ACTIVE');
      const hasHigh = this.activeAlerts.some(a => a.camera_id === node.id && a.severity === 'HIGH' && a.system_status === 'ACTIVE');

      if (hasCritical) {
        // Pulsing threat ring
        const pulse = (Date.now() / 400) % 2;
        ctx.beginPath();
        ctx.arc(nx, ny, 10 + pulse * 12, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 61, 113, ${1 - pulse * 0.4})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (hasHigh) {
        const pulse = (Date.now() / 500) % 2;
        ctx.beginPath();
        ctx.arc(nx, ny, 8 + pulse * 8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 179, 0, ${1 - pulse * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Outer Selection Ring
      if (isSelected) {
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(nx, ny, 12, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Node Icon Point
      ctx.fillStyle = hasCritical ? '#ff3d71' : (hasHigh ? '#ffb300' : (isSelected ? '#00e5ff' : '#00e676'));
      ctx.beginPath();
      ctx.arc(nx, ny, 5, 0, Math.PI * 2);
      ctx.fill();

      // Node Labels
      ctx.font = '10px "Inter", sans-serif';
      ctx.fillStyle = isSelected ? '#fff' : '#a0b0c0';
      ctx.fillText(`${node.id}: ${node.name}`, nx + 10, ny - 2);

      ctx.font = '8px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(0, 229, 255, 0.6)';
      ctx.fillText(node.bop, nx + 10, ny + 9);
    }
  }
}

window.TacticalGisMap = TacticalGisMap;
