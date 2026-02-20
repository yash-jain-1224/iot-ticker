#!/usr/bin/env python3
"""
Standalone Data Removal Script
Cleans simulation data from PostgreSQL database
Can be run locally without Databricks dependencies
"""

import psycopg2
import os
import argparse
from datetime import datetime
from pathlib import Path

# Load environment variables from .env file
def load_env_file():
    """Load environment variables from .env file in backend directory"""
    # Get the backend directory (parent of scripts directory)
    backend_dir = Path(__file__).parent.parent
    env_file = backend_dir / '.env'
    
    if env_file.exists():
        print(f"📁 Loading environment from: {env_file}")
        with open(env_file, 'r') as f:
            for line in f:
                line = line.strip()
                # Skip comments and empty lines
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip()
                    # Don't override existing environment variables
                    if key not in os.environ:
                        os.environ[key] = value
        print("✅ Environment variables loaded\n")
    else:
        print(f"⚠️  No .env file found at {env_file}")
        print("💡 You can set environment variables manually or create a .env file\n")

# Load .env file at module level
load_env_file()

# ==========================================
# 0. CONFIGURATION
# ==========================================
def get_config():
    """Load configuration from environment variables or use defaults"""
    
    # Check if DATABASE_URL is provided
    database_url = os.getenv("DATABASE_URL_SYNC") or os.getenv("DATABASE_URL", "")
    
    if database_url:
        # Parse DATABASE_URL (format: postgresql://user:password@host:port/dbname)
        # Remove the scheme prefix
        url = database_url
        if "://" in url:
            url = url.split("://", 1)[1]
        
        # Parse components
        config = {}
        
        # Extract credentials and host
        if "@" in url:
            credentials, host_part = url.split("@", 1)
            if ":" in credentials:
                config["user"], password = credentials.split(":", 1)
                if password:
                    config["password"] = password
            else:
                config["user"] = credentials
        else:
            host_part = url
            config["user"] = os.getenv("DB_USER", "postgres")
        
        # Extract host, port, and database
        if "/" in host_part:
            host_port, config["dbname"] = host_part.split("/", 1)
            # Remove any query parameters
            if "?" in config["dbname"]:
                config["dbname"] = config["dbname"].split("?")[0]
        else:
            host_port = host_part
            config["dbname"] = "postgres"
        
        if ":" in host_port:
            config["host"], config["port"] = host_port.split(":", 1)
        else:
            config["host"] = host_port
            config["port"] = "5432"
        
        # SSL mode
        config["sslmode"] = os.getenv("DATABRICKS_SSL_MODE", "disable")
        
        return config
    
    # Fallback to individual environment variables
    config = {
        "dbname": os.getenv("DB_NAME", "iot_ticker"),
        "user": os.getenv("DB_USER", "your_username"),
        "host": os.getenv("DB_HOST", "localhost"),
        "port": os.getenv("DB_PORT", "5432"),
        "sslmode": os.getenv("DB_SSLMODE", "disable")
    }
    
    # Only add password if it's set (some local PostgreSQL setups don't require password)
    password = os.getenv("DB_PASSWORD", "")
    if password:
        config["password"] = password
    
    return config

# ==========================================
# 1. TABLES TO WIPE (ORDER MATTERS)
# ==========================================
# We must delete CHILD tables before PARENT tables to avoid Foreign Key errors.
TABLES_TO_CLEAN = [
    "ALERT_ESCALATIONS",    # Depends on ALERTS
    "ALERTS",               # Depends on IOT_EVENTS
    "IOT_EVENTS",           # Independent (mostly)
    "TELEMETRY_AGGREGATES",
    "SENSOR_TELEMETRY",
    "MACHINE_HEARTBEATS",
    "MACHINE_STATES",
    "FORECAST_OUTPUTS",
    "KPI_AGGREGATES",
    "SHIFT_KPIS"
]

# ==========================================
# 2. CLEANUP FUNCTIONS
# ==========================================
def get_table_stats(cursor, table):
    """Get row count for a table"""
    try:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        return count
    except Exception:
        return 0

