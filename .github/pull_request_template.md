## Summary of Changes
Please provide a clear and concise description of what this PR introduces or fixes.

## Addressed Red-Team Architecture Considerations
Check all that apply from `IBVAP_RedTeam_Review.md`:
- [ ] Preserves edge autonomy (no synchronous dependency on cloud/WAN)
- [ ] Maintains decoupled operational SOP rules (no model retraining required)
- [ ] Honors realistic camera optics (ANPR/Face kept conditional at choke points)
- [ ] Validates anti-flooding duration counter behavior
- [ ] Appends to tamper-evident audit log matching strict 6-field schema
- [ ] Passes automated test suite (`npm test`)

## Verification Steps
1. Run `npm test`
2. Start server `npm start`
3. Tested scenarios / endpoints:
   - ...

## Screenshots / Evidence (if frontend/C2 UI change)
Include screenshots or recordings if applicable.
