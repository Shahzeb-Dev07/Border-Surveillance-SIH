// ByteTrack-inspired lightweight multi-object tracker
// Implements geometric IoU association, ground-contact point calculation,
// temporal proximity estimation (NEAR/MEDIUM/FAR), trajectory tracking,
// and dwell timing in pure JavaScript.

class MultiObjectTracker {
  constructor() {
    this.tracks = new Map(); // trackId -> TrackObject
    this.nextTrackId = 100;
    this.maxLostFrames = 15;
  }

  // Calculate Intersection over Union
  _computeIoU(boxA, boxB) {
    const xA = Math.max(boxA.x, boxB.x);
    const yA = Math.max(boxA.y, boxB.y);
    const xB = Math.min(boxA.x + boxA.w, boxB.x + boxB.w);
    const yB = Math.min(boxA.y + boxA.h, boxB.y + boxB.h);

    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = boxA.w * boxA.h;
    const boxBArea = boxB.w * boxB.h;

    const unionArea = boxAArea + boxBArea - interArea;
    if (unionArea <= 0) return 0;
    return interArea / unionArea;
  }

  // Estimate distance / proximity with temporal smoothing & clear metric vs relative labeling
  _estimateProximity(bbox, prevSmoothedH, classLabel, detMetrics = null) {
    // 1. Calibrated Metric Proximity (if client or camera geometry provides true metric distance)
    if (detMetrics && detMetrics.isCalibrated && typeof detMetrics.estimatedDistanceM === 'number' && detMetrics.estimatedDistanceM > 0) {
      const d = Number(detMetrics.estimatedDistanceM.toFixed(2));
      let level = 'FAR';
      if (d <= 3.5) level = 'NEAR';
      else if (d <= 12.0) level = 'MEDIUM';

      return {
        level,
        isMetric: true,
        distanceM: d,
        displayDistance: `${d}m (${level})`,
        method: 'CALIBRATED_GEOMETRY',
        smoothedHeight: bbox.h
      };
    }

    // 2. Relative Proximity for Single-RGB uncalibrated cameras
    // Apply exponential moving average (EMA) smoothing to bounding box height to prevent flickering
    const alpha = 0.25;
    const smoothedH = prevSmoothedH ? Number((alpha * bbox.h + (1 - alpha) * prevSmoothedH).toFixed(4)) : bbox.h;

    // Relative Proximity Thresholds (normalized vertical image proportion)
    // NEAR: >= 35% of frame height (or foreground ground contact y >= 0.82 with h >= 0.22)
    // MEDIUM: 14% to 35% of frame height
    // FAR: < 14% of frame height (distant targets on ridge / perimeter)
    let level = 'FAR';
    if (smoothedH >= 0.35 || (bbox.y + bbox.h >= 0.82 && smoothedH >= 0.22)) {
      level = 'NEAR';
    } else if (smoothedH >= 0.14) {
      level = 'MEDIUM';
    } else {
      level = 'FAR';
    }

    return {
      level,
      isMetric: false,
      distanceM: null,
      displayDistance: `${level} (Relative)`,
      method: 'RELATIVE_IMAGE_PROPORTION',
      smoothedHeight: smoothedH,
      relativeHeightNorm: Number(smoothedH.toFixed(3))
    };
  }

