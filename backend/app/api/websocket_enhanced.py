"""
Enhanced WebSocket API with Topic-Based Channels
Supports real-time component-level updates with filter-based subscriptions
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Optional, List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, and_

from app.core.database import async_session_maker
from app.core.filters import GlobalFilters, get_time_range, apply_location_filters
from app.models.event import IoTEvent, Alert
from app.models.machine import Machine, MachineState
from app.models.kpi import KPIAggregate

logger = logging.getLogger(__name__)

router = APIRouter()


class EnhancedConnectionManager:
    """
    Manages WebSocket connections with topic-based subscriptions
    Supports dynamic filter-based subscriptions
    """

    def __init__(self):
        # Connections by topic: {topic: {websocket: filters}}
        self.topic_connections: Dict[str, Dict[WebSocket, dict]] = {
            "kpi": {},
            "machine_status": {},
            "alerts": {},
            "energy": {},
            "production": {},
            "ticker": {},
        }

    async def connect(self, websocket: WebSocket, topic: str, filters: dict = None):
        """Connect a WebSocket to a topic with optional filters"""
        await websocket.accept()

        if topic not in self.topic_connections:
            self.topic_connections[topic] = {}

        self.topic_connections[topic][websocket] = filters or {}

    def disconnect(self, websocket: WebSocket, topic: str):
        """Disconnect a WebSocket from a topic"""
        if topic in self.topic_connections:
            self.topic_connections[topic].pop(websocket, None)

    def update_filters(self, websocket: WebSocket, topic: str, filters: dict):
        """Update filters for an existing connection"""
        if topic in self.topic_connections and websocket in self.topic_connections[topic]:
            self.topic_connections[topic][websocket] = filters

    async def broadcast(self, topic: str, message: dict, target_filters: dict = None):
        """
        Broadcast a message to connections in a topic
        If target_filters specified, only send to matching connections
        """
        if topic not in self.topic_connections:
            return

        disconnected = set()
        for websocket, conn_filters in self.topic_connections[topic].items():
            # Check if message matches connection filters
            if target_filters and not self._filters_match(conn_filters, target_filters):
                continue

            try:
                await websocket.send_json(message)
            except Exception:
                disconnected.add(websocket)

        # Clean up disconnected clients
        for conn in disconnected:
            self.topic_connections[topic].pop(conn, None)

    def _filters_match(self, conn_filters: dict, target_filters: dict) -> bool:
        """Check if connection filters match target filters"""
        if not conn_filters:
            return True  # No filters means receive all

        # Check each filter dimension
        for key in ["location", "workshop", "line_id", "machine_id"]:
            conn_val = conn_filters.get(key)
            target_val = target_filters.get(key)

            if conn_val and target_val and conn_val != target_val:
                return False

        return True


# Global enhanced connection manager
manager = EnhancedConnectionManager()


def parse_filters_from_query(
    location: Optional[str],
    workshop: Optional[str],
    line_id: Optional[str],
    machine_id: Optional[str]
) -> dict:
    """Parse filter parameters from query strings"""
    filters = {}

    if location and location not in ("undefined", "null", "", "all"):
        filters["location"] = location

    if workshop and workshop not in ("undefined", "null", ""):
        filters["workshop"] = workshop

    if line_id and line_id not in ("undefined", "null", ""):
        try:
            filters["line_id"] = int(line_id)
        except ValueError:
            pass

    if machine_id and machine_id not in ("undefined", "null", ""):
        try:
            filters["machine_id"] = int(machine_id)
        except ValueError:
            pass

    return filters


# ===== WebSocket Endpoints =====

@router.websocket("/kpi/live")
async def websocket_kpi_live(
    websocket: WebSocket,
    location: Optional[str] = Query(None),
    workshop: Optional[str] = Query(None),
    line_id: Optional[str] = Query(None),
    machine_id: Optional[str] = Query(None),
):
    """WebSocket for live KPI updates"""
    filters = parse_filters_from_query(location, workshop, line_id, machine_id)
    await manager.connect(websocket, "kpi", filters)

    try:
        # Send initial KPIs
        async with async_session_maker() as db:
            kpis = await fetch_kpi_data(db, filters)
            await websocket.send_json({
                "event_type": "kpi_update",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "location": filters.get("location", "all"),
                "workshop": filters.get("workshop"),
                "line_id": filters.get("line_id"),
                "machine_id": filters.get("machine_id"),
                "payload": kpis
            })

        # Poll for updates every 10 seconds
        while True:
            await asyncio.sleep(0)

            async with async_session_maker() as db:
                kpis = await fetch_kpi_data(db, filters)
                await websocket.send_json({
                    "event_type": "kpi_update",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "location": filters.get("location", "all"),
                    "workshop": filters.get("workshop"),
                    "line_id": filters.get("line_id"),
                    "machine_id": filters.get("machine_id"),
                    "payload": kpis
                })

    except WebSocketDisconnect:
        manager.disconnect(websocket, "kpi")
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
        manager.disconnect(websocket, "kpi")


@router.websocket("/machine/status")
async def websocket_machine_status(
    websocket: WebSocket,
    location: Optional[str] = Query(None),
    workshop: Optional[str] = Query(None),
    line_id: Optional[str] = Query(None),
    machine_id: Optional[str] = Query(None),
):
    """WebSocket for machine status changes"""
    filters = parse_filters_from_query(location, workshop, line_id, machine_id)
    await manager.connect(websocket, "machine_status", filters)

    try:
        # Track last known states to detect changes
        last_states = {}

        while True:
            async with async_session_maker() as db:
                current_states = await fetch_machine_states(db, filters)

                # Detect changes
                for machine_id, state in current_states.items():
                    if machine_id not in last_states or last_states[machine_id] != state["status"]:
                        # Status changed, emit event
                        await websocket.send_json({
                            "event_type": "status_change",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "location": filters.get("location", "all"),
                            "workshop": filters.get("workshop"),
                            "line_id": filters.get("line_id"),
                            "machine_id": machine_id,
                            "payload": state
                        })

                last_states = current_states

            await asyncio.sleep(0)

    except WebSocketDisconnect:
        manager.disconnect(websocket, "machine_status")
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
        manager.disconnect(websocket, "machine_status")


@router.websocket("/alerts/live")
async def websocket_alerts_live(
    websocket: WebSocket,
    location: Optional[str] = Query(None),
    workshop: Optional[str] = Query(None),
    line_id: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
):
    """WebSocket for live alert updates"""
    filters = parse_filters_from_query(location, workshop, line_id, None)
    if severity:
        filters["severity"] = severity

    await manager.connect(websocket, "alerts", filters)

    try:
        last_alert_id = 0

        while True:
            async with async_session_maker() as db:
                new_alerts = await fetch_new_alerts(db, filters, last_alert_id)

                if new_alerts:
                    for alert in new_alerts:
                        await websocket.send_json({
                            "event_type": "alert",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "location": filters.get("location", "all"),
                            "workshop": filters.get("workshop"),
                            "line_id": filters.get("line_id"),
                            "payload": alert
                        })

                    last_alert_id = new_alerts[-1]["id"]

            await asyncio.sleep(0)

    except WebSocketDisconnect:
        manager.disconnect(websocket, "alerts")
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
        manager.disconnect(websocket, "alerts")


@router.websocket("/energy/live")
async def websocket_energy_live(
    websocket: WebSocket,
    location: Optional[str] = Query(None),
    workshop: Optional[str] = Query(None),
    line_id: Optional[str] = Query(None),
):
    """WebSocket for live energy consumption updates"""
    filters = parse_filters_from_query(location, workshop, line_id, None)
    await manager.connect(websocket, "energy", filters)

    try:
        while True:
            async with async_session_maker() as db:
                energy_data = await fetch_energy_data(db, filters)

                await websocket.send_json({
                    "event_type": "energy_update",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "location": filters.get("location", "all"),
                    "workshop": filters.get("workshop"),
                    "line_id": filters.get("line_id"),
                    "payload": energy_data
                })

            await asyncio.sleep(0)

    except WebSocketDisconnect:
        manager.disconnect(websocket, "energy")
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
        manager.disconnect(websocket, "energy")


@router.websocket("/production/live")
async def websocket_production_live(
    websocket: WebSocket,
    location: Optional[str] = Query(None),
    workshop: Optional[str] = Query(None),
    line_id: Optional[str] = Query(None),
):
    """WebSocket for live production metrics"""
    filters = parse_filters_from_query(location, workshop, line_id, None)
    await manager.connect(websocket, "production", filters)

    try:
        while True:
            async with async_session_maker() as db:
                production_data = await fetch_production_data(db, filters)

                await websocket.send_json({
                    "event_type": "production_update",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "location": filters.get("location", "all"),
                    "workshop": filters.get("workshop"),
                    "line_id": filters.get("line_id"),
                    "payload": production_data
                })

            await asyncio.sleep(0)

    except WebSocketDisconnect:
        manager.disconnect(websocket, "production")
    except Exception as e:
        logger.debug(f"WebSocket error: {e}")
        manager.disconnect(websocket, "production")


# ===== Data Fetching Functions =====

async def fetch_kpi_data(db: AsyncSession, filters: dict) -> dict:
    """Fetch KPI data based on filters"""
    global_filters = GlobalFilters(
        location=filters.get("location"),
        workshop=filters.get("workshop"),
        line_id=filters.get("line_id"),
        machine_id=filters.get("machine_id"),
        time_range="1h"
    )

    from_time, to_time = get_time_range(global_filters)

    query = select(
        func.avg(KPIAggregate.availability).label('availability'),
        func.avg(KPIAggregate.performance).label('performance'),
        func.avg(KPIAggregate.quality).label('quality'),
        func.avg(KPIAggregate.oee).label('oee')
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    )

    query = apply_location_filters(query, global_filters, KPIAggregate, join_machine=True, join_line=True)

    result = await db.execute(query)
    row = result.first()

    return {
        "availability": round(row.availability or 0, 2),
        "performance": round(row.performance or 0, 2),
        "quality": round(row.quality or 0, 2),
        "oee": round(row.oee or 0, 2)
    }


async def fetch_machine_states(db: AsyncSession, filters: dict) -> dict:
    """Fetch current machine states"""
    global_filters = GlobalFilters(
        location=filters.get("location"),
        workshop=filters.get("workshop"),
        line_id=filters.get("line_id"),
        machine_id=filters.get("machine_id")
    )

    # Get latest state for each machine
    latest_state_subq = (
        select(
            MachineState.machine_id,
            func.max(MachineState.recorded_at).label('max_recorded')
        )
        .group_by(MachineState.machine_id)
        .subquery()
    )

    query = select(Machine, MachineState).join(
        MachineState,
        Machine.id == MachineState.machine_id
    ).join(
        latest_state_subq,
        and_(
            MachineState.machine_id == latest_state_subq.c.machine_id,
            MachineState.recorded_at == latest_state_subq.c.max_recorded
        )
    ).where(Machine.is_active == True)  # noqa: E712

    query = apply_location_filters(query, global_filters, Machine, join_line=True)

    result = await db.execute(query)
    rows = result.all()

    states = {}
    for machine, state in rows:
        states[machine.id] = {
            "machine_id": machine.id,
            "machine_name": machine.name,
            "status": state.status,
            "health_score": state.health_score,
            "current_cycle": state.current_cycle,
            "current_load": state.current_load,
            "temperature": state.temperature,
            "vibration": state.vibration,
            "power_consumption": state.power_consumption,
            "fault_code": state.fault_code,
            "fault_message": state.fault_message,
        }

    return states


async def fetch_new_alerts(db: AsyncSession, filters: dict, last_alert_id: int) -> List[dict]:
    """Fetch new alerts since last_alert_id"""
    global_filters = GlobalFilters(
        location=filters.get("location"),
        workshop=filters.get("workshop"),
        line_id=filters.get("line_id")
    )

    query = select(Alert).where(
        and_(
            Alert.id > last_alert_id,
            Alert.status.in_(["active", "acknowledged", "escalated"])
        )
    ).order_by(Alert.id).limit(50)

    if filters.get("severity"):
        query = query.where(Alert.severity == filters["severity"])

    query = apply_location_filters(query, global_filters, Alert, join_machine=True, join_line=True)

    result = await db.execute(query)
    alerts = result.scalars().all()

    return [
        {
            "id": alert.id,
            "machine_id": alert.machine_id,
            "alert_type": alert.alert_type,
            "severity": alert.severity,
            "title": alert.title,
            "description": alert.description,
            "triggered_at": alert.triggered_at.isoformat()
        }
        for alert in alerts
    ]


async def fetch_energy_data(db: AsyncSession, filters: dict) -> dict:
    """Fetch energy consumption data"""
    global_filters = GlobalFilters(
        location=filters.get("location"),
        workshop=filters.get("workshop"),
        line_id=filters.get("line_id"),
        time_range="1h"
    )

    from_time, to_time = get_time_range(global_filters)

    query = select(
        func.sum(KPIAggregate.energy_consumption).label('total_kwh')
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    )

    query = apply_location_filters(query, global_filters, KPIAggregate, join_machine=True, join_line=True)

    result = await db.execute(query)
    row = result.first()

    return {
        "total_kwh": round(row.total_kwh or 0, 2),
        "cost_estimate": round((row.total_kwh or 0) * 7.5, 2)
    }


async def fetch_production_data(db: AsyncSession, filters: dict) -> dict:
    """Fetch production metrics"""
    global_filters = GlobalFilters(
        location=filters.get("location"),
        workshop=filters.get("workshop"),
        line_id=filters.get("line_id"),
        time_range="1h"
    )

    from_time, to_time = get_time_range(global_filters)

    query = select(
        func.sum(KPIAggregate.actual_production).label('total_production'),
        func.sum(KPIAggregate.planned_production).label('total_planned')
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    )

    query = apply_location_filters(query, global_filters, KPIAggregate, join_machine=True, join_line=True)

    result = await db.execute(query)
    row = result.first()

    actual = row.total_production or 0
    planned = row.total_planned or 1

    return {
        "actual_production": int(actual),
        "planned_production": int(planned),
        "efficiency": round((actual / planned) * 100, 2) if planned > 0 else 0
    }


async def fetch_operator_dashboard_data(db: AsyncSession, filters: dict) -> Optional[dict]:
    """Fetch complete operator dashboard data"""
    from app.api.analytics import (
        _determine_time_window,
        _fetch_kpi_records,
        _summarize_records,
        _compute_network_totals,
        _safe_round,
        _get_machine_status_counts,
        _get_machine_health_distribution,
    )
    from app.models.plant import Plant, Shop
    from sqlalchemy import or_

    plant_id = filters.get("plant_id")
    shop_type = filters.get("shop_type")
    time_range = filters.get("time_range", "24h")

    # Handle 'all', empty, or undefined plant_id - fetch all plants
    if plant_id in ("all", "undefined", None, ""):
        plant_id = None

    from_time, to_time = _determine_time_window(time_range)

    # Get plants
    plant_query = select(Plant)
    if plant_id:
        try:
            plant_id_int = int(plant_id)
        except (TypeError, ValueError):
            plant_query = plant_query.where(Plant.code == plant_id)
        else:
            plant_query = plant_query.where(or_(Plant.code == plant_id, Plant.id == plant_id_int))

    plants_result = await db.execute(plant_query)
    plants = list(plants_result.scalars().all())

    # Only return empty if there are truly no plants in the database
    if not plants:
        logger.debug(f"WebSocket: No plants found in database for filters: {filters}")
        return None

    plant_ids = [plant.id for plant in plants]

    # Get shops
    shop_query = select(Shop).where(Shop.plant_id.in_(plant_ids))
    if shop_type and shop_type != "all":
        shop_query = shop_query.where(Shop.shop_type == shop_type)
    shops_result = await db.execute(shop_query)
    shops = list(shops_result.scalars().all())
    shop_ids = [shop.id for shop in shops] if shops else None
    shops_by_id = {shop.id: shop for shop in shops}

    # Get KPI aggregates
    kpi_records = await _fetch_kpi_records(
        db,
        plant_ids=plant_ids,
        from_time=from_time,
        to_time=to_time,
        shop_ids=shop_ids,
        period_types=["hour", "day"],
    )

    # Get previous period for comparison
    previous_records = await _fetch_kpi_records(
        db,
        plant_ids=plant_ids,
        from_time=from_time - (to_time - from_time),
        to_time=from_time,
        shop_ids=shop_ids,
        period_types=["hour", "day"],
    )

    # Aggregate metrics
    current_summary = _summarize_records(kpi_records, shops_by_id)
    previous_summary = _summarize_records(previous_records, shops_by_id)

    network_current = _compute_network_totals(current_summary.get("plant", {}))
    network_previous = _compute_network_totals(previous_summary.get("plant", {}))

    # Build KPIs
    oee_current = network_current.get("oee", 0.0)
    oee_previous = network_previous.get("oee", 0.0)
    oee_change = oee_current - oee_previous if oee_previous else 0.0

    # Calculate cycle time
    cycle_time_current = 0.0
    cycle_time_count = 0
    for record in kpi_records:
        if record.additional_metrics and "cycle_time" in record.additional_metrics:
            cycle_time_current += float(record.additional_metrics["cycle_time"])
            cycle_time_count += 1
    cycle_time_current = cycle_time_current / cycle_time_count if cycle_time_count > 0 else 0.0

    cycle_time_previous = 0.0
    cycle_time_prev_count = 0
    for record in previous_records:
        if record.additional_metrics and "cycle_time" in record.additional_metrics:
            cycle_time_previous += float(record.additional_metrics["cycle_time"])
            cycle_time_prev_count += 1
    cycle_time_previous = cycle_time_previous / cycle_time_prev_count if cycle_time_prev_count > 0 else 0.0
    cycle_time_change = cycle_time_current - cycle_time_previous if cycle_time_previous else 0.0

    downtime_current = network_current.get("downtime", 0.0)
    downtime_previous = network_previous.get("downtime", 0.0)
    downtime_change = downtime_current - downtime_previous if downtime_previous else 0.0

    quality_current = network_current.get("quality", 0.0)
    quality_previous = network_previous.get("quality", 0.0)
    quality_change = quality_current - quality_previous if quality_previous else 0.0

    kpis = {
        "oee": {
            "value": _safe_round(oee_current, 1),
            "unit": "%",
            "target": 85.0,
            "change": _safe_round(oee_change, 1),
            "change_type": "positive" if oee_change >= 0 else "negative",
        },
        "cycle_time": {
            "value": _safe_round(cycle_time_current, 1),
            "unit": "sec",
            "change": _safe_round(cycle_time_change, 1),
            "change_type": "positive" if cycle_time_change <= 0 else "negative",
        },
        "downtime": {
            "value": int(round(downtime_current)),
            "unit": "min",
            "change": _safe_round(downtime_change, 1),
            "change_type": "positive" if downtime_change <= 0 else "negative",
        },
        "quality_pass_rate": {
            "value": _safe_round(quality_current, 1),
            "unit": "%",
            "change": _safe_round(quality_change, 1),
            "change_type": "positive" if quality_change >= 0 else "negative",
        },
    }

    # Build quality metrics by shop
    quality_by_shop = []
    shop_stats = current_summary.get("plant", {})
    for plant_id_key, stats in shop_stats.items():
        for shop_type_key, shop_metrics in stats.get("shops", {}).items():
            shop = next((s for s in shops if s.shop_type == shop_type_key), None)
            if shop:
                quality_rate = shop_metrics.get("oee", 0.0)
                defect_estimate = (100 - quality_rate) / 10.0 if quality_rate > 0 else 0.0

                quality_by_shop.append({
                    "shop": shop.name,
                    "pass_rate": _safe_round(quality_rate, 1),
                    "rework": _safe_round(defect_estimate, 1),
                    "metric_key": shop_type_key,
                })

    quality = {"by_shop": quality_by_shop}
    for entry in quality_by_shop:
        quality[f"{entry['metric_key']}_pass_rate"] = entry["pass_rate"]
        quality[f"{entry['metric_key']}_rework"] = entry["rework"]

    # Machine status
    machine_status = await _get_machine_status_counts(db, plant_ids=plant_ids, shop_ids=shop_ids)

    # Health distribution
    health_distribution = await _get_machine_health_distribution(db, plant_ids=plant_ids, shop_ids=shop_ids)

    # OEE trend
    oee_trend = []
    hourly_records = [r for r in kpi_records if r.period_type == "hour"]
    hourly_records.sort(key=lambda r: r.period_start)
    for record in hourly_records[-12:]:
        if record.period_start:
            oee_trend.append({
                "time": record.period_start.strftime("%H:%M"),
                "timestamp": record.period_start.isoformat(),
                "oee": _safe_round(float(record.oee or 0), 1),
            })

    # Cycle time trend
    cycle_time_trend = []
    for record in hourly_records[-12:]:
        if record.period_start and record.additional_metrics and "cycle_time" in record.additional_metrics:
            cycle_time_trend.append({
                "time": record.period_start.strftime("%H:%M"),
                "timestamp": record.period_start.isoformat(),
                "cycle_time": _safe_round(float(record.additional_metrics["cycle_time"]), 1),
            })

    # Machine status breakdown
    total_machines = sum(machine_status.values()) or 1
    machine_status_breakdown = [
        {
            "status": status,
            "label": status.replace("_", " ").title(),
            "value": count,
            "percentage": round((count / total_machines) * 100, 1),
        }
        for status, count in machine_status.items()
        if count > 0
    ]

    # Get recent alerts
    alert_query = select(Alert).where(
        Alert.status.in_(["active", "acknowledged"])
    ).order_by(desc(Alert.triggered_at)).limit(10)

    if shop_ids:
        from app.models.machine import Machine
        alert_query = alert_query.join(Machine).where(Machine.shop_id.in_(shop_ids))

    alerts_result = await db.execute(alert_query)
    alerts_data = alerts_result.scalars().all()

    alerts = []
    for alert in alerts_data:
        alerts.append({
            "id": alert.id,
            "type": alert.alert_type,
            "severity": alert.severity,
            "machine": f"Machine {alert.machine_id}",
            "sensor": alert.title,
            "value": None,
            "threshold": None,
            "unit": "",
            "time": alert.triggered_at.strftime("%H:%M") if alert.triggered_at else "—",
        })

    # Get recent events
    event_query = select(IoTEvent).where(
        IoTEvent.timestamp >= from_time
    ).order_by(desc(IoTEvent.timestamp)).limit(10)

    if shop_ids:
        from app.models.machine import Machine
        event_query = event_query.join(Machine).where(Machine.shop_id.in_(shop_ids))

    events_result = await db.execute(event_query)
    events_data = events_result.scalars().all()

    events = []
    for event in events_data:
        events.append({
            "id": event.id,
            "title": event.event_type,
            "message": event.message or "",
            "severity": event.severity or "info",
            "time": event.timestamp.strftime("%H:%M") if event.timestamp else "—",
        })

    result = {
        "kpis": kpis,
        "trends": {
            "oee": oee_trend,
            "cycle_time": cycle_time_trend,
            "machine_status": machine_status_breakdown,
        },
        "machine_status": machine_status,
        "health_distribution": health_distribution,
        "quality": quality,
        "alerts": alerts,
        "events": events,
    }

    # Debug logging
    logger.debug(
        f"WebSocket: Returning data - KPIs: {len(kpis)} keys, "
        f"Alerts: {len(alerts)}, "
        f"Machine status total: {sum(machine_status.values())}"
    )

    return result


@router.websocket("/analytics/operator")
async def websocket_operator_dashboard(
    websocket: WebSocket,
    plant_id: Optional[str] = Query(None),
    shop_type: Optional[str] = Query(None),
    time_range: Optional[str] = Query("24h"),
):
    """
    WebSocket endpoint for operator dashboard with real-time updates
    """
    await websocket.accept()

    filters = {
        "plant_id": plant_id,
        "shop_type": shop_type,
        "time_range": time_range,
    }

    try:
        while True:
            # Fetch fresh data
            async with async_session_maker() as db:
                try:
                    data = await fetch_operator_dashboard_data(db, filters)
                    if data:
                        logger.debug(
                            f"WebSocket: Fetched data successfully. "
                            f"KPIs: {list(data.get('kpis', {}).keys())}, "
                            f"Alerts: {len(data.get('alerts', []))}"
                        )
                    else:
                        logger.debug(
                            f"WebSocket: fetch_operator_dashboard_data "
                            f"returned None for filters: {filters}"
                        )
                except Exception as fetch_error:
                    logger.error(f"Error fetching operator dashboard data: {fetch_error}")
                    import traceback
                    traceback.print_exc()
                    data = None

            if data:
                # Send update
                await websocket.send_json({
                    "type": "update",
                    "data": data,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
            else:
                # Send empty data structure to prevent client hanging
                logger.debug(f"WebSocket: Sending empty data structure for filters: {filters}")
                await websocket.send_json({
                    "type": "update",
                    "data": {
                        "kpis": {},
                        "trends": {},
                        "machine_status": {},
                        "health_distribution": {},
                        "quality": {"by_shop": []},
                        "alerts": [],
                        "events": [],
                    },
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })

            # Wait before next update (5 seconds for real-time feel)
            await asyncio.sleep(0)

    except WebSocketDisconnect:
        logger.debug("Operator dashboard WebSocket disconnected")
    except Exception as e:
        logger.error(f"Error in operator dashboard WebSocket: {e}")
        import traceback
        traceback.print_exc()
        try:
            await websocket.close()
        except Exception:
            pass
