# Dragonfly Platform — Phase 1

Document + Hybrid Inventory Platform backend.

## Stack

- TypeScript / Node.js / Express
- PostgreSQL
- JWT authentication
- Local file storage (MinIO-ready)

## Setup

```bash
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET

npm install
npm run migrate
npm run seed   # Creates admin@local / admin123
npm run dev
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with nodemon |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run migrate` | Run database migrations |
| `npm run seed` | Seed admin user |

## API Overview

### Auth
- `POST /auth/login` — Email + password → JWT
- `GET /auth/me` — Current user

### Users (admin only)
- `GET /users` — List users
- `POST /users` — Create user
- `GET /users/:id` — Get user
- `PATCH /users/:id` — Update user
- `DELETE /users/:id` — Soft delete
- `POST /users/:id/roles` — Assign role
- `DELETE /users/:id/roles/:rid` — Remove role
- `GET /users/roles` — List roles

### Documents
- `GET /folders` — Visible folder tree
- `POST /folders` — Create folder
- `PATCH /folders/:id` — Rename / move
- `DELETE /folders/:id` — Soft delete
- `GET /folders/:id/documents` — List docs in folder
- `POST /documents/upload` — Upload file (multipart, field: `file`)
- `GET /documents/:id/download` — Download file
- `DELETE /documents/:id` — Soft delete
- `GET /documents/:id/versions` — Version history
- `GET /documents/:id/activity` — Activity log
- `GET/POST/DELETE` — Permissions on docs and folders

## Architecture

- `src/controllers/` — HTTP handlers
- `src/services/` — Business logic & DB queries
- `src/routes/` — Route definitions
- `src/middleware/` — Auth, error handling, validation
- `src/utils/` — DB pool, config, JWT, passwords, errors
- `migrations/` — Ordered SQL migrations
- `scripts/` — Migration runner & seeder
