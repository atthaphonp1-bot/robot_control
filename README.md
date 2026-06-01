# robot_control

New gantry **Robot Control** UI integrated into the **xyz_simulator** FastAPI app.

The control page (served at `/`) loads its per-axis values (stroke range, default
speed/acc/step, etc.) from the real `motor` table of a `robot_static` database.
Which database is used is resolved dynamically from **`ems_config.db`**: the active
unit (`config_name.active = 1`) → its `robot_static_db` value in `config_data`.
If `ems_config.db` is missing or the lookup fails, it falls back to the `database`
value in `app/env.json`.

Robot movement on the page is still **simulated** (no hardware wiring).

The repo layout mirrors the on-unit tree: `motor_control/xyz_simulator` matches
`/root/one_software/ems/robot_control/motor_control/xyz_simulator` (EMS 5) /
`/root/xsos/robot_control/motor_control/xyz_simulator` (EMS 4), so the repo root maps
to the unit's `robot_control` directory and can be `git pull`ed directly.

## Layout
- `motor_control/xyz_simulator/app/main.py` — FastAPI app. Routes: `GET /` (new
  control UI), `GET /manual`, `POST /load-parameters`, download endpoints.
- `motor_control/xyz_simulator/app/db.py` — `get_active_robot_static_db()`
  (ems_config resolver) and `get_all_motors()`.
- `motor_control/xyz_simulator/app/templates/index.html` — the new control UI. The
  backend injects `window.SERVER_AXES` (the motor rows keyed by X/Y/Z/G) which seeds
  the axis params.
- `db/` — sample databases for local runs only: `ems_config.db` and
  `csos_alpha_robot_static.db` (the active unit's `robot_static_db`). On the unit the
  real DBs live in `env.json`'s `database_path` (e.g. `/root/one_software/common/db/`).

## Run locally
```bash
pip install -r requirements.txt

# Point env.json at the bundled sample DBs (absolute path):
#   "database_path": "<repo>/db/"
# The active config in db/ems_config.db -> csos_alpha_robot_static.db (present).

cd motor_control/xyz_simulator
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Then open <http://localhost:8000/>. The axis cards / 3D view reflect the DB
(`X` stroke_max 116000, `Y` 50000, `Z` 26000, `G` 7000).

In production the EMS service uses `run.sh`, which picks the right interpreter and
working directory based on `app/env.json`'s `ems_version`.

## Offline operation

The unit has **no internet at runtime**, so the control page has zero external
dependencies — everything is self-hosted under `motor_control/xyz_simulator/app/static/`:

- **React / ReactDOM** — `static/js/vendor/*.production.min.js` (React 18.3.1).
- **No in-browser Babel.** The JSX is **precompiled** at build time into
  `static/js/robot_control.js`. The browser loads plain JS only.
- **Fonts** — self-hosted woff2 in `static/fonts/` + `static/css/fonts.css`
  (IBM Plex Sans 400/500/600/700, JetBrains Mono 400/500/600).

### Editing the UI (during maintenance)

The JSX source of record is `static/js/robot_control.src.jsx`. After editing it,
rebuild the compiled bundle (fully offline — uses the bundled Babel in `tools/`):

```bash
cd motor_control/xyz_simulator
node tools/build_frontend.mjs   # regenerates app/static/js/robot_control.js
```

`tools/babel.standalone.js` is used only by this build step and is never served to
the browser.