  update(detections, cameraFps = 15) {
    const now = Date.now();
    const matchedTrackIds = new Set();
    const unmatchedDetections = [];

    // Match existing active tracks to incoming detections
    for (const det of detections) {
      let bestIoU = 0.25; // minimum IoU threshold for matching
      let bestTrackId = null;

      for (const [trackId, track] of this.tracks.entries()) {
        if (matchedTrackIds.has(trackId)) continue;
        if (track.classLabel !== det.classLabel) continue;

        const iou = this._computeIoU(track.bbox, det.bbox);
        if (iou > bestIoU) {
          bestIoU = iou;
          bestTrackId = trackId;
        }
      }

      if (bestTrackId !== null) {
        matchedTrackIds.add(bestTrackId);
        const track = this.tracks.get(bestTrackId);

        // Compute centroid and ground contact point
        const cx = det.bbox.x + det.bbox.w / 2;
        const cy = det.bbox.y + det.bbox.h / 2;
        const gx = cx;
        const gy = det.bbox.y + det.bbox.h; // Bottom-center ground contact approximation

        const prevCx = track.bbox.x + track.bbox.w / 2;
        const prevCy = track.bbox.y + track.bbox.h / 2;

        // Velocity vector and smoothed speed
        const dt = (now - track.lastSeen) / 1000 || 0.066;
        const vx = (cx - prevCx) / dt;
        const vy = (cy - prevCy) / dt;
        const speed = Math.sqrt(vx * vx + vy * vy) * 100; // estimated relative speed

        // Proximity calculation with temporal smoothing
        const detMetrics = det.metrics || (det.bodyMeasurements ? det.bodyMeasurements.metrics : null);
        const proximity = this._estimateProximity(det.bbox, track.proximity ? track.proximity.smoothedHeight : null, det.classLabel, detMetrics);

        track.bbox = det.bbox;
        track.groundPoint = { x: gx, y: gy };
        track.centroid = { x: cx, y: cy };
        track.proximity = proximity;
        track.confidence = det.confidence;
        track.lastSeen = now;
        track.lostFrames = 0;
        track.hits += 1;
        track.speed = speed;
        track.velocity = { vx, vy };

        // Append to trajectory trail (limit to last 25 points)
        track.trajectory.push({ x: cx, y: cy, t: now });
        if (track.trajectory.length > 25) {
          track.trajectory.shift();
        }

        // Update dwell time (seconds track has been continuously active)
        track.dwellSec = (now - track.firstSeen) / 1000;

        det.trackId = bestTrackId;
        det.trajectory = track.trajectory;
        det.centroid = track.centroid;
        det.groundPoint = track.groundPoint;
        det.proximity = proximity;
        det.dwellSec = track.dwellSec;
        det.speed = track.speed;
        det.hits = track.hits;
      } else {
        unmatchedDetections.push(det);
      }
    }

    // Create new tracks for unmatched high-confidence detections
    for (const det of unmatchedDetections) {
      const trackId = `TRK-${this.nextTrackId++}`;
      const cx = det.bbox.x + det.bbox.w / 2;
      const cy = det.bbox.y + det.bbox.h / 2;
      const gx = cx;
      const gy = det.bbox.y + det.bbox.h; // Bottom-center ground contact approximation

      const detMetrics = det.metrics || (det.bodyMeasurements ? det.bodyMeasurements.metrics : null);
      const proximity = this._estimateProximity(det.bbox, null, det.classLabel, detMetrics);

      const newTrack = {
        trackId,
        classLabel: det.classLabel,
        bbox: det.bbox,
        centroid: { x: cx, y: cy },
        groundPoint: { x: gx, y: gy },
        proximity,
        confidence: det.confidence,
        firstSeen: now,
        lastSeen: now,
        lostFrames: 0,
        hits: 1,
        speed: 0,
        velocity: { vx: 0, vy: 0 },
        trajectory: [{ x: cx, y: cy, t: now }],
        dwellSec: 0,
        zoneConfirmCount: new Map()
      };

      this.tracks.set(trackId, newTrack);
      matchedTrackIds.add(trackId);
      det.trackId = trackId;
      det.trajectory = newTrack.trajectory;
      det.centroid = newTrack.centroid;
      det.groundPoint = newTrack.groundPoint;
      det.proximity = proximity;
      det.dwellSec = 0;
      det.speed = 0;
      det.hits = newTrack.hits;
    }

    // Age and prune lost tracks
    for (const [trackId, track] of this.tracks.entries()) {
      if (!matchedTrackIds.has(trackId)) {
        track.lostFrames += 1;
        if (track.lostFrames > this.maxLostFrames) {
          this.tracks.delete(trackId);
        }
      }
    }

    return detections;
  }

  getActiveTracks() {
    return Array.from(this.tracks.values()).filter(t => t.lostFrames <= 2);
  }

  getTracks() {
    return Array.from(this.tracks.values());
  }

  reset() {
    this.tracks.clear();
    this.nextTrackId = 100;
  }
}

module.exports = MultiObjectTracker;
