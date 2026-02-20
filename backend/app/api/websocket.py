"""
WebSocket API routes for real-time updates
"""
import asyncio
import json
import logging
import traceback
from datetime import datetime, timezone, timedelta
from typing import Dict, Set, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func, or_, and_
from app.core.database import async_session_maker
from app.models.event import IoTEvent, Alert
from app.models.machine import Machine, MachineState
from app.models.plant import Line, Shop, Plant
from app.models.telemetry import SensorTelemetry, TelemetryAggregate
from app.models.kpi import KPIAggregate
from app.models.forecast import ForecastOutput

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectionManager:
    """Manages WebSocket connections for different channels"""

    def __init__(self):
        # Connections by channel
        self.connections: Dict[str, Set[WebSocket]] = {
            "ticker": set(),
            "alerts": set(),
            "machines": set(),
            "kpis": set(),
            "telemetry": set(),
            "forecasts": set(),
            "manager-dashboard": set(),
            "leadership-dashboard": set(),
        }
        self.user_connections: Dict[int, Set[WebSocket]] = {}
        # Track connection limits
        self.max_connections_per_channel = 100

    async def connect(self, websocket: WebSocket, channel: str, user_id: int = None):
        """Connect a WebSocket to a channel"""
        # Create channel if it doesn't exist
        if channel not in self.connections:
            self.connections[channel] = set()

        # Check connection limit
        if len(self.connections[channel]) >= self.max_connections_per_channel:
            logger.warning(
                f" Channel {channel} has {len(self.connections[channel])} connections, cleaning up stale connections...")  # noqa: E501
            await self._cleanup_stale_connections(channel)

        await websocket.accept()
        self.connections[channel].add(websocket)

        if user_id:
            if user_id not in self.user_connections:
                self.user_connections[user_id] = set()
            self.user_connections[user_id].add(websocket)

        logger.debug(f"WebSocket connected to {channel} (total: {len(self.connections[channel])})")

    def disconnect(self, websocket: WebSocket, channel: str, user_id: int = None):
        """Disconnect a WebSocket from a channel"""
        if channel in self.connections:
            self.connections[channel].discard(websocket)
            logger.debug(f"WebSocket disconnected from {channel} (remaining: {len(self.connections[channel])})")

        if user_id and user_id in self.user_connections:
            self.user_connections[user_id].discard(websocket)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]

    async def _cleanup_stale_connections(self, channel: str):
        """Remove stale/dead connections from a channel"""
        if channel not in self.connections:
            return

        stale = []
        for conn in self.connections[channel]:
            try:
                # Try to ping the connection
                await conn.send_json({"type": "ping"})
            except Exception:
                stale.append(conn)

        # Remove stale connections
        for conn in stale:
            self.connections[channel].discard(conn)
            try:
                await conn.close()
            except Exception:
                pass

        if stale:
            logger.debug(f"Cleaned up {len(stale)} stale connections from {channel}")

    async def broadcast(self, channel: str, message: dict):
        """Broadcast a message to all connections in a channel"""
        if channel not in self.connections:
            return

        disconnected = set()
        for connection in self.connections[channel]:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.error(f"Failed to send to connection in {channel}: {e}")
                disconnected.add(connection)

        # Clean up disconnected clients
        for conn in disconnected:
            self.connections[channel].discard(conn)
            try:
                await conn.close()
            except Exception:
                pass

        if disconnected:
            logger.debug(f"Cleaned up {len(disconnected)} dead connections from {channel}")

    async def send_to_user(self, user_id: int, message: dict):
        """Send a message to a specific user"""
        if user_id not in self.user_connections:
            return

        for connection in self.user_connections[user_id]:
            try:
                await connection.send_json(message)
            except Exception:
                pass


# Global connection manager
manager = ConnectionManager()


def parse_optional_int(value: str) -> Optional[int]:
    """Parse an optional int parameter, treating 'undefined', 'null', empty as None"""
    if value is None or value in ('undefined', 'null', ''):
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def parse_optional_str(value: str) -> Optional[str]:
    """Parse an optional string parameter, treating 'undefined', 'null', empty as None"""
    if value is None or value in ('undefined', 'null', ''):
        return None
    return value


@router.websocket("/ticker")
async def websocket_ticker(
    websocket: WebSocket,
    plant_id: str = Query(None),
    shop_type: str = Query(None),
    token: str = Query(None),
):
    """WebSocket endpoint for live ticker events"""
    # Parse params, treating "undefined" as None
    parsed_plant_id = parse_optional_int(plant_id)
    parsed_shop_type = parse_optional_str(shop_type)

    # Accept connection first (allow unauthenticated for now, can add auth check later)
    try:
        await manager.connect(websocket, "ticker")
    except Exception as e:
        logger.error(f"Failed to establish WebSocket connection: {e}")
        return

    last_event_id = 0
    connection_start = datetime.now(timezone.utc)
    max_connection_duration = timedelta(hours=8)  # Auto-disconnect after 8 hours

    try:
        # Send initial events
        try:
            async with async_session_maker() as db:
                initial_events = await get_recent_events(db, parsed_plant_id, parsed_shop_type, limit=20)
                await websocket.send_json({
                    "type": "initial",
                    "events": initial_events,
                })

                # Safely get the last event ID
                if initial_events and len(initial_events) > 0:
                    last_event_id = initial_events[-1]["id"]
        except Exception as e:
            logger.error(f"Error sending initial ticker events: {e}")
            # Send empty initial data to client
            try:
                await websocket.send_json({
                    "type": "initial",
                    "events": [],
                })
            except Exception:
                # If we can't even send empty data, disconnect
                raise WebSocketDisconnect()

        # Keep connection alive and poll for new events
        while True:
            # Check connection duration
            if datetime.now(timezone.utc) - connection_start > max_connection_duration:
                logger.debug("Ticker WebSocket connection duration exceeded, closing...")
                await websocket.send_json({"type": "reconnect", "message": "Connection duration exceeded"})
                break

            try:
                # Poll for new events every 2 seconds
                await asyncio.sleep(0)

                try:
                    async with async_session_maker() as db:
                        new_events = await get_new_events(db, last_event_id, parsed_plant_id, parsed_shop_type)

                        if new_events and len(new_events) > 0:
                            last_event_id = new_events[-1]["id"]
                            await websocket.send_json({
                                "type": "update",
                                "events": new_events,
                            })
                except Exception as db_error:
                    # Log database error but continue
                    logger.debug(f"Database error in ticker: {db_error}")
                    logger.debug(f"Traceback: {traceback.format_exc()}")
                    # Continue the loop without crashing
            except asyncio.CancelledError:
                # Handle graceful shutdown
                logger.debug("Ticker WebSocket cancelled for connection")
                raise
            except WebSocketDisconnect:
                # Client disconnected, exit loop
                raise
            except Exception as e:
                # Log error but keep connection alive
                logger.error(f"Error in ticker loop: {e}")
                logger.debug(f"Traceback: {traceback.format_exc()}")
                await asyncio.sleep(0)

    except WebSocketDisconnect:
        logger.debug("Ticker WebSocket disconnected")
    except asyncio.CancelledError:
        logger.debug("Ticker WebSocket task cancelled")
        raise  # Re-raise CancelledError
    except Exception as e:
        logger.debug(f"WebSocket ticker error: {e}")
    finally:
        # Always cleanup
        manager.disconnect(websocket, "ticker")
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/alerts")
async def websocket_alerts(
    websocket: WebSocket,
    plant_id: str = Query(None),
    plant_code: str = Query(None),
    shop_id: str = Query(None),
    shop_type: str = Query(None),
    days: str = Query(None),
    token: str = Query(None),
):
    """WebSocket endpoint for live alerts with filters for time, location, and shop"""
    # Parse params, treating "undefined" as None
    parsed_plant_id = parse_optional_int(plant_id)
    parsed_plant_code = parse_optional_str(plant_code)
    parsed_shop_id = parse_optional_int(shop_id)
    parsed_shop_type = parse_optional_str(shop_type)
    parsed_days = parse_optional_int(days)

    logger.debug(
        f"[WS Alerts] Connecting with plant_id={plant_id}, plant_code={plant_code}, shop_id={shop_id}, shop_type={shop_type}, days={days}")  # noqa: E501
    logger.debug(
        f"[WS Alerts] Parsed: plant_id={parsed_plant_id}, plant_code={parsed_plant_code}, shop_id={parsed_shop_id}, shop_type={parsed_shop_type}, days={parsed_days}")  # noqa: E501

    # If plant_code is provided, look up the plant_id
    if parsed_plant_code and not parsed_plant_id:
        async with async_session_maker() as db:
            from app.models.plant import Plant  # noqa: F401
            result = await db.execute(select(Plant).where(Plant.code == parsed_plant_code))
            plant = result.scalar_one_or_none()
            if plant:
                parsed_plant_id = plant.id
                logger.debug(f"[WS Alerts] Looked up plant_id={parsed_plant_id} for code={parsed_plant_code}")
            else:
                logger.warning(f"[WS] WARNING: No plant found for code={parsed_plant_code}")

    await manager.connect(websocket, "alerts")

    try:
        # Send initial alerts summary and array
        try:
            async with async_session_maker() as db:
                alerts_data = await get_active_alerts(
                    db,
                    parsed_plant_id,
                    parsed_shop_id,
                    parsed_shop_type,
                    parsed_days
                )
                logger.debug(
                    f"[WS Alerts] Sending initial data - summary: {alerts_data['summary']}, alerts count: {len(alerts_data['alerts'])}")  # noqa: E501
                await websocket.send_json({
                    "type": "initial",
                    "summary": alerts_data["summary"],
                    "alerts": alerts_data["alerts"],
                })
        except Exception as e:
            logger.error(f"Error sending initial alerts: {e}")
            traceback.print_exc()
            await websocket.send_json({
                "type": "initial",
                "summary": {
                    "total_active": 0,
                    "critical": 0,
                    "error": 0,
                    "warning": 0,
                    "info": 0,
                    "sla_breached": 0,
                    "acknowledged": 0,
                    "unacknowledged": 0,
                },
                "alerts": [],
            })

        # Poll for updates
        while True:
            try:
                await asyncio.sleep(0)

                async with async_session_maker() as db:
                    alerts_data = await get_active_alerts(
                        db,
                        parsed_plant_id,
                        parsed_shop_id,
                        parsed_shop_type,
                        parsed_days
                    )
                    await websocket.send_json({
                        "type": "update",
                        "summary": alerts_data["summary"],
                        "alerts": alerts_data["alerts"],
                    })
            except asyncio.CancelledError:
                logger.debug("Alerts WebSocket cancelled")
                raise
            except WebSocketDisconnect:
                raise
            except Exception as e:
                logger.error(f"Error in alerts loop: {e}")
                await asyncio.sleep(0)

    except WebSocketDisconnect:
        logger.debug("Alerts WebSocket disconnected")
        manager.disconnect(websocket, "alerts")
    except asyncio.CancelledError:
        logger.debug("Alerts WebSocket task cancelled")
        manager.disconnect(websocket, "alerts")
        raise
    except Exception as e:
        logger.debug(f"WebSocket alerts error: {e}")
        manager.disconnect(websocket, "alerts")
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/machines")
async def websocket_machines(
    websocket: WebSocket,
    plant_id: str = Query(None),
    plant_code: str = Query(None),
    shop_type: str = Query(None),
    machine_id: str = Query(None),
    token: str = Query(None),
):
    """WebSocket endpoint for live machine states"""
    # Parse params, treating "undefined" as None
    parsed_plant_id = parse_optional_int(plant_id)
    parsed_plant_code = parse_optional_str(plant_code)
    parsed_shop_type = parse_optional_str(shop_type)
    parsed_machine_id = parse_optional_int(machine_id)

    logger.debug(
        f"[WebSocket /machines] Connection request with params: plant_id={plant_id}, plant_code={plant_code}, shop_type={shop_type}, machine_id={machine_id}")  # noqa: E501

    # If plant_code is provided, look up the plant_id
    if parsed_plant_code and not parsed_plant_id:
        async with async_session_maker() as db:
            from app.models.plant import Plant  # noqa: F401
            result = await db.execute(select(Plant).where(Plant.code == parsed_plant_code))
            plant = result.scalar_one_or_none()
            if plant:
                parsed_plant_id = plant.id
                logger.debug(
                    f"[WebSocket /machines] Resolved plant_code '{parsed_plant_code}' to plant_id={parsed_plant_id}")
            else:
                logger.debug(f"[WebSocket /machines] WARNING: plant_code '{parsed_plant_code}' not found!")

    logger.debug(
        f"[WebSocket /machines] Final filter params: plant_id={parsed_plant_id}, shop_type={parsed_shop_type}, machine_id={parsed_machine_id}")  # noqa: E501

    await manager.connect(websocket, "machines")

    try:
        while True:
            try:
                # Send machine states every 5 seconds
                async with async_session_maker() as db:
                    states = await get_machine_states(db, parsed_plant_id, parsed_shop_type, parsed_machine_id)
                    logger.debug(
                        f"[WebSocket /machines] Sending {len(states)} machine states (plant_id={parsed_plant_id}, machine_id={parsed_machine_id})")  # noqa: E501
                    await websocket.send_json({
                        "type": "update",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "machines": states,
                    })

                await asyncio.sleep(0)
            except asyncio.CancelledError:
                logger.debug("Machines WebSocket cancelled")
                raise
            except WebSocketDisconnect:
                raise
            except Exception as e:
                logger.error(f"Error in machines loop: {e}")
                logger.debug(f"Traceback: {traceback.format_exc()}")
                await asyncio.sleep(0)

    except WebSocketDisconnect:
        logger.debug("Machines WebSocket disconnected")
        manager.disconnect(websocket, "machines")
    except asyncio.CancelledError:
        logger.debug("Machines WebSocket task cancelled")
        manager.disconnect(websocket, "machines")
        raise
    except Exception as e:
        logger.debug(f"WebSocket machines error: {e}")
        manager.disconnect(websocket, "machines")
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/telemetry")
async def websocket_telemetry(
    websocket: WebSocket,
    plant_id: str = Query(None),
    plant_code: str = Query(None),
    shop_type: str = Query(None),
    token: str = Query(None),
):
    """WebSocket endpoint for live telemetry data including environmental conditions and color distribution"""
    # Parse params, treating "undefined" as None
    parsed_plant_id = parse_optional_int(plant_id)
    parsed_plant_code = parse_optional_str(plant_code)
    parsed_shop_type = parse_optional_str(shop_type)

    logger.debug(f"[WS Telemetry] Connecting with plant_id={plant_id}, plant_code={plant_code}, shop_type={shop_type}")
    logger.debug(
        f"[WS Telemetry] Parsed: plant_id={parsed_plant_id}, plant_code={parsed_plant_code}, shop_type={parsed_shop_type}")  # noqa: E501

    # If plant_code is provided, look up the plant_id
    if parsed_plant_code and not parsed_plant_id:
        async with async_session_maker() as db:
            result = await db.execute(select(Plant).where(Plant.code == parsed_plant_code))
            plant = result.scalar_one_or_none()
            if plant:
                parsed_plant_id = plant.id
                logger.debug(f"[WS Telemetry] Looked up plant_id={parsed_plant_id} for code={parsed_plant_code}")
            else:
                logger.warning(f"[WS] WARNING: No plant found for code={parsed_plant_code}")

    await manager.connect(websocket, "telemetry")

    try:
        while True:
            try:
                # Send telemetry data every 10 seconds
                async with async_session_maker() as db:
                    telemetry_data = await get_telemetry_data(db, parsed_plant_id, parsed_shop_type)
                    environmental_data = await get_environmental_conditions(db, parsed_plant_id, parsed_shop_type)
                    color_data = await get_color_distribution(db, parsed_plant_id, parsed_shop_type)

                    logger.debug(
                        f"[WS Telemetry] Sending data: environmental={len(environmental_data) if environmental_data else 0}, color_dist_total={color_data.get('total', 0)}, color_items={len(color_data.get('distribution', []))}")  # noqa: E501

                    await websocket.send_json({
                        "type": "update",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "telemetry": telemetry_data,
                        "environmental_conditions": environmental_data,
                        "color_distribution": color_data,
                    })

                await asyncio.sleep(0)
            except asyncio.CancelledError:
                logger.debug("Telemetry WebSocket cancelled")
                raise
            except WebSocketDisconnect:
                raise
            except Exception as e:
                logger.error(f"Error in telemetry loop: {e}")
                await asyncio.sleep(0)

    except WebSocketDisconnect:
        logger.debug("Telemetry WebSocket disconnected")
        manager.disconnect(websocket, "telemetry")
    except asyncio.CancelledError:
        logger.debug("Telemetry WebSocket task cancelled")
        manager.disconnect(websocket, "telemetry")
        raise
    except Exception as e:
        logger.debug(f"WebSocket telemetry error: {e}")
        manager.disconnect(websocket, "telemetry")
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/kpis")
async def websocket_kpis(
    websocket: WebSocket,
    plant_id: str = Query(None),
    plant_code: str = Query(None),
    shop_type: str = Query(None),
    days: str = Query(None),
    token: str = Query(None),
):
    """WebSocket endpoint for live KPI updates"""
    # Parse params, treating "undefined" as None
    parsed_plant_id = parse_optional_int(plant_id)
    parsed_plant_code = parse_optional_str(plant_code)
    parsed_shop_type = parse_optional_str(shop_type)
    parsed_days = parse_optional_int(days) if days else 1  # Default to 1 day

    # If plant_code is provided, look up the plant_id
    if parsed_plant_code and not parsed_plant_id:
        async with async_session_maker() as db:
            from app.models.plant import Plant  # noqa: F401
            result = await db.execute(select(Plant).where(Plant.code == parsed_plant_code))
            plant = result.scalar_one_or_none()
            if plant:
                parsed_plant_id = plant.id

    await manager.connect(websocket, "kpis")

    try:
        while True:
            try:
                # Send KPI updates every 5 seconds
                async with async_session_maker() as db:
                    kpi_data = await get_dashboard_kpis(db, parsed_plant_id, parsed_shop_type, parsed_days)
                    machine_summary = await get_machines_summary(db, parsed_plant_id, parsed_shop_type)
                    alerts_summary = await get_alerts_summary(db, parsed_plant_id, parsed_shop_type)

                    await websocket.send_json({
                        "type": "update",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "kpis": kpi_data,
                        "machines": machine_summary,
                        "alerts": alerts_summary,
                    })

                await asyncio.sleep(0)
            except asyncio.CancelledError:
                logger.debug("KPIs WebSocket cancelled")
                raise
            except WebSocketDisconnect:
                raise
            except Exception as e:
                logger.error(f"Error in kpis loop: {e}")
                await asyncio.sleep(0)

    except WebSocketDisconnect:
        logger.debug("KPIs WebSocket disconnected")
        manager.disconnect(websocket, "kpis")
    except asyncio.CancelledError:
        logger.debug("KPIs WebSocket task cancelled")
        manager.disconnect(websocket, "kpis")
        raise
    except Exception as e:
        logger.debug(f"WebSocket kpis error: {e}")
        manager.disconnect(websocket, "kpis")
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/telemetry/{machine_id}")
async def websocket_telemetry_machine(
    websocket: WebSocket,
    machine_id: int,
    token: str = Query(None),
):
    """WebSocket endpoint for live telemetry data for a specific machine"""
    channel = f"telemetry_{machine_id}"

    # Add dynamic channel if it doesn't exist
    if channel not in manager.connections:
        manager.connections[channel] = set()

    await manager.connect(websocket, channel)

    try:
        # Send initial telemetry history
        async with async_session_maker() as db:
            history = await get_machine_telemetry_history(db, machine_id, limit=50)
            await websocket.send_json({
                "type": "initial",
                "history": history,
            })

        # Poll for new telemetry data
        while True:
            await asyncio.sleep(0)

            async with async_session_maker() as db:
                latest = await get_latest_machine_telemetry(db, machine_id)
                if latest:
                    await websocket.send_json({
                        "type": "telemetry",
                        "data": latest,
                    })

    except WebSocketDisconnect:
        manager.disconnect(websocket, channel)
    except Exception:
        manager.disconnect(websocket, channel)


