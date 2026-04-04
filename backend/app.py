"""
FLECS Backend API Server
Flask REST API for the FLECS Decision Support System
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
from dotenv import load_dotenv
import sqlite3
import json
import os
import math
from functools import wraps
from collections import Counter
import pandas as pd
import numpy as np
from io import BytesIO
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import csv

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

# Database Helper Functions
def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def ensure_default_suppliers():
    """Seed suppliers when none exist so new installs can satisfy category+supplier rules."""
    db = get_db()
    try:
        n = db.execute("SELECT COUNT(*) AS c FROM suppliers").fetchone()["c"]
        if n == 0:
            for name in ("General Supplier", "Local Distributor"):
                db.execute("INSERT INTO suppliers (supplier_name) VALUES (?)", (name,))
            db.commit()
    finally:
        db.close()


def ensure_sample_products():
    """
    Load demo products when the catalog is empty (idempotent).
    Uses default categories and the first supplier row for foreign keys.
    """
    db = get_db()
    try:
        if db.execute("SELECT COUNT(*) AS c FROM products").fetchone()["c"] > 0:
            return

        sup = db.execute(
            "SELECT supplier_id FROM suppliers ORDER BY supplier_id LIMIT 1"
        ).fetchone()
        if not sup:
            return

        supplier_id = sup["supplier_id"]

        def category_id(category_name):
            row = db.execute(
                "SELECT category_id FROM categories WHERE category_name = ?",
                (category_name,),
            ).fetchone()
            return row["category_id"] if row else None

        # name, sku, barcode, category_name, cost, sell, stock, reorder_point, lead_days
        samples = [
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

        insert_sql = """
            INSERT INTO products (
                name, sku, barcode, category_id, supplier_id,
                cost_price, selling_price, stock_level, reorder_point, lead_time_days
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        for row in samples:
            name, sku, barcode, cat_name, cost, sell, stock, reorder, lead = row
            cid = category_id(cat_name)
            if cid is None:
                continue
            db.execute(
                insert_sql,
                (name, sku, barcode, cid, supplier_id, cost, sell, stock, reorder, lead),
            )

        db.commit()
    finally:
        db.close()


@app.before_request
def _run_reference_seeds_once():
    if app.config.get("_reference_seeded"):
        return
    ensure_default_suppliers()
    ensure_sample_products()
    app.config["_reference_seeded"] = True


def parse_product_body(data, existing=None):
    """
    Validate and normalize product create/update payload.
    existing: sqlite Row when updating (for defaults).
    Raises ValueError with a client-safe message on invalid input.
    """
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
    if reorder_point < 0:
        raise ValueError("Reorder point cannot be negative")

    lt_raw = pick("lead_time_days", 7 if existing is None else existing["lead_time_days"])
    try:
        lead_time_days = int(lt_raw)
    except (TypeError, ValueError):
        raise ValueError("Lead time must be a whole number")
    if lead_time_days < 1:
        raise ValueError("Lead time must be at least 1 day")

    return {
        "name": name,
        "sku": sku,
        "barcode": barcode,
        "category_id": category_id,
        "supplier_id": supplier_id,
        "cost_price": cost_price,
        "selling_price": selling_price,
        "stock_level": stock_level,
        "reorder_point": reorder_point,
        "lead_time_days": lead_time_days,
    }

def init_db():
    """Initialize the database with required tables"""
    db = get_db()
    cursor = db.cursor()
    
    # Users Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('administrator', 'clerk')),
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
    
    # Insert default admin user if not exists
    cursor.execute("SELECT * FROM users WHERE username = 'admin'")
    if not cursor.fetchone():
        admin_password = generate_password_hash('admin123')
        cursor.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ('admin', admin_password, 'administrator')
        )
    
    # Insert default categories
    default_categories = ['Beverages', 'Canned Goods', 'Snacks', 'Dairy', 'Frozen', 'Other']
    for cat in default_categories:
        cursor.execute("INSERT OR IGNORE INTO categories (category_name) VALUES (?)", (cat,))
    
    db.commit()
    db.close()

def log_action(user_id, action, details=None):
    """Log user actions for audit trail"""
    db = get_db()
    db.execute(
        "INSERT INTO audit_log (user_id, action, details) VALUES (?, ?, ?)",
        (user_id, action, json.dumps(details) if details else None)
    )
    db.commit()
    db.close()

