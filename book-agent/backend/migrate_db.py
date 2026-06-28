import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "books.db")
if os.path.exists(db_path):
    print(f"Connecting to {db_path}...")
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("ALTER TABLE books ADD COLUMN total_sections INTEGER;")
        conn.commit()
        print("Successfully added total_sections column to books table.")
    except sqlite3.OperationalError as e:
        print(f"Error (column might already exist): {e}")
    finally:
        conn.close()
else:
    print(f"Database not found at {db_path}")
