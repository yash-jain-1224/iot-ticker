#!/usr/bin/env python3
"""
Standalone IoT Data Seeding Script
Generates real-time IoT machine telemetry data for PostgreSQL database
Can be run locally without Databricks dependencies
"""

import psycopg2
import os
import random
import json
import time
from datetime import datetime, timedelta
from psycopg2.extras import execute_values
import argparse
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

def get_db_connection(config):
    """Create database connection"""
    return psycopg2.connect(**config)

# ==========================================
# 2. METADATA LOADING & ID SYNC
# ==========================================
def fetch_metadata(conn):
    """Fetch machine metadata and initialize ID counters"""
    cursor = conn.cursor()
    cursor.execute("""
        SELECT m.id as machine_id, l.id as line_id, s.id as shop_id, s.name as shop_name, p.id as plant_id 
        FROM MACHINES m JOIN LINES l ON m.line_id=l.id JOIN SHOPS s ON l.shop_id=s.id JOIN PLANTS p ON s.plant_id=p.id 
        WHERE m.is_active = true
    """)
    columns = [desc[0] for desc in cursor.description]
    results = [dict(zip(columns, row)) for row in cursor.fetchall()]
    
    ids = {}
    tables = ["MACHINE_STATES", "SHIFT_KPIS", "KPI_AGGREGATES", "FORECAST_OUTPUTS", 
              "MACHINE_HEARTBEATS", "IOT_EVENTS", "SENSOR_TELEMETRY", 
              "TELEMETRY_AGGREGATES", "ALERTS", "ALERT_ESCALATIONS"]
    
    for t in tables:
        try: 
            cursor.execute(f"SELECT COALESCE(MAX(id), 0) FROM {t}")
            ids[t] = cursor.fetchone()[0]
        except: 
            conn.rollback()
            ids[t] = 0
    
    # Sync sequences at startup
    try:
        seq_tables = ["alerts", "iot_events", "alert_escalations", "sensor_telemetry", 
                      "machine_states", "machine_heartbeats", "kpi_aggregates", 
                      "telemetry_aggregates", "shift_kpis", "forecast_outputs"]
        for table in seq_tables:
            cursor.execute(f"SELECT setval('{table}_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM {table}), false)")
        conn.commit()
        print("✅ Synced sequences at startup!")
    except Exception as e:
        print(f"⚠️ Startup sequence sync error: {e}")
        conn.rollback()
    
    cursor.close()
    return results, ids

# ==========================================
# 3. DIRECT SQL WRITERS (OPTIMIZED)
# ==========================================
def execute_batch_insert(conn, table_name, data_list):
    """
    Optimized batch insert using psycopg2.extras.execute_values
    Reduces DB round trips by packing data into a single INSERT statement
    """
    if not data_list:
        return
    
    cursor = conn.cursor()
    try:
        keys = list(data_list[0].keys())
        columns = ','.join(keys)
        
        # Prepare the query with a single placeholder for execute_values
        query = f"INSERT INTO {table_name} ({columns}) VALUES %s"
        
        # Convert list of dicts to list of lists (required for execute_values)
        values = [[row[k] for k in keys] for row in data_list]
        
        # Execute Fast Batch Insert
        execute_values(cursor, query, values)
        
    except Exception as e:
        print(f"Error inserting {table_name}: {e}")
        conn.rollback()
    finally:
        cursor.close()

def handle_machine_states(conn, data_list):
    """Handle machine state updates with current state management"""
    if not data_list:
        return
    
    m_ids = tuple(set([d['machine_id'] for d in data_list]))
    cursor = conn.cursor()
    try:
        # Update old states
        if len(m_ids) == 1:
            cursor.execute(f"UPDATE MACHINE_STATES SET is_current = false WHERE machine_id = {m_ids[0]} AND is_current = true")
        else:
            cursor.execute(f"UPDATE MACHINE_STATES SET is_current = false WHERE machine_id IN {m_ids} AND is_current = true")
        
        # Insert new states using the optimized writer
        execute_batch_insert(conn, "MACHINE_STATES", data_list)
    except Exception as e:
        conn.rollback()
        print(f"Error State Update: {e}")
    finally:
        cursor.close()

