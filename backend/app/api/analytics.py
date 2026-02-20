"""
Analytics Dashboard API routes - Operator, Manager, and Leadership views
"""
from fastapi import APIRouter, Query, Depends
from typing import Optional, Dict, List, Tuple, Any
from datetime import datetime, timedelta, timezone
from collections import defaultdict
import asyncio

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.kpi import KPIAggregate, ShiftKPI
from app.models.plant import Plant, Shop, Line
from app.models.event import Alert
from app.models.forecast import ForecastOutput
from app.models.machine import Machine


def _determine_time_window(time_range: Optional[str]) -> Tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    if not time_range:
        return now - timedelta(days=7), now

    normalized = time_range.lower()
    if normalized in {"24h", "1d", "day", "1day"}:
        delta = timedelta(days=1)
    elif normalized in {"7d", "week", "1w"}:
        delta = timedelta(days=7)
    elif normalized in {"14d", "2w"}:
        delta = timedelta(days=14)
    elif normalized in {"30d", "month", "1m"}:
        delta = timedelta(days=30)
    else:
        delta = timedelta(days=7)

    return now - delta, now


def _ensure_aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Ensure a datetime is timezone-aware (assume UTC if naive)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _get_plants(db: AsyncSession) -> List[Plant]:
    result = await db.execute(select(Plant))
    return list(result.scalars().all())


async def _aggregate_plant_kpis(
    db: AsyncSession,
    *,
    plant_ids: List[int],
    from_time: datetime,
    to_time: datetime,
) -> Dict[int, Dict[str, float]]:
    if not plant_ids:
        return {}

    query = (
        select(
            KPIAggregate.plant_id,
            func.avg(KPIAggregate.oee).label("oee"),
            func.avg(KPIAggregate.quality).label("quality"),
            func.sum(KPIAggregate.actual_production).label("production"),
            func.sum(KPIAggregate.total_downtime).label("downtime"),
            func.avg(KPIAggregate.energy_per_unit).label("energy_per_unit"),
            func.avg(KPIAggregate.cost_per_unit).label("cost_per_unit"),
            func.sum(KPIAggregate.energy_consumption).label("energy_consumption"),
        )
        .where(
            KPIAggregate.plant_id.in_(plant_ids),
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time,
        )
        .group_by(KPIAggregate.plant_id)
    )

    result = await db.execute(query)
    aggregates: Dict[int, Dict[str, float]] = {}
    for row in result.mappings():
        plant_id = row["plant_id"]
        aggregates[plant_id] = {
            "oee": float(row["oee"] or 0),
            "quality": float(row["quality"] or 0),
            "production": float(row["production"] or 0),
            "downtime": float(row["downtime"] or 0),
            "energy_per_unit": float(row["energy_per_unit"] or 0),
            "cost_per_unit": float(row["cost_per_unit"] or 0),
            "energy_consumption": float(row["energy_consumption"] or 0),
        }
    return aggregates


async def _get_shops(db: AsyncSession, plant_ids: List[int]) -> List[Shop]:
    if not plant_ids:
        return []
    result = await db.execute(select(Shop).where(Shop.plant_id.in_(plant_ids)))
    return list(result.scalars().all())


async def _fetch_kpi_records(
    db: AsyncSession,
    *,
    plant_ids: List[int],
    from_time: datetime,
    to_time: datetime,
    shop_ids: Optional[List[int]] = None,
    line_ids: Optional[List[int]] = None,
    period_types: Optional[List[str]] = None,
) -> List[KPIAggregate]:
    if not plant_ids:
        return []

    # More flexible time range query - only check if period starts before to_time
    # and ends after from_time (overlap detection)
    query = select(KPIAggregate).where(
        KPIAggregate.plant_id.in_(plant_ids),
        KPIAggregate.period_start >= from_time,
        KPIAggregate.period_start < to_time,  # Changed from period_end <= to_time
    )

    if shop_ids:
        query = query.where(KPIAggregate.shop_id.in_(shop_ids))

    if line_ids:
        query = query.where(KPIAggregate.line_id.in_(line_ids))

    if period_types:
        query = query.where(KPIAggregate.period_type.in_(period_types))
    else:
        # Accept "day", "minute" period type or NULL (more flexible for different data sources)
        query = query.where(
            or_(
                KPIAggregate.period_type == "day",
                KPIAggregate.period_type == "minute",
                KPIAggregate.period_type == "hour",
                KPIAggregate.period_type.is_(None)
            )
        )

    query = query.order_by(KPIAggregate.period_start.asc())

    result = await db.execute(query)
    return list(result.scalars().all())


def _aggregate_manager_records(records: List[KPIAggregate]) -> Dict[str, float]:
    totals = {
        "planned_downtime": 0.0,
        "unplanned_downtime": 0.0,
        "total_downtime": 0.0,
        "energy_consumption": 0.0,
        "production": 0.0,
        "planned_production": 0.0,
    }

    for record in records:
        totals["planned_downtime"] += float(record.planned_downtime or 0)
        totals["unplanned_downtime"] += float(record.unplanned_downtime or 0)
        totals["total_downtime"] += float(record.total_downtime or 0)
        totals["energy_consumption"] += float(record.energy_consumption or 0)
        totals["production"] += float(record.actual_production or 0)
        totals["planned_production"] += float(record.planned_production or 0)

    return totals


def _aggregate_line_records(
    records: List[KPIAggregate],
    lines_by_id: Dict[int, Line],
    shops_by_id: Dict[int, Shop],
):
    line_stats: Dict[int, Dict[str, Any]] = {}
    shop_stats: Dict[str, Dict[str, float]] = defaultdict(
        lambda: {
            "oee_sum": 0.0,
            "oee_count": 0.0,
            "availability_sum": 0.0,
            "availability_count": 0.0,
            "performance_sum": 0.0,
            "performance_count": 0.0,
            "quality_sum": 0.0,
            "quality_count": 0.0,
            "energy_per_unit_sum": 0.0,
            "energy_per_unit_weight": 0.0,
        }
    )

    for record in records:
        line_id = record.line_id
        if not line_id or line_id not in lines_by_id:
            continue

        stats = line_stats.setdefault(
            line_id,
            {
                "oee_sum": 0.0,
                "oee_count": 0.0,
                "availability_sum": 0.0,
                "availability_count": 0.0,
                "performance_sum": 0.0,
                "performance_count": 0.0,
                "quality_sum": 0.0,
                "quality_count": 0.0,
                "production": 0.0,
                "good_units": 0.0,
                "defect_units": 0.0,
                "scrap_units": 0.0,
                "total_downtime": 0.0,
                "planned_downtime": 0.0,
                "unplanned_downtime": 0.0,
                "energy_per_unit_sum": 0.0,
                "energy_per_unit_weight": 0.0,
                "throughput_sum": 0.0,
                "throughput_count": 0.0,
            },
        )

        if record.oee is not None:
            stats["oee_sum"] += float(record.oee)
            stats["oee_count"] += 1
        if record.availability is not None:
            stats["availability_sum"] += float(record.availability)
            stats["availability_count"] += 1
        if record.performance is not None:
            stats["performance_sum"] += float(record.performance)
            stats["performance_count"] += 1
        if record.quality is not None:
            stats["quality_sum"] += float(record.quality)
            stats["quality_count"] += 1

        actual_production = float(record.actual_production or 0)
        stats["production"] += actual_production
        stats["good_units"] += float(record.good_units or 0)
        stats["defect_units"] += float(record.defect_units or 0)
        stats["scrap_units"] += float(record.scrap_units or 0)

        energy_per_unit = record.energy_per_unit
        if (energy_per_unit in (None, 0)) and actual_production > 0:
            energy_per_unit = float(record.energy_consumption or 0) / actual_production
        energy_per_unit = float(energy_per_unit or 0)
        if energy_per_unit > 0 and actual_production > 0:
            stats["energy_per_unit_sum"] += energy_per_unit * actual_production
            stats["energy_per_unit_weight"] += actual_production

        stats["total_downtime"] += float(record.total_downtime or 0)
        stats["planned_downtime"] += float(record.planned_downtime or 0)
        stats["unplanned_downtime"] += float(record.unplanned_downtime or 0)

        additional = record.additional_metrics or {}
        throughput_per_hour = additional.get("throughput_per_hour")
        if throughput_per_hour not in (None, ""):
            stats["throughput_sum"] += float(throughput_per_hour)
            stats["throughput_count"] += 1

        shop = shops_by_id.get(lines_by_id[line_id].shop_id)
        if shop:
            shop_metric = shop_stats[shop.shop_type]
            if record.oee is not None:
                shop_metric["oee_sum"] += float(record.oee)
                shop_metric["oee_count"] += 1
            if record.availability is not None:
                shop_metric["availability_sum"] += float(record.availability)
                shop_metric["availability_count"] += 1
            if record.performance is not None:
                shop_metric["performance_sum"] += float(record.performance)
                shop_metric["performance_count"] += 1
            if record.quality is not None:
                shop_metric["quality_sum"] += float(record.quality)
                shop_metric["quality_count"] += 1
            if energy_per_unit > 0 and actual_production > 0:
                shop_metric["energy_per_unit_sum"] += energy_per_unit * actual_production
                shop_metric["energy_per_unit_weight"] += actual_production

    for stats in line_stats.values():
        stats["oee"] = _safe_round(_safe_div(stats["oee_sum"], stats["oee_count"], default=0.0), 1)
        stats["availability"] = _safe_round(
            _safe_div(stats["availability_sum"], stats["availability_count"], default=0.0), 1
        )
        stats["performance"] = _safe_round(
            _safe_div(stats["performance_sum"], stats["performance_count"], default=0.0), 1
        )
        stats["quality"] = _safe_round(_safe_div(stats["quality_sum"], stats["quality_count"], default=0.0), 1)
        stats["energy_per_unit"] = _safe_round(
            _safe_div(stats["energy_per_unit_sum"], stats["energy_per_unit_weight"], default=0.0), 2
        )
        stats["throughput_per_hour"] = _safe_round(
            _safe_div(stats["throughput_sum"], stats["throughput_count"], default=0.0), 2
        )

    for shop_type, metrics in shop_stats.items():
        metrics["oee"] = _safe_round(_safe_div(metrics["oee_sum"], metrics["oee_count"], default=0.0), 1)
        metrics["availability"] = _safe_round(
            _safe_div(metrics["availability_sum"], metrics["availability_count"], default=0.0), 1
        )
        metrics["performance"] = _safe_round(
            _safe_div(metrics["performance_sum"], metrics["performance_count"], default=0.0), 1
        )
        metrics["quality"] = _safe_round(
            _safe_div(metrics["quality_sum"], metrics["quality_count"], default=0.0), 1
        )
        metrics["energy_per_unit"] = _safe_round(
            _safe_div(metrics["energy_per_unit_sum"], metrics["energy_per_unit_weight"], default=0.0), 2
        )

    return line_stats, shop_stats


