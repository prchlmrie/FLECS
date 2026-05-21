"""
Run this from your backend folder:
  cd backend
  python fix_supplier_link.py

It will show you all supplier users and all suppliers,
then let you link them correctly.
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'flecs.db')

if not os.path.exists(DB_PATH):
    print(f"ERROR: Could not find flecs.db at {DB_PATH}")
    print("Make sure you run this script from inside your /backend folder.")
    exit(1)

db = sqlite3.connect(DB_PATH)
db.row_factory = sqlite3.Row

print("\n===== SUPPLIERS IN DATABASE =====")
suppliers = db.execute("SELECT supplier_id, supplier_name FROM suppliers").fetchall()
if not suppliers:
    print("  (none found - add a supplier in Settings first!)")
else:
    for s in suppliers:
        print(f"  ID {s['supplier_id']}  →  {s['supplier_name']}")

print("\n===== SUPPLIER ACCOUNTS (users with role=supplier) =====")
users = db.execute(
    "SELECT user_id, username, supplier_id FROM users WHERE role = 'supplier'"
).fetchall()
if not users:
    print("  (no supplier accounts found)")
else:
    for u in users:
        linked = f"linked to supplier_id={u['supplier_id']}" if u['supplier_id'] else "⚠️  NOT LINKED (this causes the error!)"
        print(f"  user_id={u['user_id']}  username={u['username']}  {linked}")

if not users or not suppliers:
    print("\nNothing to fix. Make sure you have both a supplier record AND a supplier account.")
    db.close()
    exit(0)

print("\n===== FIX: Link supplier accounts =====")
for u in users:
    if u['supplier_id'] is not None:
        print(f"  '{u['username']}' is already linked — skipping.")
        continue
    
    print(f"\n  Account '{u['username']}' (user_id={u['user_id']}) needs to be linked.")
    print("  Which supplier should this account belong to?")
    for s in suppliers:
        print(f"    Enter {s['supplier_id']} for → {s['supplier_name']}")
    
    while True:
        try:
            choice = int(input("  Your choice (supplier_id): ").strip())
            match = next((s for s in suppliers if s['supplier_id'] == choice), None)
            if match:
                db.execute(
                    "UPDATE users SET supplier_id = ? WHERE user_id = ?",
                    (choice, u['user_id'])
                )
                db.commit()
                print(f"  ✅ '{u['username']}' is now linked to '{match['supplier_name']}'")
                break
            else:
                print("  Invalid ID, try again.")
        except (ValueError, KeyboardInterrupt):
            print("  Skipped.")
            break

db.close()
print("\nDone! Restart your Flask server, then refresh the supplier page.\n")
