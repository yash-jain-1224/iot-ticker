"""
Database initialization script for IoT Ticker Platform
This script creates all database tables and seeds initial data
"""

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
import random


def utc_now():
    """Get current UTC time with timezone info"""
    return datetime.now(timezone.utc)

# Add the app directory to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

from app.core.config import settings
from app.core.database import Base
from app.core.security import get_password_hash
from app.models.user import User, Role
from app.models.plant import Plant, Shop, Line
from app.models.machine import Machine, MachineState
from app.models.telemetry import SensorTelemetry
from app.models.event import IoTEvent, Alert
from app.models.kpi import KPIAggregate
from app.models.forecast import ForecastOutput
from app.models.audit import ControlActionAudit


async def create_tables(engine):
    """Create all database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✓ Database tables created")


async def seed_users(session: AsyncSession):
    """Seed initial users"""
    users = [
        {
            "username": "admin",
            "email": "admin@auronixmotors.com",
            "full_name": "System Administrator",
            "role": Role.ADMIN,
            "password": "admin123",
        },
        {
            "username": "manager",
            "email": "manager@auronixmotors.com",
            "full_name": "Plant Manager",
            "role": Role.MANAGER,
            "password": "manager123",
        },
        {
            "username": "supervisor",
            "email": "supervisor@auronixmotors.com",
            "full_name": "Line Supervisor",
            "role": Role.SUPERVISOR,
            "password": "supervisor123",
        },
        {
            "username": "operator",
            "email": "operator@auronixmotors.com",
            "full_name": "Machine Operator",
            "role": Role.OPERATOR,
            "password": "operator123",
        },
        {
            "username": "executive",
            "email": "executive@auronixmotors.com",
            "full_name": "Executive Director",
            "role": Role.EXECUTIVE,
            "password": "executive123",
        },
        {
            "username": "demo",
            "email": "demo@auronixmotors.com",
            "full_name": "Demo User",
            "role": Role.VIEWER,
            "password": "demo123",
        },
    ]

    for user_data in users:
        password = user_data.pop("password")
        user = User(
            **user_data,
            hashed_password=get_password_hash(password),
            is_active=True,
        )
        session.add(user)

    await session.commit()
    print(f"✓ Created {len(users)} users")


async def seed_plants_and_shops(session: AsyncSession):
    """Seed plants, shops, and lines"""
    # Create plant
    plant = Plant(
        code="AUSTIN-001",
        name="Auronix Motors Austin Plant",
        location="Austin, Texas",
    )
    session.add(plant)
    await session.flush()

    # Create shops
    shops_data = [
        {
            "code": "BS-001",
            "name": "Body Shop",
            "shop_type": "body_shop",
        },
        {
            "code": "PS-001",
            "name": "Paint Shop",
            "shop_type": "paint_shop",
        },
        {
            "code": "FA-001",
            "name": "Final Assembly",
            "shop_type": "final_assembly",
        },
        {
            "code": "UT-001",
            "name": "Utilities",
            "shop_type": "utilities",
        },
    ]

    shops = []
    for shop_data in shops_data:
        shop = Shop(plant_id=plant.id, **shop_data)
        session.add(shop)
        shops.append(shop)

    await session.flush()

    # Create lines for each shop
    lines_config = {
        "body_shop": ["BIW Line 1", "BIW Line 2", "Underbody Line", "Framing Line"],
        "paint_shop": ["PT/ED Line", "Primer Line", "Color Line", "Clear Coat Line"],
        "final_assembly": ["Trim Line 1", "Trim Line 2", "Chassis Line", "Final Line"],
        "utilities": ["Power House", "Compressor Room", "HVAC Central", "Water Treatment"],
    }

    lines = []
    for shop in shops:
        line_names = lines_config.get(shop.shop_type, [])
        for idx, line_name in enumerate(line_names, 1):
            line = Line(
                shop_id=shop.id,
                code=f"{shop.code}-L{idx:02d}",
                name=line_name,
                target_cycle_time=random.randint(90, 150),
            )
            session.add(line)
            lines.append(line)

    await session.commit()
    print(f"✓ Created 1 plant, {len(shops)} shops, {len(lines)} lines")
    return plant, shops, lines


async def seed_machines(session: AsyncSession, shops, lines):
    """Seed machines for each line"""
    machine_types = {
        "body_shop": ["welding_robot", "press", "assembly_robot"],
        "paint_shop": ["paint_robot", "conveyor", "hvac"],
        "final_assembly": ["assembly_robot", "conveyor", "cnc_machine"],
        "utilities": ["compressor", "pump", "transformer", "generator"],
    }

    machine_names = {
        "welding_robot": "Welding Robot",
        "press": "Press Machine",
        "assembly_robot": "Assembly Robot",
        "paint_robot": "Paint Robot",
        "conveyor": "Conveyor",
        "hvac": "HVAC Unit",
        "cnc_machine": "CNC Machine",
        "compressor": "Compressor",
        "pump": "Pump",
        "transformer": "Transformer",
        "generator": "Generator",
    }

    manufacturers = ["FANUC", "KUKA", "ABB", "Siemens", "Atlas Copco", "Dürr"]
    statuses = ["online", "online", "online", "online", "idle", "fault", "maintenance", "offline"]

    machines = []
    machine_counter = 1

    for shop in shops:
        shop_lines = [l for l in lines if l.shop_id == shop.id]
        types = machine_types.get(shop.shop_type, ["other"])

        for line in shop_lines:
            # 3-8 machines per line
            num_machines = random.randint(3, 8)
            for i in range(num_machines):
                machine_type = random.choice(types)
                machine = Machine(
                    code=f"M{machine_counter:04d}",
                    name=f"{machine_names.get(machine_type, 'Machine')} {i+1}",
                    machine_type=machine_type,
                    line_id=line.id,
                    manufacturer=random.choice(manufacturers),
                    model=f"Model-{random.randint(100, 999)}",
                    installation_date=utc_now() - timedelta(days=random.randint(365, 3650)),
                    is_controllable=random.choice([True, False]),
                )
                session.add(machine)
                machines.append(machine)
                machine_counter += 1

    await session.flush()
    
    # Add initial state for each machine
    for machine in machines:
        status = random.choice(statuses)
        health = random.uniform(60, 100)
        state = MachineState(
            machine_id=machine.id,
            status=status,
            health_score=health,
            cycle_count=random.randint(1000, 50000),
            is_current=True,
        )
        session.add(state)

    await session.commit()
    print(f"✓ Created {len(machines)} machines with states")
    return machines


async def seed_telemetry(session: AsyncSession, machines):
    """Seed sample telemetry data"""
    now = utc_now()
    telemetry_records = []

    sensor_types = ["temperature", "vibration", "current", "power", "pressure"]

    # Generate 2 hours of telemetry (24 records per machine per sensor)
    for machine in machines[:30]:  # Limit to first 30 machines for speed
        for sensor in sensor_types:
            for i in range(12):
                timestamp = now - timedelta(minutes=i * 10)
                
                if sensor == "temperature":
                    value = random.uniform(35, 85)
                    unit = "°C"
                elif sensor == "vibration":
                    value = random.uniform(0.1, 5.0)
                    unit = "mm/s"
                elif sensor == "current":
                    value = random.uniform(20, 95)
                    unit = "A"
                elif sensor == "power":
                    value = random.uniform(5, 45)
                    unit = "kW"
                else:
                    value = random.uniform(5, 8)
                    unit = "bar"
                
                telemetry = SensorTelemetry(
                    machine_id=machine.id,
                    sensor_type=sensor,
                    sensor_id=f"{machine.code}-{sensor.upper()}",
                    value=value,
                    unit=unit,
                    quality="good",
                    timestamp=timestamp,
                )
                telemetry_records.append(telemetry)

    session.add_all(telemetry_records)
    await session.commit()
    print(f"✓ Created {len(telemetry_records)} telemetry records")


async def seed_events_and_alerts(session: AsyncSession, machines):
    """Seed sample events and alerts"""
    event_types = [
        ("temperature_high", "warning", "Temperature High"),
        ("vibration_anomaly", "warning", "Vibration Anomaly"),
        ("power_spike", "warning", "Power Spike"),
        ("maintenance_due", "info", "Maintenance Due"),
        ("connection_lost", "critical", "Connection Lost"),
        ("cycle_time_exceeded", "error", "Cycle Time Exceeded"),
        ("quality_issue", "error", "Quality Issue"),
    ]

    events = []
    alerts = []
    now = utc_now()

    for machine in random.sample(machines, min(30, len(machines))):
        event_type, severity, title = random.choice(event_types)
        
        # Create event
        event = IoTEvent(
            machine_id=machine.id,
            event_type=event_type,
            severity=severity,
            title=title,
            message=f"{title} detected on {machine.code}",
            value=random.uniform(60, 120),
            threshold=random.uniform(50, 100),
            timestamp=now - timedelta(minutes=random.randint(5, 1440)),
        )
        events.append(event)
        
        # Create corresponding alert
        alert = Alert(
            machine_id=machine.id,
            alert_type="threshold",
            severity=severity,
            status=random.choice(["active", "active", "acknowledged", "resolved"]),
            title=title,
            description=f"{title} detected on {machine.code}",
            trigger_value=random.uniform(60, 120),
            threshold_value=random.uniform(50, 100),
            triggered_at=now - timedelta(minutes=random.randint(5, 1440)),
        )
        alerts.append(alert)

    session.add_all(events)
    session.add_all(alerts)
    await session.commit()
    print(f"✓ Created {len(events)} events and {len(alerts)} alerts")


async def seed_kpis(session: AsyncSession, plant, shops):
    """Seed sample KPI data"""
    kpis = []
    now = utc_now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Plant-level KPIs
    for days_ago in range(7):
        period_start = today - timedelta(days=days_ago)
        period_end = period_start + timedelta(days=1)
        
        kpis.append(
            KPIAggregate(
                plant_id=plant.id,
                period_type="day",
                period_start=period_start,
                period_end=period_end,
                availability=random.uniform(90, 98),
                performance=random.uniform(85, 95),
                quality=random.uniform(95, 99.5),
                oee=random.uniform(75, 92),
                mtbf=random.uniform(24, 72),
                mttr=random.uniform(0.5, 2.0),
                planned_production=random.randint(900, 1100),
                actual_production=random.randint(800, 1000),
                energy_consumption=random.uniform(45000, 55000),
            )
        )

    # Shop-level KPIs
    for shop in shops:
        for days_ago in range(3):
            period_start = today - timedelta(days=days_ago)
            period_end = period_start + timedelta(days=1)
            
            kpis.append(
                KPIAggregate(
                    shop_id=shop.id,
                    period_type="day",
                    period_start=period_start,
                    period_end=period_end,
                    availability=random.uniform(88, 98),
                    performance=random.uniform(82, 95),
                    quality=random.uniform(94, 99.5),
                    oee=random.uniform(72, 92),
                )
            )

    session.add_all(kpis)
    await session.commit()
    print(f"✓ Created {len(kpis)} KPI records")


async def seed_forecasts(session: AsyncSession, machines):
    """Seed sample forecast data"""
    forecasts = []
    now = utc_now()

    risk_levels = ["low", "medium", "high", "critical"]
    
    for machine in random.sample(machines, min(20, len(machines))):
        forecast = ForecastOutput(
            machine_id=machine.id,
            forecast_type="failure_probability",
            model_name="Predictive Maintenance Model",
            model_version="v1.2.0",
            prediction_value=random.uniform(5, 80),
            prediction_unit="%",
            confidence_score=random.uniform(0.7, 0.95),
            prediction_horizon="7d",
            valid_from=now,
            valid_until=now + timedelta(days=7),
            risk_level=random.choice(risk_levels),
            risk_score=random.uniform(10, 90),
            recommendations=[
                random.choice([
                    "Schedule preventive maintenance",
                    "Monitor closely",
                    "Inspect bearings",
                    "Check cooling system",
                ])
            ],
        )
        forecasts.append(forecast)

    session.add_all(forecasts)
    await session.commit()
    print(f"✓ Created {len(forecasts)} forecast records")


async def main():
    """Main initialization function"""
    print("\n" + "=" * 50)
    print("IoT Ticker Platform - Database Initialization")
    print("=" * 50 + "\n")

    # Create async engine
    database_url = settings.DATABASE_URL
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://")

    engine = create_async_engine(database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        # Create tables
        await create_tables(engine)

        async with async_session() as session:
            # Check if data already exists
            result = await session.execute(text("SELECT COUNT(*) FROM users"))
            count = result.scalar()
            
            if count > 0:
                print("\n⚠ Database already contains data. Skipping seed.")
                print("  To re-seed, drop the database tables first.\n")
                return

            # Seed data
            await seed_users(session)
            plant, shops, lines = await seed_plants_and_shops(session)
            machines = await seed_machines(session, shops, lines)
            await seed_telemetry(session, machines)
            await seed_events_and_alerts(session, machines)
            await seed_kpis(session, plant, shops)
            await seed_forecasts(session, machines)

        print("\n" + "=" * 50)
        print("✓ Database initialization complete!")
        print("=" * 50)
        print("\nDefault login credentials:")
        print("  Admin:      admin / admin123")
        print("  Manager:    manager / manager123")
        print("  Supervisor: supervisor / supervisor123")
        print("  Operator:   operator / operator123")
        print("  Executive:  executive / executive123")
        print("  Demo:       demo / demo123")
        print("\n")

    except Exception as e:
        print(f"\n✗ Error during initialization: {e}")
        raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
