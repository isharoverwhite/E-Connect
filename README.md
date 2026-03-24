# E-Connect

Self-hosted, local-first smart home platform focused on dashboard control, DIY ESP32/ESP8266 onboarding, MQTT-first communication, and durable local state.

## Core documents

- [PRD.md](PRD.md): current product and delivery baseline
- [AGENTS.md](AGENTS.md): execution rules for implementation agents
- [Jenkinsfile](Jenkinsfile): Jenkins delivery pipeline for build-gated Docker deployment
- [run.md](run.md): local run guide for the active `server` and `webapp` stack
- [esp32-wifi-flash-pairing-workflow.md](esp32-wifi-flash-pairing-workflow.md): workflow yêu cầu cho cấu hình Wi-Fi lần đầu, flash ESP32, và pair với server
- [server/tests/manual/fake_board/README.md](server/tests/manual/fake_board/README.md): manual fake-board harness for pairing, MQTT, and discovery verification

## Delivery pipeline

The Jenkins pipeline now requires a successful Docker-based build gate before CD continues:

- `webapp`: Docker `check` target runs `npm run lint` and `npm run build`
- `server`: Docker `test` target runs `python -m pytest tests/`

The gate uses Docker build targets instead of bind-mounting the Jenkins workspace into ad-hoc containers, so it works when Jenkins itself runs inside a container.
The MQTT broker now follows the same rule: its Mosquitto config is baked into the `mqtt` image instead of bind-mounting a workspace file at deploy time.
Jenkins also uses [docker-compose.jenkins.yml](docker-compose.jenkins.yml) as an override so the database stays internal to the compose network and does not need to claim host port `3306` during CD.
Only after that gate passes does Jenkins build the release Docker images, deploy with Docker Compose, and run the smoke checks.
