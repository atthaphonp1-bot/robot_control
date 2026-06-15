from fastapi import FastAPI, HTTPException, Query 
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from fastapi.middleware.cors import CORSMiddleware
import socket 
from .db import DB
from pydantic import BaseModel
from fastapi.responses import FileResponse, HTMLResponse
import os
import sqlite3
import tempfile
import zipfile
import json 


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow your frontend origin
    allow_credentials=True,
    allow_methods=["*"],  # Allow all methods
    allow_headers=["*"],  # Allow all headers
)

# Mount the static files directory
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Set up the templates directory
templates = Jinja2Templates(directory="app/templates")


class MotorRequest(BaseModel):
    motor_axis_no: int


def get_local_ip():
    # This method connects to an external address (doesn't send data)
    # to figure out what local IP the OS would use
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))  # Google's DNS, doesn't actually send
        ip = s.getsockname()[0]
    finally:
        s.close()
    return ip

# -------------------- Manual Control Endpoints --------------------

# @app.get("/")
# async def read_root(request: Request):
#     return templates.TemplateResponse("index.html", {"request": request})

# @app.get("/move")
# async def mvoe(request: Request):
#     return templates.TemplateResponse("move4.html", {"request": request})

@app.get("/manual")
async def manual_control(request: Request):
    local_ip = get_local_ip()
    version = get_version()
    return templates.TemplateResponse("manual.html", {
        "request": request,
        "server_ip": local_ip,
        "version": version,
        "ems_version": get_environment_variable(variable="ems_version")
    })


@app.get("/zoom")
async def zoom_image(request: Request):
    return templates.TemplateResponse("image_zoom.html", {"request": request})


@app.get("/server-ip")
def get_server_ip():
    ip = get_local_ip()
    return {"server_ip": ip}


