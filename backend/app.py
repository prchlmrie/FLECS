"""
FLECS Backend API Server
Flask REST API for the FLECS Decision Support System
"""
<<<<<<< HEAD
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import sqlite3

def train_demand_model(product_id):
    # Connect to the DB
    conn = sqlite3.connect('flecs.db')
    
    # Fetch historical sales using a JOIN because your schema is normalized
    query = """
        SELECT ti.quantity, t.transaction_date as sale_date 
        FROM transaction_items ti 
        JOIN transactions t ON ti.transaction_id = t.transaction_id 
        WHERE ti.product_id = ?
    """
    df = pd.read_sql_query(query, conn, params=(product_id,))
    conn.close()

    if len(df) < 5: # Need a minimum amount of data to "learn"
        return None

    # Feature Engineering: Convert date to 'Day of Week' (0-6)
    df['sale_date'] = pd.to_datetime(df['sale_date'])
    df['day_of_week'] = df['sale_date'].dt.dayofweek
    
    # X = Features (Day of Week), y = Target (Quantity Sold)
    X = df[['day_of_week']]
    y = df['quantity']

    # Initialize and Train the Random Forest
    model = RandomForestRegressor(n_estimators=100, random_state=42)
    model.fit(X, y)
    return model
=======
>>>>>>> 0d6c20c48fe787f3db347da88532ae223ac2d6b6

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, timedelta
import sqlite3
import json
import os
from functools import wraps
import pandas as pd
import numpy as np
from io import BytesIO
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import csv

app = Flask(__name__)
app.config['JWT_SECRET_KEY'] = 'your-secret-key-change-in-production'
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=8)
CORS(app)
jwt = JWTManager(app)

DATABASE = 'flecs.db'

