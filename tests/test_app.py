import os

from app.db import DB
from app.main import (
    AXIS_LETTER_BY_AXIS_NO,
    build_axes_context,
    get_environment_variable,
)

# The repo's sample DBs (for local dev only, per CLAUDE.md), independent of
# whatever `database_path` is configured in app/env.json on this machine/CI.
SAMPLE_DB_DIR = os.path.abspath(os.path.join("..", "..", "db"))


def test_axis_letter_mapping():
    assert AXIS_LETTER_BY_AXIS_NO == {2: "X", 1: "Y", 3: "Z", 4: "G"}


def test_get_environment_variable_reads_env_json():
    assert get_environment_variable(variable="ems_version") == "5"
    assert get_environment_variable(variable="database") == "csos_alpha_robot_static.db"
    assert get_environment_variable(variable="unknown_key") is None


def test_get_all_motors_returns_every_axis():
    db = DB(db_path=SAMPLE_DB_DIR)
    ret, rows, _msg = db.get_all_motors(database="csos_alpha_robot_static.db")
    assert ret is True
    assert {row["axis_no"] for row in rows} == {0, 1, 2, 3, 4}


def test_get_active_robot_static_db_resolves_active_unit():
    db = DB(db_path=SAMPLE_DB_DIR)
    assert db.get_active_robot_static_db() == "csos_alpha_robot_static.db"


def test_get_active_robot_static_db_missing_config_returns_none():
    db = DB(db_path=SAMPLE_DB_DIR)
    assert db.get_active_robot_static_db(ems_config_filename="does_not_exist.db") is None


def test_build_axes_context_keys_are_known_axis_letters():
    axes = build_axes_context()
    assert set(axes.keys()) <= set(AXIS_LETTER_BY_AXIS_NO.values())
