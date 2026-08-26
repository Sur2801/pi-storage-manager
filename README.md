# Pi Storage Manager

Pi Storage Manager is a lightweight, self-hosted personal file management application for Raspberry Pi.  
This repository is currently **Phase 1: Initial Project Skeleton** and intentionally contains placeholder APIs/UI contracts only.

## 1. Project overview

The app is designed for personal, single-user file management on a Raspberry Pi 3 Model B with a 4 TB external HDD.  
Goal: a clean, explorer-style interface backed by a lightweight FastAPI service.

## 2. Main goals

- Learn practical React + FastAPI integration
- Build predictable REST contracts for file operations
- Keep architecture simple and Raspberry Pi friendly
- Prepare for safe filesystem handling in later phases

## 3. Features planned

**Implemented in Phase 1 (skeleton):**
- React UI skeleton (dashboard + file explorer layout)
- FastAPI app with placeholder endpoints
- Frontend API service layer for backend integration
- Central configuration via environment variables
- Error-handling structure and endpoint tests

**Planned for later phases:**
- Real filesystem operations (list/upload/download/create/rename/move/copy/delete)
- Path safety and traversal protection
- Search, preview, drag/drop operational behavior
- Real system metrics and storage statistics

## 4. Architecture

```text
Frontend (React)
    ↓
API service layer (frontend/src/api)
    ↓
FastAPI routers
    ↓
File service layer
    ↓
Storage service abstraction
    ↓
Filesystem (to be implemented in later phases)
```

Routers currently do not perform real disk operations.

## 5. Technology stack

- Frontend: React + TypeScript + Vite
- Backend: Python + FastAPI + Uvicorn + Pydantic
- Testing: Pytest + FastAPI TestClient
- Remote access target: Tailscale (deployment phase)

## 6. Repository structure

```text
pi-storage-manager/
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   └── types/
│   ├── index.html
│   ├── package.json
│   └── ...
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── main.py
│   ├── tests/
│   └── requirements.txt
├── .env
├── .gitignore
└── README.md
```

## 7. Development setup

1. Clone the repository.
2. Configure environment variables in the root `.env`.
3. Start backend and frontend separately.

## 8. Environment configuration

Use environment variables only. Do not hardcode storage paths.

Root `.env`:

```env
STORAGE_ROOT=/home/pi/test-storage
APP_HOST=0.0.0.0
APP_PORT=8000
VITE_API_BASE_URL=http://localhost:8000/api
```

Development:

```env
STORAGE_ROOT=/home/pi/test-storage
VITE_API_BASE_URL=http://localhost:8000/api
```

Production:

```env
STORAGE_ROOT=/media/pi/Surya Soni
```

## 9. Running frontend

```bash
cd frontend
npm install
npm run dev
```

On Windows PowerShell:

```powershell
cd frontend
npm install
npm run dev
```

## 10. Running backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

On Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

## 11. API overview (Phase 1 placeholders with expanded contracts)

- `GET /api/health`
- `GET /api/files` (supports `path`, `search`, `sort_by`, `sort_order`)
- `POST /api/files` (create empty file placeholder contract)
- `POST /api/files/upload` (supports legacy JSON placeholder and multipart contract shape)
- `GET /api/files/download` (supports `source_path` and `as_archive` contract flag)
- `POST /api/folders`
- `PATCH /api/files/rename`
- `PATCH /api/files/move` (single or multi-source contract)
- `POST /api/files/copy` (single or multi-source contract)
- `DELETE /api/files` (multi-item contract with per-item results)
- `GET /api/system/stats`

Examples:

```text
GET /api/files?path=/Photos&search=vacation&sort_by=name&sort_order=asc
```

```json
{
  "success": true,
  "message": "Move operation completed",
  "results": [
    { "path": "/Photos/a.jpg", "success": true },
    { "path": "/Photos/b.jpg", "success": false, "error": "File not found" }
  ]
}
```

```json
{
  "success": true,
  "message": "File listing endpoint is working",
  "path": "/Photos",
  "search": "vacation",
  "sort_by": "name",
  "sort_order": "asc",
  "items": []
}
```

Filesystem logic is intentionally placeholder-only in this phase; these contracts are designed for later HDD-backed implementation.

## 12. Raspberry Pi deployment overview

Planned deployment target:
- Raspberry Pi 3 Model B (~1 GB RAM)
- Attached 4 TB Seagate HDD
- Lightweight Python + React runtime

No Docker/Kubernetes/Redis/PostgreSQL dependency is required for this project.

## 13. Tailscale usage

Remote access is planned via Tailscale to reach the Pi securely over private networking.  
Application auth is intentionally out of scope for this single-user setup phase.

## 14. Security considerations

Security boundaries are prepared in architecture but not fully implemented yet.  
Future phases will enforce:
- path traversal prevention
- access strictly under `STORAGE_ROOT`
- safe file/folder operation validation

## 15. Testing

Run backend tests:

```bash
cd backend
pytest
```

Current tests confirm each placeholder endpoint responds successfully.

## 16. Future improvements

- Implement actual filesystem operations through service layer
- Add safe path normalization and validation
- Add streaming upload/download behavior
- Add real dashboard/system metrics
- Build robust search, preview, and bulk operations

In backend folder run python code using this command: `python -m uvicorn app.main:app --reload`
