# Contributing to IBVAP

Thank you for your interest in contributing to the **Intelligent Border Video Analytics Platform (IBVAP)**! We welcome contributions that improve edge inference efficiency, rule engine determinism, C2 interface ergonomics, and forensic security standards.

---

## Code of Conduct

All contributors and maintainers are expected to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Architectural Principles to Uphold

Before submitting a Pull Request, verify that your proposed change adheres to the core engineering decisions documented in `IBVAP_RedTeam_Review.md`:

1. **Edge-First Autonomy**: Never make an edge function depend synchronously on a cloud or central server response. All primary detection, tracking, virtual fencing, and local siren triggers must execute locally.
2. **Decoupled Rule Evaluation**: Do not bake operational thresholds (curfew hours, loiter dwell time, stationary duration) into machine learning models. Operational rules belong in the configuration dataset (`data/rules_config.json`) so duty commanders can alter them without model retraining.
3. **Realistic Optics & Conditional Capabilities**: Wide-angle perimeter CCTV feeds cannot perform reliable facial recognition or license plate OCR. Keep ANPR and biometric matching conditional on calibrated choke-point geometry (e.g., barrier inspection lanes).
4. **Anti-Flooding Vigilance**: Do not generate duplicate alerts on consecutive video frames for the same ongoing track. Update event duration counters in place.
5. **Strict Audit Schema**: Any user action that changes system state or dispatches tactical resources must append to the audit log matching the 6-field schema:
   `user_id | timestamp | action | camera_id | incident_id | result`.

---

## Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/your-username/ibvap.git
   cd ibvap
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the edge server daemon:
   ```bash
   npm start
   ```

4. Open `http://localhost:3000` in your browser to verify the Tactical C2 interface and live WebSocket streams.

---

## Submitting Pull Requests

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Commit your changes following conventional commit syntax:
   - `feat:` for new capabilities
   - `fix:` for bug fixes
   - `docs:` for documentation updates
   - `refactor:` for code restructuring without behavioral change
3. Push to your branch and open a Pull Request against `main`.
4. Ensure PR descriptions include:
   - Summary of changes
   - Corresponding section from `IBVAP_RedTeam_Review.md` addressed
   - Steps to reproduce/verify locally