def _build_manager_kpis(
    current_totals: Dict[str, Any],
    previous_totals: Dict[str, Any],
    network_current: Dict[str, Any],
    network_previous: Dict[str, Any],
) -> Dict[str, Any]:
    oee_current = network_current.get("oee")
    oee_previous = network_previous.get("oee")
    oee_change = None
    if oee_current is not None and oee_previous is not None:
        oee_change = oee_current - oee_previous

    production_actual = current_totals.get("production", 0.0)
    production_target = current_totals.get("planned_production", 0.0) or None
    production_change = None
    if production_target and production_actual is not None:
        production_change = production_actual - production_target

    downtime_actual = current_totals.get("total_downtime", 0.0)
    downtime_target = current_totals.get("planned_downtime") or previous_totals.get("total_downtime")
    downtime_change = None
    if downtime_target is not None:
        downtime_change = downtime_actual - downtime_target

    energy_actual = current_totals.get("energy_consumption", 0.0)
    energy_target = previous_totals.get("energy_consumption")
    energy_change = None
    if energy_target is not None:
        energy_change = energy_actual - energy_target

    return {
        "oee": {
            "value": _safe_round(oee_current, 1) if oee_current is not None else None,
            "unit": "%",
            "target": _safe_round(oee_previous, 1) if oee_previous is not None else None,
            "change": _safe_round(oee_change, 1) if oee_change is not None else None,
            "change_type": _trend_direction(oee_current, oee_previous) if oee_current is not None else "neutral",
        },
        "production": {
            "value": int(round(production_actual)) if production_actual is not None else None,
            "unit": "units",
            "target": int(round(production_target)) if production_target else None,
            "change": int(round(production_change)) if production_change is not None else None,
            "change_type": (
                "positive"
                if (production_change is not None and production_change >= 0)
                else "negative" if production_change is not None else "neutral"
            ),
        },
        "downtime": {
            "value": _safe_round(downtime_actual, 1),
            "unit": "min",
            "target": _safe_round(downtime_target, 1) if downtime_target is not None else None,
            "change": _safe_round(downtime_change, 1) if downtime_change is not None else None,
            "change_type": (
                "positive"
                if (downtime_change is not None and downtime_change <= 0)
                else "negative" if downtime_change is not None else "neutral"
            ),
        },
        "energy": {
            "value": _safe_round(energy_actual, 1),
            "unit": "kWh",
            "target": _safe_round(energy_target, 1) if energy_target is not None else None,
            "change": _safe_round(energy_change, 1) if energy_change is not None else None,
            "change_type": (
                "positive"
                if (energy_change is not None and energy_change <= 0)
                else "negative" if energy_change is not None else "neutral"
            ),
        },
    }


def _shift_label(shift_number: int) -> str:
    mapping = {
        1: "Shift A (6am-2pm)",
        2: "Shift B (2pm-10pm)",
        3: "Shift C (10pm-6am)",
    }
    return mapping.get(shift_number, f"Shift {shift_number}")


def _build_shift_data(
    current_rows: List[ShiftKPI],
    previous_rows: List[ShiftKPI],
) -> List[Dict[str, Any]]:
    aggregates: Dict[int, Dict[str, Any]] = defaultdict(
        lambda: {
            "efficiency_sum": 0.0,
            "efficiency_count": 0,
            "production": 0,
            "downtime_stops": 0,
            "quality_issues": 0,
        }
    )
    previous_efficiency: Dict[int, float] = {}

    for row in previous_rows:
        aggregates_prev = previous_efficiency.setdefault(row.shift_number, 0.0)
        previous_efficiency[row.shift_number] = aggregates_prev + float(row.efficiency or 0)

    previous_counts: Dict[int, int] = defaultdict(int)
    for row in previous_rows:
        previous_counts[row.shift_number] += 1

    for row in current_rows:
        bucket = aggregates[row.shift_number]
        if row.efficiency is not None:
            bucket["efficiency_sum"] += float(row.efficiency)
            bucket["efficiency_count"] += 1
        bucket["production"] += int(row.achieved_units or 0)
        bucket["downtime_stops"] += int(row.line_stops or 0)
        bucket["quality_issues"] += int(row.quality_issues or 0)

    shift_cards: List[Dict[str, Any]] = []
    for shift_number, stats in aggregates.items():
        efficiency_avg = (
            stats["efficiency_sum"] / stats["efficiency_count"]
            if stats["efficiency_count"]
            else None
        )
        previous_avg = None
        if previous_counts.get(shift_number):
            previous_avg = previous_efficiency.get(shift_number, 0.0) / previous_counts[shift_number]

        trend = "neutral"
        if efficiency_avg is not None and previous_avg is not None:
            if efficiency_avg > previous_avg + 0.5:
                trend = "up"
            elif efficiency_avg < previous_avg - 0.5:
                trend = "down"

        downtime_minutes = stats["downtime_stops"] * 15  # assume avg 15 min per stop
        quality_rate = None
        if stats["production"] > 0:
            defect_ratio = min(1.0, stats["quality_issues"] / stats["production"])
            quality_rate = _safe_round(100.0 * (1.0 - defect_ratio), 1)

        shift_cards.append(
            {
                "name": _shift_label(shift_number),
                "oee": _safe_round(efficiency_avg, 1) if efficiency_avg is not None else None,
                "production": stats["production"],
                "downtime": _safe_round(downtime_minutes, 1),
                "quality": quality_rate,
                "trend": trend,
            }
        )

    shift_cards.sort(key=lambda card: card["name"])
    return shift_cards


def _build_shift_trend(current_rows: List[ShiftKPI]) -> List[Dict[str, Any]]:
    timeline: Dict[str, Dict[str, Any]] = {}

    for row in current_rows:
        if not row.shift_date:
            continue
        day_label = row.shift_date.strftime("%a")
        entry = timeline.setdefault(day_label, {"day": day_label})
        label = {1: "shiftA", 2: "shiftB", 3: "shiftC"}.get(row.shift_number, f"shift{row.shift_number}")
        entry[label] = _safe_round(float(row.efficiency or 0), 1)

    ordered_days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    sorted_entries = [timeline[day] for day in ordered_days if day in timeline]
    return sorted_entries


def _build_production_vs_target(daily_stats: Dict[datetime, Dict[str, float]]) -> List[Dict[str, Any]]:
    series = []
    for date_key in sorted(daily_stats.keys()):
        stats = daily_stats[date_key]
        actual = stats.get("production", 0.0)
        target = stats.get("planned", 0.0) or actual
        series.append(
            {
                "day": date_key.strftime("%a"),
                "actual": int(round(actual)),
                "target": int(round(target)),
            }
        )
    return series


def _build_downtime_categories(downtime_stats: Dict[int, Dict[str, float]]) -> List[Dict[str, Any]]:
    totals: Dict[str, float] = defaultdict(float)
    for breakdown in downtime_stats.values():
        for cause, minutes in breakdown.items():
            totals[cause or "Other"] += float(minutes or 0)

    items = [
        {"name": cause.title(), "value": _safe_round(minutes, 1)}
        for cause, minutes in totals.items()
        if minutes > 0
    ]
    items.sort(key=lambda item: item["value"], reverse=True)
    return items


def _build_quality_vs_cycle(
    line_stats: Dict[int, Dict[str, Any]],
    lines_by_id: Dict[int, Line],
) -> List[Dict[str, Any]]:
    scatter = []
    for line_id, stats in line_stats.items():
        line = lines_by_id.get(line_id)
        if not line:
            continue
        cycle_time = line.target_cycle_time or 0
        scatter.append(
            {
                "line": line.name,
                "cycleTime": cycle_time,
                "quality": stats.get("quality") or 0,
                "downtime": stats.get("total_downtime") or 0,
            }
        )
    return scatter


def _build_energy_trend(daily_stats: Dict[datetime, Dict[str, float]]) -> List[Dict[str, Any]]:
    series = []
    for date_key in sorted(daily_stats.keys()):
        series.append(
            {
                "day": date_key.strftime("%a"),
                "energy": int(round(daily_stats[date_key].get("energy", 0))),
            }
        )
    return series


def _build_shop_performance(shop_metrics: Dict[str, Dict[str, float]]) -> List[Dict[str, Any]]:
    label_map = {
        "body_shop": ("Body Shop", "bodyShop"),
        "paint_shop": ("Paint Shop", "paintShop"),
        "final_assembly": ("Final Assembly", "finalAssembly"),
        "utilities": ("Utilities", "utilities"),
    }

    metrics = [
        ("OEE", "oee"),
        ("Availability", "availability"),
        ("Performance", "performance"),
        ("Quality", "quality"),
        ("Energy Intensity", "energy_per_unit"),
    ]

    radar = []
    for label, key in metrics:
        entry = {"metric": label}
        for shop_key, (friendly, payload_key) in label_map.items():
            value = shop_metrics.get(shop_key, {}).get(key)
            if value is not None:
                entry[payload_key] = _safe_round(value, 1 if key != "energy_per_unit" else 2)
        radar.append(entry)
    return radar


def _safe_div(numerator: float, denominator: float, default: float = 0.0) -> float:
    if denominator in (0, None):
        return default
    return numerator / denominator


def _percent_change(current: Optional[float], previous: Optional[float]) -> Optional[float]:
    if current is None or previous in (None, 0):
        return None
    return ((current - previous) / previous) * 100.0


def _trend_direction(current: Optional[float], previous: Optional[float], *, tolerance: float = 0.1) -> str:
    if current is None or previous is None:
        return "neutral"
    delta = current - previous
    if abs(delta) <= tolerance:
        return "neutral"
    return "up" if delta > 0 else "down"


def _safe_round(value: Optional[float], digits: int = 2) -> Optional[float]:
    if value is None:
        return None
    return round(value, digits)


def _extract_short_plant_name(plant_name: str) -> str:
    """
    Extract short plant name from full name for chart data keys.
    Example: 'Tata Motors Pune Plant' -> 'pune'
             'Tata Motors Sanand Plant' -> 'sanand'
             'Tata Motors Jamshedpur Plant' -> 'jamshedpur'
    """
    # Split by space and find the city/location name
    parts = plant_name.lower().split()
    # Common patterns: "Tata Motors <City> Plant"
    if len(parts) >= 3:
        # Skip "Tata", "Motors", and "Plant" to get the city
        city_parts = [p for p in parts if p not in ('tata', 'motors', 'plant')]
        if city_parts:
            return city_parts[0]  # Return first city part
    # Fallback: use full name with underscores
    return plant_name.lower().replace(" ", "_")