def role_required(required_role):
    """Decorator to check user role"""
    def wrapper(fn):
        @wraps(fn)
        @jwt_required()
        def decorator(*args, **kwargs):
            current_user = get_jwt_identity()
            db = get_db()
            user = db.execute("SELECT role FROM users WHERE username = ?", (current_user,)).fetchone()
            db.close()
            
            if not user or user['role'] != required_role:
                return jsonify({'error': 'Insufficient permissions'}), 403
            return fn(*args, **kwargs)
        return decorator
    return wrapper

# Authentication Endpoints
@app.route('/api/auth/login', methods=['POST'])
def login():
    """User login endpoint"""
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
            'user_id': user['user_id']
        }
    })

@app.route('/api/auth/register', methods=['POST'])
@jwt_required()
def register():
    """Register new user (Admin only)"""
    current_user = get_jwt_identity()
    db = get_db()
    user = db.execute(
        "SELECT user_id, role FROM users WHERE username = ?", (current_user,)
    ).fetchone()
    
    if user['role'] != 'administrator':
        db.close()
        return jsonify({'error': 'Insufficient permissions'}), 403
    
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    role = data.get('role', 'clerk')
    
    if not username or not password:
        db.close()
        return jsonify({'error': 'Username and password required'}), 400
    
    password_hash = generate_password_hash(password)
    
    try:
        cursor = db.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (username, password_hash, role)
        )
        user_id = cursor.lastrowid
        db.commit()
        log_action(user['user_id'], 'USER_CREATED', {'username': username, 'role': role})
        db.close()
        return jsonify({'message': 'User created successfully', 'user_id': user_id}), 201
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'Username already exists'}), 400

# Product Management Endpoints
@app.route('/api/products', methods=['GET'])
@jwt_required()
def get_products():
    """Get all products"""
    search = request.args.get('search', '')
    category = request.args.get('category', '')
    
    db = get_db()
    query = '''
        SELECT p.*, c.category_name, s.supplier_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
        WHERE 1=1
    '''
    params = []
    
    if search:
        query += " AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)"
        search_param = f'%{search}%'
        params.extend([search_param, search_param, search_param])
    
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
    """Get single product"""
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
@jwt_required()
def create_product():
    """Create new product"""
    data = request.get_json()
    current_user = get_jwt_identity()

    try:
        vals = parse_product_body(data, existing=None)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
    
    try:
        cursor = db.execute('''
            INSERT INTO products (name, sku, barcode, category_id, supplier_id, 
                                cost_price, selling_price, stock_level, reorder_point, lead_time_days)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            vals['name'], vals['sku'], vals['barcode'],
            vals['category_id'], vals['supplier_id'],
            vals['cost_price'], vals['selling_price'],
            vals['stock_level'], vals['reorder_point'],
            vals['lead_time_days'],
        ))
        product_id = cursor.lastrowid
        db.commit()
        log_action(user['user_id'], 'PRODUCT_CREATED', {'product_id': product_id, 'name': vals['name']})
        db.close()
        return jsonify({'message': 'Product created successfully', 'product_id': product_id}), 201
    except sqlite3.IntegrityError as e:
        db.close()
        return jsonify({'error': 'SKU or Barcode already exists'}), 400

@app.route('/api/products/<int:product_id>', methods=['PUT'])
@jwt_required()
def update_product(product_id):
    """Update product"""
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
            UPDATE products SET name = ?, sku = ?, barcode = ?, category_id = ?,
                              supplier_id = ?, cost_price = ?, selling_price = ?,
                              stock_level = ?, reorder_point = ?, lead_time_days = ?
            WHERE product_id = ?
        ''', (
            vals['name'],
            vals['sku'],
            vals['barcode'],
            vals['category_id'],
            vals['supplier_id'],
            vals['cost_price'],
            vals['selling_price'],
            vals['stock_level'],
            vals['reorder_point'],
            vals['lead_time_days'],
            product_id,
        ))
        db.commit()
        log_action(user['user_id'], 'PRODUCT_UPDATED', {'product_id': product_id})
        db.close()
        return jsonify({'message': 'Product updated successfully'})
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'SKU or Barcode already exists'}), 400