def handle_forecasts(conn, data_list):
    """Handle forecast updates by replacing all forecasts"""
    if not data_list:
        return
    
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM FORECAST_OUTPUTS")
        execute_batch_insert(conn, "FORECAST_OUTPUTS", data_list)
    except Exception as e:
        conn.rollback()
        print(f"Error Forecast Update: {e}")
    finally:
        cursor.close()

# ==========================================
# 4. PHYSICS ENGINE
# ==========================================
class MachineSimulator:
    """Simulates machine behavior with realistic physics"""
    
    def __init__(self, row, base_probability, paint_shops, body_shops):
        self.m_id = row['machine_id']
        self.shop_id = row['shop_id']
        self.base_probability = base_probability
        self.prod_multiplier = 1.2 if self.shop_id in body_shops else 1.1 if self.shop_id in paint_shops else 1.0
        
        # Initialize random state
        rand_val = random.random()
        if rand_val < 0.15: 
            self.status = 'online'
            self.temperature = 97.0
            self.health = random.uniform(65, 80)
            self.vibration = 3.8
            self.load = 85.0
        elif rand_val < 0.25: 
            self.status = 'maintenance'
            self.temperature = 22.0
            self.health = random.uniform(90, 100)
            self.vibration = 0.0
            self.load = 0.0
        elif rand_val < 0.35: 
            self.status = 'idle'
            self.temperature = 35.0
            self.health = random.uniform(85, 95)
            self.vibration = 0.1
            self.load = 0.0
        else: 
            self.status = 'online'
            self.temperature = 55.0
            self.health = random.uniform(94, 99)
            self.vibration = 1.5
            self.load = 70.0
        
        self.power = 0.0
        self.stats = {
            'planned_down_sec': 0,
            'unplanned_down_sec': 0,
            'good_units': 0,
            'scrap_units': 0,
            'total_units': 0,
            'energy_used': 0.0,
            'fault_count': 0
        }

    def trigger_fault_state(self):
        """Trigger a fault state in the machine"""
        self.status = 'fault'
        self.health = max(0.0, self.health - random.uniform(10.0, 18.0))

    def step(self):
        """Simulate one time step of machine operation"""
        # 1. State Transitions
        if self.status == 'online' and random.random() < 0.005:
            self.status = 'fault'
            self.health = random.uniform(15.0, 35.0)
            self.stats['fault_count'] += 1
        elif self.status == 'fault' and random.random() < 0.08:
            self.status = 'online'
            self.health = random.uniform(80.0, 98.0)
            self.temperature = random.uniform(50.0, 60.0)
        
        # 2. Health Physics
        if self.status == 'fault':
            self.health = max(0.0, self.health - random.uniform(0.5, 1.2))
        elif self.temperature > 90.0:
            self.health = max(0.0, self.health - 0.05)
        elif self.status == 'maintenance':
            self.health = min(100.0, self.health + 0.1)
        else:
            self.health = max(0.0, self.health - 0.0005)

        # 3. Production & Energy
        if self.status == 'online':
            prob = self.base_probability * self.prod_multiplier
            units_made = 1 if random.random() < prob else 0
            self.load = max(50.0, min(95.0, self.load + random.uniform(-2, 2)))
            self.power = (self.load / 100.0) * 35.0
            self.temperature += (self.load / 1000.0) + random.uniform(-0.1, 0.1)
            self.vibration += random.uniform(-0.05, 0.05)
            self.stats['total_units'] += units_made
            self.stats['energy_used'] += (self.power / 3600.0)
            
            if self.temperature > 85.0 and units_made > 0:
                self.stats['scrap_units'] += units_made
            elif units_made > 0:
                self.stats['good_units'] += units_made
                
        elif self.status == 'idle':
            self.temperature = max(22.0, self.temperature - 0.05)
            self.power = 2.0
            self.stats['energy_used'] += (2.0 / 3600.0)
            
        elif self.status == 'maintenance':
            self.temperature = 22.0
            self.stats['planned_down_sec'] += 1
            
        elif self.status == 'fault':
            self.temperature = max(22.0, self.temperature - 0.1)
            self.stats['unplanned_down_sec'] += 1

        # 4. Recovery & Fault Logic
        if self.status == 'fault' and self.temperature < 50.0 and random.random() < 0.05:
            self.status = 'online'
            
        if self.temperature > 98.0 and self.status != 'fault':
            self.trigger_fault_state()
            self.stats['fault_count'] += 1
            
        return self

