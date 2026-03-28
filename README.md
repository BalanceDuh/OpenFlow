# OpenFlow (Frontend + Backend + SQLite)

This project reimplements the VeoFlow-style interface with a strict frontend/backend split.

- Frontend: React + Vite (`src/`)
- Backend API: Express (`server/index.js`)
- Persistence: SQLite (`data/openflow.sqlite`)

No localStorage is used for workflow state. Task data, artifacts, prompts, versions, narratives, logs, and production task records are stored in SQLite.

Model manager is also persisted in SQLite (`model_settings` table):

- provider (currently `gemini`)
- Gemini image model (e.g. `gemini-2.5-flash-image`)
- Gemini video model (e.g. `veo-3.1-fast-generate-preview`)
- API key (stored in DB; UI only shows masked value)

## Run

```bash
npm install
npm run server
npm run dev
```

- API: `http://localhost:5172`
- Web: `http://localhost:5173`

## Main workflow endpoints

- `POST /api/tasks`
- `POST /api/tasks/:taskId/upload-source`
- `POST /api/tasks/:taskId/clean-image`
- `POST /api/tasks/:taskId/crop-image`
- `POST /api/tasks/:taskId/style-prompts/generate`
- `POST /api/tasks/:taskId/style-images/generate`
- `POST /api/tasks/:taskId/start-image/select`
- `POST /api/tasks/:taskId/narratives/generate`
- `POST /api/tasks/:taskId/narratives/:narrativeId/confirm`
- `POST /api/tasks/:taskId/production/start`
- `POST /api/tasks/:taskId/publish`
