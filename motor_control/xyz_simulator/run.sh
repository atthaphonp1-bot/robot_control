#!/bin/bash
set -e

ems_version=$(python3 - <<'EOF'
import json

try:
    with open("./app/env.json") as f:
        data = json.load(f)

    if isinstance(data, list) and data:
        print(data[0].get("ems_version", ""))
    else:
        print("")
except Exception:
    print("")
EOF
)

echo "Detected EMS version: $ems_version"

if [[ "$ems_version" == "4" ]]; then
  echo "Starting EMS v4 application..."

  (
    cd /root/py-lib-imx8
    source bin/activate
    cd /root/xsos/robot/motor_control/xyz_simulator
    uvicorn app.main:app --reload --host=0.0.0.0
  )

else
  echo "Starting EMS v5 application..."

  (
    cd /root/py-lib
    source bin/activate
    cd /root/one_software/ems/robot_control/motor_control/xyz_simulator
    uvicorn app.main:app --reload --host=0.0.0.0
  )
fi
