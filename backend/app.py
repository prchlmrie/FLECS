"""
FLECS Backend API Server
Flask REST API for the FLECS Decision Support System
Roles: administrator | owner | supplier
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta, date, time
import random
from dotenv import load_dotenv
import sqlite3
import json
import os
import math
import time
from functools import wraps
from collections import Counter
import pandas as pd
import numpy as np
from io import BytesIO
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import csv
import urllib.request
import urllib.error

_backend_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_backend_dir, '.env'))

app = Flask(__name__)
app.config['JWT_SECRET_KEY'] = os.environ.get(
    'JWT_SECRET_KEY', 'your-secret-key-change-in-production'
)
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=8)
CORS(app)
jwt = JWTManager(app)

DATABASE = os.path.join(_backend_dir, 'flecs.db')

from forecasting import (
    FORECAST_HISTORY_DAYS,
    SES_ALPHA,
    HOLDOUT_DAYS,
    RF_N_LAGS,
    RF_N_ESTIMATORS,
    HW_SEASONAL_PERIOD,
    WINNER_BASIS,
    FORECAST_STATUS_LABELS,
    build_product_forecasts,
    load_daily_sales_bulk,
)

VALID_ROLES = ('administrator', 'owner', 'supplier')

# OpenRouter free models — ids from https://openrouter.ai/api/v1/models (:free)
OPENROUTER_MODEL_ALIASES = {
    'llama': 'meta-llama/llama-3.3-70b-instruct:free',
    'gemma': 'google/gemma-4-31b-it:free',
    'deepseek': 'deepseek/deepseek-v4-flash:free',
    'qwen': 'qwen/qwen3-next-80b-a3b-instruct:free',
    'auto': 'openrouter/free',
}
OPENROUTER_DEFAULT_MODEL = OPENROUTER_MODEL_ALIASES['auto']
OPENROUTER_FALLBACK_MODELS = [
    OPENROUTER_MODEL_ALIASES['qwen'],
    OPENROUTER_MODEL_ALIASES['gemma'],
    OPENROUTER_MODEL_ALIASES['deepseek'],
    OPENROUTER_MODEL_ALIASES['llama'],
]


class OpenRouterError(Exception):
    def __init__(self, status_code, message, retry_after=None):
        self.status_code = status_code
        self.retry_after = retry_after
        super().__init__(message)


def _resolve_openrouter_model(name):
    if not name or not str(name).strip():
        return OPENROUTER_DEFAULT_MODEL
    key = str(name).strip().lower()
    return OPENROUTER_MODEL_ALIASES.get(key, str(name).strip())


def _openrouter_models_to_try():
    primary = _resolve_openrouter_model(
        os.environ.get('OPENROUTER_MODEL', 'auto')
    )
    env_fallbacks = os.environ.get('OPENROUTER_MODEL_FALLBACKS', '')
    if env_fallbacks.strip():
        fallbacks = [
            _resolve_openrouter_model(m)
            for m in env_fallbacks.split(',')
            if m.strip()
        ]
    else:
        fallbacks = list(OPENROUTER_FALLBACK_MODELS)
    seen = set()
    ordered = []
    for model_id in [primary, *fallbacks]:
        if model_id not in seen:
            seen.add(model_id)
            ordered.append(model_id)
    return ordered


def _openrouter_chat(messages, model_id):
    api_key = os.environ.get('OPENROUTER_API_KEY')
    if not api_key:
        raise RuntimeError('OPENROUTER_API_KEY is not configured')

    body = json.dumps({
        'model': model_id,
        'messages': messages,
    }).encode('utf-8')
    req = urllib.request.Request(
        os.environ.get(
            'OPENROUTER_API_URL',
            'https://openrouter.ai/api/v1/chat/completions',
        ),
        data=body,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'HTTP-Referer': os.environ.get('OPENROUTER_HTTP_REFERER', 'http://localhost:3000'),
            'X-Title': os.environ.get('OPENROUTER_APP_TITLE', 'FLECS'),
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors='replace')
        retry_after = None
        try:
            payload = json.loads(detail)
            meta = (payload.get('error') or {}).get('metadata') or {}
            retry_after = meta.get('retry_after_seconds')
        except json.JSONDecodeError:
            pass
        raise OpenRouterError(exc.code, detail, retry_after) from exc

    choices = data.get('choices') or []
    if not choices:
        raise RuntimeError('OpenRouter returned no choices')
    content = (choices[0].get('message') or {}).get('content') or ''
    return content.strip()


def _inventory_summary_for_chat(db):
    """Compact inventory snapshot for the conversational assistant."""
    rows = db.execute('''
        SELECT p.name, p.sku, p.stock_level, p.reorder_point, p.lead_time_days,
               c.category_name, s.supplier_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
        WHERE COALESCE(p.is_archived, 0) = 0
        ORDER BY p.stock_level ASC, p.name
        LIMIT 80
    ''').fetchall()
    lines = []
    for r in rows:
        status = 'LOW' if r['stock_level'] <= r['reorder_point'] else 'OK'
        lines.append(
            f"- {r['name']} (SKU {r['sku']}): stock={r['stock_level']}, "
            f"reorder_point={r['reorder_point']}, lead_days={r['lead_time_days']}, "
            f"status={status}, category={r['category_name'] or 'N/A'}, "
            f"supplier={r['supplier_name'] or 'N/A'}"
        )
    low_count = sum(1 for r in rows if r['stock_level'] <= r['reorder_point'])
    header = f"Total products listed: {len(rows)}. Low-stock items in list: {low_count}."
    return header + "\n" + "\n".join(lines)


# ─────────────────────────────────────────────
# Database helpers
# ─────────────────────────────────────────────
def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def ensure_products_archive_column():
    db = get_db()
    try:
        cols = [r[1] for r in db.execute("PRAGMA table_info(products)").fetchall()]
        if "is_archived" not in cols:
            db.execute("ALTER TABLE products ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0")
            db.commit()
    finally:
        db.close()


def ensure_supplier_id_on_users():
    """Add supplier_id FK column to users (for supplier role accounts)."""
    db = get_db()
    try:
        cols = [r[1] for r in db.execute("PRAGMA table_info(users)").fetchall()]
        if "supplier_id" not in cols:
            db.execute("ALTER TABLE users ADD COLUMN supplier_id INTEGER REFERENCES suppliers(supplier_id)")
            db.commit()
    finally:
        db.close()


def ensure_default_suppliers():
    db = get_db()
    try:
        n = db.execute("SELECT COUNT(*) AS c FROM suppliers").fetchone()["c"]
        if n == 0:
            for name in ("General Supplier", "Local Distributor"):
                db.execute("INSERT INTO suppliers (supplier_name) VALUES (?)", (name,))
            db.commit()
    finally:
        db.close()


def migrate_users_role_constraint():
    """
    SQLite cannot ALTER or DROP a CHECK constraint.
    This rebuilds the users table if it still has the old clerk constraint.
    Safe to run on every startup - skips automatically if already migrated.
    """
    db = get_db()
    try:
        row = db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'"
        ).fetchone()
        if not row:
            return
        schema = row['sql'] or ''
        if "'clerk'" not in schema and '"clerk"' not in schema:
            return  # already migrated, nothing to do

        db.execute("PRAGMA foreign_keys = OFF")
        db.execute("""
            CREATE TABLE IF NOT EXISTS _users_new (
                user_id       INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role          TEXT NOT NULL
                                  CHECK(role IN ('administrator', 'owner', 'supplier')),
                supplier_id   INTEGER REFERENCES suppliers(supplier_id),
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.execute("""
            INSERT INTO _users_new (user_id, username, password_hash, role, created_at)
            SELECT user_id, username, password_hash,
                   CASE WHEN role = 'clerk' THEN 'owner' ELSE role END,
                   created_at
            FROM users
        """)
        db.execute("DROP TABLE users")
        db.execute("ALTER TABLE _users_new RENAME TO users")
        db.execute("PRAGMA foreign_keys = ON")
        db.commit()
        print('[FLECS] Migrated users table: CHECK constraint now includes owner + supplier.')
    except Exception as exc:
        db.rollback()
        print(f'[FLECS] role-constraint migration warning: {exc}')
    finally:
        db.close()


def ensure_default_accounts():
    """
    Create default admin and owner accounts if missing.
    Runs every startup so existing databases are updated too.
    """
    db = get_db()
    try:
        if not db.execute("SELECT 1 FROM users WHERE username = 'admin'").fetchone():
            db.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                ('admin', generate_password_hash('admin123'), 'administrator')
            )
        if not db.execute("SELECT 1 FROM users WHERE username = 'owner'").fetchone():
            db.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                ('owner', generate_password_hash('owner123'), 'owner')
            )
        db.commit()
    finally:
        db.close()


