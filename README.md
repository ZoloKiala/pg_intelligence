# PGIS Participatory Hotspot Dashboard — Go port

A faithful Go rewrite of the original Django `pg_intelligence` participatory-GIS
dashboard. It serves the Leaflet/Plotly dashboard, the GeoJSON/CSV/JSON APIs,
and the community indicator-selection form from a **single static binary** with
**zero external dependencies** — only the Go standard library.

The frontend (`static/app.js`, `static/app.css`) is reused unchanged from the
original app; only the backend (HTTP server, data layer, and the indicator /
category / district normalization logic) was ported to Go.

## Why Go

This was rebuilt as an [Exercism](https://exercism.org/tracks) learning
exercise. Go's standard library covers the whole app:

- `net/http` — server + routing (Go 1.22 method/pattern mux)
- `html/template` — dashboard + API-docs rendering
- `encoding/json`, `encoding/csv` — API responses and CSV import/export
- `compress/gzip` — response compression (replaces Django's GZipMiddleware)

## Architecture

```
main.go                     entry point: load CSVs, start server
internal/
  indicators/indicators.go  pure normalization logic (ported from views.py)
  store/store.go            in-memory locations + JSON-persisted selections
  server/                   routing, handlers, filtering, derived aggregations
templates/                  dashboard.html, api_docs.html, errors/{404,500}.html
static/                     app.css, app.js, lottie (reused from Django app)
data/                       preloaded CSVs + simplified ADM2 GeoJSON boundaries
```

**Data model.** Locations are read-only after import (~2,320 rows), so they are
held in memory and filtered in Go — this lets the port reuse the exact same
normalization functions the API and dashboard share. Community selections are
appended to `selections.json` so they survive restarts.

## Run

```bash
go run .
# or build a binary:
go build -o pgis.exe .
./pgis.exe
```

Open:
- http://127.0.0.1:8000/ — dashboard (map + filters + charts)
- http://127.0.0.1:8000/api/ — API documentation

### Configuration (flags or env vars)

| Flag          | Env               | Default           | Purpose                          |
|---------------|-------------------|-------------------|----------------------------------|
| `-addr`       | —                 | `:$PORT` or `:8000` | Listen address                 |
| —             | `PORT`            | `8000`            | Port (Railway sets this)         |
| `-selections` | `SELECTIONS_PATH` | `selections.json` | Where votes are persisted        |
| `-data`       | `DATA_DIR`        | `data`            | CSV + GeoJSON directory          |
| `-static`     | `STATIC_DIR`      | `static`          | Static assets directory          |
| `-templates`  | `TEMPLATES_DIR`   | `templates`       | HTML templates directory         |

## API Endpoints

Same surface and query parameters as the original app:

- `GET /api/locations.geojson` — points as a GeoJSON FeatureCollection
  - params: `country`, `district`, `indicator` (repeatable), `category`
    (repeatable), `severity` (1/3/5), `severity_min`, `severity_max`, `q`, `limit`
- `GET /api/locations.csv` — same data/filters as CSV
- `GET /api/districts.geojson` — ADM2 polygons with `is_matched` flag
- `GET /api/indicators` — counts per raw indicator value
- `GET /api/selections` — aggregated community votes (param `district`)
- `POST /selections/submit` — submit a selection (`indicator`, `district`, `rationale`)

## Parity with the Django app

The port was diff-tested against the original Django app across country /
district / severity / range / search / indicator / category filter combinations:
feature counts, the indicator-summary ranking, district `matched_count`, the
dashboard `Loaded locations` counts, and the top-indicator list ordering all
match exactly.

## Notes / differences from the Django version

- **No Django admin.** The `/admin/` site was not ported (it's a Django-specific
  feature). The public dashboard and APIs are fully reproduced.
- **No CSRF token** on the selection form (Django middleware specific). Add one
  if you expose writes publicly.
- **SQLite/Postgres** were replaced with an in-memory dataset + a JSON file for
  selections, since the dataset is small and read-only. To deploy with a shared
  database instead, swap the `store` package implementation.

## Deploy (Railway / any container)

`Procfile`:

```
web: ./pgis
```

Build the binary in your build step (`go build -o pgis .`) and ensure the
`data/`, `static/`, and `templates/` directories ship alongside it. The server
reads `PORT` from the environment automatically.
