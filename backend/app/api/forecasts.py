"""
Forecasts API routes
"""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List

from app.core.database import get_db
from app.core.security import require_manager
from app.models.forecast import ForecastOutput
from app.models.machine import Machine
from app.models.plant import Line, Shop, Plant, ShopType
from app.models.user import User

router = APIRouter()


# Schemas
class ForecastCreate(BaseModel):
    machine_id: Optional[int] = None
    plant_id: Optional[int] = None
    shop_id: Optional[int] = None
    line_id: Optional[int] = None
    forecast_type: str
    model_name: Optional[str] = None
    model_version: Optional[str] = None
    prediction_value: Optional[float] = None
    prediction_unit: Optional[str] = None
    confidence_score: Optional[float] = None
    confidence_lower: Optional[float] = None
    confidence_upper: Optional[float] = None
    prediction_horizon: Optional[str] = None
    valid_from: datetime
    valid_until: datetime
    risk_level: Optional[str] = None
    risk_score: Optional[float] = None
    explanation: Optional[str] = None
    recommendations: Optional[List[str]] = None


class ForecastResponse(BaseModel):
    id: int
    machine_id: Optional[int]
    plant_id: Optional[int]
    shop_id: Optional[int]
    line_id: Optional[int]
    forecast_type: str
    model_name: Optional[str]
    prediction_value: Optional[float]
    prediction_unit: Optional[str]
    confidence_score: Optional[float]
    prediction_horizon: Optional[str]
    valid_from: datetime
    valid_until: datetime
    risk_level: Optional[str]
    risk_score: Optional[float]
    explanation: Optional[str]
    generated_at: datetime

    class Config:
        from_attributes = True


@router.get("/", response_model=list[ForecastResponse])
async def get_forecasts(
    forecast_type: Optional[str] = None,
    machine_id: Optional[int] = None,
    plant_id: Optional[int] = None,
    plant_code: Optional[str] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    risk_level: Optional[str] = None,
    valid_only: bool = True,
    limit: int = Query(100, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager)
):
    """Get forecasts with filters"""
    now = datetime.now(timezone.utc)

    query = select(ForecastOutput)

    if valid_only:
        query = query.where(
            ForecastOutput.valid_from <= now,
            ForecastOutput.valid_until >= now
        )

    if forecast_type:
        query = query.where(ForecastOutput.forecast_type == forecast_type)

    if machine_id:
        query = query.where(ForecastOutput.machine_id == machine_id)

    # Apply location filters
    if plant_code:
        # Need to resolve plant_code to plant_id
        plant_result = await db.execute(select(Plant).where(Plant.code == plant_code))
        plant = plant_result.scalar_one_or_none()
        if plant:
            query = query.where(ForecastOutput.plant_id == plant.id)
    elif plant_id:
        query = query.where(ForecastOutput.plant_id == plant_id)

    if shop_type:
        # Need to resolve shop_type to shop_ids
        try:
            shop_type_enum = ShopType(shop_type)
            shop_result = await db.execute(select(Shop.id).where(Shop.shop_type == shop_type_enum))
            shop_ids = [s[0] for s in shop_result.all()]
            if shop_ids:
                query = query.where(ForecastOutput.shop_id.in_(shop_ids))
        except ValueError:
            pass
    elif shop_id:
        query = query.where(ForecastOutput.shop_id == shop_id)

    if risk_level:
        query = query.where(ForecastOutput.risk_level == risk_level)

    query = query.order_by(ForecastOutput.generated_at.desc()).limit(limit)

    result = await db.execute(query)
    forecasts = result.scalars().all()

    return forecasts


@router.get("/failure-probability")
async def get_failure_probability_forecasts(
    plant_id: Optional[int] = None,
    plant_code: Optional[str] = None,
    shop_id: Optional[int] = None,
    shop_type: Optional[str] = None,
    risk_threshold: float = Query(0.5, ge=0, le=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager)
):
    """Get machine failure probability forecasts"""
    now = datetime.now(timezone.utc)

    query = select(ForecastOutput).where(
        ForecastOutput.forecast_type == "failure_probability",
        ForecastOutput.valid_from <= now,
        ForecastOutput.valid_until >= now
    )

    # Apply location filters with joins
    if shop_type or plant_code or shop_id or plant_id:
        query = query.join(Machine).join(Line).join(Shop)

        if shop_id:
            query = query.where(Shop.id == shop_id)
        elif shop_type:
            try:
                shop_type_enum = ShopType(shop_type)
                query = query.where(Shop.shop_type == shop_type_enum)
            except ValueError:
                pass

        if plant_code:
            query = query.join(Plant).where(Plant.code == plant_code)
        elif plant_id:
            query = query.where(Shop.plant_id == plant_id)

    query = query.order_by(ForecastOutput.prediction_value.desc())

    result = await db.execute(query)
    forecasts = result.scalars().all()

    # Filter by risk threshold
    high_risk = [f for f in forecasts if (f.prediction_value or 0) >= risk_threshold]

    return {
        "total_machines": len(forecasts),
        "high_risk_count": len(high_risk),
        "forecasts": [
            {
                "machine_id": f.machine_id,
                "failure_probability": f.prediction_value,
                "confidence": f.confidence_score,
                "risk_level": f.risk_level,
                "prediction_horizon": f.prediction_horizon,
                "valid_until": f.valid_until.isoformat(),
                "recommendations": f.recommendations,
                "explanation": f.explanation,
            }
            for f in forecasts
        ],
    }


