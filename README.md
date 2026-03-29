# E-Connect

E-Connect la nen tang smart home `self-hosted` va `local-first`, tap trung vao dieu khien thiet bi trong LAN, onboarding DIY cho ESP32/ESP8266, giao tiep MQTT-first, va luu tru trang thai ben vung tren ha tang cua nguoi dung.

## Gioi thieu du an

E-Connect huong toi mo hinh nha thong minh tu host, trong do phan van hanh chinh duoc dat tren mang noi bo cua nguoi dung:

- `server`: FastAPI backend quan ly auth, device lifecycle, automation, firmware build, WebSocket va API.
- `webapp`: Next.js 16 + React 19 cho dashboard, setup, settings, DIY builder va cac man hinh van hanh.
- `mqtt`: Mosquitto broker lam transport layer cho command/state loop.
- `db`: MariaDB luu user, household, device, dashboard, automation va lich su van hanh.
- `find_website`: cong discovery public do nha phat trien host, dung de tim instance E-Connect trong cung LAN tu trinh duyet cua nguoi dung.

### Gia tri cot loi

- `Local-first`: mat Internet khong lam mat core LAN control.
- `Self-hosted`: stack chinh chay tren ha tang do nguoi dung kiem soat.
- `MQTT-first`: giao tiep thiet bi uu tien qua MQTT.
- `DIY-friendly`: ho tro pin mapping, build firmware server-side va flash/web serial workflow.
- `Durable state`: du lieu quan trong duoc persist thay vi chi ton tai trong UI memory.

## Cau truc repo quan trong

- [PRD.md](PRD.md): baseline san pham va scope thuc thi.
- [AGENTS.md](AGENTS.md): quy trinh lam viec, gate, role, commit/push policy.
- [design/](design): schema, flows, change requests va tai lieu thiet ke.
- [server/](server): backend FastAPI, SQLAlchemy, MQTT, build pipeline cho firmware.
- [webapp/](webapp): giao dien Next.js cho setup, dashboard, settings va DIY.
- [mqtt/](mqtt): Docker image cho Mosquitto broker.
- [find_website/](find_website): public discovery portal.
- [server/tests/manual/fake_board/README.md](server/tests/manual/fake_board/README.md): tai lieu test thu cong cho fake-board harness.

## Qua trinh phat trien

Repo nay dang duoc van hanh theo baseline waterfall voi 4 phase ro rang:

1. `Requirement`: doc PRD, chot scope, mapping FR/NFR va verification plan.
2. `Design`: cap nhat design docs hoac ghi ro `Design unchanged` neu chi la sua hep.
3. `Implementation`: thay doi nho nhat hop ly, giu dung topology va domain rules.
4. `Test`: xac minh doc lap bang lint, build, pytest, browser hoac DB evidence tuy theo pham vi thay doi.

### Kenh xac minh va delivery

- GitHub Actions:
  - `webapp`: `npm run lint` + `npm run build`
  - `server`: `pytest tests/`
  - `find_website`: build Docker image va smoke check HTTP
- Jenkins:
  - build-gated Docker deployment
  - co `docker-compose.jenkins.yml` cho environment Jenkins
  - co the publish `econnect.local` qua helper `discovery_mdns` khi pipeline duoc cau hinh phu hop

### Luu y topology

Self-hosted stack mac dinh cua nguoi dung chi gom `db`, `mqtt`, `server`, `webapp`.
`find_website` la thanh phan discovery public do nha phat trien host, khong phai mot phan bat buoc cua home-server deployment thong thuong. Repo van giu service nay trong `docker-compose.yml` de phuc vu local validation va build pipeline.

## Huong dan su dung voi Docker Compose

### Yeu cau moi truong

- Docker Engine
- Docker Compose plugin (`docker compose`)
- Cac cong host con trong: `3000`, `3306`, `8000`, `1883`
- Tuy chon: `9123` neu muon chay local `find_website`

### 1. Clone repo

```bash
git clone https://github.com/isharoverwhite/Final-Project.git
cd Final-Project
```

### 2. Cau hinh bien moi truong tuy chon

Neu khong tao `.env` tai root, Compose se dung cac gia tri mac dinh trong `docker-compose.yml`.
Neu can doi credential hoac origin, tao file `.env` tai root repo, vi du:

```env
DB_ROOT_PASSWORD=root_password
DB_NAME=e_connect_db
DB_USER=econnect
DB_PASSWORD=root_password
SECRET_KEY=change-me
NEXT_PUBLIC_API_URL=/api/v1
BACKEND_INTERNAL_URL=http://server:8000
FIND_WEBSITE_PORT=9123
```

### 3. Chay self-hosted stack chuan

Lenh sau phu hop voi topology duoc phe duyet cho moi truong tu host:

```bash
docker compose up -d --build db mqtt server webapp
```

Sau khi stack len:

- Web UI: `https://localhost:3000`
- Backend health: `http://localhost:8000/health`
- MQTT broker: `localhost:1883`
- MariaDB: `localhost:3306`

Luu y: `webapp` dung HTTPS local va co the yeu cau ban chap nhan chung chi tu ky khi mo lan dau.

### 4. Kiem tra trang thai

```bash
docker compose ps
curl http://localhost:8000/health
docker compose logs -f server webapp
```

Neu `health` tra ve `status: ok`, backend da san sang de `webapp` proxy va thuc hien setup/login flow.

### 5. Chay toan bo repo cho muc dich developer validation

Neu ban muon build ca cong discovery public trong may local de test:

```bash
docker compose up -d --build
```

Khi do:

- `find_website` se mo tren `http://localhost:9123`
- service nay chi nen dung cho local validation hoac pipeline testing
- trong topology san pham chuan, discovery public van duoc host rieng boi nha phat trien

### 6. Dung stack

```bash
docker compose down
```

Du lieu van duoc giu trong cac named volume:

- `db_data`
- `server_data`
- `webapp_tls`

Neu can xoa ca du lieu:

```bash
docker compose down -v
```

## Tai lieu lien quan

- [PRD.md](PRD.md)
- [AGENTS.md](AGENTS.md)
- [docker-compose.yml](docker-compose.yml)
- [docker-compose.jenkins.yml](docker-compose.jenkins.yml)
- [find_website/README.md](find_website/README.md)

## Ban quyen

Repo nay hien khong co file `LICENSE` rieng o root.
Dieu do co nghia la khong co mot giay phep nguon mo duoc cong bo ro rang cho code, tai lieu va tai nguyen trong repo.
Cho den khi chu so huu du an bo sung giay phep chinh thuc, hay xem noi dung cua repo la tai san co ban quyen va chi su dung, sao chep, phan phoi khi co su dong y phu hop.
