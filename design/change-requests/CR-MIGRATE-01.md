# Change Request: CR-MIGRATE-01

## 1. Description
Migrate the primary runtime database from a remote MariaDB instance to a local database (SQLite) as part of work package `WP-MIGRATE-01`.

## 2. Affected FR/NFR
- **FR-06:** Lưu trữ dữ liệu vận hành cục bộ (Local operational data storage).
- **NFR-08 (Maintainability / Traceable logs):** Transitioning to SQLite changes how state is interacted with locally.
- **Process Conflict:** `AGENTS.md` (Section 13.2) explicitly mandates the use of `mariadb_nas` for persistence-affecting work verification. Moving to SQLite requires altering this verification policy to use standard SQLite inspection (e.g., via `sqlite3` CLI or local DB viewing tools).

## 3. Scope & Design Delta
- **Target Database:** Local SQLite (`server/db.sqlite3`).
- **Data Migration:** Manual or automatic schema generation using existing SQLAlchemy initializations (`Base.metadata.create_all`). No existing data from remote MariaDB will be ported unless explicitly requested.
- **Env/Config Changes:** Remove `DATABASE_URL` from `server/.env` to allow `server/app/database.py` to transparently fallback to `sqlite:///...db.sqlite3`.
- **Docker/Runtime Changes:** Drop `eb-db` MariaDB container from `docker-compose.yml` if no longer needed, and remove `depends_on: db` from the `server` container. Update `run.md` documentation.
- **Rollback Path:** Revert `.env` to point to the remote MariaDB instance (`mysql+pymysql://...`) and restore docker-compose dependencies.
- **Unchanged:** Data models, schema structure (mostly additive column guards handled by `database.py`), application-level APIs and business logic.

## 4. Affected Gates
- **G1 (Requirement):** Requires approval because it alters the verification policy described in `AGENTS.md` and touches core data persistence.
- **G2 (Design):** Approval needed for the shift in infrastructure requirements (removing MariaDB from docker-compose, locking SQLite as standard).

## 5. Approval Needed
- Product / User approval to proceed with SQLite despite `AGENTS.md`'s current `mariadb_nas` mandate, and to update `AGENTS.md` or accept this explicit exception.
