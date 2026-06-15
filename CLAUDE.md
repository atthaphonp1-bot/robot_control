# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this is

A gantry **Robot Control** web UI integrated into the existing **xyz_simulator**
FastAPI app for the CSOS gantry robot. The control page (served at `/`) shows a
3D view of the gantry, per-axis jog/move/param controls, a Sequence Move editor,
and a live telemetry log. **Robot movement is simulated** — there is no hardware
wiring yet — but per-axis values (stroke range, default speed/acc/step) are
loaded from a **real `robot_static` database**.

## Repo layout (mirrors the on-unit tree)

The repo root maps to the unit's `robot_control` directory, so it can be
`git pull`ed directly on a machine:

- EMS 5: `/root/one_software/ems/robot_control/`
- EMS 4: `/root/xsos/robot_control/`

```
robot_control/                     <- repo root == unit's robot_control/
├── motor_control/
│   └── xyz_simulator/             <- the ONLY folder we modify (sibling code untouched)
│       ├── app/
│       │   ├── main.py            <- FastAPI app + routes
│       │   ├── db.py              <- DB helpers (ems_config resolver, get_all_motors)
│       │   ├── env.json           <- per-unit config (database_path, database, ems_version)
│       │   ├── templates/
│       │   │   ├── index.html     <- the new control UI (HTML/CSS + inline AXIS PARAM store)
│       │   │   └── manual.html    <- pre-existing page (untouched)
│       │   └── static/
│       │       ├── js/
│       │       │   ├── robot_control.src.jsx  <- JSX SOURCE OF RECORD (edit this)
│       │       │   ├── robot_control.js       <- COMPILED output (generated; do not hand-edit)
│       │       │   └── vendor/                <- React 18.3.1 + ReactDOM (UMD, offline)
│       │       ├── css/fonts.css  <- @font-face for self-hosted woff2
│       │       └── fonts/         <- IBM Plex Sans + JetBrains Mono woff2
│       └── tools/
│           ├── build_frontend.mjs   <- compiles robot_control.src.jsx -> robot_control.js
│           ├── babel.standalone.js  <- bundled Babel (build-time only, never served)
│           └── build_standalone.py  <- inlines everything -> robot_control_standalone.html
├── db/                            <- SAMPLE DBs for local runs only
│   ├── ems_config.db
│   └── csos_alpha_robot_static.db
├── deploy.sh                      <- safe in-place swap of ONLY xyz_simulator on a unit
├── requirements.txt
└── robot_control_standalone.html  <- generated artifact (gitignored)
```

