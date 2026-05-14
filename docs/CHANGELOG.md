# FLECS — change log and task documentation

## 2026-05-14 — UI updates: Quick guide toggle and Tooltip fixes

### Context

Added the ability to toggle the quick guide back on if accidentally dismissed, and fixed the visual proportions and placement of the help tooltips on fields like SKU and Reorder Point.

### Frontend additions and changes

- **DashboardOnboarding**: Added a "Show quick guide" button when the guide has been dismissed. Made the onboarding checklist manually toggleable so users can override automatic completion.
- **onboardingStorage**: Added `restoreDashboardOnboarding` to support the toggle behavior. Added `toggleCategoryAdded`, `toggleSupplierAdded`, `toggleProductAdded`, and `toggleFirstSale`.
- **HelpTooltip**: Updated CSS to `width: max-content` instead of a fixed minimum width to better compensate based on text length. Changed `bottom` to `top` so the bubble pops out below the target rather than above.
- **POS**: Fixed an issue where a small number of products (3 or fewer) would be pinned to the bottom by adding `align-content: start` to `.product-grid`. Fixed the "Complete Sale" button sizing so it no longer overflows its container. Fixed a layout bug where the search bar would stretch vertically on large screens, causing the search icon to misalign with the input.
- **Restocking**: Added padding to the bottom of the page to prevent the action bar from overlapping the last row when generating a purchase order.

### Files touched

- `frontend/src/components/DashboardOnboarding.js`
- `frontend/src/components/DashboardOnboarding.css`
- `frontend/src/onboardingStorage.js`
- `frontend/src/components/HelpTooltip.css`
- `frontend/src/components/POS.css`
- `frontend/src/components/Restocking.css`
- `docs/CHANGELOG.md`

---

## 2026-04-04 — Environment setup, backend fixes, and runbook

### Context

Initial work to run the FLECS stack locally, validate the API, and fix defects found during smoke testing.

### Backend

| Change | Description |
|--------|-------------|
| **Dependency install** | Python packages from `backend/requirements.txt` (Flask, Flask-CORS, Flask-JWT-Extended, Werkzeug, pandas, numpy, reportlab, python-dotenv). |
| **Register endpoint (500 error)** | `register()` selected only `role` from the current user row but called `log_action(user['user_id'], …)`, which raised `IndexError` / 500. The query was updated to `SELECT user_id, role FROM users WHERE username = ?`. |
| **Database file location** | `flecs.db` is stored next to `app.py` using a resolved backend directory (`_backend_dir`), so the database path does not depend on the process current working directory. |

### Frontend

No changes in this task.

### Configuration

- On Windows PowerShell, use `Set-Location …; command` instead of `&&` if the shell version does not support `&&`.
- **Node.js / npm**: The React app requires Node.js on `PATH`. If `npm` is missing, install Node.js LTS and reopen the terminal.

### Verification

- `GET http://127.0.0.1:5000/api/health` returns JSON with `status: healthy`.
- `POST /api/auth/login` with default admin credentials returns a JWT and user payload.
- Authenticated `POST /api/auth/register` creates a user without 500.

### Files touched

- `backend/app.py` — register query; database path alignment with `_backend_dir` (see later tasks for full `app.py` evolution).

---

## 2026-04-04 — 3.1 User authentication and session management

### Context

Formal alignment with **3.1** (JWT-based auth, protected routes, login redirect, logout, eight-hour token lifetime). Most behavior already existed; this task **hardened** the implementation and fixed interaction bugs.

### Requirements addressed

| ID | Requirement | How it is met |
|----|-------------|----------------|
| FR-01 | Registered users log in with username and password | `POST /api/auth/login`; login form submits credentials. |
| FR-02 | Validate against stored hashed passwords | Werkzeug `check_password_hash` against `password_hash` in SQLite. |
| FR-03 | Issue JWT on successful login | `create_access_token(identity=username)`. |
| FR-04 | Valid JWT for protected API endpoints | `@jwt_required()` on all routes except `/api/auth/login` and `/api/health`. |
| FR-05 | Redirect unauthenticated users to login | React: routes under the main app shell require `user`; otherwise `<Navigate to="/login" />`. |
| FR-06 | Logout clears local session | `handleLogout` / `clearAuthSession()` removes token and user from `localStorage`. |
| FR-07 | Token expiration after eight hours | `JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=8)`; expired/invalid tokens yield **401** on protected calls; client clears session and redirects to `/login`. |

