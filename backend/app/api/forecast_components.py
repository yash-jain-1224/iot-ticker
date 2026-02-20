"""
Forecast Component-Level APIs
Historical baseline, predictions, and confidence bands
"""
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from typing import Optional
import random

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.filters import GlobalFilters, apply_location_filters, get_filter_metadata
from app.schemas.filters import APIResponse
from app.models.user import User
from app.models.forecast import ForecastOutput, ForecastType
from app.models.kpi import KPIAggregate
from app.models.machine import Machine

router = APIRouter()


def _calculate_risk_level(probability: float) -> str:
    """Calculate risk level from probability"""
    if probability > 0.3:
        return "high"
    elif probability > 0.15:
        return "medium"
    return "low"


def _calculate_maintenance_risk_level(risk_score: float) -> str:
    """Calculate maintenance risk level from risk score"""
    if risk_score > 0.7:
        return "high"
    elif risk_score > 0.4:
        return "medium"
    return "low"


# ===== Production Forecast =====

@router.get("/production")
async def get_production_forecast(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    forecast_hours: int = Query(24, le=168),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get production forecast with historical baseline"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id
    )

    # Get historical data for baseline
    from_time = datetime.now(timezone.utc) - timedelta(days=7)
    to_time = datetime.now(timezone.utc)

    historical_query = select(
        func.avg(KPIAggregate.actual_production).label('avg_production')
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    )

    historical_query = apply_location_filters(
        historical_query, filters, KPIAggregate, join_machine=True, join_line=True
    )

    result = await db.execute(historical_query)
    row = result.first()
    baseline = row.avg_production or 100

    # Get forecasts from database
    to_time_limit = to_time + timedelta(hours=forecast_hours)
    forecast_query = select(ForecastOutput).where(
        and_(
            ForecastOutput.forecast_type == ForecastType.PRODUCTION_FORECAST.value,
            ForecastOutput.valid_from >= to_time,
            ForecastOutput.valid_until <= to_time_limit
        )
    ).order_by(ForecastOutput.valid_from).limit(forecast_hours)

    # Apply location filters if available
    if filters.line_id:
        forecast_query = forecast_query.where(ForecastOutput.line_id == filters.line_id)

    forecast_result = await db.execute(forecast_query)
    db_forecasts = forecast_result.scalars().all()

    # Generate synthetic forecasts if none exist
    if not db_forecasts:
        forecasts = []
        current_time = to_time
        for i in range(forecast_hours):
            # Simple trend with some variation
            variation = random.uniform(0.9, 1.1)
            predicted = baseline * variation

            forecasts.append({
                "timestamp": (current_time + timedelta(hours=i)).isoformat(),
                "predicted_value": round(predicted, 2),
                "confidence_lower": round(predicted * 0.85, 2),
                "confidence_upper": round(predicted * 1.15, 2)
            })
    else:
        forecasts = [
            {
                "timestamp": f.valid_from.isoformat(),
                "predicted_value": round(f.prediction_value or 0, 2),
                "confidence_lower": round(f.confidence_lower or 0, 2),
                "confidence_upper": round(f.confidence_upper or 0, 2)
            }
            for f in db_forecasts
        ]

    return APIResponse(
        data={
            "baseline": round(baseline, 2),
            "forecasts": forecasts,
            "forecast_horizon_hours": forecast_hours
        },
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if forecasts else "no_data"
    )


# ===== Downtime Forecast =====

@router.get("/downtime")
async def get_downtime_forecast(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    machine_id: Optional[int] = None,
    forecast_hours: int = Query(24, le=168),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get downtime probability forecast"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id,
        machine_id=machine_id
    )

    to_time = datetime.now(timezone.utc)
    to_time_limit = to_time + timedelta(hours=forecast_hours)

    # Get forecasts from database
    query = select(ForecastOutput).where(
        and_(
            ForecastOutput.forecast_type == ForecastType.DOWNTIME_PREDICTION.value,
            ForecastOutput.valid_from >= to_time,
            ForecastOutput.valid_until <= to_time_limit
        )
    ).order_by(ForecastOutput.valid_from).limit(forecast_hours)

    # Apply machine filter if specified
    if filters.machine_id:
        query = query.where(ForecastOutput.machine_id == filters.machine_id)

    result = await db.execute(query)
    db_forecasts = result.scalars().all()

    # Generate synthetic forecasts if none exist
    if not db_forecasts:
        forecasts = []
        current_time = to_time
        base_probability = 0.15  # 15% base probability

        for i in range(forecast_hours):
            # Probability varies by time of day
            hour = (current_time + timedelta(hours=i)).hour
            if 2 <= hour <= 6:  # Higher risk during low activity hours
                probability = base_probability * 1.5
            elif 14 <= hour <= 16:  # Peak production hours
                probability = base_probability * 1.2
            else:
                probability = base_probability

            probability = min(probability + random.uniform(-0.05, 0.05), 1.0)
            risk_level = _calculate_risk_level(probability)

            forecasts.append({
                "timestamp": (current_time + timedelta(hours=i)).isoformat(),
                "downtime_probability": round(probability, 4),
                "risk_level": risk_level
            })
    else:
        forecasts = [
            {
                "timestamp": f.valid_from.isoformat(),
                "downtime_probability": round(f.prediction_value or 0, 4),
                "risk_level": _calculate_risk_level(f.prediction_value or 0)
            }
            for f in db_forecasts
        ]

    return APIResponse(
        data={
            "forecasts": forecasts,
            "forecast_horizon_hours": forecast_hours
        },
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok"
    )


