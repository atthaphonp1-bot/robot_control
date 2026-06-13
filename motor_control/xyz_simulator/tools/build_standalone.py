#!/usr/bin/env python3
"""
Build a single self-contained robot_control_standalone.html.

Inlines React, ReactDOM, the precompiled robot_control.js, and the fonts
(as base64) into one file that opens directly in a browser — no server, no
internet. This is a preview/share artifact; the server version (served by the
FastAPI app) is the one that reads live values from the database.

Usage (from anywhere):
    python3 motor_control/xyz_simulator/tools/build_standalone.py [OUTPUT_HTML]

Default output: <repo_root>/robot_control_standalone.html
"""
import base64
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"          # .../xyz_simulator/app
REPO_ROOT = Path(__file__).resolve().parents[3]            # repo root
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO_ROOT / "robot_control_standalone.html"

FONTS = [
    ("IBM Plex Sans", 400, "static/fonts/ibm-plex-sans-latin-400-normal.woff2"),
    ("IBM Plex Sans", 500, "static/fonts/ibm-plex-sans-latin-500-normal.woff2"),
    ("IBM Plex Sans", 600, "static/fonts/ibm-plex-sans-latin-600-normal.woff2"),
    ("IBM Plex Sans", 700, "static/fonts/ibm-plex-sans-latin-700-normal.woff2"),
    ("JetBrains Mono", 400, "static/fonts/jetbrains-mono-latin-400-normal.woff2"),
    ("JetBrains Mono", 500, "static/fonts/jetbrains-mono-latin-500-normal.woff2"),
    ("JetBrains Mono", 600, "static/fonts/jetbrains-mono-latin-600-normal.woff2"),
]


def main():
    tpl = (APP / "templates" / "index.html").read_text()

    face = [
        "@font-face{{font-family:'{0}';font-style:normal;font-weight:{1};"
        "font-display:swap;src:url(data:font/woff2;base64,{2}) format('woff2');}}".format(
            fam, w, base64.b64encode((APP / p).read_bytes()).decode()
        )
        for fam, w, p in FONTS
    ]
    font_style = "<style>\n" + "\n".join(face) + "\n</style>"

    react = (APP / "static/js/vendor/react.production.min.js").read_text()
    reactdom = (APP / "static/js/vendor/react-dom.production.min.js").read_text()
    appjs = (APP / "static/js/robot_control.js").read_text()

    replacements = [
        ('<!-- Self-hosted fonts (offline); see app/static/css/fonts.css -->\n'
         '<link href="/static/css/fonts.css" rel="stylesheet" />',
         '<!-- Fonts embedded as base64 (standalone, offline) -->\n' + font_style),
        ('<script src="/static/js/vendor/react.production.min.js"></script>',
         '<script>/* react.production.min.js */\n' + react + '\n</script>'),
        ('<script src="/static/js/vendor/react-dom.production.min.js"></script>',
         '<script>/* react-dom.production.min.js */\n' + reactdom + '\n</script>'),
        ('<script src="/static/js/robot_control.js"></script>',
         '<script>/* robot_control.js (precompiled from JSX) */\n' + appjs + '\n</script>'),
    ]
    for old, new in replacements:
        if old not in tpl:
            raise SystemExit("marker not found in template: %r" % old[:60])
        tpl = tpl.replace(old, new)

    leftover = re.findall(r'(?:src|href)\s*=\s*"(?:/static/|https?://)[^"]*"', tpl)
    if leftover:
        raise SystemExit("leftover external/static refs: %r" % leftover)

    OUT.write_text(tpl)
    print("Built %s (%.1f KB)" % (OUT, len(tpl.encode()) / 1024))


if __name__ == "__main__":
    main()
