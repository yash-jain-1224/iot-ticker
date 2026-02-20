# Database Seeding Scripts

This directory contains scripts for seeding the IoT Ticker Platform database with test data.

## 📁 Scripts Overview

### Initial Setup

#### `seed_complete_data.py`
**Purpose:** One-time initial database seeding with master data and historical records.

**What it creates:**
- Users and authentication data
- Plant hierarchy (plants, shops, lines)
- Machines and sensors
- Historical KPIs and analytics data
- Workshop insights
- AI/BI dashboard metadata

**Usage:**
```bash
cd backend
python scripts/seed_complete_data.py
```

**Run this FIRST before any other seeding scripts!**

---

### Continuous Operation

#### `seed_incremental_data.py`
**Purpose:** Continuous real-time data generation for simulating live production.

**What it creates:**
- Sensor telemetry (every second)
- Machine heartbeats (every second)
- Events and alerts (as they occur)
- Machine state updates (every second)
- Hourly KPI aggregates
- Auto-purges data older than 30 days

**Direct Usage:**
```bash
cd backend
python scripts/seed_incremental_data.py --interval 1 --batch-size 100
```

**Preset Usage (Recommended):**
```bash
# Demo preset (30 minutes, 1s interval)
./backend/scripts/run_incremental_seeding.sh demo

# Development preset (1 hour, 5s interval)
./backend/scripts/run_incremental_seeding.sh dev

# Test preset (2 minutes, 1s interval)
./backend/scripts/run_incremental_seeding.sh test

# Continuous preset (runs until stopped)
./backend/scripts/run_incremental_seeding.sh continuous
```

**Options:**
- `--interval N`: Seconds between generation cycles (default: 1)
- `--batch-size N`: Records per batch (default: 100)
- `--max-cycles N`: Maximum cycles before stopping (default: infinite)

---

#### `run_incremental_seeding.sh`
**Purpose:** Convenient wrapper script with pre-configured presets.

**Presets:**
- `demo` - Real-time seeding for 30 minutes
- `dev` - Slower seeding for 1 hour
- `test` - Quick 2-minute test
- `load` - High-frequency load test for 10 minutes
- `continuous` - Runs until manually stopped

**Usage:**
```bash
./backend/scripts/run_incremental_seeding.sh [preset]
./backend/scripts/run_incremental_seeding.sh custom [interval] [max-cycles] [batch-size]
```

---

### Monitoring

#### `monitor_seeding.py`
**Purpose:** Monitor incremental seeding performance and data health.

**What it shows:**
- Telemetry statistics and freshness
- Event and alert counts
- Machine state distribution
- Database size and table sizes
- Data generation rates

**Usage:**
```bash
cd backend
python scripts/monitor_seeding.py
```

---

## 🚀 Quick Start Guide

### First Time Setup
```bash
# Step 1: Seed initial data (one-time)
cd backend
python scripts/seed_complete_data.py

# Step 2: Start real-time seeding
./backend/scripts/run_incremental_seeding.sh demo

# Step 3: Open dashboard
# http://localhost:3000/dashboard
```

### Daily Development
```bash
# Start slower seeding for development
./backend/scripts/run_incremental_seeding.sh dev

# Monitor data generation
python backend/scripts/monitor_seeding.py
```

### Before Demo/Presentation
```bash
# Start real-time seeding
./backend/scripts/run_incremental_seeding.sh demo

# Let it run for a few minutes to populate data
# Then open dashboard for live updates
```

---

## 📊 Data Generation Rates

With 50 machines at 1-second intervals:

| Data Type | Records/Second | Records/Hour |
|-----------|---------------|--------------|
| Telemetry | ~225 | ~810,000 |
| Heartbeats | 50 | ~180,000 |
| Events | 2-3 | ~180 |
| Alerts | 0-1 | ~50 |
| States | 50 | ~180,000 |

---

## 💾 Storage Requirements

### With 30-Day Retention (50 machines, 1s interval)
- **Total Storage:** ~72 GB
- **Daily Growth:** ~2.4 GB
- **Auto-purge:** Data older than 30 days is automatically deleted

### Optimization Options
1. Increase interval to 5s → 80% storage reduction
2. Reduce number of active machines
3. Shorten retention period to 7-14 days

---

## 🐳 Deployment Options

### Local Development
```bash
./backend/scripts/run_incremental_seeding.sh dev
```

### Docker Compose
```bash
docker-compose -f docker-compose.seeding.yml up -d
```

### Systemd Service (Linux Production)
```bash
sudo systemctl start iot-incremental-seeding
```

---

## 📚 Documentation

- **[QUICK_START_INCREMENTAL_SEEDING.md](../../QUICK_START_INCREMENTAL_SEEDING.md)** - Quick start guide
- **[INCREMENTAL_SEEDING_GUIDE.md](../../INCREMENTAL_SEEDING_GUIDE.md)** - Complete documentation
- **[INCREMENTAL_SEEDING_SUMMARY.md](../../INCREMENTAL_SEEDING_SUMMARY.md)** - Implementation overview

---

## 🆘 Troubleshooting

### Script won't run
```bash
# Make sure you're in the right directory
cd /path/to/IOT

# Make script executable
chmod +x backend/scripts/run_incremental_seeding.sh

# Check Python path
which python3

# Install dependencies
pip install -r backend/requirements.txt
```

### Database connection failed
```bash
# Check .env file
cat .env | grep DATABASE_URL

# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

### Data not appearing in dashboard
```bash
# Check if script is running
ps aux | grep seed_incremental

# Check data freshness
python backend/scripts/monitor_seeding.py

# Verify WebSocket connection in browser console
```

---

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review the documentation files
3. Check script output logs
4. Verify database connectivity
5. Monitor system resources

---

## ✅ Checklist

Before running incremental seeding:
- [ ] Initial seed completed (`seed_complete_data.py`)
- [ ] Database is running and accessible
- [ ] `.env` file configured correctly
- [ ] Dependencies installed (`pip install -r requirements.txt`)
- [ ] Sufficient disk space (monitor with `df -h`)

Success indicators:
- [ ] Script runs without errors
- [ ] Console shows regular cycle updates
- [ ] Dashboard displays changing data
- [ ] Monitor shows fresh data (age < 60 seconds)
- [ ] WebSocket updates work in browser

---

**Happy Seeding!** 🌱
