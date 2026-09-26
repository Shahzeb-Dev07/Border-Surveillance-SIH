// Interactive Zone & Virtual Fence Drawing Tool
class ZoneDrawingTool {
  constructor(canvasRenderer, onSaveZone) {
    this.renderer = canvasRenderer;
    this.canvas = canvasRenderer.canvas;
    this.onSaveZone = onSaveZone;
    this.isDrawing = false;
    this.drawMode = 'polygon'; // 'polygon' or 'tripwire'
    this.points = [];

    this._bindEvents();
  }

  _bindEvents() {
    if (!this.canvas) return;

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isDrawing) return;
      const rect = this.canvas.getBoundingClientRect();
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      this.renderer.drawingState.currentMouse = { x: normX, y: normY };
    });

    this.canvas.addEventListener('click', (e) => {
      if (!this.isDrawing) return;
      const rect = this.canvas.getBoundingClientRect();
      const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      this.points.push({ x: Number(normX.toFixed(3)), y: Number(normY.toFixed(3)) });
      this.renderer.drawingState.points = this.points;

      // If tripwire mode, 2 points completes the line
      if (this.drawMode === 'tripwire' && this.points.length >= 2) {
        this.finishDrawing();
      }
    });

    this.canvas.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (!this.isDrawing) return;
      if (this.points.length >= 3) {
        this.finishDrawing();
      }
    });
  }

  startDrawing(mode = 'polygon') {
    this.isDrawing = true;
    this.drawMode = mode;
    this.points = [];
    this.canvas.style.cursor = 'crosshair';

    this.renderer.drawingState = {
      isDrawing: true,
      mode: mode,
      points: this.points,
      currentMouse: null
    };
  }

  cancelDrawing() {
    this.isDrawing = false;
    this.points = [];
    this.canvas.style.cursor = 'default';
    this.renderer.drawingState = {
      isDrawing: false,
      mode: 'polygon',
      points: [],
      currentMouse: null
    };
  }

  finishDrawing() {
    this.isDrawing = false;
    this.canvas.style.cursor = 'default';
    this.renderer.drawingState.isDrawing = false;

    if (this.points.length < 2) {
      this.cancelDrawing();
      return;
    }

    const defaultName = this.drawMode === 'polygon' ? `Sector Fence Zone ${Date.now() % 1000}` : `Tripwire Entry ${Date.now() % 1000}`;
    const zoneName = prompt(`Enter Name for this new ${this.drawMode.toUpperCase()}:`, defaultName);
    if (!zoneName) {
      this.cancelDrawing();
      return;
    }

    const newZone = {
      id: `ZONE-${Date.now()}`,
      name: zoneName,
      type: this.drawMode,
      rule: this.drawMode === 'polygon' ? 'VIRTUAL_FENCE' : 'DIRECTIONAL_CROSSING',
      severity: this.drawMode === 'polygon' ? 'CRITICAL' : 'HIGH',
      color: this.drawMode === 'polygon' ? '#ff3d71' : '#00e5ff',
      points: [...this.points],
      enabled: true
    };

    if (this.onSaveZone) {
      this.onSaveZone(newZone);
    }

    this.cancelDrawing();
  }
}

window.ZoneDrawingTool = ZoneDrawingTool;
