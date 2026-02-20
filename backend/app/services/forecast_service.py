"""
Forecast service - Business logic for ML predictions and forecasts
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.forecast import Forecast, ForecastType
from app.models.machine import Machine
from app.schemas.forecast import (
    ForecastCreate,
    FailureProbability,
    ProductionForecast,
    RiskSummary,
    MaintenancePrediction,
)


class ForecastService:
    """Service for forecast and prediction operations"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_failure_probability(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        machine_id: Optional[int] = None,
    ) -> List[FailureProbability]:
        """Get failure probability predictions for machines"""
        # Get machines
        query = select(Machine).where(Machine.is_active == True)  # noqa: E712

        if machine_id:
            query = query.where(Machine.id == machine_id)

        result = await self.db.execute(query)
        machines = result.scalars().all()

        predictions = []
        for machine in machines:
            # Get stored forecast or generate prediction
            forecast_query = select(Forecast).where(
                and_(
                    Forecast.machine_id == machine.id,
                    Forecast.forecast_type == ForecastType.failure,
                    Forecast.is_valid == True,  # noqa: E712
                )
            ).order_by(Forecast.created_at.desc()).limit(1)

            forecast_result = await self.db.execute(forecast_query)
            forecast = forecast_result.scalar_one_or_none()

            if forecast:
                probability = forecast.prediction_value
                confidence = forecast.confidence_score
            else:
                # Demo prediction based on machine state
                probability = 0.15 if machine.current_state.value == "running" else 0.35
                confidence = 0.85

            # Determine risk level
            if probability < 0.2:
                risk_level = "low"
            elif probability < 0.5:
                risk_level = "medium"
            elif probability < 0.8:
                risk_level = "high"
            else:
                risk_level = "critical"

            predictions.append(FailureProbability(
                machine_id=machine.id,
                machine_name=machine.name,
                machine_type=machine.machine_type,
                probability=probability,
                risk_level=risk_level,
                estimated_failure_date=datetime.now(
                    timezone.utc) + timedelta(days=int(30 * (1 - probability))) if probability > 0.3 else None,
                contributing_factors=[
                    {"factor": "operating_hours", "impact": 0.3},
                    {"factor": "temperature", "impact": 0.2},
                    {"factor": "vibration", "impact": 0.15},
                ],
                recommended_actions=[
                    "Schedule preventive maintenance",
                    "Monitor temperature closely",
                ] if probability > 0.3 else [],
                confidence_score=confidence,
                last_updated=datetime.now(timezone.utc),
            ))

        return predictions

    async def get_production_forecast(
        self,
        plant_id: Optional[int] = None,
        shop_id: Optional[int] = None,
        days_ahead: int = 7,
    ) -> List[ProductionForecast]:
        """Get production forecast"""
        forecasts = []
        base_date = datetime.now(timezone.utc)

        for day in range(days_ahead):
            forecast_date = base_date + timedelta(days=day)

            # Demo forecast with some variation
            base_units = 1200
            variation = (day % 3) * 50 - 50
            predicted = base_units + variation

            forecasts.append(ProductionForecast(
                plant_id=plant_id,
                shop_id=shop_id,
                forecast_date=forecast_date,
                predicted_units=predicted,
                lower_bound=int(predicted * 0.9),
                upper_bound=int(predicted * 1.1),
                confidence_interval=0.95,
                comparison_to_target=(predicted / 1250) * 100,
                factors_affecting=[
                    {"factor": "machine_availability", "impact": 0.4},
                    {"factor": "demand", "impact": 0.3},
                    {"factor": "workforce", "impact": 0.2},
                ],
            ))

        return forecasts

    async def get_risk_summary(
        self,
        plant_id: Optional[int] = None,
    ) -> RiskSummary:
        """Get risk summary across all machines"""
        predictions = await self.get_failure_probability(plant_id=plant_id)

        risk_counts = {"low": 0, "medium": 0, "high": 0, "critical": 0}
        for pred in predictions:
            risk_counts[pred.risk_level] += 1

        # Filter machines requiring attention (high/critical risk)
        attention_needed = [p for p in predictions if p.risk_level in ("high", "critical")]

        # Calculate plant health score
        total = len(predictions)
        if total > 0:
            health_score = (
                (risk_counts["low"] * 100 +
                 risk_counts["medium"] * 70 +
                 risk_counts["high"] * 40 +
                 risk_counts["critical"] * 10) / total
            )
        else:
            health_score = 100.0

        return RiskSummary(
            total_machines=total,
            low_risk=risk_counts["low"],
            medium_risk=risk_counts["medium"],
            high_risk=risk_counts["high"],
            critical_risk=risk_counts["critical"],
            machines_requiring_attention=attention_needed[:10],  # Top 10
            overall_plant_health=health_score,
            trend="stable",
        )

    async def get_maintenance_predictions(
        self,
        machine_id: Optional[int] = None,
        days_ahead: int = 30,
    ) -> List[MaintenancePrediction]:
        """Get predictive maintenance recommendations"""
        query = select(Machine).where(Machine.is_active == True)  # noqa: E712

        if machine_id:
            query = query.where(Machine.id == machine_id)

        result = await self.db.execute(query)
        machines = result.scalars().all()

        predictions = []
        for machine in machines:
            # Check if maintenance is upcoming
            if machine.next_maintenance_date:
                remaining_days = (machine.next_maintenance_date - datetime.now(timezone.utc)).days
                if remaining_days <= days_ahead:
                    predictions.append(MaintenancePrediction(
                        machine_id=machine.id,
                        machine_name=machine.name,
                        component="General",
                        predicted_failure_date=machine.next_maintenance_date + timedelta(days=7),
                        confidence=0.75,
                        remaining_useful_life_hours=remaining_days * 24,
                        recommended_maintenance_date=machine.next_maintenance_date,
                        maintenance_type="scheduled",
                        estimated_downtime_hours=4.0,
                        parts_needed=["filters", "lubricant"],
                    ))

        return predictions

    async def create_forecast(self, data: ForecastCreate) -> Forecast:
        """Store a new forecast"""
        forecast = Forecast(
            machine_id=data.machine_id,
            forecast_type=ForecastType(data.forecast_type),
            prediction_value=data.prediction_value,
            confidence_score=data.confidence_score,
            prediction_date=data.prediction_date,
            horizon_hours=data.horizon_hours,
            model_version=data.model_version,
            feature_importance=data.feature_importance or {},
            metadata=data.metadata or {},
        )

        self.db.add(forecast)
        await self.db.commit()
        await self.db.refresh(forecast)
        return forecast

    async def invalidate_old_forecasts(
        self,
        machine_id: int,
        forecast_type: str,
    ) -> int:
        """Invalidate old forecasts when new ones are created"""
        from sqlalchemy import update as sql_update

        stmt = (
            sql_update(Forecast)
            .where(
                and_(
                    Forecast.machine_id == machine_id,
                    Forecast.forecast_type == ForecastType(forecast_type),
                    Forecast.is_valid == True,  # noqa: E712
                )
            )
            .values(is_valid=False)
        )

        result = await self.db.execute(stmt)
        await self.db.commit()
        return result.rowcount
