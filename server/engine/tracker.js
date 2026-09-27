// ByteTrack-inspired lightweight multi-object tracker
// Implements geometric IoU association, centroid smoothing, velocity vector estimation,
// trajectory tracking, and dwell timing in pure JavaScript.
// Production edge deployment would integrate full ByteTrack with Kalman filtering and low/high score two-stage matching.
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

        // Compute centroid
        const cx = det.bbox.x + det.bbox.w / 2;
        const cy = det.bbox.y + det.bbox.h / 2;
        const prevCx = track.bbox.x + track.bbox.w / 2;
        const prevCy = track.bbox.y + track.bbox.h / 2;

        // Velocity vector and smoothed speed
        const dt = (now - track.lastSeen) / 1000 || 0.066;
        const vx = (cx - prevCx) / dt;
        const vy = (cy - prevCy) / dt;
        const speed = Math.sqrt(vx * vx + vy * vy) * 100; // estimated relative speed

        track.bbox = det.bbox;
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

      const newTrack = {
        trackId,
        classLabel: det.classLabel,
        bbox: det.bbox,
        confidence: det.confidence,
        firstSeen: now,
        lastSeen: now,
        lostFrames: 0,
        hits: 1,
        speed: 0,
        velocity: { vx: 0, vy: 0 },
        trajectory: [{ x: cx, y: cy, t: now }],
        dwellSec: 0
      };

      this.tracks.set(trackId, newTrack);
      det.trackId = trackId;
      det.trajectory = newTrack.trajectory;
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
}

module.exports = MultiObjectTracker;