### Backend additions and changes

| Item | Detail |
|------|--------|
| **Environment loading** | `load_dotenv` loads `backend/.env` if present (path resolved via `_backend_dir`). |
| **JWT secret** | `JWT_SECRET_KEY` read from environment variable `JWT_SECRET_KEY`, with a dev-only default string if unset. **Production must set a strong secret.** |
| **Login response** | Successful login JSON includes `expires_in` (seconds), derived from `JWT_ACCESS_TOKEN_EXPIRES` (28800 for eight hours). |
| **Path consistency** | `_backend_dir` is used for both `.env` loading and `DATABASE` path. |

### Frontend additions and changes

| File | Change |
|------|--------|
| `src/authSession.js` | **New.** Central helpers: `clearAuthSession`, `persistSession`, `readStoredSession`. Corrupt stored user JSON triggers cleanup instead of a crash. |
| `src/index.js` | Imports `./api` before `App` so axios **request/response interceptors** are registered before any UI runs. |
| `src/api.js` | Response interceptor clears session and navigates to `/login` on **401** only when the request is **not** `POST …/auth/login` (wrong password must not trigger a forced navigation that hides the login error). Uses `clearAuthSession()` and `window.location.assign(…/login)`. |
| `src/App.js` | Uses `authSession` helpers for restore-on-load, login persistence, and logout. |
| `src/components/Login.js` | Uses `api.login()` instead of a separate `axios` call so behavior matches the shared client and interceptors. |

### Configuration

Create optional file `backend/.env`:

```env
JWT_SECRET_KEY=your-long-random-secret-here
```

Frontend continues to use `REACT_APP_API_URL` (see `frontend/.env`) defaulting to `http://localhost:5000/api`.

### Verification

1. **Valid login**: Credentials accepted; token and user stored; redirect to dashboard (existing routing).
2. **Invalid login**: 401 from `/api/auth/login`; error message remains visible (no spurious full redirect from the interceptor).
3. **Expired / invalid token on API call**: 401 from a protected route; `localStorage` cleared; browser sent to `/login`.
4. **Logout**: Sidebar logout clears storage and returns to login flow without requiring a full page reload for that path.
5. **Login payload**: Response includes `expires_in: 28800` (eight hours in seconds).

### Files touched

- `backend/app.py`
- `frontend/src/authSession.js` (new)
- `frontend/src/index.js`
- `frontend/src/api.js`
- `frontend/src/App.js`
- `frontend/src/components/Login.js`

---

## 2026-04-04 — 3.2 Product and inventory management

### Context

Delivers and tightens **3.2** (inventory CRUD, search/filter, validation, category/supplier linkage, low-stock signaling) per **FR-08–FR-15**.

### Requirements addressed

| ID | Requirement | Implementation |
|----|-------------|----------------|
| FR-08 | List products with stock-related attributes | `GET /api/products` returns joined category/supplier names plus `stock_level`, `reorder_point`, prices, etc.; table shows stock, reorder point, supplier, and status. |
| FR-09 | Create products (authorized) | Existing `POST /api/products` with stricter validation; clerks/admins with JWT can create. |
| FR-10 | Update products | `PUT /api/products/<id>` uses shared `parse_product_body` for validated updates. |
| FR-11 | Delete with confirmation | Browser confirm with product name/SKU and stock warning; admin-only delete unchanged; removal allowed when DB permits (see below). |
| FR-12 | Search by name, SKU, barcode | Backend `search` query already matched all three; frontend debounces input (~320 ms) and refetches for responsive filtering without flashing full-page load after the first fetch. |
| FR-13 | Validate required fields before save | `parse_product_body` on server; client `validateFormClient` + `required` inputs; numeric and range checks for prices, stock, reorder point, lead time. |
| FR-14 | Associate product with category and supplier | **Required** `category_id` and `supplier_id` on create/update; `PRAGMA foreign_keys = ON` so invalid IDs fail cleanly; default suppliers seeded when table is empty. |
| FR-15 | Low-stock below defined threshold | Threshold = `reorder_point`; badges (Out of Stock / Low Stock / In Stock) with tooltips; table rows use subtle highlight when `stock_level === 0` or `stock_level <= reorder_point`. |