# name, sku, barcode, category_name, cost, sell, stock, reorder_point, lead_days
DEMO_PRODUCT_ROWS = [
    ("Coca-Cola 1.5L", "DEMO-BEV-COKE-15", "4801234567890", "Beverages", 45.00, 55.00, 48, 12, 7),
    ("Sprite 1.5L", "DEMO-BEV-SPRITE-15", "4801234567891", "Beverages", 44.00, 54.00, 8, 12, 7),
    ("Mineral Water 500ml", "DEMO-BEV-WATER-05", "4801234567892", "Beverages", 8.00, 12.00, 120, 24, 5),
    ("Lay's Classic 150g", "DEMO-SNACK-LAYS-150", "4801234567893", "Snacks", 35.00, 49.00, 5, 8, 10),
    ("Instant Noodles Chicken", "DEMO-SNACK-NOODLE-CK", "4801234567894", "Snacks", 12.00, 18.00, 0, 10, 14),
    ("Corned Beef 150g", "DEMO-CAN-CB-150", "4801234567895", "Canned Goods", 55.00, 72.00, 30, 15, 14),
    ("Evaporated Milk 370ml", "DEMO-DAIRY-EVAP-370", "4801234567896", "Dairy", 42.00, 56.00, 22, 10, 7),
    ("Fresh Milk 1L", "DEMO-DAIRY-MILK-1L", "4801234567897", "Dairy", 65.00, 85.00, 15, 12, 5),
    ("Frozen French Fries 1kg", "DEMO-FRZ-FRIES-1", "4801234567898", "Frozen", 120.00, 165.00, 12, 6, 21),
    ("Paper Towels 2-Pack", "DEMO-OTH-TOWEL-2", "4801234567899", "Other", 25.00, 39.00, 40, 10, 10),
    ("Energy Drink 250ml", "DEMO-BEV-ENERGY-25", "4801234567900", "Beverages", 28.00, 38.00, 3, 12, 7),
]

DEMO_STOCK_BY_SKU = {row[1]: row[6] for row in DEMO_PRODUCT_ROWS}


def ensure_sample_products():
    db = get_db()
    try:
        sup = db.execute("SELECT supplier_id FROM suppliers ORDER BY supplier_id LIMIT 1").fetchone()
        if not sup:
            return
        supplier_id = sup["supplier_id"]

        def category_id(category_name):
            row = db.execute(
                "SELECT category_id FROM categories WHERE category_name = ?", (category_name,)
            ).fetchone()
            return row["category_id"] if row else None

        insert_sql = """
            INSERT OR IGNORE INTO products (
                name, sku, barcode, category_id, supplier_id,
                cost_price, selling_price, stock_level, reorder_point, lead_time_days
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        for row in DEMO_PRODUCT_ROWS:
            name, sku, barcode, cat_name, cost, sell, stock, reorder, lead = row
            cid = category_id(cat_name)
            if cid is None:
                continue
            db.execute(insert_sql, (name, sku, barcode, cid, supplier_id, cost, sell, stock, reorder, lead))
        db.commit()
    finally:
        db.close()


DEMO_SALES_HISTORY_DAYS = int(os.environ.get('FLECS_DEMO_SALES_DAYS', '95'))
DEMO_SALES_RANDOM_SEED = int(os.environ.get('FLECS_DEMO_SALES_SEED', '42'))
DEMO_SALES_MIN_LINES_TO_SKIP = int(os.environ.get('FLECS_DEMO_SALES_MIN_LINES_TO_SKIP', '300'))
DEMO_SALES_MAX_TXNS_TO_REBUILD = int(os.environ.get('FLECS_DEMO_SALES_MAX_TXNS_TO_REBUILD', '12'))


def _reset_stocks_for_demo_sales(db):
    for sku, stock in DEMO_STOCK_BY_SKU.items():
        db.execute("UPDATE products SET stock_level = ? WHERE sku = ?", (stock, sku))
    db.execute("""
        UPDATE products
        SET stock_level = MAX(stock_level, COALESCE(reorder_point, 10) * 4)
        WHERE sku NOT LIKE 'DEMO-%'
    """)


def ensure_sample_transactions():
    db = get_db()
    try:
        force = os.environ.get("FLECS_FORCE_DEMO_RELOAD", "").lower() in ("1", "true", "yes")
        line_count = db.execute("SELECT COUNT(*) AS c FROM transaction_items").fetchone()["c"]
        txn_count = db.execute("SELECT COUNT(*) AS c FROM transactions WHERE status = 'completed'").fetchone()["c"]

        if line_count >= DEMO_SALES_MIN_LINES_TO_SKIP and not force:
            return
        if txn_count > DEMO_SALES_MAX_TXNS_TO_REBUILD and line_count > 0 and not force:
            return
        if line_count > 0:
            db.execute("DELETE FROM transaction_items")
            db.execute("DELETE FROM transactions")
            _reset_stocks_for_demo_sales(db)

        user = db.execute("SELECT user_id FROM users WHERE username = 'admin'").fetchone()
        if not user:
            return

        rows = db.execute("""
            SELECT product_id, sku, selling_price, cost_price, stock_level
            FROM products ORDER BY product_id
        """).fetchall()
        if not rows:
            return

        products = [dict(r) for r in rows]
        remaining = {int(p["product_id"]): int(p["stock_level"]) for p in products}
        rng = random.Random(DEMO_SALES_RANDOM_SEED)
        uid = int(user["user_id"])
        days = max(30, DEMO_SALES_HISTORY_DAYS)

        for day_back in range(days - 1, -1, -1):
            sale_date = date.today() - timedelta(days=day_back)
            base_dt = datetime.combine(sale_date, time(9, 0))
            weekend = sale_date.weekday() >= 5
            num_tx = rng.randint(2, 5) if weekend else rng.randint(1, 4)

            for tix in range(num_tx):
                candidates = [p for p in products if remaining[int(p["product_id"])] > 0]
                if not candidates:
                    break
                rng.shuffle(candidates)
                n_lines = rng.randint(1, min(5, len(candidates)))
                lines = []
                for p in candidates[:n_lines]:
                    pid = int(p["product_id"])
                    cap = min(remaining[pid], rng.randint(1, 5))
                    if cap <= 0:
                        continue
                    lines.append((p, cap))
                if not lines:
                    continue

                total_amount = round(sum(float(p["selling_price"]) * q for p, q in lines), 2)
                ts = base_dt + timedelta(minutes=tix * 12 + rng.randint(0, 45), seconds=rng.randint(0, 59))

                cur = db.execute(
                    "INSERT INTO transactions (total_amount, user_id, status, transaction_date) VALUES (?, ?, 'completed', ?)",
                    (total_amount, uid, ts.strftime('%Y-%m-%d %H:%M:%S')),
                )
                tid = cur.lastrowid
                for p, q in lines:
                    pid = int(p["product_id"])
                    unit = float(p["selling_price"])
                    subtotal = round(q * unit, 2)
                    db.execute(
                        "INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)",
                        (tid, pid, q, unit, subtotal),
                    )
                    remaining[pid] -= q

        for pid, level in remaining.items():
            db.execute("UPDATE products SET stock_level = ? WHERE product_id = ?", (max(0, level), pid))
        db.commit()
    finally:
        db.close()


def ensure_stock_requests_table():
    """Create stock_requests table if it does not exist (for existing databases)."""
    db = get_db()
    try:
        db.execute('''
            CREATE TABLE IF NOT EXISTS stock_requests (
                request_id         INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id         INTEGER NOT NULL,
                supplier_id        INTEGER NOT NULL,
                requested_quantity INTEGER NOT NULL,
                status             TEXT DEFAULT 'pending'
                                       CHECK(status IN ('pending','acknowledged','fulfilled','cancelled')),
                notes              TEXT,
                requested_by       INTEGER NOT NULL,
                requested_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (product_id)   REFERENCES products(product_id),
                FOREIGN KEY (supplier_id)  REFERENCES suppliers(supplier_id),
                FOREIGN KEY (requested_by) REFERENCES users(user_id)
            )
        ''')
        db.commit()
    finally:
        db.close()



def ensure_stores_table():
    """Create stores table and seed two default stores."""
    db = get_db()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS stores (
                store_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                store_name TEXT NOT NULL,
                address    TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        if db.execute("SELECT COUNT(*) AS c FROM stores").fetchone()["c"] == 0:
            db.execute("INSERT INTO stores (store_name) VALUES ('Store 1')")
            db.execute("INSERT INTO stores (store_name) VALUES ('Store 2')")
        db.commit()
    finally:
        db.close()


def ensure_store_id_on_users():
    db = get_db()
    try:
        cols = [r[1] for r in db.execute("PRAGMA table_info(users)").fetchall()]
        if "store_id" not in cols:
            db.execute("ALTER TABLE users ADD COLUMN store_id INTEGER REFERENCES stores(store_id)")
            db.commit()
    finally:
        db.close()


def ensure_store_id_on_products():
    db = get_db()
    try:
        cols = [r[1] for r in db.execute("PRAGMA table_info(products)").fetchall()]
        if "store_id" not in cols:
            db.execute("ALTER TABLE products ADD COLUMN store_id INTEGER REFERENCES stores(store_id)")
            # Assign all existing products to Store 1
            db.execute("UPDATE products SET store_id = 1 WHERE store_id IS NULL")
            db.commit()
    finally:
        db.close()


def ensure_notifications_table():
    db = get_db()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         INTEGER NOT NULL,
                type            TEXT NOT NULL,
                title           TEXT NOT NULL,
                body            TEXT,
                is_read         INTEGER DEFAULT 0,
                reference_id    INTEGER,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(user_id)
            )
        """)
        db.commit()
    finally:
        db.close()


