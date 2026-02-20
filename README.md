# Auronix Motors — IoT Ticker Platform

> Enterprise real-time IoT monitoring, predictive maintenance, and operational analytics for automotive manufacturing.

![License](https://img.shields.io/badge/license-Proprietary-blue)
![Python](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/fastapi-0.109-009688?logo=fastapi&logoColor=white)
![Databricks](https://img.shields.io/badge/databricks-apps-FF3621?logo=databricks&logoColor=white)

---

## Overview

The **IoT Ticker Platform** is a full-stack application built for **Auronix Motors** to monitor, control, and analyse IoT-enabled machinery across multiple manufacturing plants. It runs as a **Databricks App** backed by PostgreSQL, Kafka, and MQTT, and exposes a React dashboard with real-time WebSocket streams.

### Key Capabilities

| Capability | Description |
|---|---|
| **Real-time Telemetry** | Live sensor data ingestion via Kafka & MQTT, streamed to the UI over WebSockets |
| **Role-based Dashboards** | Operator, Manager, and Leadership views with tailored KPIs |
| **Alerting Engine** | Threshold-based and AI-driven alerts with severity levels |
| **Predictive Forecasts** | Machine-learning forecasts for OEE, downtime, and utilisation |
| **Machine Control** | Remote start/stop/calibrate commands with audit logging |
| **AI/BI Dashboards** | Embedded Databricks dashboards for deep analytics |
| **Multi-plant Support** | 3 plants × 4 workshops × 450+ machines, fully filterable |

---

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│                   Databricks Apps (PaaS)                  │
│                                                           │
│  ┌─────────────┐      ┌──────────────────────┐           │
│  │  React SPA  │◄────►│  FastAPI Backend      │           │
│  │  (Vite)     │ REST │  ├── REST API (/api)  │           │
│  │  Tailwind   │  +   │  ├── WebSocket (/ws)  │           │
│  │  Recharts   │  WS  │  ├── Auth (JWT)       │           │
│  │  Zustand    │      │  └── Background Jobs  │           │
│  └─────────────┘      └──────────┬───────────┘           │
│                                  │                        │
│                    ┌─────────────┼─────────────┐         │
│                    │             │             │          │
│              ┌─────▼────┐ ┌─────▼────┐ ┌──────▼───┐     │
│              │PostgreSQL│ │  Kafka   │ │   MQTT   │     │
│              │(asyncpg) │ │(aiokafka)│ │(paho)    │     │
│              └──────────┘ └──────────┘ └──────────┘     │
└───────────────────────────────────────────────────────────┘
```

---

## Tech Stack

### Backend (`/backend`)

- **FastAPI** 0.109 — async REST + WebSocket framework
- **SQLAlchemy** 2.0 — async ORM with asyncpg driver
- **Alembic** — database migrations
- **Pydantic v2** — settings & request/response validation
- **structlog** — structured JSON logging
- **Kafka** (aiokafka) + **MQTT** (paho-mqtt) — event streaming
- **Redis** — optional caching layer
- **APScheduler** — background job scheduler
- **Databricks SDK** — platform integration

### Frontend (`/frontend`)

- **React 18** — component library
- **Vite 5** — dev server & production bundler
- **Tailwind CSS 3** — utility-first styling
- **Recharts** + **Chart.js** — data visualisation
- **React Router 6** — client-side routing
- **TanStack React Query 5** — server-state management
- **Zustand** — client-state management
- **Axios** — HTTP client
- **Lucide + Heroicons** — icon libraries

### Infrastructure

- **Databricks Apps** — deployment runtime (`app.yaml`)
- **PostgreSQL** — primary data store
- **Docker Compose** — local seeding environment

---

## Project Structure

```
.
├── app.yaml                  # Databricks Apps manifest
├── build.sh                  # Full build script (backend + frontend)
├── deploy.sh                 # Deployment helper
├── docker-compose.seeding.yml
│
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI application entry point
│   │   ├── api/              # Route handlers (REST + WebSocket)
│   │   ├── core/             # Config, database, security, filters
│   │   ├── models/           # SQLAlchemy ORM models
│   │   ├── schemas/          # Pydantic request/response schemas
│   │   └── services/         # Business logic & background tasks
│   ├── scripts/              # DB seeding, data export, cleanup
│   ├── requirements.txt      # Production dependencies
│   └── requirements-dev.txt  # Dev/test dependencies (flake8, etc.)
│
└── frontend/
    ├── src/
    │   ├── App.jsx           # Root component & route definitions
    │   ├── main.jsx          # React DOM entry point
    │   ├── components/       # Shared UI components
    │   ├── hooks/            # Custom hooks (WebSocket, dashboard data)
    │   ├── layouts/          # Page layouts (MainLayout)
    │   ├── pages/            # Page-level components & analytics views
    │   ├── services/         # Axios API client
    │   ├── store/            # Zustand stores (auth, filters)
    │   └── utils/            # Helpers & formatters
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    └── .eslintrc.cjs
```

---

## Getting Started

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| npm | ≥ 9 |
| Python | ≥ 3.11 |
| PostgreSQL | ≥ 14 |

### 1. Clone & configure

```bash
git clone <repo-url> && cd IOT

# Backend
cp backend/.env.example backend/.env
# Edit backend/.env with your DATABASE_URL, SECRET_KEY, etc.

# Frontend
cp frontend/.env.example frontend/.env
# Edit frontend/.env — set VITE_API_URL, VITE_WS_URL
```

### 2. Install dependencies

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 3. Seed the database (optional)

```bash
cd backend
python scripts/seed_complete_data.py
```

### 4. Run locally

```bash
# Terminal 1 — Backend
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Frontend
cd frontend
npm run dev          # → http://localhost:5173
```

The API docs are available at `http://localhost:8000/api/docs` (Swagger UI) and `http://localhost:8000/api/redoc`.

---

## Building for Production

Use the included build script to compile both frontend and backend:

```bash
./build.sh
```

This will:
1. Install and build the frontend (`npm ci && npm run build:prod`)
2. Validate backend Python syntax
3. Package static assets into `frontend/dist/`

### Manual build

```bash
# Frontend
cd frontend && npm run build:prod

# Backend — no build step; just ensure requirements are installed
cd backend && pip install -r requirements.txt
```

---

## Deploying to Databricks Apps

The application is configured via `app.yaml`. Key settings:

| Setting | Value |
|---|---|
| Entrypoint | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |
| Health check | `GET /health` on port 8000 |
| Resources | 1–2 CPU, 2–4 Gi memory |
| Replicas | 1–5 (auto-scaling) |
| Static files | `frontend/dist/` served at `/static` |

Secrets are managed via Databricks secret scopes (`iot-ticker-secrets`):
- `database-url`
- `secret-key`
- `databricks-host`
- `databricks-token`

---

## API Endpoints

| Prefix | Description |
|---|---|
| `GET /health` | Health check |
| `POST /api/auth/login` | JWT authentication |
| `GET /api/plants` | Plant & workshop CRUD |
| `GET /api/machines` | Machine registry |
| `GET /api/telemetry` | Sensor telemetry data |
| `GET /api/alerts` | Alert listing & management |
| `GET /api/kpis` | KPI calculations & analytics |
| `GET /api/forecasts` | Predictive maintenance forecasts |
| `POST /api/controls` | Machine control commands |
| `GET /api/ticker` | IoT ticker feed |
| `GET /api/dashboards` | AI/BI embedded dashboards |
| `GET /api/analytics` | Analytics dashboard data |
| `WS /ws/telemetry` | Real-time telemetry stream |
| `WS /ws/alerts` | Live alert notifications |
| `WS /ws/analytics/operator` | Operator analytics stream |

Full interactive documentation: `/api/docs`

---

## Scripts & Utilities

| Script | Purpose |
|---|---|
| `build.sh` | End-to-end build (frontend + backend validation) |
| `deploy.sh` | Deployment helper |
| `backend/scripts/seed_complete_data.py` | Full database seeding |
| `backend/scripts/seed_incremental_data.py` | Incremental live data seeding |
| `backend/scripts/init_db.py` | Database table creation |
| `backend/scripts/data_removal.py` | Data cleanup utility |
| `backend/scripts/export_to_excel.py` | Export data to Excel |
| `backend/scripts/update_plant_locations.py` | Update plant GPS coordinates |

---

## Linting & Code Quality

```bash
# Backend (Python)
cd backend
pip install -r requirements-dev.txt
flake8 app/

# Frontend (JS/JSX)
cd frontend
npm run lint
```

Both linters are configured to pass with **zero errors** on the current codebase.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `SECRET_KEY` | ✅ | JWT signing secret |
| `ENVIRONMENT` | — | `development` / `production` |
| `DEBUG` | — | Enable debug mode (`true`/`false`) |
| `CORS_ORIGINS` | — | Comma-separated allowed origins |
| `KAFKA_BOOTSTRAP_SERVERS` | — | Kafka broker address |
| `MQTT_BROKER` | — | MQTT broker host |
| `REDIS_URL` | — | Redis connection string |
| `DATABRICKS_HOST` | — | Databricks workspace URL |
| `DATABRICKS_TOKEN` | — | Databricks PAT |

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | ✅ | Backend API base URL |
| `VITE_WS_URL` | ✅ | WebSocket base URL |
| `VITE_APP_NAME` | — | Application display name |

---

## Contributing

1. Create a feature branch from `main`
2. Run linters before committing (`flake8`, `eslint`)
3. Ensure `npm run build` and `python -c "import ast; ast.parse(open('app/main.py').read())"` pass
4. Open a pull request with a clear description

---

## License

Proprietary — Auronix Motors. All rights reserved.