def get_random_alert_state(timestamp):
    """Generate random alert state for realism"""
    roll = random.random()
    if roll < 0.6:
        return 'active', None, None, None, None, None, None
    elif roll < 0.9:
        return 'acknowledged', 1, timestamp - timedelta(minutes=random.randint(1, 15)), "Investigating", None, None, None
    else:
        return 'resolved', 1, timestamp - timedelta(minutes=10), "Fixed", 1, timestamp - timedelta(minutes=2), "Done"

# ==========================================
# 5. MAIN SIMULATION LOOP
# ==========================================
def run_simulation(duration_seconds, base_probability, db_config):
    """Main simulation loop"""
    
    print(f"🚀 STARTING OPTIMIZED HIGH-THROUGHPUT STREAM...")
    print(f"⏱️  Duration: {duration_seconds} seconds")
    print(f"⚡ Production Probability: {base_probability}")
    print(f"🔥 Latency: Minimized via Batch Packet Insert")
    print(f"🛡️  Safety: Manual ID Increment")
    print()
    
    # Connect to database
    conn = get_db_connection(db_config)
    
    # Fetch metadata
    print("📊 Fetching machine metadata...")
    machines_metadata, ID_COUNTERS = fetch_metadata(conn)
    
    PAINT_SHOPS = list(set([m['shop_id'] for m in machines_metadata if m['shop_name'] == "Paint Shop"]))
    BODY_SHOPS = list(set([m['shop_id'] for m in machines_metadata if m['shop_name'] == "Body Shop"]))
    
    print(f"✅ Found {len(machines_metadata)} active machines")
    print(f"✅ Initialized Counters: {ID_COUNTERS}")
    print()
    
    # Initialize simulators
    sims = {m['machine_id']: MachineSimulator(m, base_probability, PAINT_SHOPS, BODY_SHOPS) for m in machines_metadata}
    
    # Simulation timing
    DATA_START_TIME = datetime.now()
    end_time = DATA_START_TIME + timedelta(seconds=duration_seconds)
    iteration_count = 0
    
    try:
        while datetime.now() < end_time:
            iteration_count += 1
            now = datetime.now()
            
            # Initialize buffers
            b_tele, b_stat, b_heart, b_evt, b_alrt, b_esc = [], [], [], [], [], []
            b_kpi, b_fcst, b_shift, b_agg = [], [], [], []
            valid_from, valid_until = now - timedelta(hours=24), now + timedelta(days=7)

            for meta in machines_metadata:
                m_id = meta['machine_id']
                sim = sims[m_id]
                sim.step()
                
                # 1. SENSOR TELEMETRY
                ID_COUNTERS["SENSOR_TELEMETRY"] += 1
                b_tele.append({
                    "id": ID_COUNTERS["SENSOR_TELEMETRY"],
                    "machine_id": m_id,
                    "sensor_type": "temperature",
                    "sensor_id": f"tmp_{m_id}",
                    "value": float(sim.temperature),
                    "unit": "C",
                    "quality": "good",
                    "timestamp": now,
                    "extra_data": "{}"
                })
                
                ID_COUNTERS["SENSOR_TELEMETRY"] += 1
                b_tele.append({
                    "id": ID_COUNTERS["SENSOR_TELEMETRY"],
                    "machine_id": m_id,
                    "sensor_type": "vibration",
                    "sensor_id": f"vib_{m_id}",
                    "value": float(sim.vibration),
                    "unit": "mm/s",
                    "quality": "good",
                    "timestamp": now,
                    "extra_data": "{}"
                })
                
                # Paint Shop specific sensors
                if sim.shop_id in PAINT_SHOPS:
                    # Viscosity
                    ID_COUNTERS["SENSOR_TELEMETRY"] += 1
                    visc_val = 120.0 + (sim.temperature * 0.5) + random.uniform(-2, 2)
                    b_tele.append({
                        "id": ID_COUNTERS["SENSOR_TELEMETRY"],
                        "machine_id": m_id,
                        "sensor_type": "viscosity",
                        "sensor_id": f"visc_{m_id}",
                        "value": float(visc_val),
                        "unit": "cP",
                        "quality": "good",
                        "timestamp": now,
                        "extra_data": "{}"
                    })
                    
                    # Humidity
                    ID_COUNTERS["SENSOR_TELEMETRY"] += 1
                    b_tele.append({
                        "id": ID_COUNTERS["SENSOR_TELEMETRY"],
                        "machine_id": m_id,
                        "sensor_type": "humidity",
                        "sensor_id": f"hum_{m_id}",
                        "value": float(random.uniform(40, 65)),
                        "unit": "%",
                        "quality": "good",
                        "timestamp": now,
                        "extra_data": "{}"
                    })
                    
                    # Air Quality
                    ID_COUNTERS["SENSOR_TELEMETRY"] += 1
                    b_tele.append({
                        "id": ID_COUNTERS["SENSOR_TELEMETRY"],
                        "machine_id": m_id,
                        "sensor_type": "air_quality",
                        "sensor_id": f"aqi_{m_id}",
                        "value": float(random.randint(50, 150)),
                        "unit": "AQI",
                        "quality": "good",
                        "timestamp": now,
                        "extra_data": "{}"
                    })
                    
                    # Dust Level
                    ID_COUNTERS["SENSOR_TELEMETRY"] += 1
                    b_tele.append({
                        "id": ID_COUNTERS["SENSOR_TELEMETRY"],
                        "machine_id": m_id,
                        "sensor_type": "dust_level",
                        "sensor_id": f"dust_{m_id}",
                        "value": float(random.uniform(5, 25)),
                        "unit": "µg/m³",
                        "quality": "good",
                        "timestamp": now,
                        "extra_data": "{}"
                    })

                # 2. MACHINE STATES
                ID_COUNTERS["MACHINE_STATES"] += 1
                f_code = "ERR_HEAT" if sim.status == 'fault' else None
                f_msg = "Overheat" if sim.status == 'fault' else None
                b_stat.append({
                    "id": ID_COUNTERS["MACHINE_STATES"],
                    "machine_id": m_id,
                    "status": sim.status,
                    "health_score": float(sim.health),
                    "current_cycle": random.randint(1, 100),
                    "cycle_count": 10000,
                    "current_load": float(sim.load),
                    "temperature": float(sim.temperature),
                    "vibration": float(sim.vibration),
                    "power_consumption": round(float(sim.power), 2),
                    "fault_code": f_code,
                    "fault_message": f_msg,
                    "additional_data": "{}",
                    "recorded_at": now,
                    "is_current": True
                })

                # 3. HEARTBEATS
                ID_COUNTERS["MACHINE_HEARTBEATS"] += 1
                b_heart.append({
                    "id": ID_COUNTERS["MACHINE_HEARTBEATS"],
                    "machine_id": m_id,
                    "timestamp": now,
                    "latency_ms": random.randint(10, 80),
                    "is_healthy": sim.status != 'fault',
                    "extra_data": "{}"
                })

                # 4. ALERTS
                alert_configs = [
                    # (condition, probability, severity, alert_type, title, description)
                    (sim.status == 'fault', 0.05, "critical", "threshold", "Shutdown Risk", "Machine in critical fault state"),
                    (sim.temperature > 85.0, 0.03, "error", "threshold", "High Temperature", f"Temperature at {sim.temperature:.1f}°C exceeds safe limit"),
                    (sim.temperature > 75.0, 0.02, "warning", "threshold", "Temperature Rising", f"Temperature at {sim.temperature:.1f}°C approaching limit"),
                    (sim.health < 50.0, 0.04, "error", "predictive", "Low Health Score", f"Machine health at {sim.health:.1f}% requires attention"),
                    (sim.health < 70.0, 0.02, "warning", "predictive", "Health Degrading", f"Machine health at {sim.health:.1f}%"),
                    (sim.vibration > 3.0, 0.03, "warning", "threshold", "High Vibration", f"Vibration at {sim.vibration:.2f} mm/s"),
                    (sim.load > 90.0, 0.02, "warning", "threshold", "High Load", f"Machine load at {sim.load:.1f}%"),
                    (random.random() < 0.001, 1.0, "info", "maintenance", "Scheduled Check", "Routine maintenance reminder"),
                ]

                for condition, probability, severity, alert_type, title, description in alert_configs:
                    if condition and random.random() < probability:
                        ID_COUNTERS["IOT_EVENTS"] += 1
                        e_id = ID_COUNTERS["IOT_EVENTS"]
                        b_evt.append({
                            "id": e_id,
                            "machine_id": m_id,
                            "event_type": "threshold_breach" if alert_type == "threshold" else alert_type,
                            "severity": severity,
                            "title": title,
                            "message": description,
                            "source": "monitoring_system",
                            "value": float(sim.temperature),
                            "threshold": 85.0 if "temp" in title.lower() else 0.0,
                            "event_data": "{}",
                            "is_acknowledged": False,
                            "acknowledged_by": None,
                            "acknowledged_at": None,
                            "timestamp": now,
                            "created_at": now
                        })
                        
                        ID_COUNTERS["ALERTS"] += 1
                        a_id = ID_COUNTERS["ALERTS"]
                        st, ab, at, an, rb, rt, rn = get_random_alert_state(now)
                        b_alrt.append({
                            "id": a_id,
                            "machine_id": m_id,
                            "alert_type": alert_type,
                            "severity": severity,
                            "status": st,
                            "title": title,
                            "description": description,
                            "trigger_value": float(sim.temperature if "temp" in title.lower() else sim.health),
                            "threshold_value": 85.0 if severity == "critical" else 75.0,
                            "threshold_type": "upper",
                            "source_event_id": e_id,
                            "alert_data": "{}",
                            "sla_deadline": now + timedelta(minutes=30 if severity == "critical" else 60 if severity == "error" else 120),
                            "sla_breached": False,
                            "acknowledged_by": ab,
                            "acknowledged_at": at,
                            "acknowledgment_note": an,
                            "resolved_by": rb,
                            "resolved_at": rt,
                            "resolution_note": rn,
                            "triggered_at": now,
                            "created_at": now,
                            "updated_at": now
                        })
                        
                        ID_COUNTERS["ALERT_ESCALATIONS"] += 1
                        b_esc.append({
                            "id": ID_COUNTERS["ALERT_ESCALATIONS"],
                            "alert_id": a_id,
                            "escalation_level": 1,
                            "escalated_to": "Manager" if severity in ["critical", "error"] else "Operator",
                            "escalation_type": "Auto",
                            "escalated_at": now,
                            "response_received": False,
                            "response_at": None,
                            "notes": f"Auto-escalated {severity} alert"
                        })
                        break  # Only one alert per machine per iteration

                # 5. FORECASTS
                r_score = 100 - sim.health
                f_configs = [
                    ("energy_demand", "kWh", (200, 500)),
                    ("production_forecast", "units", (80, 150)),
                    ("failure_probability", "probability", (0.01, 0.95)),
                    ("downtime_prediction", "minutes", (20, 120)),
                    ("quality_prediction", "percent", (95.0, 99.5))
                ]
                
                for f_t, f_u, f_rng in f_configs:
                    ID_COUNTERS["FORECAST_OUTPUTS"] += 1
                    risk_l = "low" if r_score < 30 else "medium" if r_score < 55 else "high" if r_score < 75 else "critical"
                    if f_t == "failure_probability":
                        pred_val = max(0.01, min(0.99, r_score / 100.0))
                    else:
                        pred_val = random.uniform(*f_rng)
                    
                    b_fcst.append({
                        "id": ID_COUNTERS["FORECAST_OUTPUTS"],
                        "machine_id": m_id,
                        "plant_id": meta['plant_id'],
                        "shop_id": meta['shop_id'],
                        "line_id": meta['line_id'],
                        "forecast_type": f_t,
                        "model_name": "AI-X1",
                        "model_version": "1.0",
                        "prediction_value": float(pred_val),
                        "prediction_unit": f_u,
                        "confidence_score": 0.95,
                        "confidence_lower": float(pred_val * 0.9),
                        "confidence_upper": float(pred_val * 1.1),
                        "prediction_horizon": "7d",
                        "valid_from": valid_from,
                        "valid_until": valid_until,
                        "risk_level": risk_l,
                        "risk_score": float(r_score),
                        "features_used": "{}",
                        "explanation": "Live",
                        "recommendations": "{}",
                        "raw_output": "{}",
                        "generated_at": now,
                        "created_at": now
                    })

                # 6. KPIS
                avail = ((60 - sim.stats['planned_down_sec'] - sim.stats['unplanned_down_sec']) / 60.0) * 100
                if avail < 0:
                    avail = 0
                
                ID_COUNTERS["KPI_AGGREGATES"] += 1
                b_kpi.append({
                    "id": ID_COUNTERS["KPI_AGGREGATES"],
                    "plant_id": int(meta['plant_id']),
                    "shop_id": int(meta['shop_id']),
                    "line_id": int(meta['line_id']),
                    "machine_id": int(meta['machine_id']),
                    "period_type": "minute",
                    "period_start": DATA_START_TIME,
                    "period_end": now,
                    "shift_number": 1,
                    "availability": float(avail),
                    "performance": 95.0,
                    "quality": 98.0,
                    "oee": float(avail * 0.95 * 0.98),
                    "planned_production": 12,
                    "actual_production": int(sim.stats['total_units']),
                    "good_units": int(sim.stats['good_units']),
                    "scrap_units": int(sim.stats['scrap_units']),
                    "defect_units": 0,
                    "planned_downtime": float(sim.stats['planned_down_sec'] / 60.0),
                    "unplanned_downtime": float(sim.stats['unplanned_down_sec'] / 60.0),
                    "total_downtime": float((sim.stats['planned_down_sec'] + sim.stats['unplanned_down_sec']) / 60.0),
                    "downtime_count": int(sim.stats['fault_count']),
                    "energy_consumption": float(sim.stats['energy_used']),
                    "energy_per_unit": 0.5,
                    "cost_per_unit": float(random.uniform(650000, 1200000)),
                    "maintenance_cost": 0.0,
                    "additional_metrics": json.dumps({
                        "cycle_time": random.uniform(45, 120),
                        "downtime_by_reason": [
                            {"cause": "Equipment Failure", "minutes": float(sim.stats['unplanned_down_sec'] * 0.4 / 60.0)},
                            {"cause": "Material Shortage", "minutes": float(sim.stats['unplanned_down_sec'] * 0.2 / 60.0)},
                            {"cause": "Operator Error", "minutes": float(sim.stats['unplanned_down_sec'] * 0.15 / 60.0)},
                            {"cause": "Quality Issue", "minutes": float(sim.stats['unplanned_down_sec'] * 0.15 / 60.0)},
                            {"cause": "Changeover", "minutes": float(sim.stats['planned_down_sec'] * 0.6 / 60.0)},
                            {"cause": "Planned Maintenance", "minutes": float(sim.stats['planned_down_sec'] * 0.4 / 60.0)},
                        ] if (sim.stats['planned_down_sec'] + sim.stats['unplanned_down_sec']) > 0 else [],
                        "energy_breakdown": {
                            "motors": float(sim.stats['energy_used'] * 0.45),
                            "heating": float(sim.stats['energy_used'] * 0.25),
                            "cooling": float(sim.stats['energy_used'] * 0.15),
                            "lighting": float(sim.stats['energy_used'] * 0.10),
                            "auxiliary": float(sim.stats['energy_used'] * 0.05),
                        }
                    }),
                    "mtbf": 500.0,
                    "mttr": 2.0,
                    "mttf": 1000.0,
                    "created_at": now
                })
                
                # 7. TELEMETRY AGGREGATES
                ID_COUNTERS["TELEMETRY_AGGREGATES"] += 1
                val = round(random.uniform(45.0, 65.0), 2)
                b_agg.append({
                    "id": ID_COUNTERS["TELEMETRY_AGGREGATES"],
                    "machine_id": m_id,
                    "sensor_type": "temperature",
                    "period_type": "minute",
                    "period_start": now,
                    "period_end": now,
                    "min_value": val * 0.9,
                    "max_value": val * 1.1,
                    "avg_value": val,
                    "sum_value": val * 60,
                    "count": 60,
                    "std_dev": 1.5,
                    "payload": "{}",
                    "created_at": now
                })
                
                if sim.shop_id in PAINT_SHOPS:
                    ID_COUNTERS["TELEMETRY_AGGREGATES"] += 1
                    total = random.randint(80, 145)
                    colors = ["White", "Silver", "Black", "Blue", "Red"]
                    dist = [{"color": c, "count": total // 5, "percentage": 20.0} for c in colors]
                    b_agg.append({
                        "id": ID_COUNTERS["TELEMETRY_AGGREGATES"],
                        "machine_id": m_id,
                        "sensor_type": "paint_color_distribution",
                        "period_type": "minute",
                        "period_start": now,
                        "period_end": now,
                        "min_value": 0,
                        "max_value": 0,
                        "avg_value": 0,
                        "sum_value": 0,
                        "count": total,
                        "std_dev": 0,
                        "payload": json.dumps({"distribution": dist}),
                        "created_at": now
                    })

                # 8. SHIFT KPIS
                if random.random() < 0.01:
                    ID_COUNTERS["SHIFT_KPIS"] += 1
                    b_shift.append({
                        "id": ID_COUNTERS["SHIFT_KPIS"],
                        "plant_id": int(meta['plant_id']),
                        "shop_id": int(meta['shop_id']),
                        "line_id": int(meta['line_id']),
                        "shift_date": now,
                        "shift_number": 1,
                        "shift_start": now,
                        "shift_end": now,
                        "target_units": 450,
                        "achieved_units": random.randint(400, 420),
                        "efficiency": 0.95,
                        "operators_present": 5,
                        "line_stops": 0,
                        "quality_issues": 0,
                        "safety_incidents": 0,
                        "notes": "Live",
                        "created_at": now
                    })

            # --- WRITE BATCHES (OPTIMIZED) ---
            execute_batch_insert(conn, "SENSOR_TELEMETRY", b_tele)
            execute_batch_insert(conn, "MACHINE_HEARTBEATS", b_heart)
            execute_batch_insert(conn, "IOT_EVENTS", b_evt)
            execute_batch_insert(conn, "ALERTS", b_alrt)
            execute_batch_insert(conn, "ALERT_ESCALATIONS", b_esc)
            execute_batch_insert(conn, "KPI_AGGREGATES", b_kpi)
            execute_batch_insert(conn, "TELEMETRY_AGGREGATES", b_agg)
            execute_batch_insert(conn, "SHIFT_KPIS", b_shift)
            
            handle_machine_states(conn, b_stat)
            handle_forecasts(conn, b_fcst)
            
            conn.commit()
            
            if iteration_count % 10 == 0:
                elapsed = (datetime.now() - DATA_START_TIME).total_seconds()
                remaining = duration_seconds - elapsed
                print(f"🚀 Batch #{iteration_count:3d} | Records: {len(b_tele):4d} | Elapsed: {elapsed:.1f}s | Remaining: {remaining:.1f}s")

    except KeyboardInterrupt:
        print("\n⚠️  Stream stopped by user.")
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Sync sequences at shutdown
        try:
            cursor = conn.cursor()
            seq_tables = [
                "alerts", "iot_events", "alert_escalations", "sensor_telemetry",
                "machine_states", "machine_heartbeats", "kpi_aggregates",
                "telemetry_aggregates", "shift_kpis", "forecast_outputs"
            ]
            for table in seq_tables:
                cursor.execute(f"SELECT setval('{table}_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM {table}), false)")
            conn.commit()
            cursor.close()
            print("\n✅ Synced all auto-increment sequences!")
        except Exception as seq_error:
            print(f"\n⚠️  Error syncing sequences: {seq_error}")
        
        conn.close()
        print("✅ Database connection closed.")
        print(f"\n📊 Simulation Complete! Total iterations: {iteration_count}")

# ==========================================
# 6. CLI INTERFACE
# ==========================================
def main():
    """Main entry point with CLI argument parsing"""
    parser = argparse.ArgumentParser(
        description='IoT Data Seeding Script - Generates realistic machine telemetry data',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Environment Variables:
  DB_NAME       Database name (default: databricks_postgres)
  DB_USER       Database user
  DB_PASSWORD   Database password
  DB_HOST       Database host
  DB_PORT       Database port (default: 5432)
  DB_SSLMODE    SSL mode (default: require)

Examples:
  # Run for 5 minutes with default settings
  python standalone_seed_script.py --duration 300
  
  # Run for 10 minutes with higher production rate
  python standalone_seed_script.py --duration 600 --probability 0.005
  
  # Use environment variables for database connection
  export DB_USER=myuser
  export DB_PASSWORD=mypassword
  python standalone_seed_script.py --duration 300
        """
    )
    
    parser.add_argument(
        '--duration',
        type=int,
        default=300,
        help='Duration in seconds (default: 300)'
    )
    
    parser.add_argument(
        '--probability',
        type=float,
        default=0.004,
        help='Production probability (0.003-0.005, default: 0.004)'
    )
    
    args = parser.parse_args()
    
    # Validate arguments
    if args.duration <= 0:
        print("❌ Error: Duration must be positive")
        return 1
    
    if not (0.001 <= args.probability <= 0.01):
        print("⚠️  Warning: Production probability should be between 0.001 and 0.01")
    
    # Get database configuration
    db_config = get_config()
    
    # Check if credentials are provided (allow empty password for local setups)
    if db_config['user'] == 'your_username':
        print("❌ Error: Please set DB_USER environment variable")
        print("\nExample:")
        print("  export DB_USER=myuser")
        print("  export DB_PASSWORD=mypassword  # Optional for local PostgreSQL")
        print("  python standalone_seed_script.py --duration 300")
        return 1
    
    # Run simulation
    try:
        run_simulation(args.duration, args.probability, db_config)
        return 0
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    exit(main())
