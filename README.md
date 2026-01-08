# RecipeStack (C# + React + Postgres)

Minimal full-stack app for storing recipes/ingredients and generating recipe ideas from your selected ingredients (Ollama Cloud).

## Run (Docker)

From `RecipeStack/`:

1) Create `RecipeStack/.env` with your Ollama Cloud key:

```bash
OLLAMA_API_KEY=your_key_here
# Optional:
# OLLAMA_MODEL=gemini-3-flash-preview:cloud
# OLLAMA_BASE_URL=https://ollama.com
```

2) Start:

```bash
docker compose up --build
```

- Web UI: `http://localhost:3000`
- API: `http://localhost:8081` (Swagger at `http://localhost:8081/swagger`)
- Postgres: `localhost:5441` (db `recipes`, user `postgres`, password `password`)

Stop:

```bash
docker compose down
```

## Migrations (via docker-compose)

The compose file includes a one-shot `migrate` service that runs:

```bash
dotnet RecipeApi.dll --migrate --seed
```

You can rerun it any time:

```bash
docker compose run --rm migrate
```

## API Endpoints

- `GET /api/ingredients`
- `POST /api/ingredients`
- `GET /api/recipes`
- `POST /api/recipes`
- `GET /api/recipes/can-make?ingredientIds=1&ingredientIds=2`
- `POST /api/ai/recipes`

Example:

```bash
curl -sS http://localhost:8081/api/ai/recipes \
  -H 'Content-Type: application/json' \
  -d '{"ingredientIds":[1,2,3],"maxRecipes":5,"notes":"quick dinner"}'
```

## Create a new EF migration

If you have the .NET SDK locally:

```bash
cd backend/RecipeApi
dotnet tool restore
dotnet ef migrations add YourMigrationName -o Migrations
```

If you don’t have .NET installed locally, generate migrations via a container:

```bash
docker run --rm -v "$PWD/backend/RecipeApi:/src" -w /src mcr.microsoft.com/dotnet/sdk:8.0 \
  bash -lc "dotnet tool restore && dotnet ef migrations add YourMigrationName -o Migrations"
```
# RecipeStack