### Backend

| Item | Detail |
|------|--------|
| **Foreign keys** | `get_db()` runs `PRAGMA foreign_keys = ON`. |
| **Default suppliers** | `ensure_default_suppliers()` inserts two rows if `suppliers` is empty; invoked once per process via `@app.before_request` flag `_reference_seeded`. |
| **`parse_product_body`** | Central validation/normalization for create/update: name, SKU, required category/supplier IDs, prices ≥ 0, stock/reorder rules, lead time ≥ 1; optional/clearable `barcode`. |
| **Delete behavior** | Removed “cannot delete if stock &gt; 0” rule; `DELETE` runs under FK constraints. `sqlite3.IntegrityError` returns 400 if the product is still referenced (e.g. sales line items). |

### Frontend

| Item | Detail |
|------|--------|
| **`buildProductPayload`** | Sends numeric types and `null` barcode when empty. |
| **Form** | Category, supplier, and reorder point marked required; client validation before submit. |
| **Table** | Supplier column; reorder point column; low-stock row class; delete passes full product into confirm. |
| **Empty suppliers** | Banner with link to Settings when no suppliers returned (first load after seed should normally hide this). |
| **Loading UX** | Full-page spinner only on first inventory load; later search/filter updates do not blank the page. |

### Configuration

No new environment variables. Existing API URL behavior unchanged.

### Verification

1. Open Inventory: products list shows stock, reorder point, supplier, category, status badges.  
2. Search: typing in the search box filters by name/SKU/barcode after a short debounce.  
3. Add product: omit category or supplier → client error; fix and save → 201 from API.  
4. Edit legacy row missing category/supplier: save after selecting both → succeeds.  
5. Low stock: set `stock_level` ≤ `reorder_point` → warning badge and highlighted row.  
6. Delete (admin): confirm dialog; if product has transaction lines, API returns the integrity error message.  

### Files touched

- `backend/app.py`
- `frontend/src/components/Inventory.js`
- `frontend/src/components/Inventory.css`
- `docs/CHANGELOG.md`

---

## 2026-04-04 — 3.3 Point-of-Sale (POS) transaction processing

### Context

Aligns the POS flow with **3.3** and **FR-16–FR-23**: search/select, live totals, persisted transaction + line items, stock deduction, clear success/failure feedback, cart preserved on failure, and server-side enforcement when requested quantity exceeds stock (including duplicate lines for the same product).

### Requirements addressed

| ID | Requirement | Implementation |
|----|-------------|----------------|
| FR-16 | Search and select products | Debounced search calls `GET /api/products` (name, SKU, barcode). In-stock and out-of-stock products are listed; out-of-stock cards are disabled and keyboard-accessible where applicable. |
| FR-17 | Subtotal and total in real time | `useMemo` derives line count, subtotal, and total from `cart` on every change; summary shows line items count, subtotal, and total. |
| FR-18 | Transaction record per sale | Unchanged: `INSERT INTO transactions` with `total_amount` and `user_id`. |
| FR-19 | Line items per product | Unchanged: `INSERT INTO transaction_items` per line; API response now includes `items` with `name`, `sku`, `quantity`, `unit_price`, `subtotal`. |
| FR-20 | Deduct stock on success | Unchanged: `UPDATE products SET stock_level = stock_level - ?` per line after inserts. |
| FR-21 | Success/failure notification | Success alert + receipt modal; failure sets `error` from API (or fallback) without clearing the cart. |
| FR-22 | Preserve cart on failure | Checkout `catch` only updates `error`; `setCart` runs only after successful response. |
| FR-23 | Prevent checkout when quantity exceeds stock | Client blocks quantity above `stock_level`; server aggregates quantities **per product** across all lines, compares to current `stock_level`, returns **400** with requested vs available if insufficient. |

