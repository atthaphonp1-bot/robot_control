import os
import sys

# The xyz_simulator app uses paths relative to its own directory
# (StaticFiles("app/static"), Jinja2Templates("app/templates"), env.json next
# to main.py) — matching how run.sh starts it
# (`cd motor_control/xyz_simulator && uvicorn app.main:app`). Mirror that here
# so `from app...` imports and relative paths resolve the same way in tests.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(REPO_ROOT, "motor_control", "xyz_simulator")

sys.path.insert(0, APP_DIR)
os.chdir(APP_DIR)