# Database Helper Functions
def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

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
    
    access_token = create_access_token(identity=username)
    return jsonify({
        'token': access_token,
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
    user = db.execute("SELECT role FROM users WHERE username = ?", (current_user,)).fetchone()
    
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
    
    required_fields = ['name', 'sku', 'cost_price', 'selling_price']
    for field in required_fields:
        if field not in data:
            return jsonify({'error': f'Missing required field: {field}'}), 400
    
    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
    
    try:
        cursor = db.execute('''
            INSERT INTO products (name, sku, barcode, category_id, supplier_id, 
                                cost_price, selling_price, stock_level, reorder_point, lead_time_days)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data['name'], data['sku'], data.get('barcode'),
            data.get('category_id'), data.get('supplier_id'),
            data['cost_price'], data['selling_price'],
            data.get('stock_level', 0), data.get('reorder_point', 10),
            data.get('lead_time_days', 7)
        ))
        product_id = cursor.lastrowid
        db.commit()
        log_action(user['user_id'], 'PRODUCT_CREATED', {'product_id': product_id, 'name': data['name']})
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
        db.execute('''
            UPDATE products SET name = ?, sku = ?, barcode = ?, category_id = ?,
                              supplier_id = ?, cost_price = ?, selling_price = ?,
                              stock_level = ?, reorder_point = ?, lead_time_days = ?
            WHERE product_id = ?
        ''', (
            data.get('name', product['name']),
            data.get('sku', product['sku']),
            data.get('barcode', product['barcode']),
            data.get('category_id', product['category_id']),
            data.get('supplier_id', product['supplier_id']),
            data.get('cost_price', product['cost_price']),
            data.get('selling_price', product['selling_price']),
            data.get('stock_level', product['stock_level']),
            data.get('reorder_point', product['reorder_point']),
            data.get('lead_time_days', product['lead_time_days']),
            product_id
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
    
    if product['stock_level'] > 0:
        db.close()
        return jsonify({'error': 'Cannot delete product with active stock'}), 400
    
    db.execute("DELETE FROM products WHERE product_id = ?", (product_id,))
    db.commit()
    log_action(user['user_id'], 'PRODUCT_DELETED', {'product_id': product_id, 'name': product['name']})
    db.close()
    
    return jsonify({'message': 'Product deleted successfully'})

# Transaction Endpoints
@app.route('/api/transactions', methods=['POST'])
@jwt_required()
def create_transaction():
    """Create new sales transaction"""
    data = request.get_json()
    current_user = get_jwt_identity()
    
    if not data.get('items') or len(data['items']) == 0:
        return jsonify({'error': 'Transaction must contain at least one item'}), 400
    
    db = get_db()
    user = db.execute("SELECT user_id FROM users WHERE username = ?", (current_user,)).fetchone()
    
    try:
        # Calculate total and validate stock
        total_amount = 0
        items_to_insert = []
        
        for item in data['items']:
            product = db.execute("SELECT * FROM products WHERE product_id = ?", (item['product_id'],)).fetchone()
            
            if not product:
                db.close()
                return jsonify({'error': f'Product {item["product_id"]} not found'}), 404
            
            if product['stock_level'] < item['quantity']:
                db.close()
                return jsonify({'error': f'Insufficient stock for {product["name"]}'}), 400
            
            subtotal = item['quantity'] * product['selling_price']
            total_amount += subtotal
            items_to_insert.append({
                'product_id': item['product_id'],
                'quantity': item['quantity'],
                'unit_price': product['selling_price'],
                'subtotal': subtotal
            })
        
        # Create transaction
        cursor = db.execute(
            "INSERT INTO transactions (total_amount, user_id) VALUES (?, ?)",
            (total_amount, user['user_id'])
        )
        transaction_id = cursor.lastrowid
        
        # Insert transaction items and update stock
        for item in items_to_insert:
            db.execute('''
                INSERT INTO transaction_items (transaction_id, product_id, quantity, unit_price, subtotal)
                VALUES (?, ?, ?, ?, ?)
            ''', (transaction_id, item['product_id'], item['quantity'], item['unit_price'], item['subtotal']))
            
            db.execute(
                "UPDATE products SET stock_level = stock_level - ? WHERE product_id = ?",
                (item['quantity'], item['product_id'])
            )
        
        db.commit()
        log_action(user['user_id'], 'TRANSACTION_CREATED', {'transaction_id': transaction_id, 'total': total_amount})
        db.close()
        
        return jsonify({
            'message': 'Transaction completed successfully',
            'transaction_id': transaction_id,
            'total_amount': total_amount
        }), 201
    except Exception as e:
        db.rollback()
        db.close()
        return jsonify({'error': str(e)}), 500

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
<<<<<<< HEAD
def restock():
    conn = get_db() 
    products = conn.execute('SELECT * FROM products').fetchall()
    suggestions = []

    for p in products:
        model = train_demand_model(p['product_id'])
        
        from datetime import datetime
        current_day = datetime.now().weekday()

        if model:
            predicted_demand = model.predict([[current_day]])[0]
        else:
            predicted_demand = p['reorder_point'] * 0.2 

        if p['stock_level'] <= (predicted_demand * p['lead_time_days']):
            # Calculate estimated cost for the purchase order
            suggested_qty = int(predicted_demand * 7)
            est_cost = suggested_qty * p['cost_price']

            # Match React's expected "CRITICAL", "HIGH", "MEDIUM"
            if p['stock_level'] == 0:
                priority = 'CRITICAL'
            elif p['stock_level'] < (p['reorder_point'] / 2):
                priority = 'HIGH'
            else:
                priority = 'MEDIUM'

            suggestions.append({
                'product_id': p['product_id'],
                'name': p['name'],
                'sku': p['sku'], # React needs SKU
                'current_stock': p['stock_level'], # React needs current_stock
                'reorder_point': p['reorder_point'], # React needs reorder_point
                'avg_daily_sales': round(predicted_demand, 2),
                'suggested_quantity': suggested_qty, 
                'lead_time_days': p['lead_time_days'],
                'cost_price': p['cost_price'],
                'estimated_cost': est_cost, # React needs this for the total ₱ calculation
                'priority': priority # React needs CRITICAL/HIGH/MEDIUM
            })

    conn.close()
    return jsonify(suggestions)
=======
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
        
        # Calculate suggested order quantity
        # Formula: (Average Daily Sales × Lead Time × Safety Factor) - Current Stock
        safety_factor = 1.5
        suggested_quantity = max(1, int((avg_daily_sales * product['lead_time_days'] * safety_factor) - product['stock_level']))
        
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
>>>>>>> 0d6c20c48fe787f3db347da88532ae223ac2d6b6

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
    
    print("FLECS Backend Server Starting...")
    print("Default Admin Credentials:")
    print("Username: admin")
    print("Password: admin123")
    print("\nAPI running on http://localhost:5000")
    
    app.run(debug=True, host='0.0.0.0', port=5000)