### Backend

| Item | Detail |
|------|--------|
| **Line validation** | Each item must be a dict with integer `product_id` and `quantity` ≥ 1. |
| **Stock aggregation** | `collections.Counter` sums quantity per `product_id` before any write so split lines cannot oversell. |
| **Response body** | `201` payload includes `items` array (authoritative prices and subtotals for the receipt). |
| **Errors** | Per-line validation messages; insufficient stock message includes product name, total requested in sale, and available quantity. |
| **Transactions** | `try` / `commit` / `rollback` / `finally: db.close()` for consistent connection handling. |
| **500** | Generic message to the client on unexpected errors (cart unaffected on client until success). |

### Frontend

| Item | Detail |
|------|--------|
| **POS.js** | Debounced product search; `productsLoading` vs `checkoutLoading`; `cartTotals` via `useMemo`; receipt built from `response.data.items`; improved quantity `onChange` (ignores empty/invalid transient input). |
| **POS.css** | Search field layout, disabled product card, barcode line, out-of-stock styling, search hint. |

### Verification

1. Add items: subtotal/total and line count update immediately.  
2. Search matches barcode/SKU/name (same API as Inventory).  
3. Complete sale: receipt matches server `items` and `total_amount`; product list reload shows lower stock.  
4. Set cart quantity above stock: error shown, cart unchanged.  
5. Simulate concurrent shortage: server returns insufficient-stock error; cart remains.  
6. (API) Send two lines with same `product_id` whose quantities sum above stock: **400** before any DB write.  

### Files touched

- `backend/app.py`
- `frontend/src/components/POS.js`
- `frontend/src/components/POS.css`
- `docs/CHANGELOG.md`

## 2026-04-04 — Restocking: purchase order button + suggested quantity

### Context

The **Generate Purchase Order** control had **no `onClick` handler**, so it appeared to do nothing. **Suggested quantity** used only `(avg_daily_sales × lead × safety) − stock`; with **no sales in the last 30 days** that expression was ≤ 0, so `max(1, …)` always became **1**.

### Backend

- Restock formula now sets a **policy target** of at least **`2 × reorder_point`** (and at least `reorder_point + 1`), compares with **demand-based target** `ceil(stock + avg_daily_sales × lead_time × 1.5)`, and takes the **maximum**, then **`suggested_quantity = max(1, target_stock − stock)`**.
- Added **`import math`** for `ceil`.

### Frontend

- **Generate Purchase Order** opens a **preview modal** (selected lines), with **Download CSV** and **Print**; optional success toast after CSV download.
- **Print** uses `@media print` on `.po-print-area` (see `Restocking.css`).
- Subtitle text clarifies that suggestions use **30-day sales + reorder policy**.

### Files touched

- `backend/app.py`
- `frontend/src/components/Restocking.js`
- `frontend/src/components/Restocking.css`
- `docs/CHANGELOG.md`

---

## 2026-04-04 — Exponential smoothing for restock demand forecast

### Context

Restocking previously used a **flat naive rate** (`total sold ÷ 30`) for “average daily sales,” which ignores **time order** and **recent vs older** demand. The pipeline now uses **simple exponential smoothing (SES)** on a **per-product daily time series** built from completed POS line items.

### Model (simple exponential smoothing)

