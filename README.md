# Pi Storage Manager

Pi Storage Manager is a local file management application for browsing and managing files and folders through a web interface.

It uses React + Vite for the frontend, FastAPI + Python for the backend, and the local filesystem as the storage layer. No database is required.

## Architecture

Browser -> React + Vite -> FastAPI -> Local Filesystem

The folder configured through `STORAGE_ROOT` is the application's source of truth.

## Prerequisites

- Python 3.11+
- Node.js
- npm
- Git (if cloning the repository)

## Configuration

Configure the `.env` file in the project root:

```env
STORAGE_ROOT=C:/Users/YourName/Storage
APP_HOST=0.0.0.0
APP_PORT=8000
VITE_API_BASE_URL=http://localhost:8000/api
```

`STORAGE_ROOT` is the main setting. Set it to the filesystem location you want Pi Storage Manager to manage.

Example:

```env
STORAGE_ROOT=C:/Users/SSoni3/Downloads/Others
```

No database configuration is required.

## Backend

From the project root:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Backend:

`http://localhost:8000`

Swagger:

`http://localhost:8000/docs`

ReDoc:

`http://localhost:8000/redoc`

## Frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Frontend:

`http://localhost:5173`

## Running the Application

Terminal 1 — Backend:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Terminal 2 — Frontend:

```powershell
cd frontend
npm run dev
```

Then open `http://localhost:5173`.

## Build

```powershell
cd frontend
npm run build
```

## Docker

Docker uses the external `.env` file and bind-mounts the host storage into `/storage`.

```powershell
docker compose build
docker compose up -d
docker compose down
```

- `.env` stays outside the image.
- `STORAGE_ROOT` points to the host storage folder.
- The container operates on `/storage`.
- No database is required.
- For GHCR, set `PI_STORAGE_MANAGER_IMAGE=ghcr.io/<github-user>/pi-storage-manager:latest`.

## Current Features

- File and folder browsing
- Search and sorting
- List and grid views
- Multi-select and select all
- Create folders
- Rename
- Delete
- Copy and move
- Download
- File upload
- Folder upload
- Bulk upload
- Drag and drop
- File preview
- Duplicate/conflict handling
- Filesystem watcher
- Live updates through Server-Sent Events (SSE)
- Dashboard storage and system metrics
- CPU, RAM and uptime metrics

## API Overview

### Health
`GET /api/health`

### Files
- `GET /api/files` — list files and folders
- `POST /api/files` — create an empty file
- `POST /api/files/upload` — upload files
- `GET /api/files/download` — download files
- `GET /api/files/preview` — preview supported files
- `PATCH /api/files/rename` — rename
- `PATCH /api/files/move` — move files/folders
- `POST /api/files/copy` — copy files/folders
- `DELETE /api/files` — delete files/folders

### Folders
`POST /api/folders` — create a folder

### System
`GET /api/system/stats` — storage and system metrics

### Filesystem Events
`GET /api/events` — filesystem change events through SSE

## Project Structure

```text
Pi Storage Manager
├── README.md
├── .env
├── backend/
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   ├── core/
│   │   ├── schemas/
│   │   └── services/
│   └── tests/
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── main.tsx
        ├── index.css
        ├── api/
        ├── components/
        ├── hooks/
        └── types/
```

## Troubleshooting

### Backend does not start

Activate the virtual environment and install dependencies:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Frontend cannot connect to backend

Check:

```env
VITE_API_BASE_URL=http://localhost:8000/api
```

Also make sure the backend is running.

### Invalid STORAGE_ROOT

Make sure the path exists and the application has permission to access it.

### Port already in use

Stop the process using the port or change the backend/frontend configuration accordingly.

## Important Notes

Pi Storage Manager does not use a database. The configured filesystem is the source of truth.

`STORAGE_ROOT` gives the application access to that filesystem location. Configure it carefully and only point it to a location you want the application to manage.