The development branch for this work is **`claude/inspiring-cray-SNZ0p`** (PR #1).

## How the page gets its data (DB resolution)

1. `app/env.json` gives `database_path` (a directory).
2. `db.get_active_robot_static_db()` opens `<database_path>/ems_config.db`, finds
   the active unit (`config_name.active = 1`), and returns its `robot_static_db`
   value from `config_data`.
3. If `ems_config.db` is missing or the lookup fails, fall back to the `database`
   value in `env.json`.
4. `db.get_all_motors()` reads the resolved DB's `motor` table.
5. `main.py` maps rows to UI letters by `axis_no`:
   **2→X (Bridge), 1→Y (Long rail), 3→Z (Vertical), 4→G (Gripper)**, and injects
   them into the page as `window.SERVER_AXES` (used to seed stroke range, speed,
   acc, step, etc.). Empty object → the hardcoded defaults in the JSX apply.

Stroke maxes (from the sample DB): X 116000, Y 50000, Z 26000, G 7000.

### Why `/` doesn't use Jinja2

The JSX uses `{}` / `{{}}` which collide with Jinja delimiters, and the newer
Starlette in some envs broke `TemplateResponse`. So `GET /` does a plain file
read + string `.replace()` of the `window.SERVER_AXES = {};` placeholder. Don't
"fix" this by switching back to Jinja.

## Position model (important UX detail)

The real controller does **not** push position in real time, so the UI mirrors
that: the **displayed** position (`pos` state, the 3D view, meters, readouts)
only updates when explicitly read.

- `simPosRef` — the robot's actual simulated position, animates toward `tgt` in
  the background (jog / move / home / sequence drive `tgt`).
- `pos` — last *read* position shown in the UI. Updated **only** by:
  - the per-axis **⟲ Get Pos** button (`getPosition(axis)`),
  - the **⟲ Get All** button in the jog topbar (`getAllPositions()`),
  - a direct drag on the 3D view,
  - automatically, once a commanded move finishes (see below).
- `lastRead` — per-axis timestamp shown as "read HH:MM:SS" / "not read".
- E-STOP, Hold, and sequence-stop call `holdHere()`, which freezes `tgt` at the
  actual `simPosRef` position (not the possibly-stale `pos`).

When editing movement logic, keep this separation: commands move `tgt`/`simPosRef`
in real time; they must NOT write `pos` *during* the move (that would
re-introduce fake live telemetry — the meter/3D view must stay static while
`axisStatus` is `'moving'`). Once the move completes (`moving` flips back to
`false`), the effect at the `moving` watcher calls `getPosition(a)` for each
axis that was actually commanded (`movedAxesRef.current`) — equivalent to the
user pressing that axis's **⟲ Get Pos** button. This mirrors a real operator
checking where the robot ended up after a move, without showing a live-updating
position while it's still moving.

## Editing the UI — ALWAYS rebuild

`robot_control.src.jsx` is the source of record. `robot_control.js` is compiled
and committed (the browser loads only plain JS — no in-browser Babel, fully
offline). After any JSX or template change:

```bash
cd motor_control/xyz_simulator
node tools/build_frontend.mjs          # regenerate app/static/js/robot_control.js
python3 tools/build_standalone.py      # regenerate the standalone preview (gitignored)
```

Commit `robot_control.src.jsx` AND the regenerated `robot_control.js` together.

## Run locally

```bash
pip install -r requirements.txt
# point app/env.json "database_path" at the repo's absolute db/ path first
cd motor_control/xyz_simulator
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # open http://localhost:8000/
```

Standalone preview (no server, no internet):
```bash
python3 motor_control/xyz_simulator/tools/build_standalone.py
open robot_control_standalone.html      # macOS
```

## Deploy to a unit

`deploy.sh` swaps **only** `motor_control/xyz_simulator` — never sibling code. It
backs up the existing folder, preserves the unit's `app/env.json` (keeps the repo
default as `app/env.json.repo`), and restarts the `motor_movement_web` service.
Auto-detects EMS 5 then EMS 4; override with `TARGET_DIR=` / `SERVICE=`.

```bash
git clone -b claude/inspiring-cray-SNZ0p https://github.com/atthaphonp1-bot/robot_control.git /tmp/rc_new
sudo bash /tmp/rc_new/deploy.sh
```

## Constraints / gotchas

- **Offline at runtime.** No CDNs. Everything (React, fonts, compiled JS) is
  vendored under `app/static/`. Keep it that way.
- Only touch `motor_control/xyz_simulator`. Don't modify sibling `motor_control/`
  code or the `/manual` page.
- The `db/` DBs are samples for local dev only; real DBs live in the unit's
  `env.json` `database_path` (e.g. `/root/one_software/common/db/`).
- `db.py.query_db` has a known single-row bug — use `get_all_motors()` instead.

## Verifying a frontend change without a browser

A jsdom render check (used during development) loads React + the inline AXIS
PARAM store + `robot_control.js` and asserts the app mounts. If you reach for
this, extract the inline store script (the `AXIS PARAMETER STORE` block in
`templates/index.html`) to a file and load it before `robot_control.js`, and
give JSDOM `url: 'http://localhost/'` (needed for localStorage) plus
`requestAnimationFrame`/`matchMedia` shims.