def wipe_tables(config, confirm=True, dry_run=False):
    """
    Wipe all simulation data from tables
    
    Args:
        config: Database configuration
        confirm: Whether to ask for confirmation
        dry_run: If True, only show what would be deleted
    """
    conn = None
    try:
        # Connect to database
        print("🔌 Connecting to database...")
        conn = psycopg2.connect(**config)
        conn.autocommit = False  # Use transactions for safety
        cursor = conn.cursor()
        
        # Show current state
        print("\n📊 Current Database State:")
        print("=" * 60)
        total_rows = 0
        table_stats = {}
        
        for table in TABLES_TO_CLEAN:
            count = get_table_stats(cursor, table)
            table_stats[table] = count
            total_rows += count
            print(f"  {table:25s}: {count:>10,} rows")
        
        print("=" * 60)
        print(f"  {'TOTAL':25s}: {total_rows:>10,} rows")
        print()
        
        if total_rows == 0:
            print("✨ Database is already clean. No data to remove.")
            return
        
        # Dry run check
        if dry_run:
            print("🔍 DRY RUN MODE: No changes will be made.")
            print(f"\nWould delete {total_rows:,} rows from {len(TABLES_TO_CLEAN)} tables.")
            return
        
        # Confirmation
        if confirm:
            print("⚠️  WARNING: This will DELETE ALL DATA from the following tables:")
            for table in TABLES_TO_CLEAN:
                if table_stats[table] > 0:
                    print(f"   - {table} ({table_stats[table]:,} rows)")
            print()
            response = input("Are you sure you want to continue? (type 'yes' to confirm): ")
            if response.lower() != 'yes':
                print("❌ Operation cancelled.")
                return
        
        # Execute cleanup
        print(f"\n🔥 Deleting data from {len(TABLES_TO_CLEAN)} tables...")
        print("=" * 60)
        
        deleted_counts = {}
        failed_tables = []
        
        for table in TABLES_TO_CLEAN:
            try:
                # 1. DELETE DATA
                cursor.execute(f"DELETE FROM {table}")
                rows_deleted = cursor.rowcount
                deleted_counts[table] = rows_deleted
                
                # 2. RESET ID SEQUENCE
                # Try to reset the sequence if it exists
                try:
                    cursor.execute(f"SELECT setval(pg_get_serial_sequence('{table.lower()}', 'id'), 1, false)")
                    sequence_reset = "✓"
                except Exception:
                    sequence_reset = "⚠"  # No sequence or failed to reset
                
                print(f"  ✅ {table:25s}: {rows_deleted:>10,} rows deleted {sequence_reset}")
                
            except Exception as e:
                failed_tables.append((table, str(e)))
                print(f"  ❌ {table:25s}: Failed - {str(e)[:50]}")
                conn.rollback()  # Rollback this table's changes
                continue
        
        # Commit all changes
        print("=" * 60)
        
        if not failed_tables:
            conn.commit()
            total_deleted = sum(deleted_counts.values())
            print(f"\n✨ SUCCESS! Deleted {total_deleted:,} rows from {len(deleted_counts)} tables.")
            print("🔄 All sequences reset to start from 1.")
        else:
            conn.rollback()
            print(f"\n⚠️  WARNING: {len(failed_tables)} table(s) failed:")
            for table, error in failed_tables:
                print(f"   - {table}: {error}")
            print("\n🔄 Changes rolled back for safety.")
        
        # Show final state
        print("\n📊 Final Database State:")
        print("=" * 60)
        final_total = 0
        for table in TABLES_TO_CLEAN:
            count = get_table_stats(cursor, table)
            final_total += count
            if count > 0:
                print(f"  {table:25s}: {count:>10,} rows (⚠️  not cleaned)")
            else:
                print(f"  {table:25s}: {count:>10,} rows")
        print("=" * 60)
        print(f"  {'TOTAL':25s}: {final_total:>10,} rows")
        print()
        
        if final_total == 0:
            print("✅ Database is now clean and ready for fresh seeding!")
        
    except psycopg2.Error as e:
        print(f"\n🚨 Database Error: {e}")
        if conn:
            conn.rollback()
    except Exception as e:
        print(f"\n🚨 Unexpected Error: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            cursor.close()
            conn.close()
            print("🔌 Database connection closed.")

def wipe_specific_tables(config, tables, confirm=True):
    """
    Wipe specific tables only
    
    Args:
        config: Database configuration
        tables: List of table names to wipe
        confirm: Whether to ask for confirmation
    """
    conn = None
    try:
        print("🔌 Connecting to database...")
        conn = psycopg2.connect(**config)
        conn.autocommit = False
        cursor = conn.cursor()
        
        # Validate tables exist
        valid_tables = []
        for table in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                count = cursor.fetchone()[0]
                valid_tables.append((table, count))
            except Exception:
                print(f"⚠️  Warning: Table '{table}' not found or not accessible")
        
        if not valid_tables:
            print("❌ No valid tables to clean.")
            return
        
        # Show what will be deleted
        print("\n📊 Tables to Clean:")
        total_rows = sum(count for _, count in valid_tables)
        for table, count in valid_tables:
            print(f"  {table:25s}: {count:>10,} rows")
        print(f"  {'TOTAL':25s}: {total_rows:>10,} rows")
        print()
        
        if confirm:
            response = input("Proceed with deletion? (type 'yes' to confirm): ")
            if response.lower() != 'yes':
                print("❌ Operation cancelled.")
                return
        
        # Delete data
        print("\n🔥 Deleting data...")
        for table, _ in valid_tables:
            try:
                cursor.execute(f"DELETE FROM {table}")
                rows_deleted = cursor.rowcount
                
                try:
                    cursor.execute(f"SELECT setval(pg_get_serial_sequence('{table.lower()}', 'id'), 1, false)")
                except Exception:
                    pass
                
                print(f"  ✅ {table}: {rows_deleted:,} rows deleted")
            except Exception as e:
                print(f"  ❌ {table}: Failed - {str(e)}")
        
        conn.commit()
        print("\n✨ Cleanup complete!")
        
    except Exception as e:
        print(f"\n🚨 Error: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            cursor.close()
            conn.close()

# ==========================================
# 3. CLI INTERFACE
# ==========================================
def main():
    """Main entry point with CLI argument parsing"""
    parser = argparse.ArgumentParser(
        description='IoT Data Removal Script - Clean simulation data from database',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Environment Variables:
  DB_NAME       Database name (default: databricks_postgres)
  DB_USER       Database user
  DB_PASSWORD   Database password (optional for local PostgreSQL)
  DB_HOST       Database host
  DB_PORT       Database port (default: 5432)
  DB_SSLMODE    SSL mode (default: require)

Examples:
  # Clean all tables (with confirmation)
  python standalone_data_removal.py
  
  # Clean all tables without confirmation
  python standalone_data_removal.py --yes
  
  # Dry run (show what would be deleted)
  python standalone_data_removal.py --dry-run
  
  # Clean specific tables only
  python standalone_data_removal.py --tables ALERTS IOT_EVENTS
  
  # Use with run script (loads .env automatically)
  ./run_cleanup.sh
        """
    )
    
    parser.add_argument(
        '--yes', '-y',
        action='store_true',
        help='Skip confirmation prompt'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be deleted without actually deleting'
    )
    
    parser.add_argument(
        '--tables',
        nargs='+',
        help='Clean only specific tables (space-separated)'
    )
    
    args = parser.parse_args()
    
    # Get database configuration
    db_config = get_config()
    
    # Check if credentials are provided
    if db_config['user'] == 'your_username':
        print("❌ Error: Please set DB_USER environment variable")
        print("\nExample:")
        print("  export DB_USER=myuser")
        print("  export DB_PASSWORD=mypassword  # Optional for local PostgreSQL")
        print("  python standalone_data_removal.py")
        return 1
    
    print("🗑️  IoT Data Removal Script")
    print("=" * 60)
    print(f"Database: {db_config['dbname']}")
    print(f"Host: {db_config['host']}")
    print(f"User: {db_config['user']}")
    print(f"Port: {db_config['port']}")
    print("=" * 60)
    print()
    
    try:
        if args.tables:
            # Clean specific tables
            wipe_specific_tables(db_config, args.tables, confirm=not args.yes)
        else:
            # Clean all tables
            wipe_tables(db_config, confirm=not args.yes, dry_run=args.dry_run)
        return 0
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    exit(main())