def ensure_messages_table():
    db = get_db()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id    INTEGER NOT NULL,
                recipient_id INTEGER NOT NULL,
                content      TEXT NOT NULL,
                is_read      INTEGER DEFAULT 0,
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sender_id)    REFERENCES users(user_id),
                FOREIGN KEY (recipient_id) REFERENCES users(user_id)
            )
        """)
        db.commit()
    finally:
        db.close()


def ensure_store_defaults():
    """Link owner→Store1, owner2→Store2, seed store2 sample products."""
    db = get_db()
    try:
        store1 = db.execute("SELECT store_id FROM stores WHERE store_name='Store 1'").fetchone()
        store2 = db.execute("SELECT store_id FROM stores WHERE store_name='Store 2'").fetchone()
        if not store1 or not store2:
            return
        s1, s2 = store1["store_id"], store2["store_id"]

        # Link owners to stores
        db.execute("UPDATE users SET store_id=? WHERE username='owner' AND (store_id IS NULL)", (s1,))
        db.execute("UPDATE users SET store_id=? WHERE username='owner2' AND (store_id IS NULL)", (s2,))

        # Assign unassigned products to Store 1
        db.execute("UPDATE products SET store_id=? WHERE store_id IS NULL", (s1,))

        # Seed a few different sample products for Store 2 if none exist
        if db.execute("SELECT COUNT(*) AS c FROM products WHERE store_id=?", (s2,)).fetchone()["c"] == 0:
            sup = db.execute("SELECT supplier_id FROM suppliers ORDER BY supplier_id LIMIT 1").fetchone()
            sup_id = sup["supplier_id"] if sup else None
            def cid(name):
                r = db.execute("SELECT category_id FROM categories WHERE category_name=?", (name,)).fetchone()
                return r["category_id"] if r else None
            store2_products = [
                ("Lucky Me Pancit Canton", "S2-NOODLE-PM", None, cid("Snacks"), sup_id, 10.0, 15.0, 5, 10, 7),
                ("Bear Brand Milk 300ml", "S2-MILK-BB",   None, cid("Dairy"),  sup_id, 42.0, 58.0, 3, 8,  5),
                ("Kopiko 78C 240ml",      "S2-BEV-KOP",   None, cid("Beverages"), sup_id, 28.0, 38.0, 12, 10, 7),
                ("Magic Sarap 8g",        "S2-SPICE-MS",  None, cid("Other"),  sup_id, 5.0,  8.0,  20, 15, 10),
                ("Skyflakes 33g",         "S2-SNACK-SKY", None, cid("Snacks"), sup_id, 7.0,  12.0, 8,  10, 7),
            ]
            for row in store2_products:
                name,sku,barcode,cat_id,sid,cost,sell,stock,reorder,lead = row
                if cat_id is None:
                    continue
                db.execute("""
                    INSERT OR IGNORE INTO products
                        (name,sku,barcode,category_id,supplier_id,cost_price,
                         selling_price,stock_level,reorder_point,lead_time_days,store_id)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """, (name,sku,barcode,cat_id,sid,cost,sell,stock,reorder,lead,s2))
        db.commit()
    finally:
        db.close()


def ensure_store_id_on_transactions():
    db = get_db()
    try:
        cols = [r[1] for r in db.execute("PRAGMA table_info(transactions)").fetchall()]
        if "store_id" not in cols:
            db.execute("ALTER TABLE transactions ADD COLUMN store_id INTEGER REFERENCES stores(store_id)")
            # tag existing transactions with store 1
            db.execute("UPDATE transactions SET store_id = 1 WHERE store_id IS NULL")
            db.commit()
    finally:
        db.close()


def create_notification(user_id, notif_type, title, body, reference_id=None):
    """Helper to insert a notification row."""
    db = get_db()
    try:
        db.execute("""
            INSERT INTO notifications (user_id, type, title, body, reference_id)
            VALUES (?, ?, ?, ?, ?)
        """, (user_id, notif_type, title, body, reference_id))
        db.commit()
    finally:
        db.close()


@app.before_request
def _run_reference_seeds_once():
    if app.config.get("_reference_seeded"):
        return
    migrate_users_role_constraint()
    ensure_products_archive_column()
    ensure_supplier_id_on_users()
    ensure_default_suppliers()
    ensure_default_accounts()
    ensure_stock_requests_table()
    ensure_stores_table()
    ensure_store_id_on_users()
    ensure_store_id_on_products()
    ensure_notifications_table()
    ensure_messages_table()
    ensure_store_id_on_transactions()
    ensure_sample_products()
    ensure_sample_transactions()
    ensure_store_defaults()
    app.config["_reference_seeded"] = True


# ─────────────────────────────────────────────
# Role / permission helpers
# ─────────────────────────────────────────────
def role_required(*roles):
    """Decorator: allow access only to the listed roles."""
    def wrapper(fn):
        @wraps(fn)
        @jwt_required()
        def decorator(*args, **kwargs):
            current_user = get_jwt_identity()
            db = get_db()
            user = db.execute("SELECT role FROM users WHERE username = ?", (current_user,)).fetchone()
            db.close()
            if not user or user['role'] not in roles:
                return jsonify({'error': 'Insufficient permissions'}), 403
            return fn(*args, **kwargs)
        return decorator
    return wrapper


def parse_product_body(data, existing=None):
    if not data:
        raise ValueError("Request body is required")

    def pick(key, default=None):
        if key in data and data[key] is not None and data[key] != "":
            return data[key]
        if existing is not None and key in existing.keys():
            return existing[key]
        return default

    name = pick("name")
    sku = pick("sku")
    if name is None or not str(name).strip():
        raise ValueError("Product name is required")
    if sku is None or not str(sku).strip():
        raise ValueError("SKU is required")
    name = str(name).strip()
    sku = str(sku).strip()

    if "barcode" in data:
        br = data.get("barcode")
        barcode = None if br is None or str(br).strip() == "" else str(br).strip()
    elif existing is not None:
        barcode = existing["barcode"]
    else:
        barcode = None

    cat_raw = pick("category_id")
    sup_raw = pick("supplier_id")
    if cat_raw is None or cat_raw == "":
        raise ValueError("Category is required")
    if sup_raw is None or sup_raw == "":
        raise ValueError("Supplier is required")
    try:
        category_id = int(cat_raw)
        supplier_id = int(sup_raw)
    except (TypeError, ValueError):
        raise ValueError("Category and supplier must be valid IDs")
    if category_id <= 0 or supplier_id <= 0:
        raise ValueError("Category and supplier must be selected")

    cp_raw = pick("cost_price")
    sp_raw = pick("selling_price")
    if cp_raw is None or cp_raw == "":
        raise ValueError("Cost price is required")
    if sp_raw is None or sp_raw == "":
        raise ValueError("Selling price is required")
    try:
        cost_price = float(cp_raw)
        selling_price = float(sp_raw)
    except (TypeError, ValueError):
        raise ValueError("Prices must be valid numbers")
    if cost_price < 0 or selling_price < 0:
        raise ValueError("Prices cannot be negative")

    stock_raw = pick("stock_level", 0 if existing is None else existing["stock_level"])
    try:
        stock_level = int(stock_raw)
    except (TypeError, ValueError):
        raise ValueError("Stock level must be a whole number")
    if stock_level < 0:
        raise ValueError("Stock level cannot be negative")

    rp_raw = pick("reorder_point", 10 if existing is None else existing["reorder_point"])
    try:
        reorder_point = int(rp_raw)
    except (TypeError, ValueError):
        raise ValueError("Reorder point must be a whole number")

    lt_raw = pick("lead_time_days", 7 if existing is None else existing["lead_time_days"])
    try:
        lead_time_days = int(lt_raw)
    except (TypeError, ValueError):
        raise ValueError("Lead time must be a whole number")
    if lead_time_days < 1:
        raise ValueError("Lead time must be at least 1 day")

    return {
        "name": name, "sku": sku, "barcode": barcode,
        "category_id": category_id, "supplier_id": supplier_id,
        "cost_price": cost_price, "selling_price": selling_price,
        "stock_level": stock_level, "reorder_point": reorder_point,
        "lead_time_days": lead_time_days,
    }


def log_action(user_id, action, details=None):
    db = get_db()
    db.execute(
        "INSERT INTO audit_log (user_id, action, details) VALUES (?, ?, ?)",
        (user_id, action, json.dumps(details) if details else None)
    )
    db.commit()
    db.close()


def init_db():
    """Initialize the database with required tables"""
    db = get_db()
    cursor = db.cursor()

    # Users Table — roles: administrator | owner | supplier
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('administrator', 'owner', 'supplier')),
            supplier_id INTEGER REFERENCES suppliers(supplier_id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Categories Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_name TEXT UNIQUE NOT NULL
        )
    ''')

    # Suppliers Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS suppliers (
            supplier_id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_name TEXT NOT NULL,
            contact_person TEXT,
            phone TEXT,
            email TEXT,
            address TEXT
        )
    ''')

    # Products Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS products (
            product_id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sku TEXT UNIQUE NOT NULL,
            barcode TEXT UNIQUE,
            category_id INTEGER,
            supplier_id INTEGER,
            cost_price REAL NOT NULL,
            selling_price REAL NOT NULL,
            stock_level INTEGER DEFAULT 0,
            reorder_point INTEGER DEFAULT 10,
            lead_time_days INTEGER DEFAULT 7,
            is_archived INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories(category_id),
            FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
        )
    ''')

    # Transactions Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS transactions (
            transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            total_amount REAL NOT NULL,
            user_id INTEGER NOT NULL,
            status TEXT DEFAULT 'completed',
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
    ''')

    # Transaction Items Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS transaction_items (
            item_id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            unit_price REAL NOT NULL,
            subtotal REAL NOT NULL,
            FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id),
            FOREIGN KEY (product_id) REFERENCES products(product_id)
        )
    ''')

    # Audit Log Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS audit_log (
            log_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            details TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id)
        )
    ''')

    # ── NEW: Stock Requests Table ──────────────────────────────────────────────
    # Owner/admin creates a restock request → supplier sees it and acts on it.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stock_requests (
            request_id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            supplier_id INTEGER NOT NULL,
            requested_quantity INTEGER NOT NULL,
            status TEXT DEFAULT 'pending'
                CHECK(status IN ('pending', 'acknowledged', 'fulfilled', 'cancelled')),
            notes TEXT,
            requested_by INTEGER NOT NULL,
            requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(product_id),
            FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id),
            FOREIGN KEY (requested_by) REFERENCES users(user_id)
        )
    ''')

    # Default admin
    cursor.execute("SELECT * FROM users WHERE username = 'admin'")
    if not cursor.fetchone():
        admin_password = generate_password_hash('admin123')
        cursor.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ('admin', admin_password, 'administrator')
        )

    # Default owner account (store operator)
    cursor.execute("SELECT * FROM users WHERE username = 'owner'")
    if not cursor.fetchone():
        owner_password = generate_password_hash('owner123')
        cursor.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ('owner', owner_password, 'owner')
        )

    # Default categories
    for cat in ['Beverages', 'Canned Goods', 'Snacks', 'Dairy', 'Frozen', 'Other']:
        cursor.execute("INSERT OR IGNORE INTO categories (category_name) VALUES (?)", (cat,))

    db.commit()
    db.close()
    ensure_products_archive_column()
    ensure_supplier_id_on_users()


# ─────────────────────────────────────────────
# AUTH ENDPOINTS
# ─────────────────────────────────────────────
@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'error': 'Username and password required'}), 400

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    db.close()
    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Invalid credentials'}), 401

    ttl = app.config['JWT_ACCESS_TOKEN_EXPIRES']
    expires_in = int(ttl.total_seconds()) if isinstance(ttl, timedelta) else 28800
    access_token = create_access_token(identity=username)
    return jsonify({
        'token': access_token,
        'expires_in': expires_in,
        'user': {
            'username': user['username'],
            'role': user['role'],
            'user_id': user['user_id'],
            'supplier_id': user['supplier_id'],   # None unless supplier role
        }
    })


@app.route('/api/auth/register', methods=['POST'])
@role_required('administrator')
def register():
    """Register new user — Admin only.
    For supplier role, pass supplier_id to link the account to a supplier record.
    """
    current_user = get_jwt_identity()
    db = get_db()
    admin_user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()

    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    role = data.get('role', 'owner')
    supplier_id = data.get('supplier_id')   # Required when role == 'supplier'

    if not username or not password:
        db.close()
        return jsonify({'error': 'Username and password required'}), 400

    if role not in VALID_ROLES:
        db.close()
        return jsonify({'error': f'Role must be one of: {", ".join(VALID_ROLES)}'}), 400

    if role == 'supplier' and not supplier_id:
        db.close()
        return jsonify({'error': 'supplier_id is required when creating a supplier account'}), 400

    password_hash = generate_password_hash(password)
    try:
        cursor = db.execute(
            "INSERT INTO users (username, password_hash, role, supplier_id) VALUES (?, ?, ?, ?)",
            (username, password_hash, role, supplier_id if role == 'supplier' else None)
        )
        user_id = cursor.lastrowid
        db.commit()
        log_action(admin_user['user_id'], 'USER_CREATED', {'username': username, 'role': role})
        db.close()
        return jsonify({'message': 'User created successfully', 'user_id': user_id}), 201
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'Username already exists'}), 400


# ─────────────────────────────────────────────
# PRODUCT ENDPOINTS  (admin + owner)
# ─────────────────────────────────────────────
@app.route('/api/products', methods=['GET'])
@jwt_required()
def get_products():
    search = request.args.get('search', '')
    category = request.args.get('category', '')
    archived_raw = (request.args.get('archived') or '').lower()
    archived_only = archived_raw in ('1', 'true', 'yes')

    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT role, store_id FROM users WHERE username = ?", (current_user,)).fetchone()

    query = '''
        SELECT p.*, c.category_name, s.supplier_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
        WHERE 1=1
    '''
    params = []
    # Filter by store for owner role
    if user and user['role'] == 'owner' and user['store_id']:
        query += " AND p.store_id = ?"
        params.append(user['store_id'])
    query += " AND COALESCE(p.is_archived, 0) = 1" if archived_only else " AND COALESCE(p.is_archived, 0) = 0"
    if search:
        query += " AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)"
        params.extend([f'%{search}%'] * 3)
    if category:
        query += " AND p.category_id = ?"
        params.append(category)
    query += " ORDER BY p.name"
    products = db.execute(query, params).fetchall()
    db.close()
    return jsonify([dict(p) for p in products])


@app.route('/api/products/<int:product_id>', methods=['GET'])
@jwt_required()
def get_product(product_id):
    db = get_db()
    product = db.execute('''
        SELECT p.*, c.category_name, s.supplier_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
        WHERE p.product_id = ?
    ''', (product_id,)).fetchone()
    db.close()
    if not product:
        return jsonify({'error': 'Product not found'}), 404
    return jsonify(dict(product))


@app.route('/api/products', methods=['POST'])
@role_required('administrator', 'owner')
def create_product():
    data = request.get_json()
    current_user = get_jwt_identity()
    try:
        vals = parse_product_body(data, existing=None)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
    try:
        # Get user's store_id (for owner role)
        user_detail = db.execute("SELECT role, store_id FROM users WHERE username = ?", (current_user,)).fetchone()
        store_id = user_detail['store_id'] if user_detail and user_detail['role'] == 'owner' else None

        cursor = db.execute('''
            INSERT INTO products (name, sku, barcode, category_id, supplier_id,
                                cost_price, selling_price, stock_level, reorder_point, lead_time_days, store_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (vals['name'], vals['sku'], vals['barcode'], vals['category_id'], vals['supplier_id'],
              vals['cost_price'], vals['selling_price'], vals['stock_level'], vals['reorder_point'], vals['lead_time_days'], store_id))
        product_id = cursor.lastrowid
        db.commit()
        log_action(user['user_id'], 'PRODUCT_CREATED', {'product_id': product_id, 'name': vals['name']})
        db.close()
        return jsonify({'message': 'Product created successfully', 'product_id': product_id}), 201
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'SKU or Barcode already exists'}), 400


@app.route('/api/products/<int:product_id>', methods=['PUT'])
@role_required('administrator', 'owner')
def update_product(product_id):
    data = request.get_json()
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
    product = db.execute("SELECT * FROM products WHERE product_id = ?", (product_id,)).fetchone()
    if not product:
        db.close()
        return jsonify({'error': 'Product not found'}), 404
    try:
        vals = parse_product_body(data, existing=product)
    except ValueError as e:
        db.close()
        return jsonify({'error': str(e)}), 400
    try:
        db.execute('''
            UPDATE products SET name=?, sku=?, barcode=?, category_id=?,
                supplier_id=?, cost_price=?, selling_price=?,
                stock_level=?, reorder_point=?, lead_time_days=?
            WHERE product_id=?
        ''', (vals['name'], vals['sku'], vals['barcode'], vals['category_id'], vals['supplier_id'],
              vals['cost_price'], vals['selling_price'], vals['stock_level'], vals['reorder_point'],
              vals['lead_time_days'], product_id))
        db.commit()
        log_action(user['user_id'], 'PRODUCT_UPDATED', {'product_id': product_id})
        db.close()
        return jsonify({'message': 'Product updated successfully'})
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'SKU or Barcode already exists'}), 400


@app.route('/api/products/<int:product_id>', methods=['DELETE'])
@role_required('administrator')
def delete_product(product_id):
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
    product = db.execute("SELECT * FROM products WHERE product_id = ?", (product_id,)).fetchone()
    if not product:
        db.close()
        return jsonify({'error': 'Product not found'}), 404
    db.execute("UPDATE products SET is_archived = 1 WHERE product_id = ?", (product_id,))
    db.commit()
    log_action(user['user_id'], 'PRODUCT_ARCHIVED', {'product_id': product_id, 'name': product['name']})
    db.close()
    return jsonify({'message': 'Product removed from shelf (archived).'})


@app.route('/api/products/<int:product_id>/restore', methods=['POST'])
@role_required('administrator')
def restore_product(product_id):
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
    product = db.execute("SELECT * FROM products WHERE product_id = ?", (product_id,)).fetchone()
    if not product:
        db.close()
        return jsonify({'error': 'Product not found'}), 404
    db.execute("UPDATE products SET is_archived = 0 WHERE product_id = ?", (product_id,))
    db.commit()
    log_action(user['user_id'], 'PRODUCT_RESTORED', {'product_id': product_id, 'name': product['name']})
    db.close()
    return jsonify({'message': 'Product restored to the shelf.'})


# ─────────────────────────────────────────────
# TRANSACTION ENDPOINTS
# ─────────────────────────────────────────────
@app.route('/api/transactions', methods=['POST'])
@role_required('administrator', 'owner')
def create_transaction():
    data = request.get_json()
    current_user = get_jwt_identity()

    if not data or not isinstance(data.get('items'), list) or len(data['items']) == 0:
        return jsonify({'error': 'Transaction must contain at least one line item'}), 400

    normalized_lines = []
    for idx, raw in enumerate(data['items']):
        if not isinstance(raw, dict):
            return jsonify({'error': f'Line {idx + 1}: invalid item payload'}), 400
        try:
            pid = int(raw['product_id'])
            qty = int(raw['quantity'])
        except (KeyError, TypeError, ValueError):
            return jsonify({'error': f'Line {idx + 1}: a valid product and whole-number quantity are required'}), 400
        if pid < 1 or qty < 1:
            return jsonify({'error': f'Line {idx + 1}: quantity must be at least 1'}), 400
        normalized_lines.append({'product_id': pid, 'quantity': qty})

    qty_per_product = Counter()
    for line in normalized_lines:
        qty_per_product[line['product_id']] += line['quantity']

    db = get_db()
    try:
        user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
        if not user:
            return jsonify({'error': 'User not found'}), 404

        product_cache = {}
        for pid, needed in qty_per_product.items():
            product = db.execute(
                "SELECT * FROM products WHERE product_id = ? AND COALESCE(is_archived, 0) = 0", (pid,)
            ).fetchone()
            if not product:
                exists = db.execute("SELECT COALESCE(is_archived, 0) AS a FROM products WHERE product_id = ?", (pid,)).fetchone()
                if exists and int(exists["a"]) == 1:
                    return jsonify({'error': f'Product #{pid} is archived. Restore it first.'}), 400
                return jsonify({'error': f'Product #{pid} was not found'}), 404
            available = int(product['stock_level'])
            if needed > available:
                return jsonify({'error': f'Insufficient stock for "{product["name"]}": {needed} requested, {available} available'}), 400
            product_cache[pid] = product

        total_amount = 0.0
        items_to_insert = []
        for line in normalized_lines:
            product = product_cache[line['product_id']]
            qty = line['quantity']
            unit_price = float(product['selling_price'])
            subtotal = round(qty * unit_price, 2)
            total_amount += subtotal
            items_to_insert.append({
                'product_id': line['product_id'], 'quantity': qty,
                'unit_price': unit_price, 'subtotal': subtotal,
                'name': product['name'], 'sku': product['sku'],
            })

        total_amount = round(total_amount, 2)
        cursor = db.execute(
            "INSERT INTO transactions (total_amount, user_id) VALUES (?, ?)",
            (total_amount, user['user_id']),
        )
        transaction_id = cursor.lastrowid
        for item in items_to_insert:
            db.execute(
                'INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)',
                (transaction_id, item['product_id'], item['quantity'], item['unit_price'], item['subtotal']),
            )
            db.execute(
                "UPDATE products SET stock_level = stock_level - ? WHERE product_id = ?",
                (item['quantity'], item['product_id']),
            )
        db.commit()
        log_action(user['user_id'], 'TRANSACTION_CREATED', {'transaction_id': transaction_id, 'total': total_amount})
        return jsonify({
            'message': 'Transaction completed successfully',
            'transaction_id': transaction_id,
            'total_amount': total_amount,
            'items': [{
                'product_id': i['product_id'], 'name': i['name'], 'sku': i['sku'],
                'quantity': i['quantity'], 'unit_price': i['unit_price'], 'subtotal': i['subtotal'],
            } for i in items_to_insert],
        }), 201
    except Exception:
        db.rollback()
        return jsonify({'error': 'Could not complete sale. Please try again.'}), 500
    finally:
        db.close()


@app.route('/api/transactions', methods=['GET'])
@role_required('administrator', 'owner')
def get_transactions():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    db = get_db()
    query = '''
        SELECT t.*, u.username
        FROM transactions t
        JOIN users u ON t.user_id = u.user_id
        WHERE t.status = 'completed'
    '''
    params = []
    if start_date:
        query += " AND DATE(t.transaction_date) >= ?"
        params.append(start_date)
    if end_date:
        query += " AND DATE(t.transaction_date) <= ?"
        params.append(end_date)
    query += " ORDER BY t.transaction_date DESC LIMIT 100"
    transactions = db.execute(query, params).fetchall()
    db.close()
    return jsonify([dict(t) for t in transactions])


@app.route('/api/transactions/<int:transaction_id>', methods=['GET'])
@role_required('administrator', 'owner')
def get_transaction(transaction_id):
    db = get_db()
    transaction = db.execute('''
        SELECT t.*, u.username FROM transactions t
        JOIN users u ON t.user_id = u.user_id
        WHERE t.transaction_id = ?
    ''', (transaction_id,)).fetchone()
    if not transaction:
        db.close()
        return jsonify({'error': 'Transaction not found'}), 404
    items = db.execute('''
        SELECT ti.*, p.name as product_name, p.sku
        FROM transaction_items ti
        JOIN products p ON ti.product_id = p.product_id
        WHERE ti.transaction_id = ?
    ''', (transaction_id,)).fetchall()
    db.close()
    result = dict(transaction)
    result['items'] = [dict(item) for item in items]
    return jsonify(result)


# ─────────────────────────────────────────────
# ANALYTICS
# ─────────────────────────────────────────────
@app.route('/api/analytics/dashboard', methods=['GET'])
@role_required('administrator', 'owner')
def get_dashboard_data():
    current_user = get_jwt_identity()
    db = get_db()
    u = db.execute("SELECT role, store_id FROM users WHERE username=?", (current_user,)).fetchone()
    store_filter = "AND p.store_id = ?" if (u and u["role"] == "owner" and u["store_id"]) else ""
    store_param  = [u["store_id"]] if (u and u["role"] == "owner" and u["store_id"]) else []

    total_products = db.execute(
        f"SELECT COUNT(*) as count FROM products p WHERE COALESCE(p.is_archived,0)=0 {store_filter}",
        store_param
    ).fetchone()["count"]
    low_stock = db.execute(
        f"SELECT COUNT(*) as count FROM products p WHERE COALESCE(p.is_archived,0)=0 AND p.stock_level<=p.reorder_point {store_filter}",
        store_param
    ).fetchone()["count"]

    txn_filter = ""
    txn_param  = []
    if u and u["role"] == "owner" and u["store_id"]:
        txn_filter = "AND t.store_id = ?"
        txn_param  = [u["store_id"]]

    today_sales = db.execute(
        f"SELECT COALESCE(SUM(total_amount),0) as total FROM transactions t WHERE DATE(transaction_date)=DATE('now') AND status='completed' {txn_filter}",
        txn_param
    ).fetchone()["total"]
    week_sales = db.execute(
        f"SELECT COALESCE(SUM(total_amount),0) as total FROM transactions t WHERE DATE(transaction_date)>=DATE('now','-7 days') AND status='completed' {txn_filter}",
        txn_param
    ).fetchone()["total"]
    stock_value = db.execute(
        f"SELECT COALESCE(SUM(p.stock_level*p.cost_price),0) as value FROM products p WHERE COALESCE(p.is_archived,0)=0 {store_filter}",
        store_param
    ).fetchone()["value"]
    top_products = db.execute('''
        SELECT p.name, p.sku, SUM(ti.quantity) as total_sold, SUM(ti.subtotal) as revenue
        FROM transaction_items ti
        JOIN products p ON ti.product_id = p.product_id
        JOIN transactions t ON ti.transaction_id = t.transaction_id
        WHERE DATE(t.transaction_date) >= DATE('now', '-30 days') AND t.status = 'completed'
        GROUP BY p.product_id ORDER BY total_sold DESC LIMIT 10
    ''').fetchall()
    sales_trend = db.execute('''
        SELECT DATE(transaction_date) as date, SUM(total_amount) as total
        FROM transactions
        WHERE DATE(transaction_date) >= DATE('now', '-7 days') AND status = 'completed'
        GROUP BY DATE(transaction_date) ORDER BY date
    ''').fetchall()
    db.close()
    return jsonify({
        'summary': {
            'total_products': total_products,
            'low_stock_count': low_stock,
            'today_sales': round(today_sales, 2),
            'week_sales': round(week_sales, 2),
            'stock_value': round(stock_value, 2),
        },
        'top_products': [dict(p) for p in top_products],
        'sales_trend': [dict(s) for s in sales_trend],
    })


def _build_daily_sales_series(db, product_id, horizon_days):
    horizon_days = max(1, int(horizon_days))
    rows = db.execute('''
        SELECT DATE(t.transaction_date) AS day, SUM(ti.quantity) AS qty
        FROM transaction_items ti
        INNER JOIN transactions t ON ti.transaction_id = t.transaction_id
        WHERE ti.product_id = ?
          AND DATE(t.transaction_date) >= DATE('now', ?)
          AND t.status = 'completed'
        GROUP BY day ORDER BY day
    ''', (product_id, f'-{horizon_days} days')).fetchall()
    day_map = {r['day']: float(r['qty'] or 0) for r in rows}
    today = date.today()
    return [day_map.get((today - timedelta(days=i)).isoformat(), 0.0) for i in range(horizon_days - 1, -1, -1)]


@app.route('/api/analytics/restock-recommendations', methods=['GET'])
@role_required('administrator', 'owner')
def get_restock_recommendations():
    db = get_db()
    products = db.execute('''
        SELECT p.*, c.category_name, s.supplier_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
        WHERE COALESCE(p.is_archived, 0) = 0 AND p.stock_level <= p.reorder_point
        ORDER BY p.stock_level ASC
    ''').fetchall()

    recommendations = []
    comparison_summary = {
        'ses_wins': 0,
        'random_forest_wins': 0,
        'holt_winters_wins': 0,
        'insufficient_data': 0,
        'items_evaluated': 0,
    }

    product_ids = [int(p['product_id']) for p in products]
    sales_by_product = load_daily_sales_bulk(db, product_ids, FORECAST_HISTORY_DAYS)

    for product in products:
        pid = int(product['product_id'])
        series = sales_by_product.get(pid) or _build_daily_sales_series(db, pid, FORECAST_HISTORY_DAYS)
        fc = build_product_forecasts(series, SES_ALPHA)
        forecast_daily = fc['ses_units_per_day']
        naive_mean = sum(series) / len(series) if series else 0.0
        stock = int(product['stock_level'])
        reorder_pt = int(product['reorder_point'])
        lead = max(1, int(product['lead_time_days']))
        demand_through_lead = forecast_daily * lead * 1.5
        target_stock = max(max(reorder_pt * 2, reorder_pt + 1), int(math.ceil(stock + demand_through_lead)))
        suggested_quantity = max(1, target_stock - stock)

        if product['stock_level'] == 0:
            priority = 'CRITICAL'
        elif product['stock_level'] <= product['reorder_point'] * 0.5:
            priority = 'HIGH'
        else:
            priority = 'MEDIUM'

        winner = fc.get('holdout_winner')
        if fc.get('holdout_days', 0) > 0 and winner:
            comparison_summary['items_evaluated'] += 1
            if winner == 'ses':
                comparison_summary['ses_wins'] += 1
            elif winner == 'random_forest':
                comparison_summary['random_forest_wins'] += 1
            elif winner == 'holt_winters':
                comparison_summary['holt_winters_wins'] += 1
        elif fc.get('rf_status') != 'ok' and fc.get('hw_status') != 'ok':
            comparison_summary['insufficient_data'] += 1

        recommendations.append({
            'product_id': product['product_id'],
            'name': product['name'],
            'sku': product['sku'],
            'current_stock': product['stock_level'],
            'reorder_point': product['reorder_point'],
            'suggested_quantity': suggested_quantity,
            'avg_daily_sales': forecast_daily,
            'rf_avg_daily_sales': fc.get('rf_units_per_day'),
            'hw_avg_daily_sales': fc.get('hw_units_per_day'),
            'naive_avg_daily': round(naive_mean, 4),
            'forecast_comparison': {
                'ses_units_per_day': fc['ses_units_per_day'],
                'rf_units_per_day': fc.get('rf_units_per_day'),
                'hw_units_per_day': fc.get('hw_units_per_day'),
                'difference_units': fc.get('difference_units'),
                'difference_pct': fc.get('difference_pct'),
                'holdout_winner': winner,
                'ses_holdout_rmse': fc.get('ses_holdout_rmse'),
                'rf_holdout_rmse': fc.get('rf_holdout_rmse'),
                'hw_holdout_rmse': fc.get('hw_holdout_rmse'),
                'holdout_days': fc.get('holdout_days', 0),
                'rf_status': fc.get('rf_status'),
                'hw_status': fc.get('hw_status'),
            },
            'lead_time_days': product['lead_time_days'],
            'cost_price': product['cost_price'],
            'estimated_cost': round(suggested_quantity * product['cost_price'], 2),
            'priority': priority,
            'category': product['category_name'],
            'supplier': product['supplier_name'],
            'supplier_id': product['supplier_id'],
        })
    db.close()
    return jsonify({
        'recommendations': recommendations,
        'total_items': len(recommendations),
        'total_estimated_cost': sum(r['estimated_cost'] for r in recommendations),
        'forecast_model': {
            'primary_for_restock': 'simple_exponential_smoothing',
            'method': 'simple_exponential_smoothing',
            'alpha': SES_ALPHA,
            'history_days': FORECAST_HISTORY_DAYS,
        },
        'forecast_models': {
            'primary_for_restock': 'simple_exponential_smoothing',
            'ses': {
                'method': 'simple_exponential_smoothing',
                'alpha': SES_ALPHA,
                'history_days': FORECAST_HISTORY_DAYS,
            },
            'random_forest': {
                'method': 'random_forest',
                'n_estimators': RF_N_ESTIMATORS,
                'n_lags': RF_N_LAGS,
                'holdout_days': HOLDOUT_DAYS,
                'description': (
                    'Lag features (7 days) + day-of-week; compared via holdout RMSE (comparison only).'
                ),
            },
            'holt_winters': {
                'method': 'holt_winters',
                'seasonal_period': HW_SEASONAL_PERIOD,
                'min_history_days': 28,
                'holdout_days': HOLDOUT_DAYS,
                'description': (
                    'Triple exponential smoothing (additive trend + weekly seasonality); '
                    'comparison only — restock qty still uses SES.'
                ),
            },
            'winner_basis': WINNER_BASIS,
            'forecast_status_labels': FORECAST_STATUS_LABELS,
            'comparison_summary': comparison_summary,
        },
    })


# ─────────────────────────────────────────────
# STOCK REQUESTS  (owner creates → supplier acts)
# ─────────────────────────────────────────────
@app.route('/api/stock-requests', methods=['POST'])
@role_required('administrator', 'owner')
def create_stock_request():
    """Owner or admin creates a restock request directed at a supplier."""
    current_user = get_jwt_identity()
    data = request.get_json()

    product_id = data.get('product_id')
    supplier_id = data.get('supplier_id')
    requested_quantity = data.get('requested_quantity')
    notes = data.get('notes', '')

    if not all([product_id, supplier_id, requested_quantity]):
        return jsonify({'error': 'product_id, supplier_id and requested_quantity are required'}), 400

    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
    try:
        cursor = db.execute('''
            INSERT INTO stock_requests (product_id, supplier_id, requested_quantity, notes, requested_by)
            VALUES (?, ?, ?, ?, ?)
        ''', (product_id, supplier_id, requested_quantity, notes, user['user_id']))
        request_id = cursor.lastrowid
        db.commit()
        log_action(user['user_id'], 'STOCK_REQUEST_CREATED', {'request_id': request_id, 'product_id': product_id})
        db.close()
        return jsonify({'message': 'Stock request created', 'request_id': request_id}), 201
    except Exception as e:
        db.close()
        return jsonify({'error': str(e)}), 500


@app.route('/api/stock-requests', methods=['GET'])
@role_required('administrator', 'owner')
def get_stock_requests():
    """Owner/admin: get all stock requests (optional ?status= filter)."""
    status_filter = request.args.get('status')
    db = get_db()
    query = '''
        SELECT sr.*, p.name as product_name, p.sku, p.stock_level,
               s.supplier_name, u.username as requested_by_username
        FROM stock_requests sr
        JOIN products p ON sr.product_id = p.product_id
        JOIN suppliers s ON sr.supplier_id = s.supplier_id
        JOIN users u ON sr.requested_by = u.user_id
        WHERE 1=1
    '''
    params = []
    if status_filter:
        query += " AND sr.status = ?"
        params.append(status_filter)
    query += " ORDER BY sr.requested_at DESC"
    rows = db.execute(query, params).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ─────────────────────────────────────────────
# SUPPLIER PORTAL ENDPOINTS
# ─────────────────────────────────────────────
@app.route('/api/supplier/low-stock', methods=['GET'])
@role_required('supplier')
def supplier_low_stock():
    """
    Returns products below their reorder point that belong to this supplier,
    including any pending stock requests the owner has already sent.
    """
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT supplier_id FROM users WHERE username = ?", (current_user,)).fetchone()
    if not user or not user['supplier_id']:
        db.close()
        return jsonify({'error': 'No supplier linked to this account'}), 403

    supplier_id = user['supplier_id']

    products = db.execute('''
        SELECT p.product_id, p.name, p.sku, p.stock_level, p.reorder_point,
               p.lead_time_days, p.cost_price, p.selling_price,
               c.category_name, st.store_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN stores st ON p.store_id = st.store_id
        WHERE p.supplier_id = ?
          AND COALESCE(p.is_archived, 0) = 0
          AND p.stock_level <= p.reorder_point
        ORDER BY st.store_name, p.stock_level ASC
    ''', (supplier_id,)).fetchall()

    result = []
    for p in products:
        if p['stock_level'] == 0:
            priority = 'CRITICAL'
        elif p['stock_level'] <= p['reorder_point'] * 0.5:
            priority = 'HIGH'
        else:
            priority = 'MEDIUM'

        # Fetch any pending requests for this product
        requests = db.execute('''
            SELECT request_id, requested_quantity, status, notes, requested_at
            FROM stock_requests
            WHERE product_id = ? AND supplier_id = ? AND status IN ('pending', 'acknowledged')
            ORDER BY requested_at DESC
        ''', (p['product_id'], supplier_id)).fetchall()

        result.append({
            **dict(p),
            'priority': priority,
            'stock_requests': [dict(r) for r in requests],
        })

    db.close()
    return jsonify({'low_stock_items': result, 'total': len(result)})


@app.route('/api/supplier/stock-requests', methods=['GET'])
@role_required('supplier')
def supplier_get_requests():
    """Supplier: see all restock requests directed at them."""
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT supplier_id FROM users WHERE username = ?", (current_user,)).fetchone()
    if not user or not user['supplier_id']:
        db.close()
        return jsonify({'error': 'No supplier linked to this account'}), 403

    supplier_id = user['supplier_id']
    status_filter = request.args.get('status')

    query = '''
        SELECT sr.*, p.name as product_name, p.sku, p.stock_level,
               u.username as requested_by_username, st.store_name
        FROM stock_requests sr
        JOIN products p ON sr.product_id = p.product_id
        JOIN users u ON sr.requested_by = u.user_id
        LEFT JOIN stores st ON u.store_id = st.store_id
        WHERE sr.supplier_id = ?
    '''
    params = [supplier_id]
    if status_filter:
        query += " AND sr.status = ?"
        params.append(status_filter)
    query += " ORDER BY sr.requested_at DESC"

    rows = db.execute(query, params).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/supplier/stock-requests/<int:request_id>', methods=['PUT'])
@role_required('supplier')
def supplier_update_request(request_id):
    """
    Supplier updates a stock request status:
    pending → acknowledged → fulfilled (or cancelled).
    """
    current_user = get_jwt_identity()
    data = request.get_json()
    new_status = data.get('status')

    valid_transitions = {
        'pending': ['acknowledged', 'cancelled'],
        'acknowledged': ['fulfilled', 'cancelled'],
    }

    if new_status not in ('acknowledged', 'fulfilled', 'cancelled'):
        return jsonify({'error': 'Invalid status. Use: acknowledged, fulfilled, cancelled'}), 400

    db = get_db()
    user = db.execute("SELECT user_id, supplier_id FROM users WHERE username = ?", (current_user,)).fetchone()
    if not user or not user['supplier_id']:
        db.close()
        return jsonify({'error': 'No supplier linked to this account'}), 403

    req = db.execute(
        "SELECT * FROM stock_requests WHERE request_id = ? AND supplier_id = ?",
        (request_id, user['supplier_id'])
    ).fetchone()
    if not req:
        db.close()
        return jsonify({'error': 'Stock request not found'}), 404

    allowed = valid_transitions.get(req['status'], [])
    if new_status not in allowed:
        db.close()
        return jsonify({'error': f'Cannot transition from {req["status"]} to {new_status}'}), 400

    db.execute(
        "UPDATE stock_requests SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE request_id = ?",
        (new_status, request_id)
    )
    if new_status == 'fulfilled':
        db.execute(
            "UPDATE products SET stock_level = stock_level + ? WHERE product_id = ?",
            (req['requested_quantity'], req['product_id'])
        )
        log_action(user['user_id'], 'STOCK_REQUEST_FULFILLED', {
            'request_id': request_id,
            'product_id': req['product_id'],
            'quantity': req['requested_quantity'],
        })
    db.commit()
    db.close()

    # Create notification for the owner who made the request
    product_row = get_db()
    prod = product_row.execute("SELECT name FROM products WHERE product_id=?", (req['product_id'],)).fetchone()
    product_row.close()
    product_name = prod['name'] if prod else f"Product #{req['product_id']}"
    supplier_row = get_db()
    sup = supplier_row.execute("SELECT supplier_name FROM suppliers WHERE supplier_id=?", (user['supplier_id'],)).fetchone()
    supplier_row.close()
    supplier_name = sup['supplier_name'] if sup else 'Supplier'

    if new_status == 'acknowledged':
        create_notification(
            req['requested_by'],
            'restock_acknowledged',
            f'Order acknowledged by {supplier_name}',
            f'Your restock request for {product_name} ({req["requested_quantity"]} units) has been acknowledged and is being prepared.',
            request_id
        )
    elif new_status == 'fulfilled':
        create_notification(
            req['requested_by'],
            'restock_fulfilled',
            f'Stock incoming from {supplier_name}!',
            f'{req["requested_quantity"]} units of {product_name} have been shipped. Stock level updated.',
            request_id
        )
    elif new_status == 'cancelled':
        create_notification(
            req['requested_by'],
            'restock_cancelled',
            f'Restock request cancelled',
            f'The request for {product_name} ({req["requested_quantity"]} units) was cancelled by {supplier_name}.',
            request_id
        )

    return jsonify({'message': f'Request updated to {new_status}'})


@app.route('/api/supplier/dashboard', methods=['GET'])
@role_required('supplier')
def supplier_dashboard_summary():
    """Summary counts for the supplier dashboard."""
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT supplier_id FROM users WHERE username = ?", (current_user,)).fetchone()
    if not user or not user['supplier_id']:
        db.close()
        return jsonify({'error': 'No supplier linked to this account'}), 403

    supplier_id = user['supplier_id']

    total_products = db.execute(
        "SELECT COUNT(*) AS c FROM products WHERE supplier_id = ? AND COALESCE(is_archived, 0) = 0",
        (supplier_id,)
    ).fetchone()['c']

    low_stock_count = db.execute(
        "SELECT COUNT(*) AS c FROM products WHERE supplier_id = ? AND COALESCE(is_archived, 0) = 0 AND stock_level <= reorder_point",
        (supplier_id,)
    ).fetchone()['c']

    critical_count = db.execute(
        "SELECT COUNT(*) AS c FROM products WHERE supplier_id = ? AND COALESCE(is_archived, 0) = 0 AND stock_level = 0",
        (supplier_id,)
    ).fetchone()['c']

    pending_requests = db.execute(
        "SELECT COUNT(*) AS c FROM stock_requests WHERE supplier_id = ? AND status = 'pending'",
        (supplier_id,)
    ).fetchone()['c']

    acknowledged_requests = db.execute(
        "SELECT COUNT(*) AS c FROM stock_requests WHERE supplier_id = ? AND status = 'acknowledged'",
        (supplier_id,)
    ).fetchone()['c']

    supplier_info = db.execute(
        "SELECT * FROM suppliers WHERE supplier_id = ?", (supplier_id,)
    ).fetchone()

    db.close()
    return jsonify({
        'supplier': dict(supplier_info) if supplier_info else {},
        'total_products': total_products,
        'low_stock_count': low_stock_count,
        'critical_count': critical_count,
        'pending_requests': pending_requests,
        'acknowledged_requests': acknowledged_requests,
    })


# ─────────────────────────────────────────────
# CATEGORIES & SUPPLIERS
# ─────────────────────────────────────────────
@app.route('/api/categories', methods=['GET'])
@jwt_required()
def get_categories():
    db = get_db()
    categories = db.execute("SELECT * FROM categories ORDER BY category_name").fetchall()
    db.close()
    return jsonify([dict(c) for c in categories])


@app.route('/api/categories', methods=['POST'])
@role_required('administrator', 'owner')
def create_category():
    data = request.get_json()
    if not data.get('category_name'):
        return jsonify({'error': 'Category name required'}), 400
    db = get_db()
    try:
        cursor = db.execute("INSERT INTO categories (category_name) VALUES (?)", (data['category_name'],))
        db.commit()
        db.close()
        return jsonify({'message': 'Category created', 'category_id': cursor.lastrowid}), 201
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'Category already exists'}), 400


@app.route('/api/suppliers', methods=['GET'])
@jwt_required()
def get_suppliers():
    db = get_db()
    suppliers = db.execute("SELECT * FROM suppliers ORDER BY supplier_name").fetchall()
    db.close()
    return jsonify([dict(s) for s in suppliers])


@app.route('/api/suppliers', methods=['POST'])
@role_required('administrator')
def create_supplier():
    data = request.get_json()
    if not data.get('supplier_name'):
        return jsonify({'error': 'Supplier name required'}), 400
    db = get_db()
    cursor = db.execute('''
        INSERT INTO suppliers (supplier_name, contact_person, phone, email, address)
        VALUES (?, ?, ?, ?, ?)
    ''', (data['supplier_name'], data.get('contact_person'), data.get('phone'), data.get('email'), data.get('address')))
    db.commit()
    db.close()
    return jsonify({'message': 'Supplier created', 'supplier_id': cursor.lastrowid}), 201


# ─────────────────────────────────────────────
# REPORTS
# ─────────────────────────────────────────────
@app.route('/api/reports/sales', methods=['GET'])
@role_required('administrator')
def generate_sales_report():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    format_type = request.args.get('format', 'json')
    db = get_db()
    query = '''
        SELECT DATE(t.transaction_date) as date,
               COUNT(t.transaction_id) as transaction_count,
               SUM(t.total_amount) as total_sales,
               AVG(t.total_amount) as avg_transaction
        FROM transactions t WHERE t.status = 'completed'
    '''
    params = []
    if start_date:
        query += " AND DATE(t.transaction_date) >= ?"
        params.append(start_date)
    if end_date:
        query += " AND DATE(t.transaction_date) <= ?"
        params.append(end_date)
    query += " GROUP BY DATE(t.transaction_date) ORDER BY date DESC"
    report_data = db.execute(query, params).fetchall()
    db.close()

    if format_type == 'csv':
        output = BytesIO()
        writer = csv.writer(output)
        writer.writerow(['Date', 'Transactions', 'Total Sales', 'Avg Transaction'])
        for row in report_data:
            writer.writerow([row['date'], row['transaction_count'], row['total_sales'], row['avg_transaction']])
        output.seek(0)
        return send_file(output, mimetype='text/csv', as_attachment=True, download_name='sales_report.csv')
    return jsonify([dict(r) for r in report_data])


@app.route('/api/reports/inventory', methods=['GET'])
@role_required('administrator')
def generate_inventory_report():
    db = get_db()
    products = db.execute('''
        SELECT p.*, c.category_name, s.supplier_name,
               (p.stock_level * p.cost_price) as stock_value
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
        WHERE COALESCE(p.is_archived, 0) = 0 ORDER BY p.name
    ''').fetchall()
    db.close()
    return jsonify([dict(p) for p in products])




# ─────────────────────────────────────────────
# NOTIFICATIONS
# ─────────────────────────────────────────────
@app.route('/api/notifications', methods=['GET'])
@jwt_required()
def get_notifications():
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username=?", (current_user,)).fetchone()
    rows = db.execute("""
        SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50
    """, (user['user_id'],)).fetchall()
    unread = db.execute(
        "SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0", (user['user_id'],)
    ).fetchone()['c']
    db.close()
    return jsonify({'notifications': [dict(r) for r in rows], 'unread_count': unread})


@app.route('/api/notifications/read', methods=['PUT'])
@jwt_required()
def mark_notifications_read():
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username=?", (current_user,)).fetchone()
    db.execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (user['user_id'],))
    db.commit()
    db.close()
    return jsonify({'message': 'All notifications marked as read'})


# ─────────────────────────────────────────────
# MESSAGES
# ─────────────────────────────────────────────
@app.route('/api/messages/contacts', methods=['GET'])
@jwt_required()
def get_message_contacts():
    """
    Owner: returns all suppliers linked to their store's products.
    Supplier: returns all owners who have sent them stock requests.
    """
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT user_id, role, store_id, supplier_id FROM users WHERE username=?", (current_user,)).fetchone()

    contacts = []
    if user['role'] in ('owner', 'administrator'):
        # Find suppliers linked to this store's products (or all for admin)
        if user['role'] == 'owner' and user['store_id']:
            rows = db.execute("""
                SELECT DISTINCT u.user_id, u.username, u.role, s.supplier_name
                FROM users u
                JOIN suppliers s ON u.supplier_id = s.supplier_id
                WHERE u.role = 'supplier'
                  AND s.supplier_id IN (
                      SELECT DISTINCT supplier_id FROM products WHERE store_id=?
                  )
            """, (user['store_id'],)).fetchall()
        else:
            rows = db.execute("""
                SELECT DISTINCT u.user_id, u.username, u.role, s.supplier_name
                FROM users u
                JOIN suppliers s ON u.supplier_id = s.supplier_id
                WHERE u.role = 'supplier'
            """).fetchall()
        contacts = [{'user_id': r['user_id'], 'username': r['username'],
                     'display_name': r['supplier_name'], 'role': r['role']} for r in rows]

    elif user['role'] == 'supplier':
        rows = db.execute("""
            SELECT DISTINCT u.user_id, u.username, u.role, st.store_name
            FROM users u
            LEFT JOIN stores st ON u.store_id = st.store_id
            WHERE u.role IN ('owner', 'administrator')
              AND u.user_id IN (
                  SELECT requested_by FROM stock_requests WHERE supplier_id=?
              )
        """, (user['supplier_id'],)).fetchall()
        contacts = [{'user_id': r['user_id'], 'username': r['username'],
                     'display_name': r['store_name'] or r['username'], 'role': r['role']} for r in rows]

    db.close()
    return jsonify(contacts)


@app.route('/api/messages/<int:other_user_id>', methods=['GET'])
@jwt_required()
def get_messages(other_user_id):
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username=?", (current_user,)).fetchone()
    my_id = user['user_id']
    rows = db.execute("""
        SELECT m.*, u.username as sender_username
        FROM messages m
        JOIN users u ON m.sender_id = u.user_id
        WHERE (m.sender_id=? AND m.recipient_id=?)
           OR (m.sender_id=? AND m.recipient_id=?)
        ORDER BY m.created_at ASC
    """, (my_id, other_user_id, other_user_id, my_id)).fetchall()
    # Mark incoming as read
    db.execute("""
        UPDATE messages SET is_read=1
        WHERE sender_id=? AND recipient_id=?
    """, (other_user_id, my_id))
    db.commit()
    db.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/messages', methods=['POST'])
@jwt_required()
def send_message():
    current_user = get_jwt_identity()
    data = request.get_json()
    recipient_id = data.get('recipient_id')
    content = data.get('content', '').strip()
    if not recipient_id or not content:
        return jsonify({'error': 'recipient_id and content are required'}), 400

    db = get_db()
    user = db.execute("SELECT user_id, username FROM users WHERE username=?", (current_user,)).fetchone()
    recipient = db.execute("SELECT user_id, username FROM users WHERE user_id=?", (recipient_id,)).fetchone()
    if not recipient:
        db.close()
        return jsonify({'error': 'Recipient not found'}), 404

    cur = db.execute("""
        INSERT INTO messages (sender_id, recipient_id, content) VALUES (?,?,?)
    """, (user['user_id'], recipient_id, content))
    msg_id = cur.lastrowid
    db.commit()
    db.close()

    # Notify recipient
    create_notification(
        recipient_id, 'message',
        f'New message from {user["username"]}',
        content[:80] + ('…' if len(content) > 80 else ''),
        msg_id
    )
    return jsonify({'message': 'Message sent', 'message_id': msg_id}), 201


@app.route('/api/messages/unread-count', methods=['GET'])
@jwt_required()
def get_unread_message_count():
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username=?", (current_user,)).fetchone()
    count = db.execute(
        "SELECT COUNT(*) AS c FROM messages WHERE recipient_id=? AND is_read=0", (user['user_id'],)
    ).fetchone()['c']
    db.close()
    return jsonify({'unread_count': count})

# ─────────────────────────────────────────────
# INVENTORY CHAT (OpenRouter)
# ─────────────────────────────────────────────
@app.route('/api/chat/inventory', methods=['POST'])
@role_required('administrator', 'owner')
def chat_inventory():
    data = request.get_json() or {}
    message = (data.get('message') or '').strip()
    if not message:
        return jsonify({'error': 'message is required'}), 400

    if not os.environ.get('OPENROUTER_API_KEY'):
        return jsonify({'error': 'OPENROUTER_API_KEY is not configured on the server'}), 503

    db = get_db()
    try:
        inventory_context = _inventory_summary_for_chat(db)
    finally:
        db.close()

    messages = [
        {
            'role': 'system',
            'content': (
                'You are FLECS Inventory Assistant for a small retail store. '
                'Answer in the same language the user used (English, Filipino, or Taglish). '
                'Use ONLY the inventory data provided. If the answer is not in the data, say so. '
                'Do not invent products, SKUs, or stock numbers.'
            ),
        },
        {
            'role': 'user',
            'content': (
                f'Inventory snapshot:\n{inventory_context}\n\n'
                f'User question: {message}'
            ),
        },
    ]

    errors = []
    max_retries_429 = int(os.environ.get('OPENROUTER_429_RETRIES', '2'))

    for model_id in _openrouter_models_to_try():
        attempt = 0
        while attempt <= max_retries_429:
            try:
                reply = _openrouter_chat(messages, model_id)
                if reply:
                    return jsonify({'reply': reply, 'model': model_id})
                errors.append(f'{model_id}: empty response')
                break
            except OpenRouterError as exc:
                if exc.status_code == 429 and attempt < max_retries_429:
                    wait_s = min(int(exc.retry_after or 20) + 1, 30)
                    time.sleep(wait_s)
                    attempt += 1
                    continue
                errors.append(f'{model_id}: HTTP {exc.status_code}')
                break
            except Exception as exc:
                errors.append(f'{model_id}: {exc}')
                break

    return jsonify({
        'error': 'All OpenRouter models failed. ' + '; '.join(errors[:4]),
    }), 502


# ─────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})


if __name__ == '__main__':
    if not os.path.exists(DATABASE):
        init_db()
        print("Database initialized successfully")

    migrate_users_role_constraint()
    ensure_products_archive_column()
    ensure_supplier_id_on_users()
    ensure_default_suppliers()
    ensure_default_accounts()
    ensure_stock_requests_table()  # ← creates table on existing DBs
    ensure_sample_products()
    ensure_sample_transactions()

    print("FLECS Backend Server Starting...")
    print("\nDefault Credentials:")
    print("  Admin    — username: admin    | password: admin123")
    print("  Owner    — username: owner    | password: owner123")
    print("  Supplier — create via POST /api/auth/register (admin token required)")
    print("\nAPI running on http://localhost:5000")
    app.run(debug=True, host='0.0.0.0', port=5000)