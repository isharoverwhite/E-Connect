# E-Connect

Self-hosted, local-first smart home platform focused on dashboard control, DIY ESP32/ESP8266 onboarding, MQTT-first communication, and durable local state.

## Core documents

- [PRD.md](PRD.md): current product and delivery baseline
- [Jenkinsfile](Jenkinsfile): Jenkins delivery pipeline for build-gated Docker deployment
- [run.md](run.md): local run guide for the active `server` and `webapp` stack
- [esp32-wifi-flash-pairing-workflow.md](esp32-wifi-flash-pairing-workflow.md): workflow yêu cầu cho cấu hình Wi-Fi lần đầu, flash ESP32, và pair với server
- [server/tests/manual/fake_board/README.md](server/tests/manual/fake_board/README.md): manual fake-board harness for pairing, MQTT, and discovery verification

## Deployment topology

- End-user self-hosted stack: `server`, `webapp`, `mqtt`, and `db` run on hardware controlled by the user inside their own LAN.
- Public discovery entrypoint: `E-Connect Web Assistant` (`find_website`) is hosted only on developer-controlled infrastructure, with the approved public origin currently at [find.isharoverwhite.com](https://find.isharoverwhite.com).
- Discovery execution model: after the user finishes setup on their home server, they open [find.isharoverwhite.com](https://find.isharoverwhite.com) from a device on the same LAN, and the browser tab performs the LAN discovery requests toward the self-hosted backend.
- Non-goal: the developer-hosted website is not a server-side LAN scanner, and it should not be bundled into the user's normal home-server stack unless the product baseline changes.

## Delivery pipeline

The Jenkins pipeline now requires a successful Docker-based build gate before CD continues:

- `webapp`: Docker `check` target runs `npm run lint` and `npm run build`
- `server`: Docker `test` target runs `python -m pytest tests/`
- `find_website`: Docker image build validates the standalone Next.js public discovery portal

The gate uses Docker build targets instead of bind-mounting the Jenkins workspace into ad-hoc containers, so it works when Jenkins itself runs inside a container.
The MQTT broker now follows the same rule: its Mosquitto config is baked into the `mqtt` image instead of bind-mounting a workspace file at deploy time.
Jenkins also uses [docker-compose.jenkins.yml](docker-compose.jenkins.yml) as an override so the database stays internal to the compose network, while the live backend keeps host port `8000` published for the browser discovery-script contract used by `find_website`.
The approved product topology is split: the end-user home deployment is `server`, `webapp`, `mqtt`, and `db`, while `find_website` remains a separate developer-hosted service. Jenkins can still validate or build both from the same repository, but `find_website` should not be treated as part of the user's normal self-hosted compose stack.
Validation-only runs can stop after the build gate by setting `DEPLOY=false`, which skips the release-image build, compose rollout, and smoke stages.
When deployment is requested, Jenkins now enforces the branch policy immediately after the build gate so blocked non-main deploys fail before the release-image build starts.
When Jenkins deploys the Docker stack, it now also auto-resolves a LAN IP for the build node, enables the `discovery-mdns` compose profile, publishes `econnect.local` through the `discovery_mdns` helper running on host networking, and aligns `FIRMWARE_PUBLIC_BASE_URL`, `FIRMWARE_MQTT_BROKER`, and `HTTPS_HOSTS` with that alias unless the job already overrides them explicitly.
Only after that gate passes does Jenkins build the release Docker images and run the smoke checks relevant to the target environment, keeping the public `find_website` deployment distinct from the end-user self-hosted stack.

For Docker-based server deployments, set `FIRMWARE_PUBLIC_BASE_URL` to the real WebUI origin, for example `https://192.168.2.55:3000`, because bridge-mode containers cannot infer the host LAN IP reliably at startup.
If you want the public scanner and firmware metadata to use `econnect.local` instead of a raw IP, either let Jenkins deploy the `discovery_mdns` helper or publish that hostname to the server LAN IP through Avahi/mDNS or your router DNS, then set `FIRMWARE_PUBLIC_BASE_URL=https://econnect.local:3000`, `FIRMWARE_MQTT_BROKER=econnect.local`, and `HTTPS_HOSTS=econnect.local` for the compose stack. For the `.local` suffix, Avahi/mDNS is the preferred path; router DNS is only a fallback when your clients resolve it consistently.

GitHub Actions also runs a scoped Docker workflow for `find_website` on pull requests and pushes to `main` that touch [find_website](/Users/kiendinhtrung/Documents/GitHub/Final-Project/find_website) or the workflow file itself. That workflow builds the image from [find_website/Dockerfile](/Users/kiendinhtrung/Documents/GitHub/Final-Project/find_website/Dockerfile) and smoke-checks the developer-hosted public discovery portal over HTTP, but it does not publish the image to a registry yet.