@router.get("/production-forecast")
async def get_production_forecasts(
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    horizon: str = "24h",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager)
):
    """Get production forecasts"""
    now = datetime.now(timezone.utc)

    query = select(ForecastOutput).where(
        ForecastOutput.forecast_type == "production_forecast",
        ForecastOutput.prediction_horizon == horizon,
        ForecastOutput.valid_from <= now,
        ForecastOutput.valid_until >= now
    )

    if shop_id:
        query = query.where(ForecastOutput.shop_id == shop_id)
    elif plant_id:
        query = query.where(ForecastOutput.plant_id == plant_id)

    query = query.order_by(ForecastOutput.generated_at.desc())

    result = await db.execute(query)
    forecasts = result.scalars().all()

    return [
        {
            "plant_id": f.plant_id,
            "shop_id": f.shop_id,
            "line_id": f.line_id,
            "predicted_units": f.prediction_value,
            "confidence_lower": f.confidence_lower,
            "confidence_upper": f.confidence_upper,
            "confidence_score": f.confidence_score,
            "horizon": f.prediction_horizon,
            "valid_until": f.valid_until.isoformat(),
        }
        for f in forecasts
    ]


@router.get("/energy-demand")
async def get_energy_demand_forecasts(
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    horizon: str = "24h",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager)
):
    """Get energy demand forecasts"""
    now = datetime.now(timezone.utc)

    query = select(ForecastOutput).where(
        ForecastOutput.forecast_type == "energy_demand",
        ForecastOutput.prediction_horizon == horizon,
        ForecastOutput.valid_from <= now,
        ForecastOutput.valid_until >= now
    )

    if shop_id:
        query = query.where(ForecastOutput.shop_id == shop_id)
    elif plant_id:
        query = query.where(ForecastOutput.plant_id == plant_id)

    query = query.order_by(ForecastOutput.generated_at.desc())

    result = await db.execute(query)
    forecasts = result.scalars().all()

    return [
        {
            "plant_id": f.plant_id,
            "shop_id": f.shop_id,
            "predicted_kwh": f.prediction_value,
            "confidence_lower": f.confidence_lower,
            "confidence_upper": f.confidence_upper,
            "confidence_score": f.confidence_score,
            "horizon": f.prediction_horizon,
            "valid_until": f.valid_until.isoformat(),
        }
        for f in forecasts
    ]


@router.get("/machine/{machine_id}")
async def get_machine_forecasts(
    machine_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager)
):
    """Get all forecasts for a specific machine"""
    now = datetime.now(timezone.utc)

    result = await db.execute(
        select(ForecastOutput)
        .where(
            ForecastOutput.machine_id == machine_id,
            ForecastOutput.valid_from <= now,
            ForecastOutput.valid_until >= now
        )
        .order_by(ForecastOutput.forecast_type, ForecastOutput.generated_at.desc())
    )
    forecasts = result.scalars().all()

    # Group by forecast type
    grouped = {}
    for f in forecasts:
        if f.forecast_type not in grouped:
            grouped[f.forecast_type] = {
                "forecast_type": f.forecast_type,
                "prediction_value": f.prediction_value,
                "prediction_unit": f.prediction_unit,
                "confidence_score": f.confidence_score,
                "risk_level": f.risk_level,
                "risk_score": f.risk_score,
                "prediction_horizon": f.prediction_horizon,
                "valid_until": f.valid_until.isoformat(),
                "explanation": f.explanation,
                "recommendations": f.recommendations,
                "model_name": f.model_name,
                "generated_at": f.generated_at.isoformat(),
            }

    return list(grouped.values())


@router.post("/", response_model=ForecastResponse)
async def create_forecast(
    forecast_data: ForecastCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a new forecast (called by ML pipeline)"""
    forecast = ForecastOutput(
        machine_id=forecast_data.machine_id,
        plant_id=forecast_data.plant_id,
        shop_id=forecast_data.shop_id,
        line_id=forecast_data.line_id,
        forecast_type=forecast_data.forecast_type,
        model_name=forecast_data.model_name,
        model_version=forecast_data.model_version,
        prediction_value=forecast_data.prediction_value,
        prediction_unit=forecast_data.prediction_unit,
        confidence_score=forecast_data.confidence_score,
        confidence_lower=forecast_data.confidence_lower,
        confidence_upper=forecast_data.confidence_upper,
        prediction_horizon=forecast_data.prediction_horizon,
        valid_from=forecast_data.valid_from,
        valid_until=forecast_data.valid_until,
        risk_level=forecast_data.risk_level,
        risk_score=forecast_data.risk_score,
        explanation=forecast_data.explanation,
        recommendations=forecast_data.recommendations,
    )

    db.add(forecast)
    await db.commit()
    await db.refresh(forecast)

    return forecast


@router.get("/risk-summary")
async def get_risk_summary(
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_manager)
):
    """Get risk summary from all forecasts"""
    now = datetime.now(timezone.utc)

    query = select(ForecastOutput).where(
        ForecastOutput.valid_from <= now,
        ForecastOutput.valid_until >= now,
        ForecastOutput.risk_level.isnot(None)
    )

    if shop_id:
        query = query.where(ForecastOutput.shop_id == shop_id)
    elif plant_id:
        query = query.where(ForecastOutput.plant_id == plant_id)

    result = await db.execute(query)
    forecasts = result.scalars().all()

    # Count by risk level
    risk_counts = {
        "critical": 0,
        "high": 0,
        "medium": 0,
        "low": 0,
    }

    for f in forecasts:
        if f.risk_level in risk_counts:
            risk_counts[f.risk_level] += 1

    # Get critical items
    critical_items = [
        {
            "machine_id": f.machine_id,
            "forecast_type": f.forecast_type,
            "risk_score": f.risk_score,
            "explanation": f.explanation,
        }
        for f in forecasts
        if f.risk_level == "critical"
    ]

    return {
        "summary": risk_counts,
        "total_forecasts": len(forecasts),
        "critical_items": critical_items[:10],  # Top 10 critical
    }
