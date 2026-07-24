# ACare MVP — Aquatic System Control & Approval Portal

ACare MVP is a comprehensive Aquatic Facility Management software designed to track aquatic populations (census), water quality, incident reports, research projects (AUPPs), and a 14-day mandatory quarantine pipeline for new fish. 

It provides strict role-based access control (RBAC) ensuring researchers, staff, facility managers, and university chairs have the precise access needed for compliance and daily operations.

## 🚀 Current Status & Features

The MVP is actively developed and functional with the following core modules:
- **Role-Based Access Control (RBAC):** Users sign up for roles (Chair, Admin, Staff, Researcher, Manager) and await Admin/Chair approval.
- **Facility & Tank Management:** Create and manage Facilities, Rooms, and Tanks. Staff can be assigned to specific tanks.
- **Project (AUPP) Tracking:** Track research projects, metadata (species, sex, DOB, source), and monitor AUPP expiration.
- **Census & Population Tracking:** Immutable event sourcing for tracking animal arrivals, deaths, hatches, and transfers across tanks.
- **Water Quality & Incidents:** Submit daily water quality logs, test strip logs, and aquatic incident reports.
- **Quarantine Monitor:** Enforces a 14-day mandatory isolation period for new arrivals with the ability to request special transfer exemptions.
- **Reports Dashboard:** Executive summary dashboard and comprehensive table logs with dynamic filters (Dates, Event Types, Project/AUPP).
- **Audit Logging:** Immutable tracking of all critical system actions for regulatory compliance.

---

## 🛠 Setup Manual (Quick Start with Docker)

Anyone can run the entire stack (Frontend + Backend + Database) locally using Docker Compose.

### Prerequisites
- [Git](https://git-scm.com/)
- [Docker](https://www.docker.com/) & Docker Compose

### 1. Clone the repository
```bash
git pull origin main
# (or clone if you haven't already: git clone <repo_url>)
cd MVP-Acare
```

### 2. Build and run with Docker
Run the following command in the root directory to spin up MongoDB, the FastAPI backend, and the Vite React frontend:
```bash
docker compose up --build
```

### 3. Access the Application
- **Web App (Frontend):** [http://localhost:5173](http://localhost:5173)
- **API (Backend):** [http://localhost:8000](http://localhost:8000)
- **API Swagger Docs:** [http://localhost:8000/docs](http://localhost:8000/docs)

*(Note: The very first time you start the app, the backend automatically seeds a Super Admin account: `superadmin@uwindsor.ca` / `ChangeMe123!`)*

---

## 💻 Manual Setup (Without Docker)

If you prefer to run the services locally without Docker, you will need MongoDB (port 27017), Python 3.10+, and Node.js 18+.

### Backend (FastAPI)
```bash
cd apps/api
python -m venv venv

# Windows:
.\venv\Scripts\Activate.ps1
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
python -m app.seed  # Seed Super Admin
python -m uvicorn app.main:app --port 8000 --reload
```

### Frontend (Vite + React)
Open a new terminal:
```bash
cd apps/web
npm install
npm run dev
```

---

## 🗄 Database Structure & Schema (MongoDB / Beanie)

The backend uses MongoDB with Beanie ODM. The data is heavily normalized and prioritizes **immutability** for compliance tracking (e.g. logs and census events are never updated or deleted).

### 1. `users`
- **Fields:** `email`, `password_hash`, `first_name`, `last_name`, `role`, `status` (pending/approved/rejected).
- **Permissions:** `assigned_tank_ids`, `facility_ids`, `room_ids`.

### 2. `projects`
- **Fields:** `title`, `pi_name`, `aupp_number` (Unique), `status` (active/closed).
- **Metadata:** `species`, `sex`, `dob`, `established_date`, `source`, `aupp_expiry_date`.

### 3. `facilities`, `rooms`, `tanks`
- Hierarchical structure. Tanks contain `status` (active/inactive) and quarantine metadata (`is_quarantined`, `quarantine_start_date`, `quarantine_end_date`).

### 4. `tank_assignments`
- **Purpose:** Associates a Project (AUPP) with a specific Tank. 
- **Fields:** `project_id`, `tank_id`, `current_count`, `aupp_number`. Tracks real-time active population count in that specific tank.

### 5. `water_quality_logs` & `incident_reports` (Immutable)
- **Water Quality:** `type` (daily/test_strip), `date`, `parameters` (dict), `project_id`.
- **Incidents:** `problem`, `treatment`, `aquatic_condition_checked`, `vet_contacted`.
- *Note: These records are append-only. Corrections require new entries.*

### 6. `census_events` (Immutable)
- **Event Types:** `arrival`, `death`, `transfer_in`, `transfer_out`, `hatch`, `manual_adjustment`.
- **Fields:** `change` (integer delta), `date`, `project_id`, `tank_id`.
- The aggregate sum of `census_events` dynamically equates to the `current_count` in a `tank_assignment`.

### 7. `audit_logs` (Immutable)
- Automatically records the `actor`, `action`, `entity_type`, `before` state, and `after` state for all meaningful CRUD operations.

---

## 🧪 Testing

Acceptance tests cover full end-to-end user flows (signup, approvals, assignments).

```bash
cd apps/api
# Make sure your virtual environment is active
python -m pytest -s -v
```