async def get_recent_events(db: AsyncSession, plant_id: int, shop_type: str, limit: int = 20) -> list:
    """Get recent ticker events"""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=1)

        query = (
            select(IoTEvent, Machine, Shop)
            .join(Machine, IoTEvent.machine_id == Machine.id)
            .join(Line, Machine.line_id == Line.id)
            .join(Shop, Line.shop_id == Shop.id)
            .where(IoTEvent.timestamp >= cutoff)
        )

        if plant_id:
            query = query.where(Shop.plant_id == plant_id)

        if shop_type:
            query = query.where(Shop.shop_type == shop_type)

        query = query.order_by(desc(IoTEvent.timestamp)).limit(limit)

        result = await db.execute(query)
        rows = result.all()

        events = []
        for event, machine, shop in rows:
            # Safely convert shop_type
            shop_type_value = shop.shop_type
            if hasattr(shop_type_value, 'value'):
                shop_type_value = shop_type_value.value
            elif shop_type_value is not None:
                shop_type_value = str(shop_type_value)

            events.append({
                "id": event.id,
                "machine_id": machine.id,
                "machine_code": machine.code,
                "machine_name": machine.name,
                "shop_type": shop_type_value,
                "event_type": event.event_type,
                "severity": event.severity,
                "title": event.title,
                "message": event.message,
                "timestamp": event.timestamp.isoformat() if event.timestamp else None,
            })

        return events
    except Exception as e:
        logger.error(f"Error in get_recent_events: {e}")
        logger.debug(f"Traceback: {traceback.format_exc()}")
        # Return empty list on error
        return []


async def get_new_events(db: AsyncSession, last_event_id: int, plant_id: int, shop_type: str) -> list:
    """Get new events since last event ID"""
    try:
        query = (
            select(IoTEvent, Machine, Shop)
            .join(Machine, IoTEvent.machine_id == Machine.id)
            .join(Line, Machine.line_id == Line.id)
            .join(Shop, Line.shop_id == Shop.id)
            .where(IoTEvent.id > last_event_id)
        )

        if plant_id:
            query = query.where(Shop.plant_id == plant_id)

        if shop_type:
            query = query.where(Shop.shop_type == shop_type)

        query = query.order_by(IoTEvent.id.asc()).limit(50)

        result = await db.execute(query)
        rows = result.all()

        events = []
        for event, machine, shop in rows:
            # Safely convert shop_type
            shop_type_value = shop.shop_type
            if hasattr(shop_type_value, 'value'):
                shop_type_value = shop_type_value.value
            elif shop_type_value is not None:
                shop_type_value = str(shop_type_value)

            events.append({
                "id": event.id,
                "machine_id": machine.id,
                "machine_code": machine.code,
                "machine_name": machine.name,
                "shop_type": shop_type_value,
                "event_type": event.event_type,
                "severity": event.severity,
                "title": event.title,
                "message": event.message,
                "timestamp": event.timestamp.isoformat() if event.timestamp else None,
            })

        return events
    except Exception as e:
        logger.error(f"Error in get_new_events: {e}")
        logger.debug(f"Traceback: {traceback.format_exc()}")
        # Return empty list on error to keep the connection alive
        return []


