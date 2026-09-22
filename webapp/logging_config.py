"""Centralized logging setup for the Nevet web app.

Writes to <CAMERA_BASE_DIR>/logs/webapp.log alongside the shell
scripts' logs (capture.log, watchdog.log), auto-rotating so it never
grows unbounded even without the OS-level logrotate config.
"""
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

BASE_DIR = Path(os.environ.get("CAMERA_BASE_DIR", str(Path.home() / "camera_captures")))
LOGS_DIR = BASE_DIR / "logs"


def setup_logging(app):
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(LOGS_DIR / "webapp.log", maxBytes=1_000_000, backupCount=3)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    handler.setLevel(logging.INFO)
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)
    return app.logger