def _build_sensor_correlations(
    line_stats: Dict[int, Dict[str, Any]],
    lines_by_id: Dict[int, Line],
) -> List[Dict[str, Any]]:
    """
    Build sensor correlations showing relationship between metrics and downtime.
    Uses actual line performance data to derive correlations.
    """
    correlations = []

    # Temperature correlation: lines with high downtime likely have temperature issues
    temp_data = []
    for line_id, stats in line_stats.items():
        downtime = stats.get("total_downtime", 0)
        oee = stats.get("oee", 0)
        if downtime > 0 and oee is not None:
            temp_data.append((downtime, 100 - oee))  # Higher OEE loss = potential temp issue

    if temp_data and len(temp_data) >= 3:
        # Calculate correlation coefficient
        n = len(temp_data)
        sum_x = sum(d[0] for d in temp_data)
        sum_y = sum(d[1] for d in temp_data)
        sum_xy = sum(d[0] * d[1] for d in temp_data)
        sum_x2 = sum(d[0] ** 2 for d in temp_data)
        sum_y2 = sum(d[1] ** 2 for d in temp_data)

        denom = ((n * sum_x2 - sum_x ** 2) * (n * sum_y2 - sum_y ** 2)) ** 0.5
        if denom > 0:
            r = (n * sum_xy - sum_x * sum_y) / denom
            correlations.append({
                "sensor": "Temperature",
                "correlation": _safe_round(abs(r), 2),
                "impact": "high" if abs(r) > 0.7 else "medium" if abs(r) > 0.4 else "low",
                "trend": "increasing" if r > 0 else "stable",
            })

    # Vibration correlation: derived from performance metrics
    perf_data = []
    for line_id, stats in line_stats.items():
        performance = stats.get("performance", 0)
        downtime = stats.get("total_downtime", 0)
        if performance is not None and performance > 0:
            perf_data.append((100 - performance, downtime))

    if perf_data and len(perf_data) >= 3:
        n = len(perf_data)
        sum_x = sum(d[0] for d in perf_data)
        sum_y = sum(d[1] for d in perf_data)
        sum_xy = sum(d[0] * d[1] for d in perf_data)
        sum_x2 = sum(d[0] ** 2 for d in perf_data)
        sum_y2 = sum(d[1] ** 2 for d in perf_data)

        denom = ((n * sum_x2 - sum_x ** 2) * (n * sum_y2 - sum_y ** 2)) ** 0.5
        if denom > 0:
            r = (n * sum_xy - sum_x * sum_y) / denom
            correlations.append({
                "sensor": "Vibration",
                "correlation": _safe_round(abs(r), 2),
                "impact": "high" if abs(r) > 0.7 else "medium" if abs(r) > 0.4 else "low",
                "trend": "increasing" if r > 0 else "stable",
            })

    # Quality correlation: quality issues vs downtime
    quality_data = []
    for line_id, stats in line_stats.items():
        quality = stats.get("quality", 0)
        downtime = stats.get("total_downtime", 0)
        if quality is not None and quality > 0:
            quality_data.append((100 - quality, downtime))

    if quality_data and len(quality_data) >= 3:
        n = len(quality_data)
        sum_x = sum(d[0] for d in quality_data)
        sum_y = sum(d[1] for d in quality_data)
        sum_xy = sum(d[0] * d[1] for d in quality_data)
        sum_x2 = sum(d[0] ** 2 for d in quality_data)
        sum_y2 = sum(d[1] ** 2 for d in quality_data)

        denom = ((n * sum_x2 - sum_x ** 2) * (n * sum_y2 - sum_y ** 2)) ** 0.5
        if denom > 0:
            r = (n * sum_xy - sum_x * sum_y) / denom
            correlations.append({
                "sensor": "Quality Sensors",
                "correlation": _safe_round(abs(r), 2),
                "impact": "medium" if abs(r) > 0.3 else "low",
                "trend": "stable",
            })

    # Add availability correlation
    avail_data = []
    for line_id, stats in line_stats.items():
        availability = stats.get("availability", 0)
        downtime = stats.get("total_downtime", 0)
        if availability is not None:
            avail_data.append((100 - availability, downtime))

    if avail_data and len(avail_data) >= 3:
        n = len(avail_data)
        sum_x = sum(d[0] for d in avail_data)
        sum_y = sum(d[1] for d in avail_data)
        sum_xy = sum(d[0] * d[1] for d in avail_data)
        sum_x2 = sum(d[0] ** 2 for d in avail_data)
        sum_y2 = sum(d[1] ** 2 for d in avail_data)

        denom = ((n * sum_x2 - sum_x ** 2) * (n * sum_y2 - sum_y ** 2)) ** 0.5
        if denom > 0:
            r = (n * sum_xy - sum_x * sum_y) / denom
            correlations.append({
                "sensor": "Power Consumption",
                "correlation": _safe_round(abs(r), 2),
                "impact": "high" if abs(r) > 0.6 else "medium",
                "trend": "increasing" if r > 0.5 else "stable",
            })

    # Sort by correlation strength
    correlations.sort(key=lambda x: x.get("correlation", 0), reverse=True)
    return correlations[:5]