async def get_active_alerts(
    db: AsyncSession,
    plant_id: int = None,
    shop_id: int = None,
    shop_type: str = None,
    days: int = None
) -> dict:
    """Get active alerts with summary and full array, filtered by plant, shop, and time range"""
    logger.debug(
        f"[get_active_alerts] Fetching alerts for plant_id={plant_id}, shop_id={shop_id}, shop_type={shop_type}, days={days}")  # noqa: E501

    query = (
        select(Alert, Machine, Line, Shop, Plant)
        .join(Machine, Alert.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .join(Plant, Shop.plant_id == Plant.id)
        .where(Alert.status.in_(["active", "acknowledged", "escalated"]))
    )

    # Apply time range filter if specified
    if days:
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.where(Alert.triggered_at >= cutoff_date)
        logger.debug(f"[get_active_alerts] Filtering by time range: last {days} days (since {cutoff_date.isoformat()})")

    # Apply location filter (plant)
    if plant_id:
        query = query.where(Shop.plant_id == plant_id)
        logger.debug(f"[get_active_alerts] Filtering by plant_id={plant_id}")

    # Apply shop filters
    if shop_id:
        query = query.where(Line.shop_id == shop_id)
        logger.debug(f"[get_active_alerts] Filtering by shop_id={shop_id}")
    elif shop_type:
        query = query.where(Shop.shop_type == shop_type)
        logger.debug(f"[get_active_alerts] Filtering by shop_type={shop_type}")

    if not plant_id and not shop_id and not shop_type:
        logger.debug("[get_active_alerts] No filters applied - returning all alerts")

    query = query.order_by(
        Alert.severity.desc(),
        Alert.triggered_at.desc()
    )

    result = await db.execute(query)
    rows = result.all()

    logger.debug(f"[get_active_alerts] Found {len(rows)} alerts")

    # Build full alert array
    alerts_array = []
    for alert, machine, line, shop, plant in rows:
        alerts_array.append({
            "id": alert.id,
            "alert_id": alert.id,
            "machine_id": machine.id,
            "machine_code": machine.code,
            "machine_name": machine.name,
            "alert_type": alert.alert_type,
            "severity": alert.severity,
            "status": alert.status,
            "title": alert.title,
            "description": alert.description,
            "message": alert.description,
            "triggered_at": alert.triggered_at.isoformat() if alert.triggered_at else None,
            "created_at": alert.created_at.isoformat() if alert.created_at else None,
            "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
            "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
            "sla_deadline": alert.sla_deadline.isoformat() if alert.sla_deadline else None,
            "sla_breached": alert.sla_breached,
            "trigger_value": alert.trigger_value,
            "threshold_value": alert.threshold_value,
            "threshold_type": alert.threshold_type,
            "source_event_id": alert.source_event_id,
            "plant_name": plant.name,
            "plant_code": plant.code,
            "shop_name": shop.name,
            "shop_id": shop.id,
            "shop_type": shop.shop_type.value if hasattr(shop.shop_type, 'value') else str(shop.shop_type) if shop.shop_type else None,  # noqa: E501
            "line_name": line.name,
            "line_id": line.id,
        })

    # Build summary object (matching AlertSummary schema from alerts.py)
    summary = {
        "total_active": len(alerts_array),
        "critical": sum(1 for a in alerts_array if a["severity"] == "critical"),
        "error": sum(1 for a in alerts_array if a["severity"] == "error"),
        "warning": sum(1 for a in alerts_array if a["severity"] == "warning"),
        "info": sum(1 for a in alerts_array if a["severity"] == "info"),
        "sla_breached": sum(1 for a in alerts_array if a["sla_breached"]),
        "acknowledged": sum(1 for a in alerts_array if a["status"] == "acknowledged"),
        "unacknowledged": sum(1 for a in alerts_array if a["status"] == "active"),
    }

    logger.debug(f"[get_active_alerts] Summary: {summary}, Array count: {len(alerts_array)}")

    return {
        "summary": summary,
        "alerts": alerts_array
    }


async def get_machine_states(db: AsyncSession, plant_id: int, shop_type: str, machine_id: int = None) -> list:
    """Get current machine states with line and plant information"""
    logger.debug(
        f"[get_machine_states] Querying with plant_id={plant_id}, shop_type={shop_type}, machine_id={machine_id}")

    query = (
        select(MachineState, Machine, Shop, Line, Plant)
        .join(Machine, MachineState.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .join(Plant, Shop.plant_id == Plant.id)
        .where(MachineState.is_current == True, Machine.is_active == True)  # noqa: E712
    )

    if machine_id:
        query = query.where(Machine.id == machine_id)
        logger.debug(f"[get_machine_states] Filtering by machine_id={machine_id}")

    if plant_id:
        query = query.where(Shop.plant_id == plant_id)
        logger.debug(f"[get_machine_states] Filtering by plant_id={plant_id}")

    if shop_type:
        query = query.where(Shop.shop_type == shop_type)
        logger.debug(f"[get_machine_states] Filtering by shop_type={shop_type}")

    result = await db.execute(query)
    rows = result.all()

    logger.debug(f"[get_machine_states] Found {len(rows)} machine states")

    states = []
    for state, machine, shop, line, plant in rows:
        states.append({
            "machine_id": machine.id,
            "machine_code": machine.code,
            "machine_name": machine.name,
            "machine_type": machine.machine_type,
            "shop_id": shop.id,
            "shop_name": shop.name,
            "shop_type": shop.shop_type.value if hasattr(shop.shop_type, 'value') else str(shop.shop_type) if shop.shop_type else None,  # noqa: E501
            "line_id": line.id,
            "line_name": line.name,
            "line_code": line.code,
            "plant_id": plant.id,
            "plant_code": plant.code,
            "plant_name": plant.name,
            "location": plant.location,
            "status": state.status,
            "health_score": state.health_score,
            "current_cycle": state.current_cycle,
            "current_load": state.current_load,
            "temperature": state.temperature,
            "vibration": state.vibration,
            "power_consumption": state.power_consumption,
            "fault_code": state.fault_code,
            "fault_message": state.fault_message,
            "is_controllable": machine.is_controllable,
        })

    return states


async def get_telemetry_data(db: AsyncSession, plant_id: int, shop_type: str) -> list:
    """Get current telemetry data"""
    query = (
        select(
            SensorTelemetry,
            Machine,
            Shop) .join(
            Machine,
            SensorTelemetry.machine_id == Machine.id) .join(
                Line,
                Machine.line_id == Line.id) .join(
                    Shop,
                    Line.shop_id == Shop.id) .where(
                        SensorTelemetry.timestamp == select(
                            func.max(
                                SensorTelemetry.timestamp)).where(
                                    SensorTelemetry.machine_id == Machine.id).scalar_subquery()))

    if plant_id:
        query = query.where(Shop.plant_id == plant_id)

    if shop_type:
        query = query.where(Shop.shop_type == shop_type)

    result = await db.execute(query)
    rows = result.all()

    telemetry = []
    for reading, machine, shop in rows:
        telemetry.append({"machine_id": machine.id,
                          "machine_code": machine.code,
                          "machine_name": machine.name,
                          "shop_type": shop.shop_type.value if hasattr(shop.shop_type,
                                                                       'value') else str(shop.shop_type) if shop.shop_type else None,  # noqa: E501
                          "timestamp": reading.timestamp.isoformat(),
                          "sensor_type": reading.sensor_type,
                          "value": reading.value,
                          "unit": reading.unit,
                          })

    return telemetry


async def get_machine_telemetry_history(db: AsyncSession, machine_id: int, limit: int = 50) -> list:
    """Get telemetry history for a specific machine"""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)

    query = (
        select(SensorTelemetry)
        .where(
            SensorTelemetry.machine_id == machine_id,
            SensorTelemetry.timestamp >= cutoff
        )
        .order_by(desc(SensorTelemetry.timestamp))
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.scalars().all()

    history = []
    for reading in rows:
        history.append({
            "id": reading.id,
            "sensor_type": reading.sensor_type,
            "sensor_id": reading.sensor_id,
            "value": reading.value,
            "unit": reading.unit,
            "quality": reading.quality,
            "timestamp": reading.timestamp.isoformat(),
        })

    return history


async def get_environmental_conditions(db: AsyncSession, plant_id: Optional[int], shop_type: Optional[str]) -> dict:
    """Get current environmental conditions (temperature, humidity, air quality, dust level)"""
    # Priority map for sensor types
    sensor_priority = {
        "temperature": ["ambient_temp", "temperature", "temp"],
        "humidity": ["humidity", "relative_humidity"],
        "air_quality": ["air_quality", "aqi", "air_quality_index"],
        "dust_level": ["dust_level", "particulate_matter", "pm25", "pm10"],
    }

    base_query = select(
        SensorTelemetry.sensor_type,
        SensorTelemetry.value,
        SensorTelemetry.unit,
        SensorTelemetry.timestamp,
    ).join(Machine, Machine.id == SensorTelemetry.machine_id)

    # Add filters
    if shop_type or plant_id:
        base_query = base_query.join(Line, Line.id == Machine.line_id).join(Shop, Shop.id == Line.shop_id)
        if plant_id:
            base_query = base_query.where(Shop.plant_id == plant_id)
        if shop_type:
            base_query = base_query.where(Shop.shop_type == shop_type)

    latest_readings = {}

    for metric, sensor_aliases in sensor_priority.items():
        query = (
            base_query
            .where(SensorTelemetry.sensor_type.in_(sensor_aliases))
            .order_by(SensorTelemetry.timestamp.desc())
            .limit(1)
        )
        result = await db.execute(query)
        row = result.fetchone()
        if row:
            latest_readings[metric] = {
                "value": row.value,
                "unit": row.unit,
                "timestamp": row.timestamp.isoformat() if row.timestamp else None,
            }
        else:
            latest_readings[metric] = {"value": None, "unit": None, "timestamp": None}

    return latest_readings


async def get_color_distribution(db: AsyncSession, plant_id: Optional[int], shop_type: Optional[str]) -> dict:
    """Get latest paint color distribution for paint shops"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)

    query = select(TelemetryAggregate).where(
        TelemetryAggregate.sensor_type == "paint_color_distribution",
        TelemetryAggregate.period_start >= cutoff,
    ).order_by(TelemetryAggregate.period_start.desc())

    if plant_id:
        query = query.where(TelemetryAggregate.payload["plant_id"].as_integer() == plant_id)

    # Note: shop_type filtering could be added if needed in the future
    # Currently color distribution is stored by plant_id in the aggregate payload

    result = await db.execute(query.limit(1))
    row = result.scalar_one_or_none()

    if not row:
        return {
            "total": 0,
            "distribution": [],
            "timestamp": None,
        }

    data = row.payload or {}
    return {
        "total": data.get("total", 0),
        "distribution": data.get("distribution", []),
        "timestamp": row.period_start.isoformat() if row.period_start else None,
        "shop_id": data.get("shop_id"),
    }


async def get_latest_machine_telemetry(db: AsyncSession, machine_id: int) -> Optional[dict]:
    """Get the latest telemetry reading for a specific machine"""
    query = (
        select(SensorTelemetry)
        .where(SensorTelemetry.machine_id == machine_id)
        .order_by(desc(SensorTelemetry.timestamp))
        .limit(1)
    )

    result = await db.execute(query)
    reading = result.scalar_one_or_none()

    if not reading:
        return None

    return {
        "id": reading.id,
        "sensor_type": reading.sensor_type,
        "sensor_id": reading.sensor_id,
        "value": reading.value,
        "unit": reading.unit,
        "quality": reading.quality,
        "timestamp": reading.timestamp.isoformat(),
    }


async def get_dashboard_kpis(db: AsyncSession, plant_id: int, shop_type: str, days: int = 1) -> dict:
    """Get dashboard KPIs from database"""
    try:
        from app.models.kpi import KPIAggregate
        from app.models.plant import Plant, Shop  # noqa: F401

        # Calculate date range - use days parameter like API does
        now = datetime.now(timezone.utc)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff = today - timedelta(days=days)  # Use days parameter
        yesterday = today - timedelta(days=1)

        logger.debug(f"[get_dashboard_kpis] Querying KPIs - plant_id: {plant_id}, shop_type: {shop_type}, days: {days}")
        logger.debug(f"[get_dashboard_kpis] Date range: {cutoff} to {now}")

        # Get shop_ids and line_ids if shop_type is provided
        shop_ids = []
        line_ids = []
        if shop_type:
            shop_query = select(Shop).where(Shop.shop_type == shop_type)
            if plant_id:
                shop_query = shop_query.where(Shop.plant_id == plant_id)
            shops_result = await db.execute(shop_query)
            shops = shops_result.scalars().all()
            shop_ids = [s.id for s in shops]
            logger.debug(f"[get_dashboard_kpis] Found {len(shop_ids)} shops for type '{shop_type}'")

            # Get all lines under these shops for complete filtering
            if shop_ids:
                from app.models.plant import Line
                lines_result = await db.execute(
                    select(Line).where(Line.shop_id.in_(shop_ids))
                )
                lines = lines_result.scalars().all()
                line_ids = [line_obj.id for line_obj in lines]
                logger.debug(f"[get_dashboard_kpis] Found {len(line_ids)} lines under these shops")

        # Get KPIs for the selected time range (same as API)
        # Build the query with proper hierarchy filtering
        query = select(
            func.avg(KPIAggregate.oee).label('avg_oee'),
            func.avg(KPIAggregate.quality).label('avg_quality'),
            func.sum(KPIAggregate.actual_production).label('total_production'),
            func.sum(KPIAggregate.unplanned_downtime).label('total_downtime'),
            func.sum(KPIAggregate.energy_consumption).label('total_energy'),
            func.count(KPIAggregate.id).label('record_count')
        ).where(
            KPIAggregate.period_start >= cutoff,  # Use cutoff instead of today
            KPIAggregate.period_type == "minute"
        )

        # Apply filters with proper hierarchy logic
        # When shop_type is selected, aggregate ALL data related to those shops
        # (shop-level, line-level under those shops, machine-level under those lines)
        if shop_ids:
            # Get all machines under these lines too
            from app.models.machine import Machine
            machines_result = await db.execute(
                select(Machine.id).where(Machine.line_id.in_(line_ids)) if line_ids else select(Machine.id).where(False)
            )
            machine_ids = [m[0] for m in machines_result.all()] if line_ids else []
            logger.debug(f"[get_dashboard_kpis] Found {len(machine_ids)} machines under these lines")

            # Filter for ANY record that belongs to this shop hierarchy
            query = query.where(
                or_(
                    KPIAggregate.shop_id.in_(shop_ids),
                    KPIAggregate.line_id.in_(line_ids) if line_ids else False,
                    KPIAggregate.machine_id.in_(machine_ids) if machine_ids else False
                )
            )
        elif plant_id:
            # For plant-only filter, get ALL shops, lines, machines under that plant
            shops_result = await db.execute(
                select(Shop.id).where(Shop.plant_id == plant_id)
            )
            plant_shop_ids = [s[0] for s in shops_result.all()]

            if plant_shop_ids:
                from app.models.plant import Line
                from app.models.machine import Machine

                lines_result = await db.execute(
                    select(Line.id).where(Line.shop_id.in_(plant_shop_ids))
                )
                plant_line_ids = [row[0] for row in lines_result.all()]

                machines_result = await db.execute(
                    select(Machine.id).where(Machine.line_id.in_(plant_line_ids)
                                             ) if plant_line_ids else select(Machine.id).where(False)
                )
                plant_machine_ids = [m[0] for m in machines_result.all()] if plant_line_ids else []

                logger.debug(
                    f"[get_dashboard_kpis] Plant filter: {len(plant_shop_ids)} shops, {len(plant_line_ids)} lines, {len(plant_machine_ids)} machines")  # noqa: E501

                query = query.where(
                    or_(
                        KPIAggregate.plant_id == plant_id,
                        KPIAggregate.shop_id.in_(plant_shop_ids) if plant_shop_ids else False,
                        KPIAggregate.line_id.in_(plant_line_ids) if plant_line_ids else False,
                        KPIAggregate.machine_id.in_(plant_machine_ids) if plant_machine_ids else False
                    )
                )

        result = await db.execute(query)
        period_data = result.first()

        logger.debug(f"[get_dashboard_kpis] Query result: {period_data}")
        logger.debug(f"[get_dashboard_kpis] Query result type: {type(period_data)}")

        # Try to access attributes by name or index (SQLAlchemy compatibility)
        if period_data:
            try:
                # Try accessing by attribute name first
                logger.debug(
                    f"[get_dashboard_kpis] avg_oee: {period_data.avg_oee}, total_production: {period_data.total_production}")  # noqa: E501
                logger.debug(
                    f"[get_dashboard_kpis] total_downtime: {period_data.total_downtime}, total_energy: {period_data.total_energy}")  # noqa: E501
                logger.debug(f"[get_dashboard_kpis] record_count: {period_data.record_count}")
            except AttributeError:
                # Try accessing by index if attribute access fails
                logger.debug(
                    f"[get_dashboard_kpis] Accessing by index: {period_data[0]}, {period_data[1]}, {period_data[2]}, {period_data[3]}, {period_data[4]}")  # noqa: E501
        else:
            logger.debug("[get_dashboard_kpis] No data returned from query!")

        # Get yesterday's KPIs for comparison (using same filter logic)
        query_yesterday = select(
            func.avg(KPIAggregate.oee).label('avg_oee'),
            func.avg(KPIAggregate.quality).label('avg_quality'),
            func.sum(KPIAggregate.actual_production).label('total_production'),
        ).where(
            KPIAggregate.period_start >= yesterday,
            KPIAggregate.period_start < today,
            KPIAggregate.period_type == "minute"
        )

        # Apply same filter logic for yesterday's data
        if shop_ids:
            query_yesterday = query_yesterday.where(
                or_(
                    KPIAggregate.shop_id.in_(shop_ids),
                    KPIAggregate.line_id.in_(line_ids) if line_ids else False,
                    KPIAggregate.machine_id.in_(machine_ids) if machine_ids else False
                )
            )
        elif plant_id and plant_shop_ids:
            query_yesterday = query_yesterday.where(
                or_(
                    KPIAggregate.plant_id == plant_id,
                    KPIAggregate.shop_id.in_(plant_shop_ids) if plant_shop_ids else False,
                    KPIAggregate.line_id.in_(plant_line_ids) if plant_line_ids else False,
                    KPIAggregate.machine_id.in_(plant_machine_ids) if plant_machine_ids else False
                )
            )

        result_yesterday = await db.execute(query_yesterday)
        yesterday_data = result_yesterday.first()

        logger.debug(f"[get_dashboard_kpis] Yesterday query result: {yesterday_data}")

        # Extract metrics - use actual values if available with robust error handling
        try:
            period_oee = float(period_data.avg_oee) if period_data and period_data.avg_oee is not None else 0.0
            period_quality = float(
                period_data.avg_quality) if period_data and period_data.avg_quality is not None else 0.0
            period_production = int(
                period_data.total_production) if period_data and period_data.total_production is not None else 0
            period_downtime = float(
                period_data.total_downtime) if period_data and period_data.total_downtime is not None else 0.0
            period_energy = float(
                period_data.total_energy) if period_data and period_data.total_energy is not None else 0.0
            record_count = int(period_data.record_count) if period_data and period_data.record_count is not None else 0
        except (AttributeError, TypeError) as e:
            logger.debug(f"[get_dashboard_kpis] Error accessing period_data attributes: {e}, trying index access...")
            # Fallback to index access
            if period_data:
                period_oee = float(period_data[0]) if period_data[0] is not None else 0.0
                period_quality = float(period_data[1]) if period_data[1] is not None else 0.0
                period_production = int(period_data[2]) if period_data[2] is not None else 0
                period_downtime = float(period_data[3]) if period_data[3] is not None else 0.0
                period_energy = float(period_data[4]) if period_data[4] is not None else 0.0
                record_count = int(period_data[5]) if period_data and len(
                    period_data) > 5 and period_data[5] is not None else 0
            else:
                period_oee = period_quality = period_production = period_downtime = period_energy = record_count = 0

        try:
            yesterday_oee = float(
                yesterday_data.avg_oee) if yesterday_data and yesterday_data.avg_oee is not None else 0.0
            yesterday_quality = float(
                yesterday_data.avg_quality) if yesterday_data and yesterday_data.avg_quality is not None else 0.0
            yesterday_production = int(
                yesterday_data.total_production) if yesterday_data and yesterday_data.total_production is not None else 0  # noqa: E501
        except (AttributeError, TypeError) as e:
            logger.debug(f"[get_dashboard_kpis] Error accessing yesterday_data attributes: {e}, trying index access...")
            if yesterday_data:
                yesterday_oee = float(yesterday_data[0]) if yesterday_data[0] is not None else 0.0
                yesterday_quality = float(yesterday_data[1]) if yesterday_data[1] is not None else 0.0
                yesterday_production = int(yesterday_data[2]) if yesterday_data[2] is not None else 0
            else:
                yesterday_oee = yesterday_quality = yesterday_production = 0

        logger.debug(
            f"[get_dashboard_kpis] Extracted values - OEE: {period_oee}, Quality: {period_quality}, Production: {period_production}, Downtime: {period_downtime}, Energy: {period_energy}, Records: {record_count}")  # noqa: E501

        kpi_result = {
            "oee": {
                "value": round(period_oee, 2),
                "change": round(period_oee - yesterday_oee, 2),
                "trend": "up" if period_oee >= yesterday_oee else "down"
            },
            "quality": {
                "value": round(period_quality, 2),
                "change": round(period_quality - yesterday_quality, 2),
                "trend": "up" if period_quality >= yesterday_quality else "down"
            },
            "production": {
                "value": period_production,
                "change": period_production - yesterday_production,
                "trend": "up" if period_production >= yesterday_production else "down"
            },
            "downtime": {
                "value": round(period_downtime, 2),
                "unit": "min"
            },
            "energy": {
                "value": round(period_energy, 2),
                "unit": "kWh"
            }
        }

        logger.debug(f"[get_dashboard_kpis] Returning KPIs: {kpi_result}")
        return kpi_result

    except Exception as e:
        logger.debug(f"[get_dashboard_kpis] Error calculating dashboard KPIs: {e}")
        traceback.print_exc()
        # Return default values on error
        return {
            "oee": {"value": 0, "change": 0, "trend": "flat"},
            "quality": {"value": 0, "change": 0, "trend": "flat"},
            "production": {"value": 0, "change": 0, "trend": "flat"},
            "downtime": {"value": 0, "unit": "min"},
            "energy": {"value": 0, "unit": "kWh"}
        }


async def get_machines_summary(db: AsyncSession, plant_id: int, shop_type: str) -> dict:
    """Get machine status summary"""
    try:
        # Get status breakdown from MachineState
        base_query = (
            select(MachineState.status, func.count(MachineState.id))
            .join(Machine, MachineState.machine_id == Machine.id)
            .join(Line, Machine.line_id == Line.id)
            .join(Shop, Line.shop_id == Shop.id)
            .where(MachineState.is_current == True, Machine.is_active == True)  # noqa: E712
        )

        if plant_id:
            base_query = base_query.where(Shop.plant_id == plant_id)
        if shop_type:
            base_query = base_query.where(Shop.shop_type == shop_type)

        base_query = base_query.group_by(MachineState.status)

        result = await db.execute(base_query)
        status_counts = dict(result.all())

        total = sum(status_counts.values())

        # Count both 'running' and 'online' as online
        online_count = status_counts.get("running", 0) + status_counts.get("online", 0)

        return {
            "total": total,
            "online": online_count,
            "offline": status_counts.get("offline", 0),
            "idle": status_counts.get("idle", 0),
            "fault": status_counts.get("fault", 0),
            "maintenance": status_counts.get("maintenance", 0)
        }
    except Exception as e:
        logger.error(f"Error getting machines summary: {e}")
        return {
            "total": 0,
            "online": 0,
            "offline": 0,
            "idle": 0,
            "fault": 0,
            "maintenance": 0
        }


async def get_alerts_summary(db: AsyncSession, plant_id: int, shop_type: str) -> dict:
    """Get alerts summary"""
    try:
        # Get counts by severity for active alerts
        severity_query = (
            select(Alert.severity, func.count(Alert.id))
            .join(Machine, Alert.machine_id == Machine.id)
            .join(Line, Machine.line_id == Line.id)
            .join(Shop, Line.shop_id == Shop.id)
            .where(Alert.status.in_(["active", "acknowledged"]))
        )

        if plant_id:
            severity_query = severity_query.where(Shop.plant_id == plant_id)
        if shop_type:
            severity_query = severity_query.where(Shop.shop_type == shop_type)

        severity_query = severity_query.group_by(Alert.severity)

        result = await db.execute(severity_query)
        severity_counts = dict(result.all())

        total_active = sum(severity_counts.values())

        return {
            "total_active": total_active,
            "critical": severity_counts.get("critical", 0),
            "error": severity_counts.get("error", 0),
            "warning": severity_counts.get("warning", 0),
            "info": severity_counts.get("info", 0)
        }
    except Exception as e:
        logger.error(f"Error getting alerts summary: {e}")
        return {
            "total_active": 0,
            "critical": 0,
            "error": 0,
            "warning": 0,
            "info": 0
        }


@router.websocket("/forecasts")
async def websocket_forecasts(
    websocket: WebSocket,
    plant_id: str = Query(None),
    plant_code: str = Query(None),
    shop_type: str = Query(None),
    shop_id: str = Query(None),
    horizon: str = Query("7d"),
    token: str = Query(None),
):
    """WebSocket endpoint for live forecast updates"""
    # Parse params, treating "undefined" as None
    parsed_plant_id = parse_optional_int(plant_id)
    parsed_plant_code = parse_optional_str(plant_code)
    parsed_shop_type = parse_optional_str(shop_type)
    parsed_shop_id = parse_optional_int(shop_id)
    parsed_horizon = parse_optional_str(horizon) or "7d"

    logger.debug(
        f"[WS Forecasts] Connecting with plant_id={plant_id}, plant_code={plant_code}, shop_type={shop_type}, horizon={parsed_horizon}")  # noqa: E501

    # If plant_code is provided, look up the plant_id
    if parsed_plant_code and not parsed_plant_id:
        async with async_session_maker() as db:
            from app.models.plant import Plant  # noqa: F401
            result = await db.execute(select(Plant).where(Plant.code == parsed_plant_code))
            plant = result.scalar_one_or_none()
            if plant:
                parsed_plant_id = plant.id
                logger.debug(f"[WS Forecasts] Looked up plant_id={parsed_plant_id} for code={parsed_plant_code}")

    await manager.connect(websocket, "forecasts")

    try:
        # Send initial forecasts data
        try:
            async with async_session_maker() as db:
                forecasts_data = await get_forecasts_data(
                    db,
                    parsed_plant_id,
                    parsed_shop_id,
                    parsed_shop_type,
                    parsed_horizon
                )
                logger.debug(
                    f"[WS Forecasts] Sending initial data: risk_summary={forecasts_data.get('risk_summary')}, failure_probs={len(forecasts_data.get('failure_probabilities', []))}")  # noqa: E501
                await websocket.send_json({
                    "type": "initial",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    **forecasts_data,
                })
        except Exception as e:
            logger.error(f"Error sending initial forecasts: {e}")
            traceback.print_exc()
            await websocket.send_json({
                "type": "initial",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "risk_summary": {"critical": 0, "high": 0, "medium": 0, "low": 0},
                "failure_probabilities": [],
                "production_forecast": None,
                "energy_demand": None,
            })

        # Poll for updates every 30 seconds (forecasts don't change as frequently)
        while True:
            try:
                await asyncio.sleep(0)

                async with async_session_maker() as db:
                    forecasts_data = await get_forecasts_data(
                        db,
                        parsed_plant_id,
                        parsed_shop_id,
                        parsed_shop_type,
                        parsed_horizon
                    )
                    await websocket.send_json({
                        "type": "update",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        **forecasts_data,
                    })
            except asyncio.CancelledError:
                logger.debug("Forecasts WebSocket cancelled")
                raise
            except WebSocketDisconnect:
                raise
            except Exception as e:
                logger.error(f"Error in forecasts loop: {e}")
                await asyncio.sleep(0)

    except WebSocketDisconnect:
        logger.debug("Forecasts WebSocket disconnected")
        manager.disconnect(websocket, "forecasts")
    except asyncio.CancelledError:
        logger.debug("Forecasts WebSocket task cancelled")
        manager.disconnect(websocket, "forecasts")
        raise
    except Exception as e:
        logger.debug(f"WebSocket forecasts error: {e}")
        manager.disconnect(websocket, "forecasts")
        try:
            await websocket.close()
        except Exception:
            pass


async def get_forecasts_data(
    db: AsyncSession,
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    horizon: str = "7d"
) -> dict:
    """Get forecasts data for WebSocket - ENHANCED with multiple forecasts and critical items"""
    from app.models.forecast import ForecastOutput
    from app.models.plant import Shop, ShopType

    try:
        now = datetime.now(timezone.utc)

        # Get risk summary
        risk_query = select(ForecastOutput).where(
            ForecastOutput.valid_from <= now,
            ForecastOutput.valid_until >= now,
            ForecastOutput.risk_level.isnot(None)
        )

        if shop_id:
            risk_query = risk_query.where(ForecastOutput.shop_id == shop_id)
        elif plant_id:
            risk_query = risk_query.where(ForecastOutput.plant_id == plant_id)
        elif shop_type:
            # Resolve shop_type to shop_ids
            try:
                shop_type_enum = ShopType(shop_type)
                shop_result = await db.execute(select(Shop.id).where(Shop.shop_type == shop_type_enum))
                shop_ids = [s[0] for s in shop_result.all()]
                if shop_ids:
                    risk_query = risk_query.where(ForecastOutput.shop_id.in_(shop_ids))
            except ValueError:
                pass

        result = await db.execute(risk_query)
        forecasts = result.scalars().all()

        risk_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        for f in forecasts:
            if f.risk_level in risk_counts:
                risk_counts[f.risk_level] += 1

        # Get critical items (high and critical risk forecasts)
        critical_query = select(ForecastOutput).where(
            ForecastOutput.valid_from <= now,
            ForecastOutput.valid_until >= now,
            ForecastOutput.risk_level.in_(["critical", "high"])
        )

        if shop_id:
            critical_query = critical_query.where(ForecastOutput.shop_id == shop_id)
        elif plant_id:
            critical_query = critical_query.where(ForecastOutput.plant_id == plant_id)
        elif shop_type:
            try:
                shop_type_enum = ShopType(shop_type)
                shop_result = await db.execute(select(Shop.id).where(Shop.shop_type == shop_type_enum))
                shop_ids = [s[0] for s in shop_result.all()]
                if shop_ids:
                    critical_query = critical_query.where(ForecastOutput.shop_id.in_(shop_ids))
            except ValueError:
                pass

        critical_query = critical_query.order_by(ForecastOutput.prediction_value.desc()).limit(10)
        result = await db.execute(critical_query)
        critical_forecasts = result.scalars().all()

        critical_items = [
            {
                "machine_id": f.machine_id,
                "risk_level": f.risk_level,
                "risk_score": round(f.prediction_value or 0, 2),
                "forecast_type": f.forecast_type,
                "explanation": f.explanation,
                "valid_until": f.valid_until.isoformat() if f.valid_until else None,
            }
            for f in critical_forecasts
        ]

        # Get failure probability forecasts
        failure_query = select(ForecastOutput).where(
            ForecastOutput.forecast_type == "failure_probability",
            ForecastOutput.valid_from <= now,
            ForecastOutput.valid_until >= now
        )

        if shop_id:
            failure_query = failure_query.where(ForecastOutput.shop_id == shop_id)
        elif plant_id:
            failure_query = failure_query.where(ForecastOutput.plant_id == plant_id)
        elif shop_type:
            try:
                shop_type_enum = ShopType(shop_type)
                shop_result = await db.execute(select(Shop.id).where(Shop.shop_type == shop_type_enum))
                shop_ids = [s[0] for s in shop_result.all()]
                if shop_ids:
                    failure_query = failure_query.where(ForecastOutput.shop_id.in_(shop_ids))
            except ValueError:
                pass

        failure_query = failure_query.order_by(ForecastOutput.prediction_value.desc()).limit(20)
        result = await db.execute(failure_query)
        failure_forecasts = result.scalars().all()

        failure_probabilities = [
            {
                "machine_id": f.machine_id,
                "failure_probability": round(f.prediction_value or 0, 3),
                "confidence": round(f.confidence_score or 0, 3),
                "risk_level": f.risk_level,
                "prediction_horizon": f.prediction_horizon,
                "valid_until": f.valid_until.isoformat(),
                "recommendations": f.recommendations,
                "explanation": f.explanation,
            }
            for f in failure_forecasts
        ]

        # Get production forecasts (MULTIPLE - removed limit!)
        production_query = select(ForecastOutput).where(
            ForecastOutput.forecast_type == "production_forecast",
            ForecastOutput.prediction_horizon == horizon,
            ForecastOutput.valid_from <= now,
            ForecastOutput.valid_until >= now
        )

        if shop_id:
            production_query = production_query.where(ForecastOutput.shop_id == shop_id)
        elif plant_id:
            production_query = production_query.where(ForecastOutput.plant_id == plant_id)

        # Order by predicted value descending to show highest producers first
        production_query = production_query.order_by(ForecastOutput.prediction_value.desc()).limit(20)
        result = await db.execute(production_query)
        production_forecasts = result.scalars().all()

        production_data = [
            {
                "predicted_units": f.prediction_value,
                "confidence_lower": f.confidence_lower,
                "confidence_upper": f.confidence_upper,
                "confidence_score": f.confidence_score,
                "horizon": f.prediction_horizon,
                "valid_until": f.valid_until.isoformat(),
                # ADD ENTITY IDS
                "line_id": f.line_id,
                "shop_id": f.shop_id,
                "plant_id": f.plant_id,
            }
            for f in production_forecasts
        ] if production_forecasts else []

        # Get energy demand forecasts (MULTIPLE - removed limit!)
        energy_query = select(ForecastOutput).where(
            ForecastOutput.forecast_type == "energy_demand",
            ForecastOutput.prediction_horizon == horizon,
            ForecastOutput.valid_from <= now,
            ForecastOutput.valid_until >= now
        )

        if shop_id:
            energy_query = energy_query.where(ForecastOutput.shop_id == shop_id)
        elif plant_id:
            energy_query = energy_query.where(ForecastOutput.plant_id == plant_id)

        # Order by predicted value descending to show highest consumers first
        energy_query = energy_query.order_by(ForecastOutput.prediction_value.desc()).limit(20)
        result = await db.execute(energy_query)
        energy_forecasts = result.scalars().all()

        energy_data = [
            {
                "predicted_kwh": f.prediction_value,
                "confidence_lower": f.confidence_lower,
                "confidence_upper": f.confidence_upper,
                "confidence_score": f.confidence_score,
                "horizon": f.prediction_horizon,
                "valid_until": f.valid_until.isoformat(),
                # ADD ENTITY IDS
                "shop_id": f.shop_id,
                "plant_id": f.plant_id,
            }
            for f in energy_forecasts
        ] if energy_forecasts else []

        return {
            "risk_summary": risk_counts,
            "critical_items": critical_items,  # NOW POPULATED!
            "failure_probabilities": failure_probabilities,
            "production_forecast": production_data,  # NOW ARRAY with entity IDs!
            "energy_demand": energy_data,  # NOW ARRAY with entity IDs!
        }

    except Exception as e:
        logger.debug(f"[get_forecasts_data] Error fetching forecasts: {e}")
        traceback.print_exc()
        return {
            "risk_summary": {"critical": 0, "high": 0, "medium": 0, "low": 0},
            "critical_items": [],
            "failure_probabilities": [],
            "production_forecast": [],
            "energy_demand": [],
        }


# Utility function to broadcast events (called from other services)
async def broadcast_event(event_data: dict):
    """Broadcast an event to all ticker subscribers"""
    await manager.broadcast("ticker", {
        "type": "event",
        "data": event_data,
    })


async def broadcast_alert(alert_data: dict):
    """Broadcast an alert to all alert subscribers"""
    await manager.broadcast("alerts", {
        "type": "alert",
        "data": alert_data,
    })


async def broadcast_machine_update(machine_data: dict):
    """Broadcast a machine state update"""
    await manager.broadcast("machines", {
        "type": "machine_update",
        "data": machine_data,
    })


async def broadcast_telemetry_update(telemetry_data: dict):
    """Broadcast a telemetry data update"""
    await manager.broadcast("telemetry", {
        "type": "telemetry_update",
        "data": telemetry_data,
    })


# Add REST endpoint for monitoring WebSocket connections
@router.get("/stats")
async def get_websocket_stats():
    """Get WebSocket connection statistics"""
    channel_stats = {}
    for channel, connections in manager.connections.items():
        channel_stats[channel] = len(connections)

    return {
        "success": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "channels": channel_stats,
        "total_connections": sum(channel_stats.values()),
        "max_per_channel": manager.max_connections_per_channel,
    }


@router.websocket("/workshop-insights")
async def workshop_insights_websocket(
    websocket: WebSocket,
    shop_type: Optional[str] = Query(None),
    plant_id: Optional[int] = Query(None),
    plant_code: Optional[str] = Query(None),
):
    """
    WebSocket endpoint for workshop-specific insights
    Streams real-time data about production pipeline, assembly stations, quality metrics, torque tools
    Used by workshop dashboards (Final Assembly, Body Shop, Paint Shop)
    """
    logger.debug("[WebSocket] /ws/workshop-insights - Connection request")
    logger.debug(
        f"[WebSocket] /ws/workshop-insights - shop_type={shop_type}, plant_id={plant_id}, plant_code={plant_code}")

    await manager.connect(websocket, "workshop-insights")

    try:
        # Resolve plant_id from plant_code if needed
        if plant_code and not plant_id:
            async with async_session_maker() as db:
                plant = await db.scalar(
                    select(Plant).where(Plant.code == plant_code)
                )
                if plant:
                    plant_id = plant.id
                    logger.debug(
                        f"[WebSocket] /ws/workshop-insights - Resolved plant_code {plant_code} to plant_id {plant_id}")
                    # Clear plant_code since we now have plant_id
                    plant_code = None

        # Send initial data
        initial_data = await get_workshop_insights_data(shop_type, plant_id, plant_code)
        await websocket.send_json({
            "type": "initial",
            **initial_data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        logger.debug("[WebSocket] /ws/workshop-insights - Sent initial data")

        # Update loop - send updates every 10 seconds
        while True:
            try:
                # Wait for 10 seconds or until a message is received
                message = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)

                # Handle ping/pong
                try:
                    data = json.loads(message)
                    if data.get("type") == "pong":
                        continue
                except json.JSONDecodeError:
                    pass

            except asyncio.TimeoutError:
                # Timeout - send update
                pass

            # Fetch and send updated workshop insights
            insights_data = await get_workshop_insights_data(shop_type, plant_id, plant_code)
            await websocket.send_json({
                "type": "update",
                **insights_data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            logger.debug(f"[WebSocket] /ws/workshop-insights - Sent update for shop_type={shop_type}")

    except WebSocketDisconnect:
        logger.debug("[WebSocket] /ws/workshop-insights - Client disconnected")
    except Exception as e:
        logger.debug(f"[WebSocket] /ws/workshop-insights - Error: {e}")
        traceback.print_exc()
    finally:
        manager.disconnect(websocket, "workshop-insights")


async def get_workshop_insights_data(
        shop_type: Optional[str], plant_id: Optional[int], plant_code: Optional[str]) -> dict:
    """
    Fetch workshop-specific insights data
    Returns production pipeline, assembly stations, quality metrics, torque tools
    """
    try:
        async with async_session_maker() as db:
            logger.debug(
                f"[get_workshop_insights_data] Building query with shop_type={shop_type}, plant_id={plant_id}, plant_code={plant_code}")  # noqa: E501
            logger.debug(f"[get_workshop_insights_data] shop_type type: {type(shop_type)}, value: {repr(shop_type)}")

            # Normalize shop_type (strip whitespace, lowercase)
            shop_type_normalized = None
            if shop_type:
                shop_type_normalized = shop_type.strip().lower()
                logger.debug(f"[get_workshop_insights_data] Normalized shop_type: {repr(shop_type_normalized)}")

            # Step 1: Get shop_ids based on filters (matching API logic)
            shop_query = select(Shop.id).where(Shop.is_active == True)  # noqa: E712

            if shop_type_normalized:
                logger.debug(f"[get_workshop_insights_data] Adding shop_type filter: {shop_type_normalized}")
                shop_query = shop_query.where(Shop.shop_type == shop_type_normalized)

            if plant_id:
                logger.debug(f"[get_workshop_insights_data] Adding plant_id filter: {plant_id}")
                shop_query = shop_query.where(Shop.plant_id == plant_id)
            elif plant_code:
                logger.debug(f"[get_workshop_insights_data] Adding plant_code filter: {plant_code}")
                shop_query = shop_query.join(Plant, Shop.plant_id == Plant.id).where(Plant.code == plant_code)

            shop_result = await db.execute(shop_query)
            shop_ids = [row[0] for row in shop_result.all()]
            logger.debug(f"[get_workshop_insights_data] Found {len(shop_ids)} shop_ids: {shop_ids}")

            if not shop_ids:
                logger.debug("[get_workshop_insights_data] No shops found, returning empty data")
                return {
                    "production_pipeline": [],
                    "assembly_stations": [],
                    "quality_metrics": {
                        "first_pass_yield": 0,
                        "torque_compliance": 0,
                        "rework_rate": 0,
                        "top_defects": []},
                    "torque_tools": [],
                    "power_distribution": {},
                    "water_treatment": {},
                    "waste_management": {},
                    "hvac_systems": [],
                    "utility_oee": {
                        "availability": 0,
                        "performance": 0,
                        "quality": 0,
                        "oee": 0,
                        "machine_status_counts": {}},
                    "machine_status_counts": {},
                    }

            # Step 2: Get line_ids from those shops (matching API logic)
            line_query = select(Line.id, Line.name).where(Line.shop_id.in_(shop_ids))
            line_result = await db.execute(line_query)
            line_rows = line_result.all()
            line_ids = [row[0] for row in line_rows]
            logger.debug(f"[get_workshop_insights_data] Found {len(line_ids)} line_ids: {line_ids}")

            if not line_ids:
                logger.debug("[get_workshop_insights_data] No lines found, returning empty data")
                return {
                    "production_pipeline": [],
                    "assembly_stations": [],
                    "quality_metrics": {
                        "first_pass_yield": 0,
                        "torque_compliance": 0,
                        "rework_rate": 0,
                        "top_defects": []},
                    "torque_tools": [],
                    "power_distribution": {},
                    "water_treatment": {},
                    "waste_management": {},
                    "hvac_systems": [],
                    "utility_oee": {
                        "availability": 0,
                        "performance": 0,
                        "quality": 0,
                        "oee": 0,
                        "machine_status_counts": {}},
                    "machine_status_counts": {},
                    }

            # Step 3: Get machines in those lines with their current state (matching API logic)
            machine_query = (
                select(Machine, MachineState)
                .outerjoin(
                    MachineState,
                    and_(
                        MachineState.machine_id == Machine.id,
                        MachineState.is_current == True  # noqa: E712
                    )
                )
                .where(Machine.line_id.in_(line_ids))
            )

            logger.debug("[get_workshop_insights_data] Executing machine query...")
            result = await db.execute(machine_query)
            rows = result.all()
            logger.debug(f"[get_workshop_insights_data] Query returned {len(rows)} rows")
            logger.debug("[get_workshop_insights_data] Executing machine query...")
            result = await db.execute(machine_query)
            rows = result.all()
            logger.debug(f"[get_workshop_insights_data] Query returned {len(rows)} rows")

            # Extract machines and states
            machines_list = []
            machine_states = {}
            for machine, state in rows:
                machines_list.append(machine)
                # Handle None state (outerjoin may return None)
                if state:
                    machine_states[machine.id] = state

            logger.debug(
                f"[get_workshop_insights_data] Found {len(machines_list)} machines, {len(machine_states)} with states")
            if machines_list:
                logger.debug(
                    f"[get_workshop_insights_data] First machine: id={machines_list[0].id}, name={machines_list[0].name}, type={machines_list[0].machine_type}")  # noqa: E501
                if machines_list[0].id in machine_states:
                    logger.debug(
                        f"[get_workshop_insights_data] First machine state: status={machine_states[machines_list[0].id].status}, health={machine_states[machines_list[0].id].health_score}")  # noqa: E501

            # Machine status counts
            machine_status_counts = {
                "total": len(machines_list),
                "online": 0,
                "idle": 0,
                "fault": 0,
                "maintenance": 0,
                "offline": 0,
            }

            for machine in machines_list:
                state = machine_states.get(machine.id)
                if state:
                    status = (state.status or "offline").lower()
                    if status in machine_status_counts:
                        machine_status_counts[status] += 1
                    else:
                        machine_status_counts["offline"] += 1
                else:
                    machine_status_counts["offline"] += 1

            # Production Pipeline - using KPIAggregate data (matching API logic)
            production_pipeline = []
            logger.debug(
                f"[get_workshop_insights_data] Checking shop_type for production_pipeline: {repr(shop_type_normalized if shop_type else None)}")  # noqa: E501

            # Use a reasonable time range (last 24 hours) for KPI aggregates
            from datetime import datetime, timezone, timedelta
            to_time = datetime.now(timezone.utc)
            from_time = to_time - timedelta(hours=24)

            # Query KPIAggregate by line
            pipeline_query = (
                select(
                    Line.id.label("line_id"),
                    Line.name.label("line_name"),
                    func.sum(KPIAggregate.planned_production).label("target_units"),
                    func.sum(KPIAggregate.actual_production).label("completed_units"),
                    func.avg(KPIAggregate.oee).label("oee"),
                    func.avg(KPIAggregate.performance).label("performance"),
                    func.avg(KPIAggregate.availability).label("availability")
                )
                .join(Line, KPIAggregate.line_id == Line.id)
                .where(
                    KPIAggregate.line_id.in_(line_ids),
                    KPIAggregate.period_start >= from_time,
                    KPIAggregate.period_start < to_time
                )
                .group_by(Line.id, Line.name)
            )
            pipeline_result = await db.execute(pipeline_query)
            pipeline_rows = pipeline_result.mappings().all()

            hours_window = max((to_time - from_time).total_seconds() / 3600, 1)

            for row in pipeline_rows:
                target_units = float(row["target_units"] or 0)
                completed_units = float(row["completed_units"] or 0)
                if target_units <= 0 and completed_units > 0:
                    target_units = completed_units
                work_in_progress = max(target_units - completed_units, 0)
                oee = float(row["oee"] or 0)
                throughput_per_hour = completed_units / hours_window if hours_window else 0

                production_pipeline.append({
                    "line_id": row["line_id"],
                    "stage": row["line_name"],
                    "target_units": round(target_units),
                    "completed_units": round(completed_units),
                    "work_in_progress": round(work_in_progress),
                    "cycle_time_minutes": round(60 / throughput_per_hour, 1) if throughput_per_hour > 0 else None,
                    "efficiency": round(oee / 100, 3) if oee else 0,
                    "throughput_per_hour": round(throughput_per_hour, 2),
                })

            if production_pipeline:
                min_efficiency = min(stage["efficiency"] for stage in production_pipeline)
                for stage in production_pipeline:
                    stage["is_bottleneck"] = stage["efficiency"] == min_efficiency

            logger.debug(f"[get_workshop_insights_data] Created {len(production_pipeline)} pipeline stages")

            # Assembly Stations - based on production pipeline data (matching API logic)
            # Get alerts aggregated by line
            alert_query = (
                select(
                    Line.id.label("line_id"),
                    func.count(Alert.id).label("open_alerts"),
                    func.max(Alert.triggered_at).label("last_event")
                )
                .join(Machine, Alert.machine_id == Machine.id)
                .join(Line, Machine.line_id == Line.id)
                .where(
                    Line.id.in_(line_ids),
                    Alert.status.in_(["active", "acknowledged", "escalated"])
                )
                .group_by(Line.id)
            )
            alert_result = await db.execute(alert_query)
            alert_map = {row["line_id"]: row for row in alert_result.mappings().all()}

            assembly_stations = []
            for stage in production_pipeline:
                line_id = stage["line_id"]
                oee_percent = stage["efficiency"] * 100 if stage["efficiency"] else 0
                performance = next((row["performance"] for row in pipeline_rows if row["line_id"] == line_id), None)
                utilization = (performance or 0) / 100 if performance else 0

                if oee_percent >= 85:
                    status = "operational"
                elif oee_percent >= 70:
                    status = "attention"
                else:
                    status = "maintenance"

                alert_info = alert_map.get(line_id, {})

                assembly_stations.append({
                    "line_id": line_id,
                    "name": stage["stage"],
                    "oee": round(oee_percent, 2),
                    "throughput": stage["completed_units"],
                    "utilization": round(utilization, 2),
                    "status": status,
                    "open_alerts": int(alert_info.get("open_alerts", 0)),
                    "queued_jobs": max(stage["work_in_progress"] // 5, 0),
                    "last_event": alert_info.get("last_event").isoformat() if alert_info.get("last_event") else None,
                })

            logger.debug(f"[get_workshop_insights_data] Created {len(assembly_stations)} assembly stations")

            # Quality Metrics - from KPIAggregate (matching API logic)
            quality_query = (
                select(
                    func.avg(KPIAggregate.oee).label("oee"),
                    func.avg(KPIAggregate.quality).label("quality"),
                    func.avg(KPIAggregate.performance).label("performance"),
                    func.avg(KPIAggregate.availability).label("availability"),
                    func.sum(KPIAggregate.defect_units).label("defect_units"),
                    func.sum(KPIAggregate.actual_production).label("actual_production")
                )
                .where(
                    KPIAggregate.shop_id.in_(shop_ids),
                    KPIAggregate.period_start >= from_time,
                    KPIAggregate.period_start < to_time
                )
            )
            quality_result = await db.execute(quality_query)
            quality_stats = quality_result.mappings().one_or_none() or {}

            total_production = float(quality_stats.get("actual_production") or 0)
            defect_units = float(quality_stats.get("defect_units") or 0)

            quality_metrics = {
                "first_pass_yield": round(float(quality_stats.get("quality") or 0), 2),
                "torque_compliance": round(float(quality_stats.get("performance") or 0), 2),
                "rework_rate": round((defect_units / total_production) * 100, 2) if total_production else 0.0,
                "top_defects": [],
            }

            # Top defects from alerts
            defect_query = (
                select(
                    Alert.title.label("defect"),
                    func.count(Alert.id).label("count")
                )
                .join(Machine, Alert.machine_id == Machine.id)
                .join(Line, Machine.line_id == Line.id)
                .where(
                    Line.shop_id.in_(shop_ids),
                    Alert.alert_type == "quality",
                    Alert.triggered_at >= from_time,
                    Alert.triggered_at <= to_time
                )
                .group_by(Alert.title)
                .order_by(func.count(Alert.id).desc())
                .limit(5)
            )
            defect_result = await db.execute(defect_query)
            quality_metrics["top_defects"] = [
                {"defect": row["defect"], "count": row["count"]}
                for row in defect_result.mappings().all()
            ]

            logger.debug(
                f"[get_workshop_insights_data] Quality metrics: FPY={quality_metrics['first_pass_yield']}%, TC={quality_metrics['torque_compliance']}%")  # noqa: E501

            # Utilities-specific data structures
            power_distribution = {}
            water_treatment = {}
            waste_management = {}
            hvac_systems = []

            logger.debug(
                f"[get_workshop_insights_data] Checking shop_type for utilities: {repr(shop_type_normalized if shop_type else None)}")  # noqa: E501
            if shop_type_normalized == 'utilities':
                # Power Distribution - group power-related machines
                power_machines = [m for m in machines_list if m.machine_type in [
                    'transformer', 'generator', 'ups', 'switchgear', 'power_distribution']]

                total_capacity = sum(machine_states.get(
                    m.id).current_load or 100 for m in power_machines if m.id in machine_states)
                active_load = sum(
                    machine_states.get(
                        m.id).power_consumption or 50 for m in power_machines if m.id in machine_states and machine_states.get(  # noqa: E501
                        m.id).status == 'online')
                peak_load = max([machine_states.get(
                    m.id).power_consumption or 0 for m in power_machines if m.id in machine_states], default=0)
                avg_load = active_load / len(power_machines) if power_machines else 0
                faulty_count = sum(
                    1 for m in power_machines if m.id in machine_states and machine_states.get(m.id).status == 'fault')

                power_distribution = {
                    "total_power_kw": round(active_load, 2),
                    "total_capacity_kw": round(total_capacity, 2),
                    "current_load_kw": round(active_load, 2),
                    "load_percentage": round((active_load / total_capacity * 100) if total_capacity > 0 else 0, 1),
                    "peak_load_pct": round((peak_load / total_capacity * 100) if total_capacity > 0 else 0, 1),
                    "average_load_pct": round((avg_load / (total_capacity / len(power_machines) if power_machines else 1) * 100) if power_machines else 0, 1),  # noqa: E501
                    "faulty_assets": faulty_count,
                    "power_factor": round(sum(machine_states.get(m.id).current_load or 0.95 for m in power_machines if m.id in machine_states) / len(power_machines) if power_machines else 0.95, 2),  # noqa: E501
                    "systems": [
                        {
                            "id": m.id,
                            "name": m.name,
                            "type": m.machine_type,
                            "status": "alert" if machine_states.get(m.id).status == 'fault' else "normal",
                            "power_kw": round(machine_states.get(m.id).power_consumption or 50, 2),
                            "load_kw": round(machine_states.get(m.id).power_consumption or 50, 2),
                            "load_pct": round((machine_states.get(m.id).power_consumption or 50) / (machine_states.get(m.id).current_load or 100) * 100, 1),  # noqa: E501
                            "capacity_kw": round(machine_states.get(m.id).current_load or 100, 2),
                            "equipment_count": 1,
                            "faulty_count": 1 if machine_states.get(m.id).status == 'fault' else 0,
                            "health": round(machine_states.get(m.id).health_score or 85, 1),
                        }
                        for m in power_machines[:10] if m.id in machine_states  # Limit to 10 systems
                    ]
                }

                # Water Treatment - group water-related machines
                water_machines = [m for m in machines_list if m.machine_type in [
                    'ro_system', 'softener', 'cooling_tower', 'chiller', 'boiler', 'cooling_pump']]

                total_flow = sum(
                    machine_states.get(
                        m.id).current_cycle or 50 for m in water_machines if m.id in machine_states and machine_states.get(  # noqa: E501
                        m.id).status == 'online')
                total_capacity = len(water_machines) * 100  # Assume 100 m³/h per system
                alert_count = sum(
                    1 for m in water_machines if m.id in machine_states and machine_states.get(m.id).status == 'fault')

                water_treatment = {
                    "flow_rate_m3h": round(total_flow, 2),
                    "total_flow_m3h": round(total_flow, 2),
                    "capacity_m3h": total_capacity,
                    "recovery_pct": round((total_flow / total_capacity * 100) if total_capacity > 0 else 0, 1),
                    "utilization_percentage": round((total_flow / total_capacity * 100) if total_capacity > 0 else 0, 1),  # noqa: E501
                    "ph_level": 7.2,  # Simulated pH level
                    "quality_tds": round(sum(machine_states.get(m.id).temperature or 50 for m in water_machines if m.id in machine_states) / len(water_machines) if water_machines else 50, 1),  # noqa: E501
                    "alerts": alert_count,
                    "systems": [
                        {
                            "id": m.id,
                            "name": m.name,
                            "type": m.machine_type,
                            "status": "alert" if machine_states.get(m.id).status == 'fault' else "normal",
                            "flow_rate_m3h": round(machine_states.get(m.id).current_cycle or 50, 2),
                            "flow_m3h": round(machine_states.get(m.id).current_cycle or 50, 2),
                            "pressure_bar": round((machine_states.get(m.id).current_load or 70) / 10, 1),
                            "uptime_pct": round(machine_states.get(m.id).health_score or 90, 1),
                            "quality_index": round((machine_states.get(m.id).health_score or 90) / 10, 1),
                            "equipment_count": 1,
                            "health": round(machine_states.get(m.id).health_score or 90, 1),
                        }
                        for m in water_machines[:8] if m.id in machine_states  # Limit to 8 systems
                    ]
                }

                # Waste Management - simulated data based on machine operations
                operating_machines = [
                    m for m in machines_list if m.id in machine_states and machine_states.get(m.id).status == 'online']
                waste_generation_rate = len(operating_machines) * 0.5  # 0.5 tons per machine
                total_waste = round(waste_generation_rate * 24, 2)
                recycled_amount = total_waste * 0.65

                waste_management = {
                    "total_tonnage": total_waste,
                    "total_waste_tons": total_waste,
                    "recycling_rate": 65.0,
                    "recycled_percentage": 65.0,
                    "landfill_percentage": 20.0,
                    "hazardous_percentage": 15.0,
                    "hazardous_incidents": 2,
                    "co2_savings_tonnes": round(recycled_amount * 0.8, 2),  # Estimate CO2 savings
                    "breakdown": [
                        {
                            "category": "Metal Scrap",
                            "type": "Metal Scrap",
                            "tonnage": round(waste_generation_rate * 24 * 0.45, 2),
                            "amount_tons": round(waste_generation_rate * 24 * 0.45, 2),
                            "trend_pct": 5.2,
                            "recycled": True
                        },
                        {
                            "category": "Plastic Waste",
                            "type": "Plastic Waste",
                            "tonnage": round(waste_generation_rate * 24 * 0.20, 2),
                            "amount_tons": round(waste_generation_rate * 24 * 0.20, 2),
                            "trend_pct": -2.1,
                            "recycled": True
                        },
                        {
                            "category": "Chemical Waste",
                            "type": "Chemical Waste",
                            "tonnage": round(waste_generation_rate * 24 * 0.15, 2),
                            "amount_tons": round(waste_generation_rate * 24 * 0.15, 2),
                            "trend_pct": 0.5,
                            "recycled": False
                        },
                        {
                            "category": "General Waste",
                            "type": "General Waste",
                            "tonnage": round(waste_generation_rate * 24 * 0.20, 2),
                            "amount_tons": round(waste_generation_rate * 24 * 0.20, 2),
                            "trend_pct": -3.8,
                            "recycled": False
                        },
                    ]
                }

                # HVAC Systems - group HVAC-related machines
                hvac_machines = [m for m in machines_list if m.machine_type in [
                    'hvac_unit', 'chiller', 'cooling_tower', 'air_handler']]

                hvac_systems = [
                    {
                        "id": m.id,
                        "name": m.name,
                        "type": m.machine_type,
                        "status": machine_states.get(m.id).status,
                        "temperature_c": round(machine_states.get(m.id).temperature or 22.0, 1),
                        # Proxy calculation
                        "humidity_percent": round((machine_states.get(m.id).current_load or 50) / 1.5, 1),
                        "airflow_m3h": round(machine_states.get(m.id).current_cycle or 1000, 0),
                        "power_kw": round(machine_states.get(m.id).power_consumption or 15.0, 2),
                        "health": round(machine_states.get(m.id).health_score or 0, 1),
                    }
                    for m in hvac_machines[:12] if m.id in machine_states  # Limit to 12 systems
                ]

            # Calculate utility OEE and machine status counts (for all shop types, especially utilities)
            online_machines = [
                m for m in machines_list if m.id in machine_states and machine_states.get(m.id).status == 'online']
            offline_machines = [
                m for m in machines_list if m.id in machine_states and machine_states.get(m.id).status == 'offline']
            idle_machines = [
                m for m in machines_list if m.id in machine_states and machine_states.get(m.id).status == 'idle']
            fault_machines = [
                m for m in machines_list if m.id in machine_states and machine_states.get(m.id).status == 'fault']
            maintenance_machines = [
                m for m in machines_list if m.id in machine_states and machine_states.get(m.id).status == 'maintenance']

            total_machines = len(machines_list)

            # Availability: percentage of time equipment is available for operation
            availability = (len(online_machines) + len(idle_machines)) / \
                total_machines * 100 if total_machines > 0 else 0

            # Performance: average health score of online equipment
            performance = sum(machine_states.get(m.id).health_score or 0 for m in online_machines) / \
                len(online_machines) if online_machines else 0

            # Quality: percentage of equipment without faults
            quality = (total_machines - len(fault_machines)) / total_machines * 100 if total_machines > 0 else 0

            # Overall OEE: combined metric
            oee = (availability / 100) * (performance / 100) * (quality / 100) * 100

            utility_oee = {
                "availability": round(availability, 1),
                "performance": round(performance, 1),
                "quality": round(quality, 1),
                "oee": round(oee, 1),
                "machine_status_counts": {
                    "total": total_machines,
                    "online": len(online_machines),
                    "offline": len(offline_machines),
                    "idle": len(idle_machines),
                    "fault": len(fault_machines),
                    "maintenance": len(maintenance_machines),
                }
            }

            # Assembly Stations - group machines by type (for all shop types)
            assembly_stations = []
            machine_types = {}
            for machine in machines_list:
                if machine.machine_type not in machine_types:
                    machine_types[machine.machine_type] = []
                machine_types[machine.machine_type].append(machine)

            for machine_type, type_machines in machine_types.items():
                online_count = sum(
                    1 for m in type_machines if m.id in machine_states and machine_states.get(m.id).status == 'online')
                fault_count = sum(
                    1 for m in type_machines if m.id in machine_states and machine_states.get(m.id).status == 'fault')
                total_count = len(type_machines)

                # Get latest telemetry for OEE calculation
                avg_health = sum(
                    machine_states.get(
                        m.id).health_score or 0 for m in type_machines if m.id in machine_states) / total_count if total_count > 0 else 0  # noqa: E501

                # Get alert count for this machine type
                alert_query = select(func.count(Alert.id)).where(
                    Alert.machine_id.in_([m.id for m in type_machines]),
                    Alert.status == 'active'
                )
                alert_count = await db.scalar(alert_query) or 0

                assembly_stations.append({
                    "name": machine_type.replace('_', ' ').title(),
                    "status": "operational" if fault_count == 0 else ("attention" if fault_count < total_count * 0.3 else "critical"),  # noqa: E501
                    "oee": int(avg_health),
                    "throughput": f"{online_count}/{total_count}",
                    "utilization": online_count / total_count if total_count > 0 else 0,
                    "queued_jobs": max(0, total_count - online_count),
                    "open_alerts": alert_count,
                })

            # Quality Metrics - aggregate from telemetry and machine states
            fault_machines_list = [
                m for m in machines_list if m.id in machine_states and machine_states.get(m.id).status == 'fault']
            total_machines = len(machines_list)

            # Calculate First Pass Yield (machines not in fault / total machines)
            first_pass_yield = ((total_machines - len(fault_machines_list)) /
                                total_machines * 100) if total_machines > 0 else 0

            # Torque compliance - for assembly machines
            torque_machines = [m for m in machines_list if 'assembly' in m.machine_type.lower()
                               or 'torque' in m.machine_type.lower()]
            torque_compliance = (len([m for m in torque_machines if m.id in machine_states and machine_states.get(
                m.id).status == 'online']) / len(torque_machines) * 100) if torque_machines else 0

            # Rework rate - machines in maintenance or fault
            rework_machines = [m for m in machines_list if m.id in machine_states and machine_states.get(m.id).status in [  # noqa: E501
                                                                                                         'maintenance', 'fault']]  # noqa: E501
            rework_rate = (len(rework_machines) / total_machines * 100) if total_machines > 0 else 0

            # Top defects - get most common alerts
            defect_query = select(
                Alert.alert_type,
                func.count(Alert.id).label('count')
            ).where(
                Alert.machine_id.in_([m.id for m in machines_list]),
                Alert.status == 'active'
            ).group_by(Alert.alert_type).order_by(desc('count')).limit(10)

            defect_results = await db.execute(defect_query)
            top_defects = [
                {"defect": row[0], "count": row[1]}
                for row in defect_results
            ]

            quality_metrics = {
                "first_pass_yield": round(first_pass_yield, 1),
                "torque_compliance": round(torque_compliance, 1),
                "rework_rate": round(rework_rate, 1),
                "top_defects": top_defects,
            }

            # Torque Tools - exact match for machine_type == "torque_tool" (matching API logic)
            logger.debug("[get_workshop_insights_data] Querying torque tools...")
            torque_query = (
                select(
                    Machine.id.label("machine_id"),
                    Machine.name,
                    Machine.code,
                    MachineState.status,
                    MachineState.health_score,
                    MachineState.current_load,
                    MachineState.power_consumption,
                    MachineState.recorded_at
                )
                .join(Line, Machine.line_id == Line.id)
                .outerjoin(
                    MachineState,
                    and_(
                        MachineState.machine_id == Machine.id,
                        MachineState.is_current == True  # noqa: E712
                    )
                )
                .where(
                    Line.id.in_(line_ids),
                    Machine.machine_type == "torque_tool"
                )
                .order_by(Machine.name.asc())
            )
            torque_result = await db.execute(torque_query)
            torque_rows = torque_result.mappings().all()
            logger.debug(f"[get_workshop_insights_data] Found {len(torque_rows)} torque tools")

            # Get alert counts for torque tools
            torque_machine_ids = [row["machine_id"] for row in torque_rows]
            torque_alert_map = {}
            if torque_machine_ids:
                torque_alert_query = (
                    select(
                        Machine.id.label("machine_id"),
                        func.count(Alert.id).label("alerts")
                    )
                    .join(Machine, Alert.machine_id == Machine.id)
                    .where(
                        Machine.id.in_(torque_machine_ids),
                        Alert.status.in_(["active", "acknowledged", "escalated"])
                    )
                    .group_by(Machine.id)
                )
                torque_alert_result = await db.execute(torque_alert_query)
                torque_alert_map = {row["machine_id"]: row["alerts"] for row in torque_alert_result.mappings().all()}

            torque_tools_data = []
            for row in torque_rows:
                health = float(row.get("health_score") or 0)
                compliance = min(max(health, 70), 100)
                torque_tools_data.append({
                    "machine_id": row["machine_id"],
                    "name": row["name"],
                    "code": row["code"],
                    "status": row.get("status") or "offline",
                    "health": round(health, 2) if health else 0,
                    "torque_nm": round((row.get("current_load") or 35) * 1.2, 2),
                    "torque_target_nm": 35,
                    "compliance": round(compliance, 2),
                    "calibration_due_in_days": 7,
                    "alerts": int(torque_alert_map.get(row["machine_id"], 0)),
                    "last_updated": row.get("recorded_at").isoformat() if row.get("recorded_at") else None,
                })
            logger.debug(f"[get_workshop_insights_data] Built {len(torque_tools_data)} torque tool records")

            logger.debug("[get_workshop_insights_data] Returning data:")
            logger.debug(f"  - Production Pipeline: {len(production_pipeline)} stages")
            logger.debug(f"  - Assembly Stations: {len(assembly_stations)} stations")
            logger.debug(f"  - Quality Metrics: FPY={quality_metrics['first_pass_yield']}%")
            logger.debug(f"  - Torque Tools: {len(torque_tools_data)} tools")

            if shop_type == 'utilities':
                logger.debug(
                    f"  - Power Distribution: {len(power_distribution.get('systems', []))} systems, {power_distribution.get('current_load_kw', 0)} kW")  # noqa: E501
                logger.debug(
                    f"  - Water Treatment: {len(water_treatment.get('systems', []))} systems, {water_treatment.get('total_flow_m3h', 0)} m³/h")  # noqa: E501
                logger.debug(f"  - Waste Management: {waste_management.get('total_waste_tons', 0)} tons")
                logger.debug(f"  - HVAC Systems: {len(hvac_systems)} units")
                logger.debug(
                    f"  - Utility OEE: Availability={utility_oee['availability']}%, Performance={utility_oee['performance']}%, Quality={utility_oee['quality']}%, OEE={utility_oee['oee']}%")  # noqa: E501

            return {
                "production_pipeline": production_pipeline,
                "assembly_stations": assembly_stations,
                "quality_metrics": quality_metrics,
                "torque_tools": torque_tools_data,
                "power_distribution": power_distribution,
                "water_treatment": water_treatment,
                "waste_management": waste_management,
                "hvac_systems": hvac_systems,
                "utility_oee": utility_oee,
                # Also return at top level for easier access
                "machine_status_counts": utility_oee.get("machine_status_counts", {}),
            }

    except Exception as e:
        logger.debug(f"[get_workshop_insights_data] Error: {e}")
        traceback.print_exc()
        return {
            "production_pipeline": [],
            "assembly_stations": [],
            "quality_metrics": None,
            "torque_tools": [],
            "power_distribution": {},
            "water_treatment": {},
            "waste_management": {},
            "hvac_systems": [],
            "utility_oee": {
                "availability": 0,
                "performance": 0,
                "quality": 0,
                "oee": 0,
                "machine_status_counts": {
                    "total": 0,
                    "online": 0,
                    "offline": 0,
                    "idle": 0,
                    "fault": 0,
                    "maintenance": 0,
                }
            },
            "machine_status_counts": {
                "total": 0,
                "online": 0,
                "offline": 0,
                "idle": 0,
                "fault": 0,
                "maintenance": 0,
            },
        }


@router.websocket("/manager-dashboard")
async def websocket_manager_dashboard(
    websocket: WebSocket,
    plant_id: Optional[str] = Query(None),
    shop_type: Optional[str] = Query(None),
    time_range: Optional[str] = Query("24h"),
    token: str = Query(None),
):
    """
    WebSocket endpoint for Manager Dashboard
    Streams real-time operational metrics and team performance data
    """
    logger.debug("[WebSocket] /ws/manager-dashboard - Connection request")
    logger.debug(
        f"[WebSocket] /ws/manager-dashboard - plant_id={plant_id}, shop_type={shop_type}, time_range={time_range}")

    await manager.connect(websocket, "manager-dashboard")

    try:
        # Send initial data
        initial_data = await get_manager_dashboard_data(plant_id, shop_type, time_range)
        await websocket.send_json({
            "type": "initial",
            **initial_data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        logger.debug("[WebSocket] /ws/manager-dashboard - Sent initial data")

        # Update loop - send updates every 15 seconds
        while True:
            try:
                await asyncio.sleep(0)
            except asyncio.TimeoutError:
                pass

            # Fetch and send updated manager dashboard data
            dashboard_data = await get_manager_dashboard_data(plant_id, shop_type, time_range)
            await websocket.send_json({
                "type": "update",
                **dashboard_data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            logger.debug("[WebSocket] /ws/manager-dashboard - Sent update")

    except WebSocketDisconnect:
        logger.debug("[WebSocket] /ws/manager-dashboard - Client disconnected")
    except asyncio.CancelledError:
        logger.debug("[WebSocket] /ws/manager-dashboard - Task cancelled")
        raise
    except Exception as e:
        logger.debug(f"[WebSocket] /ws/manager-dashboard - Error: {e}")
        traceback.print_exc()
    finally:
        manager.disconnect(websocket, "manager-dashboard")


@router.websocket("/leadership-dashboard")
async def websocket_leadership_dashboard(
    websocket: WebSocket,
    time_range: Optional[str] = Query("7d"),
    token: str = Query(None),
):
    """
    WebSocket endpoint for Leadership Dashboard
    Streams cross-plant KPIs and strategic insights in real-time
    """
    logger.debug("[WebSocket] /ws/leadership-dashboard - Connection request")
    logger.debug(f"[WebSocket] /ws/leadership-dashboard - time_range={time_range}")

    await manager.connect(websocket, "leadership-dashboard")

    try:
        # Send initial data
        initial_data = await get_leadership_dashboard_data(time_range)
        await websocket.send_json({
            "type": "initial",
            **initial_data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        logger.debug("[WebSocket] /ws/leadership-dashboard - Sent initial data")

        # Update loop - send updates every 20 seconds
        while True:
            try:
                await asyncio.sleep(0)
            except asyncio.TimeoutError:
                pass

            # Fetch and send updated leadership dashboard data
            dashboard_data = await get_leadership_dashboard_data(time_range)
            await websocket.send_json({
                "type": "update",
                **dashboard_data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
            logger.debug("[WebSocket] /ws/leadership-dashboard - Sent update")

    except WebSocketDisconnect:
        logger.debug("[WebSocket] /ws/leadership-dashboard - Client disconnected")
    except asyncio.CancelledError:
        logger.debug("[WebSocket] /ws/leadership-dashboard - Task cancelled")
        raise
    except Exception as e:
        logger.debug(f"[WebSocket] /ws/leadership-dashboard - Error: {e}")
        traceback.print_exc()
    finally:
        manager.disconnect(websocket, "leadership-dashboard")


async def get_manager_dashboard_data(
    plant_id: Optional[str] = None,
    shop_type: Optional[str] = None,
    time_range: str = "24h"
) -> dict:
    """
    Fetch manager dashboard data from KPI, shift, forecast, and alert tables
    Returns operational metrics and team performance
    """
    try:
        async with async_session_maker() as db:
            from app.models.kpi import ShiftKPI

            logger.debug(
                f"[get_manager_dashboard_data] Fetching data for plant_id={plant_id}, shop_type={shop_type}, time_range={time_range}")  # noqa: E501

            # Parse time range
            from_time, to_time = _parse_time_range(time_range)

            # Get plants
            plant_query = select(Plant)
            if plant_id:
                try:
                    plant_id_int = int(plant_id)
                    plant_query = plant_query.where(or_(Plant.code == plant_id, Plant.id == plant_id_int))
                except (TypeError, ValueError):
                    plant_query = plant_query.where(Plant.code == plant_id)

            plants_result = await db.execute(plant_query)
            plants = list(plants_result.scalars().all())

            if not plants:
                return {
                    "success": False,
                    "message": "No plants found for the requested filters",
                    "data": None,
                }

            plant_ids = [plant.id for plant in plants]

            # Get shops
            shop_query = select(Shop).where(Shop.plant_id.in_(plant_ids))
            if shop_type:
                shop_query = shop_query.where(Shop.shop_type == shop_type)
            shops_result = await db.execute(shop_query)
            shops = list(shops_result.scalars().all())
            shop_ids = [shop.id for shop in shops]

            # Get lines
            line_query = select(Line).join(Shop).where(Shop.plant_id.in_(plant_ids))
            if shop_ids:
                line_query = line_query.where(Line.shop_id.in_(shop_ids))
            line_rows = await db.execute(line_query)
            lines = list(line_rows.scalars().all())
            line_ids = [line.id for line in lines]

            # Get KPI aggregates
            kpi_query = select(KPIAggregate).where(
                KPIAggregate.period_start >= from_time,
                KPIAggregate.period_start <= to_time,
                KPIAggregate.period_type == "minute"
            )

            # Apply hierarchy filters
            if shop_ids:
                kpi_query = kpi_query.where(
                    or_(
                        KPIAggregate.shop_id.in_(shop_ids),
                        KPIAggregate.line_id.in_(line_ids) if line_ids else False
                    )
                )
            elif plant_ids:
                kpi_query = kpi_query.where(KPIAggregate.plant_id.in_(plant_ids))

            kpi_result = await db.execute(kpi_query)
            kpi_records = kpi_result.scalars().all()

            # Calculate metrics
            oee_values = [r.oee for r in kpi_records if r.oee is not None]
            quality_values = [r.quality for r in kpi_records if r.quality is not None]
            production_values = [r.actual_production for r in kpi_records if r.actual_production is not None]
            downtime_values = [r.unplanned_downtime for r in kpi_records if r.unplanned_downtime is not None]

            avg_oee = round(sum(oee_values) / len(oee_values), 2) if oee_values else 0
            avg_quality = round(sum(quality_values) / len(quality_values), 2) if quality_values else 0
            total_production = sum(production_values) if production_values else 0
            total_downtime = round(sum(downtime_values), 2) if downtime_values else 0

            # Get shift performance
            shift_query = select(ShiftKPI).where(
                ShiftKPI.shift_date >= from_time.date()
            )
            if shop_ids:
                shift_query = shift_query.where(ShiftKPI.shop_id.in_(shop_ids))
            elif plant_ids:
                shift_query = shift_query.where(ShiftKPI.plant_id.in_(plant_ids))

            shift_result = await db.execute(shift_query)
            shifts = shift_result.scalars().all()

            shift_performance = []
            for shift in shifts[:10]:  # Latest 10 shifts
                shift_performance.append({
                    "shift_id": shift.id,
                    "shift_number": shift.shift_number,
                    "shift_date": shift.shift_date.isoformat() if shift.shift_date else None,
                    "efficiency": round(shift.efficiency or 0, 2),
                    "target_units": shift.target_units or 0,
                    "achieved_units": shift.achieved_units or 0,
                    "operators_present": shift.operators_present or 0,
                })

            # Get active alerts
            alert_query = select(Alert).join(Machine).join(Line).join(Shop).where(
                Alert.status.in_(["active", "acknowledged"])
            )
            if shop_ids:
                alert_query = alert_query.where(Line.shop_id.in_(shop_ids))
            elif plant_ids:
                alert_query = alert_query.where(Shop.plant_id.in_(plant_ids))

            alert_result = await db.execute(alert_query)
            alerts = alert_result.scalars().all()

            alert_summary = {
                "total": len(alerts),
                "critical": sum(1 for a in alerts if a.severity == "critical"),
                "high": sum(1 for a in alerts if a.severity == "error"),
                "medium": sum(1 for a in alerts if a.severity == "warning"),
            }

            # Get forecasts
            forecast_query = select(ForecastOutput).where(
                ForecastOutput.valid_from <= datetime.now(timezone.utc),
                ForecastOutput.valid_until >= datetime.now(timezone.utc)
            )
            if shop_ids:
                forecast_query = forecast_query.where(ForecastOutput.shop_id.in_(shop_ids))
            elif plant_ids:
                forecast_query = forecast_query.where(ForecastOutput.plant_id.in_(plant_ids))

            forecast_result = await db.execute(forecast_query)
            forecasts = forecast_result.scalars().all()

            risk_summary = {
                "critical": sum(1 for f in forecasts if f.risk_level == "critical"),
                "high": sum(1 for f in forecasts if f.risk_level == "high"),
                "medium": sum(1 for f in forecasts if f.risk_level == "medium"),
                "low": sum(1 for f in forecasts if f.risk_level == "low"),
            }

            return {
                "success": True,
                "data": {
                    "overview": {
                        "oee": avg_oee,
                        "quality": avg_quality,
                        "production": total_production,
                        "downtime_minutes": total_downtime,
                    },
                    "shift_performance": shift_performance,
                    "alerts": alert_summary,
                    "forecasts": risk_summary,
                    "time_range": {
                        "from": from_time.isoformat(),
                        "to": to_time.isoformat(),
                    },
                },
            }

    except Exception as e:
        logger.debug(f"[get_manager_dashboard_data] Error: {e}")
        traceback.print_exc()
        return {
            "success": False,
            "message": f"Error fetching manager dashboard data: {str(e)}",
            "data": None,
        }


async def get_leadership_dashboard_data(time_range: str = "7d") -> dict:
    """
    Fetch leadership dashboard data aggregated from KPI records
    Returns cross-plant KPIs and strategic insights
    """
    try:
        async with async_session_maker() as db:
            logger.debug(f"[get_leadership_dashboard_data] Fetching data for time_range={time_range}")

            # Parse time range
            from_time, to_time = _parse_time_range(time_range)

            # Get all plants
            plants_result = await db.execute(select(Plant))
            plants = list(plants_result.scalars().all())

            if not plants:
                return {
                    "success": False,
                    "message": "No plants configured in the system",
                    "data": None,
                }

            plant_ids = [plant.id for plant in plants]

            # Get all shops
            shops_result = await db.execute(select(Shop).where(Shop.plant_id.in_(plant_ids)))
            _shops = list(shops_result.scalars().all())  # noqa: F841

            # Get KPI aggregates
            kpi_query = select(KPIAggregate).where(
                KPIAggregate.period_start >= from_time,
                KPIAggregate.period_start <= to_time,
                KPIAggregate.period_type.in_(["hour", "day"])
            )

            kpi_result = await db.execute(kpi_query)
            kpi_records = kpi_result.scalars().all()

            # Calculate network-wide metrics
            oee_values = [r.oee for r in kpi_records if r.oee is not None]
            quality_values = [r.quality for r in kpi_records if r.quality is not None]
            production_values = [r.actual_production for r in kpi_records if r.actual_production is not None]
            energy_values = [r.energy_consumption for r in kpi_records if r.energy_consumption is not None]

            network_metrics = {
                "avg_oee": round(sum(oee_values) / len(oee_values), 2) if oee_values else 0,
                "avg_quality": round(sum(quality_values) / len(quality_values), 2) if quality_values else 0,
                "total_production": sum(production_values) if production_values else 0,
                "total_energy_kwh": round(sum(energy_values), 2) if energy_values else 0,
            }

            # Plant-level breakdown
            plant_performance = []
            for plant in plants:
                plant_kpis = [r for r in kpi_records if r.plant_id == plant.id]

                plant_oee = [r.oee for r in plant_kpis if r.oee is not None]
                plant_quality = [r.quality for r in plant_kpis if r.quality is not None]
                plant_production = [r.actual_production for r in plant_kpis if r.actual_production is not None]

                plant_performance.append({
                    "plant_id": plant.id,
                    "plant_code": plant.code,
                    "plant_name": plant.name,
                    "location": plant.location,
                    "oee": round(sum(plant_oee) / len(plant_oee), 2) if plant_oee else 0,
                    "quality": round(sum(plant_quality) / len(plant_quality), 2) if plant_quality else 0,
                    "production": sum(plant_production) if plant_production else 0,
                })

            # Get strategic alerts (critical only)
            alert_query = select(Alert).join(Machine).join(Line).join(Shop).where(
                Alert.status.in_(["active", "acknowledged"]),
                Alert.severity.in_(["critical", "error"])
            )

            alert_result = await db.execute(alert_query)
            critical_alerts = alert_result.scalars().all()

            # Get strategic forecasts
            forecast_query = select(ForecastOutput).where(
                ForecastOutput.valid_from <= datetime.now(timezone.utc),
                ForecastOutput.valid_until >= datetime.now(timezone.utc),
                ForecastOutput.risk_level.in_(["critical", "high"])
            )

            forecast_result = await db.execute(forecast_query)
            high_risk_forecasts = forecast_result.scalars().all()

            return {
                "success": True,
                "data": {
                    "network_metrics": network_metrics,
                    "plant_performance": plant_performance,
                    "strategic_alerts": {
                        "total": len(critical_alerts),
                        "critical": sum(1 for a in critical_alerts if a.severity == "critical"),
                        "high": sum(1 for a in critical_alerts if a.severity == "error"),
                    },
                    "strategic_forecasts": {
                        "total": len(high_risk_forecasts),
                        "critical_risk": sum(1 for f in high_risk_forecasts if f.risk_level == "critical"),
                        "high_risk": sum(1 for f in high_risk_forecasts if f.risk_level == "high"),
                    },
                    "time_range": {
                        "from": from_time.isoformat(),
                        "to": to_time.isoformat(),
                    },
                },
            }

    except Exception as e:
        logger.debug(f"[get_leadership_dashboard_data] Error: {e}")
        traceback.print_exc()
        return {
            "success": False,
            "message": f"Error fetching leadership dashboard data: {str(e)}",
            "data": None,
        }


@router.websocket("/analytics/operator")
async def websocket_operator_dashboard(
    websocket: WebSocket,
    plant_id: Optional[str] = Query(None),
    shop_type: Optional[str] = Query(None),
    time_range: Optional[str] = Query("24h"),
    token: str = Query(None),
):
    """
    WebSocket endpoint for Operator Dashboard
    Streams real-time KPIs, machine status, alerts, and events
    """
    logger.debug("[WebSocket] /ws/analytics/operator - Connection request")
    logger.debug(
        f"[WebSocket] /ws/analytics/operator - "
        f"plant_id={plant_id}, shop_type={shop_type}, "
        f"time_range={time_range}")

    await manager.connect(websocket, "analytics-operator")

    try:
        from app.api.websocket_enhanced import (
            fetch_operator_dashboard_data,
        )

        filters = {
            "plant_id": plant_id,
            "shop_type": shop_type,
            "time_range": time_range or "24h",
        }

        # Send initial data
        async with async_session_maker() as db:
            initial = await fetch_operator_dashboard_data(db, filters)

        if initial:
            await websocket.send_json({
                "type": "initial",
                "data": initial,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        else:
            await websocket.send_json({
                "type": "initial",
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
        logger.debug(
            "[WebSocket] /ws/analytics/operator - Sent initial data")

        # Update loop
        while True:
            try:
                await asyncio.sleep(15)
            except asyncio.TimeoutError:
                pass

            async with async_session_maker() as db:
                data = await fetch_operator_dashboard_data(db, filters)

            if data:
                await websocket.send_json({
                    "type": "update",
                    "data": data,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
            logger.debug(
                "[WebSocket] /ws/analytics/operator - Sent update")

    except WebSocketDisconnect:
        logger.debug(
            "[WebSocket] /ws/analytics/operator - Client disconnected")
    except asyncio.CancelledError:
        logger.debug(
            "[WebSocket] /ws/analytics/operator - Task cancelled")
        raise
    except Exception as e:
        logger.debug(
            f"[WebSocket] /ws/analytics/operator - Error: {e}")
        traceback.print_exc()
    finally:
        manager.disconnect(websocket, "analytics-operator")


def _parse_time_range(time_range: str) -> tuple[datetime, datetime]:
    """Parse time range string and return (from_time, to_time)"""
    now = datetime.now(timezone.utc)

    if time_range.endswith('h'):
        hours = int(time_range[:-1])
        from_time = now - timedelta(hours=hours)
    elif time_range.endswith('d'):
        days = int(time_range[:-1])
        from_time = now - timedelta(days=days)
    elif time_range.endswith('w'):
        weeks = int(time_range[:-1])
        from_time = now - timedelta(weeks=weeks)
    else:
        # Default to 24 hours
        from_time = now - timedelta(hours=24)

    return from_time, now
