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

The Jenkins pipeline now requires a successful application build gate before CD continues:

- `webapp`: `npm ci`, `npm run lint`, and `npm run build`
- `server`: `pip install -r requirements-dev.txt` and `python -m pytest tests/`

Only after that gate passes does Jenkins build the release Docker images, deploy with Docker Compose, and run the smoke checks.
