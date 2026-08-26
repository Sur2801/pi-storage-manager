# Pi Storage Manager

Pi Storage Manager is a local file manager built with a React/Vite frontend and a FastAPI/Python backend. It operates directly on a configured filesystem location and does not require a database.

## Project overview

- **Frontend:** React + Vite
- **Backend:** FastAPI + Python
- **Storage:** the local filesystem is the source of truth
- **Database:** not used

## Architecture

```text
Browser
   ↓
React/Vite Frontend
   ↓
FastAPI Backend
   ↓
Local Filesystem
```

The configured filesystem path is the application’s storage root.

## Prerequisites

- Python 3.11+ recommended
- Node.js and npm
- Git (if you are cloning the repository)

## Configuration

The application reads environment variables from the root `.env` file.

```env
STORAGE_ROOT=C:/path/to/your/storage
APP_HOST=0.0.0.0
APP_PORT=8000
VITE_API_BASE_URL=http://localhost:8000/api
```

- `STORAGE_ROOT` is the folder Pi Storage Manager manages.
- Change `STORAGE_ROOT` to the filesystem location you want the app to operate on.
- `APP_HOST` and `APP_PORT` control the backend listener.
- `VITE_API_BASE_URL` points the frontend at the backend API.

## Backend setup and run

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Backend API docs:

- http://localhost:8000/docs
- http://localhost:8000/redoc

## Frontend setup and run

```powershell
cd frontend
npm install
npm run dev
```

Frontend URL:

- http://localhost:5173/

## Build

```powershell
cd frontend
npm run build
```

## Running both

Run the backend and frontend in separate terminals.

- **Terminal 1:** backend
- **Terminal 2:** frontend

## Configuration flow

1. Open `.env`
2. Set `STORAGE_ROOT` to the folder you want Pi Storage Manager to manage
3. Start the backend
4. Start the frontend
5. Open the frontend URL

## Current features

- File and folder listing
- Live updates from the filesystem watcher via SSE
- Search
- Sorting
- Upload
- Folder upload
- Bulk upload
- Create folder
- Rename
- Delete
- Copy
- Move
- Download
- File preview
- Multi-select
- Grid and list views
- Drag and drop
- Dashboard system metrics

## API overview

- `GET /api/health` — health check
- `GET /api/files` — list files and folders, with `path`, `search`, `sort_by`, `sort_order`
- `POST /api/files` — create an empty file
- `POST /api/files/upload` — upload a file
- `GET /api/files/download` — download a file or archive
- `GET /api/files/preview` — fetch preview content for supported files
- `PATCH /api/files/rename` — rename a file or folder
- `PATCH /api/files/move` — move one or more items
- `POST /api/files/copy` — copy one or more items
- `DELETE /api/files` — delete one or more items
- `POST /api/folders` — create a folder
- `GET /api/system/stats` — storage, CPU, RAM, and uptime stats
- `GET /api/events` — server-sent filesystem change events

## Project structure

```text
README.md
.env
backend/
  requirements.txt
  app/
    main.py
    api/
      health.py
      files.py
      folders.py
      events.py
      system.py
    core/
      config.py
      exception_handlers.py
      exceptions.py
    schemas/
      common.py
      files.py
      system.py
    services/
      file_service.py
      storage_service.py
      watcher_service.py
  tests/
    test_endpoints.py
    test_file_listing.py
    test_file_operations.py
    test_sse_endpoint.py
    test_watcher_service.py
frontend/
  package.json
  vite.config.ts
  src/
    App.tsx
    main.tsx
    index.css
    api/
      client.ts
      storageApi.ts
    components/
      dashboard/DashboardCards.tsx
      explorer/FileExplorer.tsx
    hooks/
      useDebounce.ts
      useFileSSE.ts
    types/
      api.ts
```

## Troubleshooting

- **Invalid `STORAGE_ROOT`:** verify the folder exists and the backend user can read/write it.
- **Backend not running:** start `uvicorn app.main:app --host 0.0.0.0 --port 8000` in the backend folder.
- **Frontend cannot connect:** confirm `VITE_API_BASE_URL=http://localhost:8000/api`.
- **Port already in use:** stop the process using the port or change `APP_PORT` / the frontend port.
- **Missing dependencies:** rerun `pip install -r requirements.txt` or `npm install`.

## Security / important notes

`STORAGE_ROOT` gives the application direct access to that filesystem location. Configure it carefully and only point it at the folder you want managed.