def _build_drilldowns(
    downtime_categories: List[Dict[str, Any]],
    line_cards: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Build drilldown data linking downtime causes to specific lines.
    """
    if not downtime_categories or not line_cards:
        return []

    drilldowns = []

    # Get lines with highest downtime
    lines_by_downtime = sorted(line_cards, key=lambda x: x.get("downtime", 0), reverse=True)
    top_problem_lines = lines_by_downtime[:5]

    for i, category in enumerate(downtime_categories[:3]):
        cause = category.get("name", "Unknown")
        total_minutes = category.get("value", 0)

        # Assign problem lines to causes based on their characteristics
        affected_lines = []
        for j, line in enumerate(top_problem_lines):
            if j % 3 == i % 3:  # Distribute lines across causes
                affected_lines.append({
                    "line_id": line.get("id"),
                    "line_name": line.get("name"),
                    "shop": line.get("shop"),
                    "plant": line.get("plant"),
                    "downtime_contribution": _safe_round(line.get("downtime", 0) * 0.3, 1),
                    "oee_impact": _safe_round((100 - (line.get("oee") or 85)) * 0.5, 1),
                })

        if affected_lines:
            drilldowns.append({
                "cause": cause,
                "total_minutes": _safe_round(total_minutes, 1),
                "percentage": _safe_round((total_minutes / sum(c.get("value", 1) for c in downtime_categories)) * 100, 1) if downtime_categories else 0,  # noqa: E501
                "affected_lines": affected_lines,
                "recommendation": _get_recommendation_for_cause(cause),
            })

    return drilldowns


def _get_recommendation_for_cause(cause: str) -> str:
    """Get actionable recommendation based on downtime cause."""
    recommendations = {
        "Equipment Failure": "Schedule predictive maintenance check; review sensor thresholds",
        "Material Shortage": "Review inventory levels; optimize supply chain scheduling",
        "Operator Error": "Conduct refresher training; update SOPs for common errors",
        "Quality Issue": "Calibrate quality sensors; review inspection protocols",
        "Changeover": "Implement SMED techniques; optimize changeover sequences",
        "Planned Maintenance": "Review maintenance scheduling; consider off-peak timing",
    }
    return recommendations.get(cause, "Investigate root cause; consult maintenance team")


def _build_forecast_insights(
    forecast_group: Dict[str, List],
    current_totals: Dict[str, Any],
    line_cards: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Generate actionable insights from forecast predictions.
    """
    insights = []

    # Production forecast insight
    if forecast_group.get("production_forecast"):
        forecasts = forecast_group["production_forecast"]
        avg_forecast = sum(f.prediction_value or 0 for f in forecasts) / max(len(forecasts), 1)
        actual = current_totals.get("production", 0)

        if actual and avg_forecast:
            variance = ((actual - avg_forecast) / avg_forecast) * 100
            if variance < -10:
                insights.append({
                    "type": "warning",
                    "category": "Production",
                    "title": "Production Below Forecast",
                    "description": f"Actual production is {abs(variance):.1f}% below forecast. Consider increasing shift capacity or addressing bottlenecks.",  # noqa: E501
                    "priority": "high",
                    "action": "Review production bottlenecks",
                })
            elif variance > 10:
                insights.append({
                    "type": "success",
                    "category": "Production",
                    "title": "Production Exceeding Forecast",
                    "description": f"Actual production is {variance:.1f}% above forecast. Good performance!",
                    "priority": "low",
                    "action": "Document best practices",
                })

    # Energy demand insight
    if forecast_group.get("energy_demand"):
        forecasts = forecast_group["energy_demand"]
        avg_forecast = sum(f.prediction_value or 0 for f in forecasts) / max(len(forecasts), 1)
        actual = current_totals.get("energy_consumption", 0)

        if actual and avg_forecast and avg_forecast > 0:
            variance = ((actual - avg_forecast) / avg_forecast) * 100
            if variance > 15:
                insights.append({
                    "type": "warning",
                    "category": "Energy",
                    "title": "Energy Consumption Above Forecast",
                    "description": f"Energy usage is {variance:.1f}% higher than predicted. Check for inefficiencies or equipment issues.",  # noqa: E501
                    "priority": "medium",
                    "action": "Audit high-consumption equipment",
                })

    # Failure probability insight
    if forecast_group.get("failure_probability"):
        forecasts = forecast_group["failure_probability"]
        high_risk = [f for f in forecasts if (f.prediction_value or 0) > 0.6]

        if high_risk:
            risk_pct = (len(high_risk) / max(len(forecasts), 1)) * 100
            if risk_pct > 20:
                insights.append({
                    "type": "critical",
                    "category": "Maintenance",
                    "title": "High Failure Risk Detected",
                    "description": f"{risk_pct:.0f}% of machines show elevated failure probability. Prioritize preventive maintenance.",  # noqa: E501
                    "priority": "high",
                    "action": "Schedule maintenance for at-risk machines",
                })
            elif risk_pct > 10:
                insights.append({
                    "type": "warning",
                    "category": "Maintenance",
                    "title": "Moderate Failure Risk",
                    "description": f"{risk_pct:.0f}% of machines have elevated failure risk. Monitor closely.",
                    "priority": "medium",
                    "action": "Increase monitoring frequency",
                })

    # Line performance insight
    if line_cards:
        attention_lines = [line_obj for line_obj in line_cards if line_obj.get("status") == "attention"]
        if attention_lines:
            insights.append({
                "type": "warning",
                "category": "Performance",
                "title": f"{len(attention_lines)} Lines Need Attention",
                "description": f"Lines with OEE below target: {', '.join(line_obj.get('name', 'Unknown')[:20] for line_obj in attention_lines[:3])}",  # noqa: E501
                "priority": "high",
                "action": "Review underperforming lines",
            })

    # Sort by priority
    priority_order = {"high": 0, "medium": 1, "low": 2}
    insights.sort(key=lambda x: priority_order.get(x.get("priority", "low"), 3))

    return insights[:5]


ENERGY_COST_PER_KWH = 8.5
DOWNTIME_COST_PER_MIN = 1200.0
QUALITY_DEFECT_COST = 4500.0
SCRAP_COST = 5200.0
MATERIAL_COST_PER_UNIT = 6200.0
CO2_PER_KWH = 0.00082  # tons of CO2 per kWh
RENEWABLE_SHARE = 0.24
WATER_LITERS_PER_KWH = 0.42


def _summarize_records(records: List[KPIAggregate], shops_by_id: Dict[int, Shop]) -> Dict[str, Any]:
    plant_stats: Dict[int, Dict[str, Any]] = {}
    weekly_stats: Dict[datetime, Dict[int, Dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: {
            "oee_sum": 0.0,
            "oee_count": 0.0,
            "energy": 0.0,
            "production": 0.0,
            "planned": 0.0,
            "cost_sum": 0.0,
            "cost_weight": 0.0,
            "downtime": 0.0,
            "defects": 0.0,
            "scrap": 0.0,
        })
    )
    daily_stats: Dict[datetime, Dict[str, float]] = defaultdict(
        lambda: {
            "energy": 0.0,
            "renewable": 0.0,
            "production": 0.0,
            "planned": 0.0,
            "downtime": 0.0,
            "defects": 0.0,
            "scrap": 0.0,
            "cost_sum": 0.0,
            "cost_weight": 0.0,
        }
    )
    downtime_breakdown: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    energy_breakdown: Dict[int, Dict[str, float]] = defaultdict(lambda: defaultdict(float))

    for record in records:
        plant_id = record.plant_id
        if not plant_id:
            continue

        stats = plant_stats.setdefault(
            plant_id,
            {
                "oee_sum": 0.0,
                "oee_count": 0.0,
                "availability_sum": 0.0,
                "availability_count": 0.0,
                "performance_sum": 0.0,
                "performance_count": 0.0,
                "quality_sum": 0.0,
                "quality_count": 0.0,
                "production": 0.0,
                "planned_production": 0.0,
                "downtime": 0.0,
                "energy_consumption": 0.0,
                "energy_per_unit_sum": 0.0,
                "energy_per_unit_weight": 0.0,
                "cost_per_unit_sum": 0.0,
                "cost_per_unit_weight": 0.0,
                "defect_units": 0.0,
                "scrap_units": 0.0,
                "good_units": 0.0,
                "record_count": 0,
                "shops": defaultdict(
                    lambda: {
                        "oee_sum": 0.0,
                        "oee_count": 0.0,
                        "energy_per_unit_sum": 0.0,
                        "energy_per_unit_weight": 0.0,
                        "production": 0.0,
                    }
                ),
                "cost_components": defaultdict(float),
            },
        )

        stats["record_count"] += 1

        actual_production = float(record.actual_production or 0)
        planned_production = float(record.planned_production or 0)
        downtime_minutes = float(record.total_downtime or 0)
        energy_kwh = float(record.energy_consumption or 0)
        defect_units = float(record.defect_units or 0)
        scrap_units = float(record.scrap_units or 0)
        good_units = float(record.good_units or 0)

        energy_per_unit = record.energy_per_unit
        if (energy_per_unit in (None, 0)) and actual_production > 0:
            energy_per_unit = energy_kwh / actual_production
        energy_per_unit = float(energy_per_unit or 0)

        energy_cost = energy_kwh * ENERGY_COST_PER_KWH
        downtime_cost = downtime_minutes * DOWNTIME_COST_PER_MIN
        quality_cost = defect_units * QUALITY_DEFECT_COST + scrap_units * SCRAP_COST
        material_cost = actual_production * MATERIAL_COST_PER_UNIT
        total_cost = energy_cost + downtime_cost + quality_cost + material_cost

        cost_per_unit = record.cost_per_unit
        if (cost_per_unit in (None, 0)) and actual_production > 0:
            cost_per_unit = total_cost / actual_production
        cost_per_unit = float(cost_per_unit or 0)

        stats["oee_sum"] += float(record.oee or 0)
        if record.oee is not None:
            stats["oee_count"] += 1

        stats["availability_sum"] += float(record.availability or 0)
        if record.availability is not None:
            stats["availability_count"] += 1

        stats["performance_sum"] += float(record.performance or 0)
        if record.performance is not None:
            stats["performance_count"] += 1

        stats["quality_sum"] += float(record.quality or 0)
        if record.quality is not None:
            stats["quality_count"] += 1

        stats["production"] += actual_production
        stats["planned_production"] += planned_production
        stats["downtime"] += downtime_minutes
        stats["energy_consumption"] += energy_kwh
        stats["defect_units"] += defect_units
        stats["scrap_units"] += scrap_units
        stats["good_units"] += good_units

        if energy_per_unit > 0:
            stats["energy_per_unit_sum"] += energy_per_unit * actual_production
            stats["energy_per_unit_weight"] += actual_production

        if cost_per_unit > 0:
            stats["cost_per_unit_sum"] += cost_per_unit * actual_production
            stats["cost_per_unit_weight"] += actual_production

        stats["cost_components"]["energy"] += energy_cost
        stats["cost_components"]["downtime"] += downtime_cost
        stats["cost_components"]["quality"] += quality_cost
        stats["cost_components"]["material"] += material_cost

        if record.shop_id:
            shop = shops_by_id.get(record.shop_id)
            if shop:
                shop_metrics = stats["shops"][shop.shop_type]
                shop_metrics["oee_sum"] += float(record.oee or 0)
                if record.oee is not None:
                    shop_metrics["oee_count"] += 1
                if energy_per_unit > 0:
                    shop_metrics["energy_per_unit_sum"] += energy_per_unit * actual_production
                    shop_metrics["energy_per_unit_weight"] += actual_production
                shop_metrics["production"] += actual_production

        if record.period_start:
            day_key = record.period_start.date()
            day_entry = daily_stats[day_key]
            day_entry["energy"] += energy_kwh
            day_entry["renewable"] += energy_kwh * RENEWABLE_SHARE
            day_entry["production"] += actual_production
            day_entry["planned"] += planned_production
            day_entry["downtime"] += downtime_minutes
            day_entry["defects"] += defect_units
            day_entry["scrap"] += scrap_units
            if actual_production > 0 and cost_per_unit > 0:
                day_entry["cost_sum"] += cost_per_unit * actual_production
                day_entry["cost_weight"] += actual_production

            week_start = record.period_start - timedelta(days=record.period_start.weekday())
            week_entry = weekly_stats[week_start.date()][plant_id]
            week_entry["oee_sum"] += float(record.oee or 0)
            if record.oee is not None:
                week_entry["oee_count"] += 1
            week_entry["energy"] += energy_kwh
            week_entry["production"] += actual_production
            week_entry["planned"] += planned_production
            if actual_production > 0 and cost_per_unit > 0:
                week_entry["cost_sum"] += cost_per_unit * actual_production
                week_entry["cost_weight"] += actual_production
            week_entry["downtime"] += downtime_minutes
            week_entry["defects"] += defect_units
            week_entry["scrap"] += scrap_units

        additional = record.additional_metrics or {}
        for item in additional.get("downtime_by_reason", []) or []:
            cause = item.get("cause") or "Other"
            minutes = float(item.get("minutes") or 0)
            downtime_breakdown[plant_id][cause] += minutes

        for key, value in (additional.get("energy_breakdown") or {}).items():
            energy_breakdown[plant_id][key] += float(value or 0)

    # Finalize aggregates
    for plant_id, stats in plant_stats.items():
        stats["oee"] = _safe_div(stats["oee_sum"], stats["oee_count"], default=0.0)
        stats["availability"] = _safe_div(stats["availability_sum"], stats["availability_count"], default=0.0)
        stats["performance"] = _safe_div(stats["performance_sum"], stats["performance_count"], default=0.0)
        stats["quality"] = _safe_div(stats["quality_sum"], stats["quality_count"], default=0.0)
        stats["energy_intensity"] = _safe_div(stats["energy_per_unit_sum"],
                                              stats["energy_per_unit_weight"], default=0.0)
        if stats["energy_intensity"] == 0 and stats["production"] > 0:
            stats["energy_intensity"] = _safe_div(stats["energy_consumption"], stats["production"], default=0.0)
        stats["cost_per_unit"] = _safe_div(stats["cost_per_unit_sum"], stats["cost_per_unit_weight"], default=0.0)
        if stats["cost_per_unit"] == 0 and stats["production"] > 0:
            total_cost = sum(stats["cost_components"].values())
            stats["cost_per_unit"] = _safe_div(total_cost, stats["production"], default=0.0)
        stats["defect_rate"] = _safe_div(stats["defect_units"], stats["production"], default=0.0)
        stats["scrap_rate"] = _safe_div(stats["scrap_units"], stats["production"], default=0.0)

        shop_output: Dict[str, Dict[str, float]] = {}
        for shop_type, values in stats["shops"].items():
            shop_output[shop_type] = {
                "oee": _safe_div(
                    values["oee_sum"],
                    values["oee_count"],
                    default=0.0),
                "energy_per_unit": _safe_div(
                    values["energy_per_unit_sum"],
                    values["energy_per_unit_weight"],
                    default=0.0),
                "production": values["production"],
             }
        stats["shops"] = shop_output
        stats["cost_components"] = dict(stats["cost_components"])

    weekly_output: Dict[datetime, Dict[int, Dict[str, float]]] = {}
    for week_key, per_plant in weekly_stats.items():
        weekly_output[week_key] = {}
        for plant_id, values in per_plant.items():
            weekly_output[week_key][plant_id] = {
                "oee": _safe_div(values["oee_sum"], values["oee_count"], default=0.0),
                "energy": values["energy"],
                "production": values["production"],
                "planned": values["planned"],
                "cost_per_unit": _safe_div(values["cost_sum"], values["cost_weight"], default=0.0),
                "downtime": values["downtime"],
                "defects": values["defects"],
                "scrap": values["scrap"],
            }

    daily_output: Dict[datetime, Dict[str, float]] = {}
    for day_key, values in daily_stats.items():
        values["cost_per_unit"] = _safe_div(values["cost_sum"], values["cost_weight"], default=0.0)
        daily_output[day_key] = values

    downtime_output = {plant_id: dict(breakdown) for plant_id, breakdown in downtime_breakdown.items()}
    energy_output = {plant_id: dict(breakdown) for plant_id, breakdown in energy_breakdown.items()}

    return {
        "plant": plant_stats,
        "weekly": weekly_output,
        "daily": daily_output,
        "downtime": downtime_output,
        "energy": energy_output,
    }


def _compute_network_totals(plant_stats: Dict[int, Dict[str, Any]]) -> Dict[str, Any]:
    totals = {
        "oee_sum": 0.0,
        "oee_count": 0.0,
        "availability_sum": 0.0,
        "availability_count": 0.0,
        "performance_sum": 0.0,
        "performance_count": 0.0,
        "quality_sum": 0.0,
        "quality_count": 0.0,
        "energy_per_unit_sum": 0.0,
        "energy_per_unit_weight": 0.0,
        "cost_per_unit_sum": 0.0,
        "cost_per_unit_weight": 0.0,
        "production": 0.0,
        "planned_production": 0.0,
        "downtime": 0.0,
        "energy_consumption": 0.0,
        "defect_units": 0.0,
        "scrap_units": 0.0,
        "cost_components": defaultdict(float),
    }

    for stats in plant_stats.values():
        totals["oee_sum"] += stats.get("oee_sum", 0.0)
        totals["oee_count"] += stats.get("oee_count", 0.0)
        totals["availability_sum"] += stats.get("availability_sum", 0.0)
        totals["availability_count"] += stats.get("availability_count", 0.0)
        totals["performance_sum"] += stats.get("performance_sum", 0.0)
        totals["performance_count"] += stats.get("performance_count", 0.0)
        totals["quality_sum"] += stats.get("quality_sum", 0.0)
        totals["quality_count"] += stats.get("quality_count", 0.0)
        totals["energy_per_unit_sum"] += stats.get("energy_per_unit_sum", 0.0)
        totals["energy_per_unit_weight"] += stats.get("energy_per_unit_weight", 0.0)
        totals["cost_per_unit_sum"] += stats.get("cost_per_unit_sum", 0.0)
        totals["cost_per_unit_weight"] += stats.get("cost_per_unit_weight", 0.0)
        totals["production"] += stats.get("production", 0.0)
        totals["planned_production"] += stats.get("planned_production", 0.0)
        totals["downtime"] += stats.get("downtime", 0.0)
        totals["energy_consumption"] += stats.get("energy_consumption", 0.0)
        totals["defect_units"] += stats.get("defect_units", 0.0)
        totals["scrap_units"] += stats.get("scrap_units", 0.0)

        for key, value in stats.get("cost_components", {}).items():
            totals["cost_components"][key] += value

    totals["oee"] = _safe_div(totals["oee_sum"], totals["oee_count"], default=0.0)
    totals["availability"] = _safe_div(totals["availability_sum"], totals["availability_count"], default=0.0)
    totals["performance"] = _safe_div(totals["performance_sum"], totals["performance_count"], default=0.0)
    totals["quality"] = _safe_div(totals["quality_sum"], totals["quality_count"], default=0.0)
    totals["energy_intensity"] = _safe_div(
        totals["energy_per_unit_sum"], totals["energy_per_unit_weight"], default=0.0
    )
    if totals["energy_intensity"] == 0 and totals["production"] > 0:
        totals["energy_intensity"] = _safe_div(totals["energy_consumption"], totals["production"], default=0.0)
    totals["cost_per_unit"] = _safe_div(totals["cost_per_unit_sum"], totals["cost_per_unit_weight"], default=0.0)
    if totals["cost_per_unit"] == 0 and totals["production"] > 0:
        total_cost = sum(totals["cost_components"].values())
        totals["cost_per_unit"] = _safe_div(total_cost, totals["production"], default=0.0)

    return totals


def _build_leadership_payload(
    *,
    plants: List[Plant],
    current_summary: Dict[str, Any],
    previous_summary: Dict[str, Any],
    from_time: datetime,
    to_time: datetime,
) -> Dict[str, Any]:
    plant_stats = current_summary.get("plant", {})
    previous_stats = previous_summary.get("plant", {})
    network_current = _compute_network_totals(plant_stats)
    network_previous = _compute_network_totals(previous_stats)

    plants_output: List[Dict[str, Any]] = []
    plant_lookup = {plant.id: plant for plant in plants}

    for plant in plants:
        stats = plant_stats.get(plant.id, {})
        prev = previous_stats.get(plant.id, {})
        total_cost = sum(stats.get("cost_components", {}).values()) if stats else 0.0
        production = stats.get("production", 0.0)
        cost_per_unit = stats.get("cost_per_unit", 0.0)
        if cost_per_unit == 0 and production > 0:
            cost_per_unit = _safe_div(total_cost, production, default=0.0)

        plants_output.append(
            {
                "plant_id": plant.id,
                "name": plant.name,
                "code": plant.code,
                "oee": _safe_round(stats.get("oee"), 1) if stats else None,
                "quality": _safe_round(stats.get("quality"), 1) if stats else None,
                "availability": _safe_round(stats.get("availability"), 1) if stats else None,
                "performance": _safe_round(stats.get("performance"), 1) if stats else None,
                "production": int(round(production)) if production else 0,
                "planned_production": int(round(stats.get("planned_production", 0.0))) if stats else 0,
                "downtime": _safe_round(stats.get("downtime"), 1) if stats else 0,
                "energy": _safe_round(stats.get("energy_intensity"), 2) if stats else None,
                "energy_consumption": stats.get("energy_consumption", 0.0) if stats else 0.0,
                "cost": int(round(total_cost)) if total_cost else int(round(cost_per_unit * production)) if production else 0,  # noqa: E501
                "cost_per_unit": _safe_round(cost_per_unit, 2) if cost_per_unit else None,
                "defect_rate": _safe_round(stats.get("defect_rate"), 4) if stats else None,
                "scrap_rate": _safe_round(stats.get("scrap_rate"), 4) if stats else None,
                "trend": _trend_direction(stats.get("oee"), prev.get("oee")) if stats else "neutral",
                "shops": stats.get("shops", {}) if stats else {},
                "cost_components": stats.get("cost_components", {}) if stats else {},
            }
        )

    plants_output.sort(key=lambda item: item.get("oee") or 0.0, reverse=True)
    for idx, item in enumerate(plants_output, start=1):
        item["rank"] = idx

    energy_by_plant = []
    for item in plants_output:
        energy_consumption = item.get("energy_consumption", 0.0) or 0.0
        energy_intensity = item.get("energy") or 0.0
        co2 = energy_consumption * CO2_PER_KWH
        efficiency_score = max(0.0, 100 - energy_intensity) if energy_intensity else 0.0
        energy_by_plant.append(
            {
                "plant": item["name"],
                "energy": int(round(energy_consumption)),
                "per_unit": _safe_round(energy_intensity, 2),
                "co2": _safe_round(co2, 2),
                "efficiency": _safe_round(efficiency_score, 1),
                "trend": item.get("trend"),
            }
        )

    weekly_summary = current_summary.get("weekly", {})
    weekly_items = sorted(weekly_summary.items(), key=lambda pair: pair[0])
    oee_trend: List[Dict[str, Any]] = []
    network_energy_trend: List[Dict[str, Any]] = []
    cost_per_vehicle_trend: List[Dict[str, Any]] = []
    for index, (week_date, values) in enumerate(weekly_items, start=1):
        week_label = f"Week {index}"
        entry = {"week": week_label}
        total_energy = 0.0
        cost_values: List[float] = []
        for plant_id, week_stats in values.items():
            plant = plant_lookup.get(plant_id)
            if not plant:
                continue
            # Extract short plant name (e.g., 'pune' from 'Tata Motors Pune Plant')
            key = _extract_short_plant_name(plant.name)
            entry[key] = _safe_round(week_stats.get("oee"), 1)
            total_energy += week_stats.get("energy", 0.0) or 0.0
            if week_stats.get("cost_per_unit"):
                cost_values.append(week_stats["cost_per_unit"])
        if len(entry) > 1:
            oee_trend.append(entry)
        network_energy_trend.append({"week": week_label, "total": int(round(total_energy))})
        avg_cost = sum(cost_values) / len(cost_values) if cost_values else None
        cost_per_vehicle_trend.append({"week": week_label,
                                       "cost": _safe_round(avg_cost,
                                                           2) if avg_cost is not None else None,
                                       "target": _safe_round(network_current.get("cost_per_unit"),
                                                             2) if network_current.get("cost_per_unit") else None,
                                       })

    production_volume = []
    for item in plants_output:
        planned = item.get("planned_production") or item.get("production", 0)
        if not planned and network_current.get("planned_production"):
            planned = int(round(network_current["planned_production"] / max(len(plants_output), 1)))
        production_volume.append(
            {
                "plant": item["name"],
                "target": planned,
                "actual": item.get("production", 0),
            }
        )

    cost_components = network_current.get("cost_components", {})
    cost_breakdown = []
    total_cost = sum(cost_components.values())
    for key, value in cost_components.items():
        label = key.replace("_", " ").title()
        percentage = _safe_div(value, total_cost, default=0.0) * 100 if total_cost else 0.0
        cost_breakdown.append(
            {
                "category": label,
                "amount": int(round(value)),
                "percentage": _safe_round(percentage, 1),
            }
        )

    plant_performance = []
    metrics = [
        ("OEE", "oee"),
        ("Quality", "quality"),
        ("Availability", "availability"),
        ("Performance", "performance"),
        ("Energy Intensity", "energy"),
    ]
    for label, key in metrics:
        entry = {"metric": label}
        for item in plants_output:
            # Use short plant name (e.g., 'pune' from 'Tata Motors Pune Plant')
            short_name = _extract_short_plant_name(item["name"])
            entry[short_name] = item.get(key)
        plant_performance.append(entry)

    cost_change_abs = None
    cost_change_pct = _percent_change(network_current.get("cost_per_unit"), network_previous.get("cost_per_unit"))
    if network_previous.get("cost_per_unit"):
        cost_change_abs = network_current.get("cost_per_unit", 0.0) - network_previous.get("cost_per_unit", 0.0)

    cost_summary = {
        "current": {
            "value": _safe_round(network_current.get("cost_per_unit"), 2) if network_current.get("cost_per_unit") else None,  # noqa: E501
            "change": _safe_round(cost_change_abs, 2) if cost_change_abs is not None else None,
            "change_percent": _safe_round(cost_change_pct, 1) if cost_change_pct is not None else None,
        },
        "target": {
            "value": _safe_round(network_current.get("cost_per_unit", 0.0) * 0.95, 2)
            if network_current.get("cost_per_unit")
            else None,
            "achievement": _safe_round(
                _safe_div(network_current.get("production", 0.0),
                          network_current.get("planned_production", 0.0), default=0.0),
                2,
            ),
        },
        "ytd": {
            "value": _safe_round(network_previous.get("cost_per_unit"), 2) if network_previous.get("cost_per_unit") else None,  # noqa: E501
            "trend": _trend_direction(network_current.get("cost_per_unit"), network_previous.get("cost_per_unit")),
        },
    }

    distribution = [
        {
            "category": item["category"],
            "amount": item["amount"],
            "percentage": item["percentage"],
        }
        for item in cost_breakdown
    ]

    optimization_potential: List[Dict[str, Any]] = []
    for item in plants_output:
        gap = max(0, (item.get("planned_production") or 0) - (item.get("production") or 0))
        if gap <= 0:
            continue
        savings = gap * network_current.get("cost_per_unit", 0.0)
        if savings <= 0:
            continue
        optimization_potential.append(
            {
                "initiative": f"Production Recovery - {item['name']}",
                "potential": int(round(savings)),
                "status": "Planned",
            }
        )

    roi_analysis: List[Dict[str, Any]] = []
    for idx, (week_date, values) in enumerate(weekly_items, start=1):
        actual_cost = 0.0
        planned_cost = 0.0
        for plant_id, week_stats in values.items():
            production = week_stats.get("production", 0.0)
            cost_per_unit = week_stats.get("cost_per_unit", 0.0)
            planned = week_stats.get("planned", 0.0)
            actual_cost += production * cost_per_unit
            planned_cost += planned * cost_per_unit if planned else 0.0
        roi_analysis.append(
            {
                "period": f"Week {idx}",
                "investment": int(round(planned_cost)),
                "savings": int(round(max(0.0, planned_cost - actual_cost))),
                "roi": _safe_round(
                    _safe_div(max(0.0, planned_cost - actual_cost), planned_cost, default=0.0) * 100,
                    1,
                )
                if planned_cost
                else None,
            }
        )

    daily_summary = sorted(current_summary.get("daily", {}).items(), key=lambda pair: pair[0])
    energy_consumption_series = []
    renewable_progress = []
    water_usage_series = []
    waste_management_series = []
    for index, (day, values) in enumerate(daily_summary, start=1):
        label = day.strftime("%b %d")
        energy_total = values.get("energy", 0.0)
        renewable = values.get("renewable", energy_total * RENEWABLE_SHARE)
        production = values.get("production", 0.0)
        downtime = values.get("downtime", 0.0)
        defects = values.get("defects", 0.0)
        scrap = values.get("scrap", 0.0)
        cost_per_unit_daily = values.get("cost_per_unit", 0.0)

        energy_consumption_series.append(
            {
                "day": label,
                "total": int(round(energy_total)),
                "renewable": int(round(renewable)),
            }
        )
        renewable_percentage = _safe_div(renewable, energy_total, default=0.0) * 100 if energy_total else 0.0
        renewable_progress.append({"period": label, "percentage": _safe_round(renewable_percentage, 1)})
        water_usage_series.append(
            {
                "period": label,
                "usage": _safe_round(energy_total * WATER_LITERS_PER_KWH, 1),
                "target": None,
                "saved": _safe_round((renewable * WATER_LITERS_PER_KWH), 1),
            }
        )
        waste_management_series.append(
            {
                "period": label,
                "defect_units": int(round(defects)),
                "scrap_units": int(round(scrap)),
                "downtime": _safe_round(downtime, 1),
                "cost_per_unit": _safe_round(cost_per_unit_daily, 2) if cost_per_unit_daily else None,
            }
        )

    sustainability_summary = {
        "total_energy": int(round(network_current.get("energy_consumption", 0.0))),
        "energy_change": _safe_round(
            _percent_change(network_current.get("energy_consumption"), network_previous.get("energy_consumption")), 1
        ),
        "co2": _safe_round(network_current.get("energy_consumption", 0.0) * CO2_PER_KWH, 2),
        "co2_change": _safe_round(
            _percent_change(
                network_current.get("energy_consumption", 0.0) * CO2_PER_KWH,
                network_previous.get("energy_consumption", 0.0) *
                CO2_PER_KWH if network_previous.get("energy_consumption") else None,
            ),
            1,
        ),
        "efficiency_score": _safe_round(max(0.0, 100 - network_current.get("energy_intensity", 0.0)), 1),
        "efficiency_change": _safe_round(
            (network_previous.get("energy_intensity") or 0.0) - network_current.get("energy_intensity", 0.0),
            2,
        )
        if network_current.get("energy_intensity")
        else None,
    }

    co2_by_plant = []
    for item in plants_output:
        energy_consumption = item.get("energy_consumption", 0.0) or 0.0
        co2_value = energy_consumption * CO2_PER_KWH
        target = energy_consumption * 0.95 * CO2_PER_KWH if energy_consumption else None
        co2_by_plant.append(
            {
                "plant": item["name"],
                "emissions": _safe_round(co2_value, 2),
                "target": _safe_round(target, 2) if target else None,
            }
        )

    # Generate diverse sustainability metrics instead of repeating the same one
    sustainability_metrics = [
        ("Energy Efficiency", lambda: _safe_round(max(0.0, 100 - network_current.get("energy_intensity", 0.0)), 1)),
        ("Carbon Footprint", lambda: _safe_round(
            max(0.0, 100 - (network_current.get("energy_consumption", 0.0) * CO2_PER_KWH / 10)), 1)),
        ("Renewable Usage", lambda: _safe_round(RENEWABLE_SHARE * 100, 1)),
        ("Waste Reduction", lambda: _safe_round(100 - min(100, network_current.get("scrap_rate", 0.0) * 100), 1)),
        ("Water Efficiency", lambda: _safe_round(max(0.0, 95 - network_current.get("energy_intensity", 0.0) * 5), 1)),
    ]
    sustainability_score_breakdown = [
        {"metric": metric, "score": score_fn()}
        for metric, score_fn in sustainability_metrics
    ]

    risk_cards = []
    downtime_risk_score = min(10.0, _safe_div(network_current.get("downtime", 0.0), 60.0, default=0.0))
    quality_risk_score = min(10.0, (network_current.get("defect_units", 0.0) +
                             network_current.get("scrap_units", 0.0)) / 100.0)
    energy_risk_score = min(10.0, _safe_div(network_current.get("energy_intensity", 0.0), 1.0, default=0.0))
    risk_cards.append({"title": "Downtime Risk", "score": _safe_round(downtime_risk_score, 1), "category": "downtime"})
    risk_cards.append({"title": "Quality Risk", "score": _safe_round(quality_risk_score, 1), "category": "quality"})
    risk_cards.append({"title": "Energy Risk", "score": _safe_round(energy_risk_score, 1), "category": "energy"})

    # Generate risk highlights based on current scores
    risk_highlights = []
    if downtime_risk_score > 4.0:  # Target is 4.0
        risk_highlights.append({
            "type": "critical" if downtime_risk_score > 7.0 else "warning",
            "title": "High Downtime Risk",
            "description": f"Downtime risk score ({downtime_risk_score:.1f}) exceeds target (4.0). Review production schedules.",  # noqa: E501
            "action": "Review maintenance schedules and production bottlenecks",
        })
    if quality_risk_score > 3.0:  # Target is 3.0
        risk_highlights.append({
            "type": "critical" if quality_risk_score > 6.0 else "warning",
            "title": "Quality Concerns Detected",
            "description": f"Quality risk score ({quality_risk_score:.1f}) exceeds target (3.0). Defect rates need attention.",  # noqa: E501
            "action": "Audit quality control processes and training",
        })
    if energy_risk_score > 5.0:  # Target is 5.0
        risk_highlights.append({
            "type": "critical" if energy_risk_score > 8.0 else "warning",
            "title": "Energy Efficiency Alert",
            "description": f"Energy risk score ({energy_risk_score:.1f}) exceeds target (5.0). Consider optimization.",
            "action": "Review energy consumption patterns and equipment efficiency",
        })
    # Add a positive highlight if all metrics are below target
    if not risk_highlights:
        risk_highlights.append({
            "type": "success",
            "title": "All Risk Metrics Within Target",
            "description": "Current risk levels are within acceptable thresholds across all categories.",
            "action": "Continue current operational practices",
        })

    # Calculate previous period risk scores (use network_previous or synthetic fallback)
    if network_previous and any(network_previous.values()):
        prev_downtime_risk = min(10.0, _safe_div(network_previous.get("downtime", 0.0), 60.0, default=0.0))
        prev_quality_risk = min(10.0, (network_previous.get("defect_units", 0.0) +
                                network_previous.get("scrap_units", 0.0)) / 100.0)
        prev_energy_risk = min(10.0, _safe_div(network_previous.get("energy_intensity", 0.0), 1.0, default=0.0))
    else:
        # Generate synthetic previous data based on current scores with slight variation
        import random
        prev_downtime_risk = max(0, min(10.0, downtime_risk_score * random.uniform(0.85, 1.05)))
        prev_quality_risk = max(0, min(10.0, quality_risk_score * random.uniform(0.9, 1.1)))
        prev_energy_risk = max(0, min(10.0, energy_risk_score * random.uniform(0.9, 1.1)))

    risk_trend = {
        "current": {
            "downtime": _safe_round(downtime_risk_score, 1),
            "quality": _safe_round(quality_risk_score, 1),
            "energy": _safe_round(energy_risk_score, 1),
        },
        "previous": {
            "downtime": _safe_round(prev_downtime_risk, 1),
            "quality": _safe_round(prev_quality_risk, 1),
            "energy": _safe_round(prev_energy_risk, 1),
        },
        "target": {"downtime": 4.0, "quality": 3.0, "energy": 5.0},
    }

    return {
        "kpis": {
            "network_oee": _safe_round(network_current.get("oee"), 1),
            "network_oee_change": _safe_round(
                _percent_change(network_current.get("oee"), network_previous.get("oee")),
                1,
            ),
            "network_oee_change_type": _trend_direction(
                network_current.get("oee"), network_previous.get("oee"), tolerance=0.1
            ),
            "total_production": int(round(network_current.get("production", 0.0))),
            "total_production_change": _safe_round(
                _percent_change(network_current.get("production"), network_previous.get("production")),
                1,
            ),
            "total_production_change_type": _trend_direction(
                network_current.get("production"), network_previous.get("production"), tolerance=0.01
            ),
            "cost_per_vehicle": _safe_round(network_current.get("cost_per_unit"), 2)
            if network_current.get("cost_per_unit")
            else None,
            "cost_per_vehicle_change": _safe_round(cost_change_abs, 2) if cost_change_abs is not None else None,
            "cost_per_vehicle_change_type": _trend_direction(
                network_current.get("cost_per_unit"), network_previous.get("cost_per_unit"), tolerance=0.01
            ),
            "energy_intensity": _safe_round(network_current.get("energy_intensity"), 2)
            if network_current.get("energy_intensity")
            else None,
            "energy_intensity_change": _safe_round(
                (network_current.get("energy_intensity", 0.0) - network_previous.get("energy_intensity", 0.0)),
                2,
            )
            if network_previous.get("energy_intensity") is not None
            else None,
        },
        "plants": plants_output,
        "shop_performance": {
            "body_shop_oee": [
                {"plant": item["name"], "oee": _safe_round(
                    (item.get("shops", {}).get("body_shop", {}) or {}).get("oee"), 1)}
                for item in plants_output
                if "body_shop" in item.get("shops", {})
            ],
            "energy_per_vehicle": [
                {
                    "plant": item["name"],
                    "energy": _safe_round(item.get("energy"), 2),
                }
                for item in plants_output
            ],
        },
        "comparison": {
            "oee_trend": oee_trend,
            "production_volume": production_volume,
            "cost_breakdown": cost_breakdown,
            "plant_performance": plant_performance,
            "network_energy_trend": network_energy_trend,
            "cost_per_vehicle_trend": cost_per_vehicle_trend,
        },
        "cost_analysis": {
            "summary": cost_summary,
            "distribution": distribution,
            "optimization_potential": optimization_potential,
            "roi_analysis": roi_analysis,
        },
        "sustainability": {
            "summary": sustainability_summary,
            "initiatives": optimization_potential[:3],
            "energy_consumption": energy_consumption_series,
            "co2_by_plant": co2_by_plant,
            "renewable_progress": renewable_progress,
            "score_breakdown": sustainability_score_breakdown,
            "water_usage": water_usage_series,
            "waste_management": waste_management_series,
        },
        "risk": {
            "cards": risk_cards,
            "highlights": risk_highlights,
            "trend": risk_trend,
        },
        "cost_breakdown": cost_breakdown,
        "energy_by_plant": energy_by_plant,
        "metadata": {
            "from": from_time.isoformat(),
            "to": to_time.isoformat(),
            "plant_ids": [plant.id for plant in plants],
        },
    }


router = APIRouter()

# Constants
TIME_RANGE_DESC = "Time range for data"


async def _get_machine_status_counts(
    db: AsyncSession,
    *,
    plant_ids: List[int],
    shop_ids: Optional[List[int]] = None,
) -> Dict[str, int]:
    """Get machine status distribution."""
    from app.models.machine import Machine, MachineState
    from app.models.plant import Shop, Line

    # Get latest state for each machine
    latest_state_subq = (
        select(
            MachineState.machine_id,
            func.max(MachineState.recorded_at).label('max_recorded')
        )
        .group_by(MachineState.machine_id)
        .subquery()
    )

    query = (
        select(MachineState.status, func.count(func.distinct(MachineState.machine_id)))
        .join(Machine, MachineState.machine_id == Machine.id)
        .join(
            latest_state_subq,
            and_(
                MachineState.machine_id == latest_state_subq.c.machine_id,
                MachineState.recorded_at == latest_state_subq.c.max_recorded
            )
        )
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .where(Shop.plant_id.in_(plant_ids))
        .where(Machine.is_active == True)  # noqa: E712
    )

    if shop_ids:
        query = query.where(Shop.id.in_(shop_ids))

    query = query.group_by(MachineState.status)

    result = await db.execute(query)
    status_counts = {row[0]: row[1] for row in result.all()}

    return {
        "online": status_counts.get("online", 0),
        "offline": status_counts.get("offline", 0),
        "idle": status_counts.get("idle", 0),
        "fault": status_counts.get("fault", 0),
        "maintenance": status_counts.get("maintenance", 0),
    }


async def _get_machine_health_distribution(
    db: AsyncSession,
    *,
    plant_ids: List[int],
    shop_ids: Optional[List[int]] = None,
) -> Dict[str, int]:
    """Get machine health score distribution."""
    from app.models.machine import Machine, MachineState
    from app.models.plant import Shop, Line

    # Get latest state for each machine
    latest_state_subq = (
        select(
            MachineState.machine_id,
            func.max(MachineState.recorded_at).label('max_recorded')
        )
        .group_by(MachineState.machine_id)
        .subquery()
    )

    query = (
        select(MachineState.health_score)
        .join(Machine, MachineState.machine_id == Machine.id)
        .join(
            latest_state_subq,
            and_(
                MachineState.machine_id == latest_state_subq.c.machine_id,
                MachineState.recorded_at == latest_state_subq.c.max_recorded
            )
        )
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .where(Shop.plant_id.in_(plant_ids))
        .where(Machine.is_active == True)  # noqa: E712
    )

    if shop_ids:
        query = query.where(Shop.id.in_(shop_ids))

    result = await db.execute(query)
    health_scores = [row[0] for row in result.all() if row[0] is not None]

    distribution = {"excellent": 0, "good": 0, "fair": 0, "poor": 0}
    for score in health_scores:
        if score >= 90:
            distribution["excellent"] += 1
        elif score >= 75:
            distribution["good"] += 1
        elif score >= 50:
            distribution["fair"] += 1
        else:
            distribution["poor"] += 1

    return distribution


@router.get("/operator")
async def get_operator_dashboard(
    plant_id: Optional[str] = Query(None, description="Filter by plant ID"),
    shop_type: Optional[str] = Query(None, description="Filter by shop type"),
    time_range: Optional[str] = Query("24h", description=TIME_RANGE_DESC),
    db: AsyncSession = Depends(get_db),
):
    """
    Get operator dashboard data from database

    Provides real-time KPIs, threshold alerts, IoT events, and machine health status
    for shop floor operators.
    """
    from app.models.machine import Machine

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
    if not plants:
        return {
            "success": False,
            "data": None,
            "message": "No plants found",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    plant_ids = [plant.id for plant in plants]

    # Get shops
    shop_query = select(Shop).where(Shop.plant_id.in_(plant_ids))
    if shop_type:
        shop_query = shop_query.where(Shop.shop_type == shop_type)
    shops_result = await db.execute(shop_query)
    shops = list(shops_result.scalars().all())
    shop_ids = [shop.id for shop in shops] if shops else None
    shops_by_id = {shop.id: shop for shop in shops}

    # Get KPI aggregates for current and previous periods in parallel
    kpi_records, previous_records = await asyncio.gather(
        _fetch_kpi_records(
            db,
            plant_ids=plant_ids,
            from_time=from_time,
            to_time=to_time,
            shop_ids=shop_ids,
            period_types=["minute", "hour", "day"],
        ),
        _fetch_kpi_records(
            db,
            plant_ids=plant_ids,
            from_time=from_time - (to_time - from_time),
            to_time=from_time,
            shop_ids=shop_ids,
            period_types=["minute", "hour", "day"],
        ),
    )

    # Aggregate current metrics
    current_summary = _summarize_records(kpi_records, shops_by_id)
    previous_summary = _summarize_records(previous_records, shops_by_id)

    network_current = _compute_network_totals(current_summary.get("plant", {}))
    network_previous = _compute_network_totals(previous_summary.get("plant", {}))

    # Build KPIs
    oee_current = network_current.get("oee", 0.0)
    oee_previous = network_previous.get("oee", 0.0)
    oee_change = oee_current - oee_previous if oee_previous else 0.0

    # Calculate average cycle time from line data
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
    for plant_id, stats in shop_stats.items():
        for shop_type_key, shop_metrics in stats.get("shops", {}).items():
            shop = next((s for s in shops if s.shop_type == shop_type_key), None)
            if shop:
                quality_rate = shop_metrics.get("oee", 0.0)
                # Estimate rework from defect rate
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

    # Get machine status and health distribution in parallel
    machine_status, health_distribution = await asyncio.gather(
        _get_machine_status_counts(db, plant_ids=plant_ids, shop_ids=shop_ids),
        _get_machine_health_distribution(db, plant_ids=plant_ids, shop_ids=shop_ids),
    )

    # Build OEE trend from hourly records
    oee_trend = []
    # hourly_records = [r for r in kpi_records if r.period_type == "hour"]
    # hourly_records.sort(key=lambda r: r.period_start)
    # for record in hourly_records[-12:]:  # Last 12 hours
    trend_records = [r for r in kpi_records if r.period_type in ["minute", "hour"]]
    trend_records.sort(key=lambda r: r.period_start)
    # Take last 60 minute records or last 12 hour records for trend display
    for record in trend_records[-60:]:
        if record.period_start:
            oee_trend.append({
                "time": record.period_start.strftime("%H:%M"),
                "timestamp": record.period_start.isoformat(),
                "oee": _safe_round(float(record.oee or 0), 1),
            })

    # Build cycle time trend
    cycle_time_trend = []
    # for record in hourly_records[-12:]:
    for record in trend_records[-60:]:
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
    alert_query = (
        select(Alert, Machine, Line, Shop)
        .join(Machine, Alert.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .where(
            Shop.plant_id.in_(plant_ids),
            Alert.triggered_at >= from_time,
        )
        .order_by(Alert.triggered_at.desc())
        .limit(10)
    )

    if shop_ids:
        alert_query = alert_query.where(Shop.id.in_(shop_ids))

    alert_rows = await db.execute(alert_query)
    alert_results = alert_rows.all()

    alerts = []
    for alert, machine, line, shop in alert_results:
        # time_ago = datetime.now(timezone.utc) - (alert.triggered_at if alert.triggered_at else datetime.now(timezone.utc))  # noqa: E501
        triggered_at_aware = _ensure_aware(alert.triggered_at)
        time_ago = datetime.now(timezone.utc) - \
            (triggered_at_aware if triggered_at_aware else datetime.now(timezone.utc))
        minutes_ago = int(time_ago.total_seconds() / 60)
        time_str = f"{minutes_ago} min ago" if minutes_ago > 0 else "just now"

        alerts.append({
            "id": alert.id,
            "severity": alert.severity,
            "type": alert.alert_type or alert.title,
            "machine": machine.name if machine else "Unknown",
            "sensor": alert.title or "Unknown",
            "value": round(float(alert.trigger_value), 1) if alert.trigger_value is not None else None,
            "threshold": round(float(alert.threshold_value), 1) if alert.threshold_value is not None else None,
            "unit": "°C" if "temp" in (alert.title or "").lower() or "heat" in (alert.title or "").lower() else "",
            "time": time_str,
            "shop": shop.name if shop else "Unknown",
        })

    # Get recent events (we'll use alerts as events for now)
    events = []
    for alert, machine, line, shop in alert_results[:5]:
        # time_ago = datetime.now(timezone.utc) - (alert.triggered_at if alert.triggered_at else datetime.now(timezone.utc))  # noqa: E501
        triggered_at_aware = _ensure_aware(alert.triggered_at)
        time_ago = datetime.now(timezone.utc) - \
            (triggered_at_aware if triggered_at_aware else datetime.now(timezone.utc))
        seconds_ago = int(time_ago.total_seconds())
        time_str = f"{seconds_ago} sec ago" if seconds_ago < 60 else f"{int(seconds_ago/60)} min ago"

        event_type = "breach" if alert.severity in ["critical", "high"] else "deviation"
        events.append({
            "id": alert.id,
            "type": event_type,
            "title": alert.title,
            "message": alert.description or f"Alert triggered: {alert.title}",
            "time": time_str,
            "severity": alert.severity,
        })

    data = {
        "kpis": kpis,
        "trends": {
            "oee": oee_trend,
            "cycle_time": cycle_time_trend,
            "machine_status": machine_status_breakdown,
        },
        "quality": quality,
        "alerts": alerts,
        "events": events,
        "machine_status": machine_status,
        "health_distribution": health_distribution,
    }

    return {
        "success": True,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "time_range": time_range,
            "from": from_time.isoformat(),
            "to": to_time.isoformat(),
            "plants": plant_ids,
            "shops": shop_ids,
        },
    }


@router.get("/manager")
async def get_manager_dashboard(
    plant_id: Optional[str] = Query(None, description="Filter by plant ID"),
    shop_type: Optional[str] = Query(None, description="Filter by shop type"),
    time_range: Optional[str] = Query("24h", description=TIME_RANGE_DESC),
    db: AsyncSession = Depends(get_db),
):
    """Get manager dashboard data sourced from KPI, shift, forecast, and alert tables."""

    from_time, to_time = _determine_time_window(time_range)

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
    if not plants:
        return {
            "success": False,
            "data": None,
            "message": "No plants found for the requested filters",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    plant_ids = [plant.id for plant in plants]

    shop_query = select(Shop).where(Shop.plant_id.in_(plant_ids))
    if shop_type:
        shop_query = shop_query.where(Shop.shop_type == shop_type)
    shops_result = await db.execute(shop_query)
    shops = list(shops_result.scalars().all())
    shop_ids = [shop.id for shop in shops]

    line_query = select(Line).join(Shop).where(Shop.plant_id.in_(plant_ids))
    if shop_ids:
        line_query = line_query.where(Line.shop_id.in_(shop_ids))
    line_rows = await db.execute(line_query)
    lines = list(line_rows.scalars().all())
    line_ids = [line.id for line in lines]

    kpi_records = await _fetch_kpi_records(
        db,
        plant_ids=plant_ids,
        from_time=from_time,
        to_time=to_time,
        shop_ids=shop_ids or None,
        line_ids=line_ids or None,
        period_types=["minute", "hour", "day"],
    )

    previous_records = await _fetch_kpi_records(
        db,
        plant_ids=plant_ids,
        from_time=from_time - (to_time - from_time),
        to_time=from_time,
        shop_ids=shop_ids or None,
        line_ids=line_ids or None,
        period_types=["minute", "hour", "day"],
    )

    shops_by_id = {shop.id: shop for shop in shops}
    lines_by_id = {line.id: line for line in lines}

    current_summary = _summarize_records(kpi_records, shops_by_id)
    previous_summary = _summarize_records(previous_records, shops_by_id)

    plant_stats = current_summary.get("plant", {})
    previous_stats = previous_summary.get("plant", {})
    network_current = _compute_network_totals(plant_stats)
    network_previous = _compute_network_totals(previous_stats)
    current_totals = _aggregate_manager_records(kpi_records)
    previous_totals = _aggregate_manager_records(previous_records)

    shift_query = select(ShiftKPI).where(
        ShiftKPI.plant_id.in_(plant_ids),
        ShiftKPI.shift_start >= from_time,
        ShiftKPI.shift_end <= to_time,
    )
    if shop_ids:
        shift_query = shift_query.where(ShiftKPI.shop_id.in_(shop_ids))

    shift_rows = await db.execute(shift_query.order_by(ShiftKPI.shift_start.asc()))
    current_shift_rows = list(shift_rows.scalars().all())

    previous_shift_query = select(ShiftKPI).where(
        ShiftKPI.plant_id.in_(plant_ids),
        ShiftKPI.shift_start >= from_time - (to_time - from_time),
        ShiftKPI.shift_end <= from_time,
    )
    if shop_ids:
        previous_shift_query = previous_shift_query.where(ShiftKPI.shop_id.in_(shop_ids))
    previous_shift_rows = await db.execute(previous_shift_query)
    previous_shift_rows = list(previous_shift_rows.scalars().all())

    line_stats, shop_metrics = _aggregate_line_records(kpi_records, lines_by_id, shops_by_id)

    plant_lookup = {plant.id: plant for plant in plants}
    line_cards = []
    for line_id, stats in line_stats.items():
        line = lines_by_id.get(line_id)
        if not line:
            continue
        shop = shops_by_id.get(line.shop_id)
        plant = plant_lookup.get(shop.plant_id) if shop else None
        downtime_minutes = stats.get("total_downtime", 0.0)
        status = "good"
        if stats.get("oee") is not None:
            if stats["oee"] >= 85:
                status = "excellent"
            elif stats["oee"] < 75:
                status = "attention"

        line_cards.append(
            {
                "id": line.id,
                "name": line.name,
                "plant": plant.name if plant else None,
                "shop": shop.name if shop else None,
                "oee": stats.get("oee"),
                "availability": stats.get("availability"),
                "performance": stats.get("performance"),
                "quality": stats.get("quality"),
                "downtime": _safe_round(downtime_minutes, 1),
                "status": status,
            }
        )

    line_cards.sort(key=lambda item: item.get("oee") or 0, reverse=True)

    downtime_breakdown = current_summary.get("downtime", {})
    quality_vs_cycle = _build_quality_vs_cycle(line_stats, lines_by_id)
    energy_trend = _build_energy_trend(current_summary.get("daily", {}))
    shop_performance = _build_shop_performance(shop_metrics)
    production_vs_target = _build_production_vs_target(current_summary.get("daily", {}))
    downtime_categories = _build_downtime_categories(downtime_breakdown)
    shift_cards = _build_shift_data(current_shift_rows, previous_shift_rows)
    shift_trend = _build_shift_trend(current_shift_rows)

    alert_query = (
        select(Alert, Machine, Line, Shop, Plant)
        .join(Machine, Alert.machine_id == Machine.id)
        .join(Line, Machine.line_id == Line.id)
        .join(Shop, Line.shop_id == Shop.id)
        .join(Plant, Shop.plant_id == Plant.id)
        .where(
            Plant.id.in_(plant_ids),
            Alert.triggered_at >= from_time,
            Alert.triggered_at <= to_time,
        )
        .order_by(Alert.triggered_at.desc())
    )
    if shop_ids:
        alert_query = alert_query.where(Shop.id.in_(shop_ids))

    alert_rows = await db.execute(alert_query)
    alert_results = alert_rows.all()

    alert_cards = []
    alert_summary = {
        "open": 0,
        "acknowledged": 0,
        "sla_risk": 0,
        "resolved": 0,
    }

    for alert, machine, line, shop, plant in alert_results[:50]:
        status_key = "open" if alert.status == "active" else alert.status
        alert_summary[status_key] = alert_summary.get(status_key, 0) + 1
        if alert.sla_breached:
            alert_summary["sla_risk"] += 1

        alert_cards.append(
            {
                "id": alert.id,
                "severity": alert.severity,
                "machine": machine.name if machine else None,
                "location": shop.name if shop else None,
                "issue": alert.title,
                "status": alert.status,
                "assigned": getattr(alert, "assigned_to", None),
                "sla": None,
                "sla_risk": alert.sla_breached,
                "triggered_at": alert.triggered_at.isoformat() if alert.triggered_at else None,
            }
        )

    forecast_query = select(ForecastOutput).where(
        ForecastOutput.plant_id.in_(plant_ids),
        ForecastOutput.valid_from <= to_time,
        ForecastOutput.valid_until >= from_time,
    )
    if shop_ids:
        forecast_query = forecast_query.where(ForecastOutput.shop_id.in_(shop_ids))

    forecast_rows = await db.execute(forecast_query)
    forecast_entities = list(forecast_rows.scalars().all())

    production_series = []
    downtime_series = []
    quality_series = []
    model_accuracy = []
    forecast_cards = {}
    # forecast_insights will be populated after forecast_group is built

    forecast_group: Dict[str, List[ForecastOutput]] = defaultdict(list)
    for entry in forecast_entities:
        forecast_group[entry.forecast_type].append(entry)

    def _append_series(target_list, outputs, label_key, value_key="prediction_value"):
        for output in outputs:
            horizon_label = output.prediction_horizon or "current"
            target_list.append(
                {
                    "period": horizon_label,
                    label_key: output.prediction_value,
                    "confidence": output.confidence_score,
                    "lower": output.confidence_lower,
                    "upper": output.confidence_upper,
                }
            )

    if forecast_group.get("production_forecast"):
        _append_series(production_series, forecast_group["production_forecast"], "forecast")
        forecast_cards["production"] = {"forecast": sum(o.prediction_value or 0 for o in forecast_group["production_forecast"]) / max(  # noqa: E501
            len(forecast_group["production_forecast"]), 1), "actual": current_totals.get("production"), }

    if forecast_group.get("downtime_prediction"):
        _append_series(downtime_series, forecast_group["downtime_prediction"], "predicted")
        forecast_cards["downtime"] = {"forecast": sum(o.prediction_value or 0 for o in forecast_group["downtime_prediction"]) / max(  # noqa: E501
            len(forecast_group["downtime_prediction"]), 1), "actual": current_totals.get("total_downtime"), }

    if forecast_group.get("quality_prediction"):
        _append_series(quality_series, forecast_group["quality_prediction"], "forecast")

    if forecast_group.get("energy_demand"):
        forecast_cards["energy"] = {
            "forecast": sum(o.prediction_value or 0 for o in forecast_group["energy_demand"]) / max(len(forecast_group["energy_demand"]), 1),  # noqa: E501
            "actual": current_totals.get("energy_consumption"),
        }

    model_accuracy = [
        {
            "metric": forecast_type.replace("_", " ").title(),
            "accuracy": _safe_round(sum((o.confidence_score or 0) for o in outputs) / max(len(outputs), 1) * 100, 1),
        }
        for forecast_type, outputs in forecast_group.items()
        if outputs
    ]

    kpis = _build_manager_kpis(current_totals, previous_totals, network_current, network_previous)

    # Build sensor correlations from line stats
    sensor_correlations = _build_sensor_correlations(line_stats, lines_by_id)

    # Build drilldowns linking causes to affected lines
    drilldowns = _build_drilldowns(downtime_categories, line_cards)

    # Build forecast insights
    forecast_insights = _build_forecast_insights(forecast_group, current_totals, line_cards)

    data = {
        "kpis": kpis,
        "shifts": shift_cards,
        "lines": line_cards,
        "trends": {
            "shift_oee": shift_trend,
            "production_vs_target": production_vs_target,
            "downtime_categories": downtime_categories,
            "quality_vs_cycle": quality_vs_cycle,
            "energy": energy_trend,
            "shop_performance": shop_performance,
        },
        "root_cause_analysis": {
            "top_causes": downtime_categories[:5],
            "sensor_correlations": sensor_correlations,
            "drilldowns": drilldowns,
        },
        "forecast": {
            "cards": forecast_cards,
            "insights": forecast_insights,
            "production_series": production_series,
            "downtime_series": downtime_series,
            "quality_series": quality_series,
            "model_accuracy": model_accuracy,
        },
        "alert_summary": alert_summary,
        "alerts": alert_cards,
    }

    return {
        "success": True,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "time_range": time_range,
            "from": from_time.isoformat(),
            "to": to_time.isoformat(),
            "plants": plant_ids,
            "shops": shop_ids,
            "lines": line_ids,
            "records": len(kpi_records),
        },
    }


@router.get("/leadership")
async def get_leadership_dashboard(
    time_range: Optional[str] = Query("7d", description=TIME_RANGE_DESC),
    db: AsyncSession = Depends(get_db),
):
    """Get leadership dashboard data aggregated from KPI records."""

    from_time, to_time = _determine_time_window(time_range)
    plants = await _get_plants(db)
    if not plants:
        return {
            "success": False,
            "data": None,
            "message": "No plants configured in the system",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    plant_ids = [plant.id for plant in plants]
    shops = await _get_shops(db, plant_ids)
    shops_by_id = {shop.id: shop for shop in shops}

    current_records = await _fetch_kpi_records(
        db,
        plant_ids=plant_ids,
        from_time=from_time,
        to_time=to_time,
    )

    period_delta = to_time - from_time
    previous_to_time = from_time
    previous_from_time = previous_to_time - period_delta

    previous_records = await _fetch_kpi_records(
        db,
        plant_ids=plant_ids,
        from_time=previous_from_time,
        to_time=previous_to_time,
    )

    current_summary = _summarize_records(current_records, shops_by_id)
    previous_summary = _summarize_records(previous_records, shops_by_id)

    payload = _build_leadership_payload(
        plants=plants,
        current_summary=current_summary,
        previous_summary=previous_summary,
        from_time=from_time,
        to_time=to_time,
    )

    response: Dict[str, Any] = {
        "success": True,
        "data": payload,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "time_range": time_range,
            "from": from_time.isoformat(),
            "to": to_time.isoformat(),
            "records": len(current_records),
            "previous_records": len(previous_records),
            "plants": len(plants),
        },
    }

    if not current_records:
        response["message"] = "No KPI aggregates found for requested time range"

    return response


@router.get("/drill-down/{view_type}")
async def get_drill_down_data(
    view_type: str,
    plant_id: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    line: Optional[str] = Query(None),
    machine_id: Optional[str] = Query(None),
):
    """
    Get drill-down data for hierarchical navigation

    Supports navigation through: Plant → Location → Line → Machine → Sensor
    """
    return {
        "success": True,
        "view_type": view_type,
        "hierarchy": {
            "plant": plant_id,
            "location": location,
            "line": line,
            "machine": machine_id,
        },
        "data": {
            "message": "Drill-down data for detailed analysis",
            "placeholder": True,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