@app.route('/api/products/<int:product_id>', methods=['DELETE'])
@jwt_required()
def delete_product(product_id):
    """Delete product (Admin only)"""
    current_user = get_jwt_identity()
    
    db = get_db()
    user = db.execute("SELECT user_id, role FROM users WHERE username = ?", (current_user,)).fetchone()
    
    if user['role'] != 'administrator':
        db.close()
        return jsonify({'error': 'Insufficient permissions'}), 403
    
    product = db.execute("SELECT * FROM products WHERE product_id = ?", (product_id,)).fetchone()
    
    if not product:
        db.close()
        return jsonify({'error': 'Product not found'}), 404

    try:
        db.execute("DELETE FROM products WHERE product_id = ?", (product_id,))
        db.commit()
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({
            'error': 'Cannot delete this product; it is still referenced by sales history or other records.'
        }), 400

    log_action(user['user_id'], 'PRODUCT_DELETED', {'product_id': product_id, 'name': product['name']})
    db.close()

    return jsonify({'message': 'Product deleted successfully'})

# Transaction Endpoints
@app.route('/api/transactions', methods=['POST'])
@jwt_required()
def create_transaction():
    """Create new sales transaction: line items, stock deduction, validated totals."""
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
            return jsonify({
                'error': f'Line {idx + 1}: a valid product and whole-number quantity are required',
            }), 400
        if pid < 1 or qty < 1:
            return jsonify({'error': f'Line {idx + 1}: quantity must be at least 1'}), 400
        normalized_lines.append({'product_id': pid, 'quantity': qty})

    qty_per_product = Counter()
    for line in normalized_lines:
        qty_per_product[line['product_id']] += line['quantity']

    db = get_db()
    try:
        user = db.execute(
            "SELECT user_id FROM users WHERE username = ?", (current_user,)
        ).fetchone()
        if not user:
            return jsonify({'error': 'User not found'}), 404

        product_cache = {}
        for pid, needed in qty_per_product.items():
            product = db.execute(
                "SELECT * FROM products WHERE product_id = ?", (pid,)
            ).fetchone()
            if not product:
                return jsonify({'error': f'Product #{pid} was not found'}), 404
            available = int(product['stock_level'])
            if needed > available:
                return jsonify({
                    'error': (
                        f'Insufficient stock for "{product["name"]}": '
                        f'{needed} requested in this sale, {available} available'
                    ),
                }), 400
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
                'product_id': line['product_id'],
                'quantity': qty,
                'unit_price': unit_price,
                'subtotal': subtotal,
                'name': product['name'],
                'sku': product['sku'],
            })

        total_amount = round(total_amount, 2)

        cursor = db.execute(
            "INSERT INTO transactions (total_amount, user_id) VALUES (?, ?)",
            (total_amount, user['user_id']),
        )
        transaction_id = cursor.lastrowid

        for item in items_to_insert:
            db.execute(
                '''
                INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, subtotal)
                VALUES (?, ?, ?, ?, ?)
                ''',
                (
                    transaction_id,
                    item['product_id'],
                    item['quantity'],
                    item['unit_price'],
                    item['subtotal'],
                ),
            )
            db.execute(
                "UPDATE products SET stock_level = stock_level - ? WHERE product_id = ?",
                (item['quantity'], item['product_id']),
            )

        db.commit()
        log_action(
            user['user_id'],
            'TRANSACTION_CREATED',
            {'transaction_id': transaction_id, 'total': total_amount},
        )

        response_items = [
            {
                'product_id': i['product_id'],
                'name': i['name'],
                'sku': i['sku'],
                'quantity': i['quantity'],
                'unit_price': i['unit_price'],
                'subtotal': i['subtotal'],
            }
            for i in items_to_insert
        ]

        return jsonify({
            'message': 'Transaction completed successfully',
            'transaction_id': transaction_id,
            'total_amount': total_amount,
            'items': response_items,
        }), 201
    except Exception:
        db.rollback()
        return jsonify({'error': 'Could not complete sale. Please try again.'}), 500
    finally:
        db.close()