- **Series:** For each product, build a vector of length **`history_days`** (default **90** calendar days), **oldest → newest**. Each element is total units sold that day; days with no sales are **0**.
- **Recurrence:** (Brown’s single-parameter smoothing) \(S_t = \alpha x_t + (1-\alpha) S_{t-1}\), with \(S_0 = x_0\).
- **Forecast:** The **smoothed level** \(S_T\) after the last observed day is used as **expected daily demand** in the existing restock formula: `demand_through_lead = forecast_daily × lead_time × safety_factor`, then combined with the **policy target** (`max(2×reorder_point, …)`) as before.
- **Reference field:** Each recommendation includes **`naive_avg_daily`** (arithmetic mean of the same daily series) for comparison; the UI tooltip on the forecast column shows this when present.

### API

- **`GET /api/analytics/restock-recommendations`** response adds:
  - **`forecast_model`**: `{ method, alpha, history_days, description }`
  - Per item: **`naive_avg_daily`** (in addition to **`avg_daily_sales`**, which now holds the **SES forecast**).

### Configuration (optional environment variables)

| Variable | Default | Role |
|----------|---------|------|
| `FLECS_FORECAST_HISTORY_DAYS` | `90` | Length of the daily series window |
| `FLECS_SES_ALPHA` | `0.35` | Smoothing parameter \(\alpha\) (clamped to \([0.01, 0.99]\) in code) |

### Frontend

- Restocking table column renamed to **“SES forecast (units/day)”**; subtitle describes SES + policy.
- Forecast cell shows two decimal places; **tooltip** shows naive mean when `naive_avg_daily` is returned.

### Files touched

- `backend/app.py`
- `frontend/src/components/Restocking.js`
- `docs/CHANGELOG.md`

---

## 2026-04-04 — Sample sales dataset (demo transactions)

### Context

Adds **synthetic POS history** so you can test and visualize **Dashboard** trends, **Reports**, **Restocking (SES)**, and **inventory after sales** without entering months of receipts by hand.

### Behavior

- **`ensure_sample_products()`** uses **`INSERT OR IGNORE`** on the fixed **DEMO-** SKUs, so **your own rows stay** (e.g. a single hand-entered Coca-Cola) and **missing demo products are added** every startup until all SKUs exist.
- **`ensure_sample_transactions()`** loads a long synthetic history when **`transaction_items` count is below `FLECS_DEMO_SALES_MIN_LINES_TO_SKIP`** (default **300**) and you have at most **`FLECS_DEMO_SALES_MAX_TXNS_TO_REBUILD`** completed transactions (default **12**). If it rebuilds, it **clears** `transaction_items` / `transactions`, **restores DEMO-** stocks from the catalog table, and **bumps non–DEMO-** stock with `MAX(stock_level, reorder_point×4)` so simulation has room.
- Set **`FLECS_FORCE_DEMO_RELOAD=1`** to wipe and rebuild demo sales even when counts are higher (**dev only**).

### Previous behavior (superseded)

- Earlier, demo products were skipped whenever **any** product existed, and demo sales whenever **any** transaction existed — which blocked the full dataset if you only had one item or one sale.
- Builds about **1–5 transactions per calendar day** over **`FLECS_DEMO_SALES_DAYS`** (default **95**), with slightly more activity on **weekends**, using a fixed RNG seed for **reproducible** data.
- Each sale inserts **`transactions`** + **`transaction_items`** at staggered times; then **`products.stock_level`** is updated so it matches units sold (**stock never forced below 0**).

### Configuration

| Variable | Default | Role |
|----------|---------|------|
| `FLECS_DEMO_SALES_DAYS` | `95` | Calendar days of history (minimum 30 enforced in code) |
| `FLECS_DEMO_SALES_SEED` | `42` | `random.Random` seed |

### When it runs

- With **`ensure_sample_products()`** on first app request (`@app.before_request`) and when starting **`python app.py`**.

### Re-loading demo sales

1. **Backup** if needed, then delete sales: `DELETE FROM transaction_items; DELETE FROM transactions;` and reset stock or re-seed products as you prefer.  
2. Restart the API; if the transaction tables are empty, demo sales are inserted again.

### Files touched

- `backend/app.py`
- `docs/CHANGELOG.md`

---