# Change Request: CR-DEPLOY-FULL-STACK-JENKINS-001

## Proposed Change
Align the Jenkins-managed Docker deployment with the full E-Connect runtime by deploying `find_website`, publishing the backend scanner port expected by the LAN finder, and setting an explicit public WebUI origin for firmware/scanner metadata in Docker mode.

## Affected FR/NFR Items
- **FR-27:** Device discovery + explicit authorization depends on the LAN finder reaching the real backend health endpoint.
- **FR-30:** Firmware build metadata must advertise a reachable public origin for the server/WebUI when Docker hides host interfaces.
- **NFR-07:** Scanner results must reflect real reachable states instead of a deployment-only mismatch.
- **NFR-08:** Jenkins/CD behavior must stay traceable and reproducible.

## Scope & Design Delta
- Add `find_website` to the deployed Compose stack with a published LAN-facing port.
- Publish backend port `8000` in the live deployment so the finder can probe `http://<ip>:8000/health` as designed.
- Keep the database internal-only to the compose network.
- Set deployment-time `FIRMWARE_PUBLIC_BASE_URL` to the actual WebUI origin because Docker bridge mode cannot infer the host LAN IP reliably.
- Extend Jenkins smoke verification to cover the deployed `find_website` service and the runtime shape needed by the scanner flow.

## Affected Gates
- **G1:** Covered by the direct deployment request because the change stays within existing product scope.
- **G2:** Required because deployment architecture and runtime exposure change materially.

## Approval Needed
User approval is required to accept the deployment/runtime delta where the backend becomes LAN-reachable on `8000` and `find_website` becomes part of the live stack.
