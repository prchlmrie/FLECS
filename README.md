# FLECS

**F**orecasting and **L**ogistics **E**nterprise for **C**onvenience **S**tores — a web-based decision support system for independent retailers. FLECS ties together point-of-sale, inventory control, demand-based restocking, supplier workflows, and optional AI-assisted inventory Q&A.

## Features

| Role | Capabilities |
|------|----------------|
| **Owner** | Dashboard analytics, POS checkout, product CRUD, restock recommendations, stock requests to suppliers, in-app messaging, inventory AI chat |
| **Administrator** | Everything the owner has, plus sales/inventory reports (JSON/CSV), user registration, system settings |
| **Supplier** | Low-stock overview, view and process stock requests (acknowledge, cancel, fulfill), notifications |

**Restocking engine** — Uses 90 days of sales history and Simple Exponential Smoothing (SES) to suggest order quantities with priority labels (CRITICAL, HIGH, MEDIUM).

**Inventory assistant** — Optional chat powered by OpenRouter; answers natural-language stock questions when `OPENROUTER_API_KEY` is set.

## Tech stack

| Layer | Technologies |
|-------|----------------|
| Frontend | React 18, React Router, Axios, Recharts |
| Backend | Flask, Flask-JWT-Extended, Flask-CORS |
| Database | SQLite (`backend/flecs.db`) |
| Forecasting | SES (configurable alpha via `FLECS_SES_ALPHA`) |
| AI (optional) | OpenRouter API |

## Project structure

```
FLECS/
├── backend/
│   ├── app.py              # Flask API and business logic
│   ├── flecs.db            # SQLite database (created on first run)
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.js          # Routes and role guards
│   │   ├── api.js          # Axios client and interceptors
│   │   └── components/     # UI modules (POS, Inventory, etc.)
│   ├── package.json
│   └── build/              # Production bundle (after npm run build)
└── concept_summary.md      # Technical documentation (local reference)
```

## Getting started

### Prerequisites

- Python 3.10+
- Node.js 18+

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env    # optional; required for AI chat
python app.py
```

The API listens on `http://localhost:5000`. On first run, the app creates `flecs.db`, seeds demo products, and ensures default accounts exist.

### Frontend

```bash
cd frontend
npm install
npm start
```

The dev server runs on `http://localhost:3000` and proxies API calls to port 5000 (`package.json` proxy).

### Default accounts

| Username | Password | Role |
|----------|----------|------|
| `admin` | `admin123` | administrator |
| `owner` | `owner123` | owner |

Change these credentials before any production deployment.

## Configuration

Copy `backend/.env.example` to `backend/.env`:

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | API key for inventory chat |
| `OPENROUTER_MODEL` | Primary model (`auto`, `llama`, `gemma`, `deepseek`, `qwen`, or full model id) |
| `OPENROUTER_MODEL_FALLBACKS` | Comma-separated fallback models |
| `FLECS_SES_ALPHA` | SES smoothing factor (default `0.35`) |

`.env` files are gitignored. Do not commit secrets.

## Production build

```bash
cd frontend
npm run build
```

Serve `frontend/build` with a static file host. Point the client at the Flask API URL your deployment uses.

## Architecture flowchart

End-to-end request flow: authentication, role routing, store/supplier operations, middleware, and persistence.

