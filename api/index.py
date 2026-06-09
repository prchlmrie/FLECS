"""
Vercel serverless entrypoint for the FLECS Flask API.
"""
import os
import sys

os.environ.setdefault('VERCEL', '1')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'backend'))

from app import app, bootstrap_database  # noqa: E402

bootstrap_database()
