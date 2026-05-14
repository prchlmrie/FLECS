# FLECS
A Data-Driven Demand-Based Restocking Decision Support System for Independent Local Retailers

## How to Run

This project consists of a Python Flask backend and a React Node.js frontend.

### Prerequisites
- Python 3.x
- Node.js and npm

### 1. Run the Backend
Open a terminal and navigate to the `backend` directory:
```bash
cd backend
```

*(Optional but recommended)* Create and activate a virtual environment:
```bash
python -m venv venv
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate
```

Install the required Python packages:
```bash
pip install -r requirements.txt
```

Start the Flask server:
```bash
python app.py
```
The backend API will run on `http://localhost:5000` and automatically initialize the SQLite database with default credentials (`admin` / `admin123`).

### 2. Run the Frontend
Open a new terminal and navigate to the `frontend` directory:
```bash
cd frontend
```

Install the Node.js dependencies:
```bash
npm install
```

Start the React development server:
```bash
npm start
```
The application will open in your default browser at `http://localhost:3000`.

## Documentation

- **[Change log and task notes](docs/CHANGELOG.md)** — per-task descriptions of changes, requirements mapping, and how to verify behavior.