```mermaid
graph TD
    %% --- USER INITIALIZATION & AUTHENTICATION FLOW ---
    Start([User Opens Application]) --> UI_Login[UI: Login Component]
    UI_Login -- "Submits Username/Password" --> API_Login["POST /api/auth/login"]

    subgraph "Authentication & Session Management"
        API_Login --> DB_UserCheck{"Verify Credentials & Role"}
        DB_UserCheck -- "Invalid" --> Res_401["Return 401 Error"]
        Res_401 --> UI_Err[UI: Show 'Invalid Credentials']

        DB_UserCheck -- "Valid" --> Mint_JWT["Generate JWT Token (8h Expiry)"]
        Mint_JWT --> Res_200["Return Token + User Metadata"]
        Res_200 --> Local_Save["Save to LocalStorage via authSession.js"]
    end

    Local_Save --> Route_Guard{"React Router: Guard Check"}

    %% --- FRONTEND ROLE-BASED ROUTING ---
    subgraph "Frontend Routing Layer (App.js)"
        Route_Guard -- "No Token" --> UI_Login
        Route_Guard -- "Has Token" --> Layout_Render["Render Main Layout component"]
        Layout_Render --> Role_Split{"Evaluate user.role"}
    end

    %% --- ROLE FLOWS ---
    Role_Split -- "supplier" --> Sup_Dashboard["Supplier Portal Dashboard"]
    Role_Split -- "administrator | owner" --> Admin_Dashboard["Admin / Owner Workspace"]

    %% --- SUPPLIER WORKFLOW SUBGRAPH ---
    subgraph "Supplier Core Operations Journey"
        Sup_Dashboard --> Sup_LowStock["GET /api/supplier/low-stock"]
        Sup_Dashboard --> Sup_Requests["GET /api/supplier/stock-requests"]

        Sup_Requests --> Sup_Action{"Evaluate Request Status"}
        Sup_Action -- "Acknowledge" --> API_Ack["PUT /api/supplier/stock-requests/:id (Status: acknowledged)"]
        Sup_Action -- "Cancel" --> API_Can["PUT /api/supplier/stock-requests/:id (Status: cancelled)"]
        Sup_Action -- "Fulfill" --> API_Ful["PUT /api/supplier/stock-requests/:id (Status: fulfilled)"]

        API_Ack --> Notif_Ack["Create Notification: 'Order Acknowledged'"]
        API_Can --> Notif_Can["Create Notification: 'Order Cancelled'"]
        API_Ful --> Stock_Inc["DB: Increment product.stock_level"]
        Stock_Inc --> Notif_Ful["Create Notification: 'Stock Incoming!'"]
    end

    %% --- ADMIN / OWNER WORKFLOW SUBGRAPH ---
    subgraph "Store Operations Journey (Admin/Owner)"
        Admin_Dashboard --> Module_POS["Point of Sale (POS.js)"]
        Admin_Dashboard --> Module_Inv["Inventory Management (Inventory.js)"]
        Admin_Dashboard --> Module_Restock["Restocking System (Restocking.js)"]
        Admin_Dashboard --> Module_Comms["Messaging/Chat System (Messages.js)"]

        %% POS Loop
        Module_POS --> POS_Scan["Scan Barcode / Select Product"]
        POS_Scan --> POS_Check{"Local Stock Check"}
        POS_Check -- "Insufficient" --> POS_Warn["UI: Block Checkout / Alert Out of Stock"]
        POS_Check -- "Sufficient" --> POS_Checkout["Submit Cart: POST /api/transactions"]

        %% Inventory Loop
        Module_Inv --> Inv_View["GET /api/products (Filter by Store/Archive)"]
        Inv_View --> Inv_CRUD{"Action Type"}
        Inv_CRUD -- "Create" --> API_CProd["POST /api/products"]
        Inv_CRUD -- "Update" --> API_UProd["PUT /api/products/:id"]
        Inv_CRUD -- "Archive" --> API_DProd["DELETE /api/products/:id (is_archived = 1)"]

        %% Restocking & Forecasting Loop
        Module_Restock --> API_Recs["GET /api/analytics/restock-recommendations"]
        subgraph "Forecasting Engine (Simple Exponential Smoothing)"
            API_Recs --> Alg_Series["Fetch 90-day Sales History"]
            Alg_Series --> Alg_SES["Apply SES Algorithm Level: Level = alpha * x + (1 - alpha) * Level"]
            Alg_SES --> Alg_Lead["Calculate Demand through Lead Time * 1.5 Factor"]
            Alg_Lead --> Alg_Output["Generate Suggested Quantity & Priority (CRITICAL/HIGH/MEDIUM)"]
        end
        Alg_Output --> UI_Recs["Display Restock Recommendations Grid"]
        UI_Recs --> Owner_Req["Click 'Order': POST /api/stock-requests"]
        Owner_Req --> DB_Req["Insert into stock_requests Table (Status: pending)"]
        DB_Req -- "Triggers Alert" --> Sup_Requests
    end

    %% --- PRIVILEGE ELEVATION LOOP (ADMIN ONLY) ---
    Admin_Dashboard --> Admin_Check{"Is Role == administrator?"}
    subgraph "System Administration Workspace (Admin Only)"
        Admin_Check -- "No (Owner)" --> Block_Admin["Redirect / Hide Navigation Paths"]
        Admin_Check -- "Yes" --> Module_Reports["Reports Component (Reports.js)"]
        Admin_Check -- "Yes" --> Module_Settings["Settings Component (Settings.js)"]

        Module_Reports --> API_SReport["GET /api/reports/sales (JSON or CSV Export)"]
        Module_Reports --> API_IReport["GET /api/reports/inventory"]
        Module_Settings --> API_Reg["POST /api/auth/register (Create Owners/Suppliers)"]
    end

    %% --- INTERCEPTOR, DECORATOR & COMMUNICATOR MIDDLEWARE LAYER ---
    subgraph "System Interceptors & Middleware (Architectural Design)"
        POS_Checkout & API_CProd & API_UProd & API_DProd & Owner_Req & API_Ack & API_Can & API_Ful --> Axios_Hook["Axios Interceptor: Attach JWT Bearer Header"]
        Axios_Hook --> Flask_Decorator["Flask Routing: @jwt_required() & @role_required() Validation"]
        Flask_Decorator --> Audit_Logger["Execute log_action() -> Write to audit_log Table"]
    end

    %% --- DATABASE PERSISTENCE LAYER ---
    subgraph "Data Persistence Layer (SQLite Database: flecs.db)"
        Audit_Logger --> DB_Tables[(Physical Database SQLite)]
        POS_Checkout --> DB_Tx["transactions & transaction_items Tables"]
        API_CProd & API_UProd & API_DProd --> DB_Prod["products Table"]
        Notif_Ack & Notif_Can & Notif_Ful --> DB_Notif["notifications Table"]
        Module_Comms --> API_Msg["POST /api/messages <--> messages Table"]
        API_Msg --> DB_Msg["messages Table"]
    end

    %% Mapping DB tables back to views
    DB_Tx -.-> API_SReport
    DB_Prod -.-> Inv_View
    DB_Notif -.-> Layout_Render
    DB_Msg -.-> Module_Comms
```