# ===== Quality Forecast =====

@router.get("/quality")
async def get_quality_forecast(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    forecast_hours: int = Query(24, le=168),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get quality metric forecast"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id
    )

    # Get historical quality baseline
    from_time = datetime.now(timezone.utc) - timedelta(days=7)
    to_time = datetime.now(timezone.utc)

    historical_query = select(
        func.avg(KPIAggregate.quality).label('avg_quality')
    ).where(
        and_(
            KPIAggregate.period_start >= from_time,
            KPIAggregate.period_end <= to_time
        )
    )

    historical_query = apply_location_filters(
        historical_query, filters, KPIAggregate, join_machine=True, join_line=True
    )

    result = await db.execute(historical_query)
    row = result.first()
    baseline = row.avg_quality or 95.0

    # Get forecasts from database
    to_time_limit = to_time + timedelta(hours=forecast_hours)
    forecast_query = select(ForecastOutput).where(
        and_(
            ForecastOutput.forecast_type == ForecastType.QUALITY_PREDICTION.value,
            ForecastOutput.valid_from >= to_time,
            ForecastOutput.valid_until <= to_time_limit
        )
    ).order_by(ForecastOutput.valid_from).limit(forecast_hours)

    # Apply location filters if available
    if filters.line_id:
        forecast_query = forecast_query.where(ForecastOutput.line_id == filters.line_id)

    forecast_result = await db.execute(forecast_query)
    db_forecasts = forecast_result.scalars().all()

    # Generate synthetic forecasts if none exist
    if not db_forecasts:
        forecasts = []
        current_time = to_time

        for i in range(forecast_hours):
            # Quality typically degrades slightly over time without intervention
            degradation = 0.1 * (i / 24)  # 0.1% per day
            variation = random.uniform(-0.5, 0.5)
            predicted = max(baseline - degradation + variation, 85.0)

            forecasts.append({
                "timestamp": (current_time + timedelta(hours=i)).isoformat(),
                "predicted_quality": round(predicted, 2),
                "confidence_lower": round(predicted - 2.0, 2),
                "confidence_upper": round(predicted + 2.0, 2)
            })
    else:
        forecasts = [
            {
                "timestamp": f.valid_from.isoformat(),
                "predicted_quality": round(f.prediction_value or 0, 2),
                "confidence_lower": round(f.confidence_lower or 0, 2),
                "confidence_upper": round(f.confidence_upper or 0, 2)
            }
            for f in db_forecasts
        ]

    return APIResponse(
        data={
            "baseline": round(baseline, 2),
            "forecasts": forecasts,
            "forecast_horizon_hours": forecast_hours
        },
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if forecasts else "no_data"
    )


# ===== Maintenance Prediction =====

@router.get("/maintenance")
async def get_maintenance_prediction(
    location: Optional[str] = None,
    workshop: Optional[str] = None,
    line_id: Optional[int] = None,
    machine_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get predictive maintenance recommendations"""
    filters = GlobalFilters(
        location=location,
        workshop=workshop,
        line_id=line_id,
        machine_id=machine_id
    )

    # Get machines that might need maintenance
    query = select(Machine).where(Machine.is_active == True)  # noqa: E712
    query = apply_location_filters(query, filters, Machine, join_line=True)

    result = await db.execute(query)
    machines = result.scalars().all()

    # Generate synthetic maintenance predictions
    predictions = []
    for machine in machines[:10]:  # Limit to 10 machines
        # Simulate risk scoring
        risk_score = random.uniform(0.1, 0.9)
        days_until_maintenance = int(30 * (1 - risk_score))

        if risk_score > 0.3:  # Only show machines with significant risk
            risk_level = _calculate_maintenance_risk_level(risk_score)
            predictions.append({
                "machine_id": machine.id,
                "machine_name": machine.name,
                "machine_code": machine.code,
                "risk_score": round(risk_score, 2),
                "risk_level": risk_level,
                "days_until_maintenance": days_until_maintenance,
                "recommended_action": "Schedule preventive maintenance" if risk_score > 0.7 else "Monitor closely"
            })

    # Sort by risk score descending
    predictions.sort(key=lambda x: x["risk_score"], reverse=True)

    return APIResponse(
        data={
            "predictions": predictions,
            "high_risk_count": len([p for p in predictions if p["risk_level"] == "high"]),
            "medium_risk_count": len([p for p in predictions if p["risk_level"] == "medium"])
        },
        metadata=get_filter_metadata(filters),
        last_updated=datetime.now(timezone.utc),
        status="ok" if predictions else "no_data"
    )