@app.route('/api/transactions', methods=['GET'])
@jwt_required()
def get_transactions():
    """Get all transactions"""
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
@jwt_required()
def get_transaction(transaction_id):
    """Get transaction details"""
    db = get_db()
    transaction = db.execute('''
        SELECT t.*, u.username
        FROM transactions t
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

# Analytics and Decision Support
@app.route('/api/analytics/dashboard', methods=['GET'])
@jwt_required()
def get_dashboard_data():
    """Get dashboard analytics"""
    db = get_db()
    
    # Total products
    total_products = db.execute("SELECT COUNT(*) as count FROM products").fetchone()['count']
    
    # Low stock items
    low_stock = db.execute('''
        SELECT COUNT(*) as count FROM products WHERE stock_level <= reorder_point
    ''').fetchone()['count']
    
    # Today's sales
    today_sales = db.execute('''
        SELECT COALESCE(SUM(total_amount), 0) as total
        FROM transactions
        WHERE DATE(transaction_date) = DATE('now') AND status = 'completed'
    ''').fetchone()['total']
    
    # This week's sales
    week_sales = db.execute('''
        SELECT COALESCE(SUM(total_amount), 0) as total
        FROM transactions
        WHERE DATE(transaction_date) >= DATE('now', '-7 days') AND status = 'completed'
    ''').fetchone()['total']
    
    # Stock valuation (at cost)
    stock_value = db.execute('''
        SELECT COALESCE(SUM(stock_level * cost_price), 0) as value FROM products
    ''').fetchone()['value']
    
    # Top selling products (last 30 days)
    top_products = db.execute('''
        SELECT p.name, p.sku, SUM(ti.quantity) as total_sold, SUM(ti.subtotal) as revenue
        FROM transaction_items ti
        JOIN products p ON ti.product_id = p.product_id
        JOIN transactions t ON ti.transaction_id = t.transaction_id
        WHERE DATE(t.transaction_date) >= DATE('now', '-30 days') AND t.status = 'completed'
        GROUP BY p.product_id
        ORDER BY total_sold DESC
        LIMIT 10
    ''').fetchall()
    
    # Sales trend (last 7 days)
    sales_trend = db.execute('''
        SELECT DATE(transaction_date) as date, SUM(total_amount) as total
        FROM transactions
        WHERE DATE(transaction_date) >= DATE('now', '-7 days') AND status = 'completed'
        GROUP BY DATE(transaction_date)
        ORDER BY date
    ''').fetchall()
    
    db.close()
    
    return jsonify({
        'summary': {
            'total_products': total_products,
            'low_stock_count': low_stock,
            'today_sales': round(today_sales, 2),
            'week_sales': round(week_sales, 2),
            'stock_value': round(stock_value, 2)
        },
        'top_products': [dict(p) for p in top_products],
        'sales_trend': [dict(s) for s in sales_trend]
    })

@app.route('/api/analytics/restock-recommendations', methods=['GET'])
@jwt_required()
def get_restock_recommendations():
    """Generate restock recommendations using demand forecasting"""
    db = get_db()
    
    # Get products that need restocking
    products = db.execute('''
        SELECT p.*, c.category_name, s.supplier_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
        WHERE p.stock_level <= p.reorder_point
        ORDER BY p.stock_level ASC
    ''').fetchall()
    
    recommendations = []
    
    for product in products:
        # Calculate average daily sales (last 30 days)
        sales_data = db.execute('''
            SELECT SUM(ti.quantity) as total_sold
            FROM transaction_items ti
            JOIN transactions t ON ti.transaction_id = t.transaction_id
            WHERE ti.product_id = ? 
            AND DATE(t.transaction_date) >= DATE('now', '-30 days')
            AND t.status = 'completed'
        ''', (product['product_id'],)).fetchone()
        
        total_sold = sales_data['total_sold'] if sales_data['total_sold'] else 0
        avg_daily_sales = total_sold / 30.0

        # Suggested order qty: cover lead-time demand + safety, but never rely only on
        # sales history (no sales → avg_daily_sales=0 would otherwise always yield 1).
        stock = int(product['stock_level'])
        reorder_pt = int(product['reorder_point'])
        lead = max(1, int(product['lead_time_days']))
        safety_factor = 1.5

        demand_through_lead = avg_daily_sales * lead * safety_factor
        demand_target = int(math.ceil(stock + demand_through_lead))
        # Policy floor: bring inventory up to at least 2× reorder point when restocking
        policy_target = max(reorder_pt * 2, reorder_pt + 1)
        target_stock = max(policy_target, demand_target)
        suggested_quantity = max(1, target_stock - stock)
        
        # Determine priority
        if product['stock_level'] == 0:
            priority = 'CRITICAL'
        elif product['stock_level'] <= product['reorder_point'] * 0.5:
            priority = 'HIGH'
        else:
            priority = 'MEDIUM'
        
        recommendations.append({
            'product_id': product['product_id'],
            'name': product['name'],
            'sku': product['sku'],
            'current_stock': product['stock_level'],
            'reorder_point': product['reorder_point'],
            'suggested_quantity': suggested_quantity,
            'avg_daily_sales': round(avg_daily_sales, 2),
            'lead_time_days': product['lead_time_days'],
            'cost_price': product['cost_price'],
            'estimated_cost': round(suggested_quantity * product['cost_price'], 2),
            'priority': priority,
            'category': product['category_name'],
            'supplier': product['supplier_name']
        })
    
    db.close()
    
    return jsonify({
        'recommendations': recommendations,
        'total_items': len(recommendations),
        'total_estimated_cost': sum(r['estimated_cost'] for r in recommendations)
    })

# Categories
@app.route('/api/categories', methods=['GET'])
@jwt_required()
def get_categories():
    """Get all categories"""
    db = get_db()
    categories = db.execute("SELECT * FROM categories ORDER BY category_name").fetchall()
    db.close()
    return jsonify([dict(c) for c in categories])

@app.route('/api/categories', methods=['POST'])
@jwt_required()
def create_category():
    """Create new category"""
    data = request.get_json()
    
    if not data.get('category_name'):
        return jsonify({'error': 'Category name required'}), 400
    
    db = get_db()
    try:
        cursor = db.execute("INSERT INTO categories (category_name) VALUES (?)", (data['category_name'],))
        category_id = cursor.lastrowid
        db.commit()
        db.close()
        return jsonify({'message': 'Category created', 'category_id': category_id}), 201
    except sqlite3.IntegrityError:
        db.close()
        return jsonify({'error': 'Category already exists'}), 400

# Suppliers
@app.route('/api/suppliers', methods=['GET'])
@jwt_required()
def get_suppliers():
    """Get all suppliers"""
    db = get_db()
    suppliers = db.execute("SELECT * FROM suppliers ORDER BY supplier_name").fetchall()
    db.close()
    return jsonify([dict(s) for s in suppliers])

@app.route('/api/suppliers', methods=['POST'])
@jwt_required()
def create_supplier():
    """Create new supplier"""
    data = request.get_json()
    
    if not data.get('supplier_name'):
        return jsonify({'error': 'Supplier name required'}), 400
    
    db = get_db()
    cursor = db.execute('''
        INSERT INTO suppliers (supplier_name, contact_person, phone, email, address)
        VALUES (?, ?, ?, ?, ?)
    ''', (
        data['supplier_name'],
        data.get('contact_person'),
        data.get('phone'),
        data.get('email'),
        data.get('address')
    ))
    supplier_id = cursor.lastrowid
    db.commit()
    db.close()
    
    return jsonify({'message': 'Supplier created', 'supplier_id': supplier_id}), 201

# Reports
@app.route('/api/reports/sales', methods=['GET'])
@jwt_required()
def generate_sales_report():
    """Generate sales report"""
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    format_type = request.args.get('format', 'json')
    
    db = get_db()
    query = '''
        SELECT 
            DATE(t.transaction_date) as date,
            COUNT(t.transaction_id) as transaction_count,
            SUM(t.total_amount) as total_sales,
            AVG(t.total_amount) as avg_transaction
        FROM transactions t
        WHERE t.status = 'completed'
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
@jwt_required()
def generate_inventory_report():
    """Generate inventory report"""
    db = get_db()
    
    products = db.execute('''
        SELECT p.*, c.category_name, s.supplier_name,
               (p.stock_level * p.cost_price) as stock_value
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.category_id
        LEFT JOIN suppliers s ON p.supplier_id = s.supplier_id
        ORDER BY p.name
    ''').fetchall()
    
    db.close()
    
    return jsonify([dict(p) for p in products])

# Health check
@app.route('/api/health', methods=['GET'])
def health_check():
    """API health check"""
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    if not os.path.exists(DATABASE):
        init_db()
        print("Database initialized successfully")

    ensure_default_suppliers()
    ensure_sample_products()

    print("FLECS Backend Server Starting...")
    print("Default Admin Credentials:")
    print("Username: admin")
    print("Password: admin123")
    print("\nAPI running on http://localhost:5000")
    
    app.run(debug=True, host='0.0.0.0', port=5000)
