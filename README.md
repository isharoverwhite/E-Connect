# E-Connect

Self-hosted, local-first smart home platform focused on dashboard control, DIY ESP32/ESP8266 onboarding, MQTT-first communication, and durable local state.

## Core documents

- [PRD.md](PRD.md): current product and delivery baseline
- [Jenkinsfile](Jenkinsfile): Jenkins delivery pipeline for build-gated Docker deployment
- [run.md](run.md): local run guide for the active `server` and `webapp` stack
- [esp32-wifi-flash-pairing-workflow.md](esp32-wifi-flash-pairing-workflow.md): workflow yêu cầu cho cấu hình Wi-Fi lần đầu, flash ESP32, và pair với server
- [server/tests/manual/fake_board/README.md](server/tests/manual/fake_board/README.md): manual fake-board harness for pairing, MQTT, and discovery verification

## Delivery pipeline

The Jenkins pipeline now requires a successful Docker-based build gate before CD continues:

- `webapp`: Docker `check` target runs `npm run lint` and `npm run build`
- `server`: Docker `test` target runs `python -m pytest tests/`
- `find_website`: Docker image build validates the standalone Next.js public scanner app

The gate uses Docker build targets instead of bind-mounting the Jenkins workspace into ad-hoc containers, so it works when Jenkins itself runs inside a container.
The MQTT broker now follows the same rule: its Mosquitto config is baked into the `mqtt` image instead of bind-mounting a workspace file at deploy time.
Jenkins also uses [docker-compose.jenkins.yml](docker-compose.jenkins.yml) as an override so the database and backend stay internal to the compose network and do not need to claim host ports `3306` or `8000` during CD.
The compose stack now declares healthchecks for `server` and `webapp`, and Jenkins waits for those services to become healthy before it runs the smoke commands.
Validation-only runs can stop after the build gate by setting `DEPLOY=false`, which skips the release-image build, compose rollout, and smoke stages.
When deployment is requested, Jenkins now enforces the branch policy immediately after the build gate so blocked non-main deploys fail before the release-image build starts.
Only after that gate passes does Jenkins build the release Docker images, deploy with Docker Compose, and run the smoke checks.

GitHub Actions also runs a scoped Docker workflow for `find_website` on pull requests and pushes to `main` that touch [find_website](/Users/kiendinhtrung/Documents/GitHub/Final-Project/find_website) or the workflow file itself. That workflow builds the image from [find_website/Dockerfile](/Users/kiendinhtrung/Documents/GitHub/Final-Project/find_website/Dockerfile) and smoke-checks the container over HTTP, but it does not publish the image to a registry yet.