def get_version():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    version_path = os.path.join(base_dir, "env.json")

    with open(version_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        return data[0]["version"]
    

def get_environment_variable(variable):
    base_dir = os.path.dirname(os.path.abspath(__file__))
    version_path = os.path.join(base_dir, "env.json")

    with open(version_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        if variable == "ems_version":
            return data[0]["ems_version"]
        
        elif variable == "database_path": 
            return data[0]["database_path"]
        
        elif variable == "database": 
            return data[0]["database"]
        
        else:
            return None


def get_robot_static_db(db: DB):
    """
    Determine which robot_static database to use.

    Preference order:
      1. The active unit's 'robot_static_db' from ems_config.db (in database_path).
      2. Fallback to the hardcoded 'database' value in env.json.
    """
    resolved = db.get_active_robot_static_db()
    if resolved:
        return resolved
    return get_environment_variable(variable="database")


# UI axis letter <- motor table axis_no mapping (axis_no 0 = y_master, unused).
AXIS_LETTER_BY_AXIS_NO = {2: "X", 1: "Y", 3: "Z", 4: "G"}


def build_axes_context():
    """Read all motors from the resolved robot_static db and key them by UI letter."""
    database_path = get_environment_variable(variable="database_path")
    db = DB(db_path=database_path)
    database = get_robot_static_db(db)
    ret, rows, _msg = db.get_all_motors(database=database)
    axes = {}
    if ret:
        for row in rows:
            letter = AXIS_LETTER_BY_AXIS_NO.get(row.get("axis_no"))
            if letter:
                axes[letter] = row
    return axes


@app.get("/")
async def robot_control(request: Request):
    # The control page is a single-file React (JSX) app whose many `{{ }}` / `{ }`
    # braces collide with Jinja's delimiters, so inject the live axis data with a
    # plain string replacement instead. The template ships a valid empty default
    # (`window.SERVER_AXES = {};`) so it also works opened standalone.
    base_dir = os.path.dirname(os.path.abspath(__file__))
    template_path = os.path.join(base_dir, "templates", "index.html")
    with open(template_path, "r", encoding="utf-8") as f:
        html = f.read()
    axes_json = json.dumps(build_axes_context())
    html = html.replace(
        "window.SERVER_AXES = {};",
        "window.SERVER_AXES = " + axes_json + ";",
    )
    return HTMLResponse(html)


@app.post("/load-parameters")
def get_motor_parameters(request: MotorRequest):
    database_path = get_environment_variable(variable="database_path")
    db = DB(db_path=database_path)
    database = get_robot_static_db(db)

    motor_axis_no = request.motor_axis_no
    ret, dat, msg = db.get_motor_settings(motor_axis_no, database=database)
    return {
        "success": ret,
        "data": dat,
        "message": msg
    }


# -------------------- Database Download Endpoints --------------------

DB_DIR = "/root/xsos/db"  # folder where your .db files are stored

@app.get("/download-db")
async def download_db(filename: str):
    # Prevent directory traversal attacks like ../../etc/passwd
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(DB_DIR, safe_filename)

    if not file_path.endswith(".db"):
        raise HTTPException(status_code=400, detail="Only .db files are allowed")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Database file not found")

    return FileResponse(
        path=file_path,
        filename=safe_filename,
        media_type="application/octet-stream"
    )


@app.get("/download-db/safe")
async def download_db_safe(filename: str):
    # 1. Sanitize filename (avoid path traversal)
    safe_filename = os.path.basename(filename)

    # 2. Enforce .db extension
    if not safe_filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Only .db files are allowed")

    db_path = os.path.join(DB_DIR, safe_filename)
    if not os.path.exists(db_path):
        raise HTTPException(status_code=404, detail="Database file not found")

    # 3. Create a temporary backup copy
    #    This ensures consistent snapshot even if DB is being written to
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".db")
    os.close(tmp_fd)  # close file descriptor, sqlite will write to path

    try:
        source = sqlite3.connect(db_path)
        backup = sqlite3.connect(tmp_path)
        with backup:
            source.backup(backup)   # copy all contents
        backup.close()
        source.close()

        # 4. Return the backup copy as download
        return FileResponse(
            path=tmp_path,
            filename=f"{safe_filename.replace('.db', '')}_backup.db",
            media_type="application/octet-stream",
            background=None,  # We'll delete manually below
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")


@app.get("/downlolad-dbs/safe")
async def download_dbs(filenames: list[str] = Query(..., description="List database names")):
    # 1. Parse and sanitize filenames
    requested_files = [os.path.basename(f.strip()) for f in filenames]
    
    if not requested_files:
        raise HTTPException(status_code=400, detail="No database names provided")
    
    for f in requested_files:
        if not f.endswith(".db"):
            raise HTTPException(status_code=400, detail=f"Invalid database file: {f}")
    
    # 2. Verify all files exist
    db_paths = []
    for f in requested_files:
        path = os.path.join(DB_DIR, f)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail=f"Database not found: {f}")
        db_paths.append((f, path))
    
    # 3. Create a temporary zip file
    tmp_fd, tmp_zip_path = tempfile.mkstemp(suffix=".zip")
    os.close(tmp_fd)
    
    try:
        with zipfile.ZipFile(tmp_zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for name, path in db_paths:
                # Backup each database to a temporary file
                tmp_db_fd, tmp_db_path = tempfile.mkstemp(suffix=".db")
                os.close(tmp_db_fd)
                
                src = sqlite3.connect(path)
                backup = sqlite3.connect(tmp_db_path)
                with backup:
                    src.backup(backup)
                backup.close()
                src.close()
                
                # Add backup to zip
                zipf.write(tmp_db_path, arcname=name)
                
                # Remove temporary backup
                os.remove(tmp_db_path)
        
        # 4. Serve the zip file
        return FileResponse(
            path=tmp_zip_path,
            filename="databases_backup.zip",
            media_type="application/zip",
            background=None  # Optional: can add BackgroundTask to auto-delete zip after sending
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create zip: {e}")
