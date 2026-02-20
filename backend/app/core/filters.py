"""
Filter utilities for building database queries with standardized filters
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.filters import LocationFilter, WorkshopFilter, TimeRangeFilter, GlobalFilters
from app.models.plant import Plant, Shop, Line, ShopType
from app.models.machine import Machine


# Plant code mapping
LOCATION_TO_PLANT_CODE = {
    LocationFilter.JAMSHEDPUR: "HOUSTON-001",
    LocationFilter.SANAND: "DALLAS-001",
    LocationFilter.PUNE: "AUSTIN-001",
}

# Workshop to ShopType mapping
WORKSHOP_TO_SHOP_TYPE = {
    WorkshopFilter.BODY_SHOP: ShopType.BODY_SHOP,
    WorkshopFilter.PAINT_SHOP: ShopType.PAINT_SHOP,
    WorkshopFilter.FINAL_ASSEMBLY: ShopType.FINAL_ASSEMBLY,
    WorkshopFilter.UTILITIES: ShopType.UTILITIES,
}

# Time range to timedelta mapping
TIME_RANGE_TO_DELTA = {
    TimeRangeFilter.ONE_HOUR: timedelta(hours=1),
    TimeRangeFilter.TWELVE_HOURS: timedelta(hours=12),
    TimeRangeFilter.ONE_DAY: timedelta(days=1),
    TimeRangeFilter.SEVEN_DAYS: timedelta(days=7),
    TimeRangeFilter.FOURTEEN_DAYS: timedelta(days=14),
    TimeRangeFilter.THIRTY_DAYS: timedelta(days=30),
}


def get_time_range(filters: GlobalFilters) -> Tuple[datetime, datetime]:
    """
    Calculate the time range based on filters
    Returns (from_time, to_time)
    """
    to_time = filters.to_timestamp or datetime.now(timezone.utc)

    if filters.from_timestamp:
        from_time = filters.from_timestamp
    elif filters.time_range:
        delta = TIME_RANGE_TO_DELTA.get(filters.time_range, timedelta(days=1))
        from_time = to_time - delta
    else:
        from_time = to_time - timedelta(days=1)

    return from_time, to_time


async def get_plant_id_from_location(db: AsyncSession, location: LocationFilter) -> Optional[int]:
    """Get plant ID from location filter"""
    if location == LocationFilter.ALL or not location:
        return None

    plant_code = LOCATION_TO_PLANT_CODE.get(location)
    if not plant_code:
        return None

    result = await db.execute(select(Plant.id).where(Plant.code == plant_code))
    plant = result.scalar_one_or_none()
    return plant if plant else None


async def get_shop_ids_from_workshop(
    db: AsyncSession,
    workshop: WorkshopFilter,
    plant_id: Optional[int] = None
) -> Optional[list[int]]:
    """Get shop IDs from workshop filter"""
    if not workshop:
        return None

    shop_type = WORKSHOP_TO_SHOP_TYPE.get(workshop)
    if not shop_type:
        return None

    shop_type_value = shop_type.value if hasattr(shop_type, "value") else shop_type

    query = select(Shop.id).where(Shop.shop_type == shop_type_value)
    if plant_id:
        query = query.where(Shop.plant_id == plant_id)

    result = await db.execute(query)
    shop_ids = result.scalars().all()
    return list(shop_ids) if shop_ids else None


def apply_location_filters(
    query,
    filters: GlobalFilters,
    model_table,
    join_machine: bool = False,
    join_line: bool = False
):
    """
    Apply location-based filters to a query
    Returns modified query with appropriate joins and filters
    """
    # Apply joins and filters
    query = _apply_joins(query, filters, model_table, join_machine, join_line)
    query = _apply_filter_conditions(query, filters, model_table)
    return query


def _apply_joins(query, filters: GlobalFilters, model_table, join_machine: bool, join_line: bool):
    """Apply necessary joins based on filters"""
    needs_plant = filters.location and filters.location != LocationFilter.ALL
    needs_shop = filters.workshop or needs_plant
    needs_line = filters.line_id or needs_shop
    needs_machine = filters.machine_id or needs_line

    # Apply joins in correct order
    if needs_machine and join_machine and hasattr(model_table, 'machine_id'):
        query = query.join(Machine, model_table.machine_id == Machine.id)
        join_machine = False

    if needs_line:
        if join_machine and hasattr(model_table, 'machine_id'):
            query = query.join(Machine, model_table.machine_id == Machine.id)
            query = query.join(Line, Machine.line_id == Line.id)
        elif join_line and hasattr(model_table, 'line_id'):
            query = query.join(Line, model_table.line_id == Line.id)

    if needs_shop and not join_line:
        query = query.join(Shop, Line.shop_id == Shop.id)

    if needs_plant:
        query = query.join(Plant, Shop.plant_id == Plant.id)

    return query


def _apply_filter_conditions(query, filters: GlobalFilters, model_table):
    """Apply filter conditions to query"""
    if filters.machine_id:
        query = _apply_machine_filter(query, filters, model_table)

    if filters.line_id:
        query = _apply_line_filter(query, filters, model_table)

    if filters.workshop:
        shop_type = WORKSHOP_TO_SHOP_TYPE.get(filters.workshop)
        if shop_type:
            query = query.where(Shop.shop_type == shop_type)

    if filters.location and filters.location != LocationFilter.ALL:
        plant_code = LOCATION_TO_PLANT_CODE.get(filters.location)
        if plant_code:
            query = query.where(Plant.code == plant_code)

    return query


def _apply_machine_filter(query, filters: GlobalFilters, model_table):
    """Apply machine filter"""
    if hasattr(model_table, 'machine_id'):
        return query.where(model_table.machine_id == filters.machine_id)
    return query.where(Machine.id == filters.machine_id)


def _apply_line_filter(query, filters: GlobalFilters, model_table):
    """Apply line filter"""
    if hasattr(model_table, 'line_id'):
        return query.where(model_table.line_id == filters.line_id)
    return query.where(Line.id == filters.line_id)


def get_filter_metadata(filters: GlobalFilters) -> dict:
    """Generate metadata dict from filters"""
    return {
        "location": filters.location.value if filters.location else "all",
        "workshop": filters.workshop.value if filters.workshop else None,
        "line_id": filters.line_id,
        "machine_id": filters.machine_id,
        "sensor_id": filters.sensor_id,
        "time_range": filters.time_range.value if filters.time_range else None,
        "from_timestamp": filters.from_timestamp.isoformat() if filters.from_timestamp else None,
        "to_timestamp": filters.to_timestamp.isoformat() if filters.to_timestamp else None,
    }
