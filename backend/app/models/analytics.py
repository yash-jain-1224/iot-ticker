"""
Analytics-related persistent models for dashboard data
"""
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, JSON
from sqlalchemy.dialects.postgresql import TIMESTAMP

from app.core.database import Base


class AnalyticsSnapshot(Base):
    """Stored snapshot payload for analytics dashboards (operator/manager/leadership)."""

    __tablename__ = "analytics_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    view_type = Column(String(50), nullable=False, unique=True)
    payload = Column(JSON, nullable=False)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class WorkshopInsight(Base):
    """Precomputed analytics content for workshop dashboards."""

    __tablename__ = "analytics_workshop_insights"

    id = Column(Integer, primary_key=True, index=True)
    shop_type = Column(String(50), nullable=False, unique=True)
    machine_cards = Column(JSON, nullable=False)
    energy_trend = Column(JSON, nullable=False)
    downtime_trend = Column(JSON, nullable=False)
    quality_defects = Column(JSON, nullable=False)
    insight_metadata = Column(JSON, nullable=True)
    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
