# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.6.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Chain-of-Custody & Tamper-Evidence

IBVAP implements cryptographic SHA-256 digital fingerprinting across:
- All generated video event snapshots and evidentiary crops.
- The append-only chain-of-custody audit log (`data/audit_log.json`).
- Offline event sync transactions.

Any modification of evidence logs outside the authenticated C2 interface will result in a checksum mismatch flag during audit verification.

## Prototype Disclaimer

The Role-Based Access Control (RBAC) tiers and retention thresholds present in this repository are designed as a **prototype engineering baseline** for testing tactical workflows. They are not official regulations of the Ministry of Home Affairs (MHA), Border Security Force (BSF), or Sashastra Seema Bal (SSB).

## Reporting a Vulnerability

If you discover a security vulnerability or bypass in the edge authentication or audit log integrity system:

1. **Do not open a public issue.**
2. Send a detailed report to the security team or open a private security advisory on GitHub.
3. Include reproduction steps, sample payload, and potential operational impact.
4. We aim to acknowledge reports within 48 hours and provide a remediation plan within 7 days.
