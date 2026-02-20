"""
Pydantic schemas for request/response validation
"""
from app.schemas.user import (
    UserCreate,
    UserUpdate,
    UserResponse,
    UserLogin,
    Token,
    TokenData,
)
from app.schemas.plant import (
    PlantBase,
    PlantCreate,
    PlantResponse,
    ShopBase,
    ShopCreate,
    ShopResponse,
    LineBase,
    LineCreate,
    LineResponse,
    PlantHierarchy,
)
from app.schemas.machine import (
    MachineBase,
    MachineCreate,
    MachineUpdate,
    MachineResponse,
    MachineSummary,
    MachineStateHistory,
)
from app.schemas.telemetry import (
    TelemetryBase,
    TelemetryCreate,
    TelemetryResponse,
    TelemetryAggregate,
    TelemetryLatest,
)
from app.schemas.event import (
    EventBase,
    EventCreate,
    EventResponse,
    AlertCreate,
    AlertResponse,
    AlertSummary,
)
from app.schemas.kpi import (
    OEEResponse,
    ProductionKPI,
    DowntimeKPI,
    EnergyKPI,
    ReliabilityKPI,
    ShiftKPI,
    DashboardOverview,
)
from app.schemas.forecast import (
    ForecastBase,
    ForecastCreate,
    ForecastResponse,
    FailureProbability,
    ProductionForecast,
    RiskSummary,
)
from app.schemas.control import (
    CommandRequest,
    CommandResponse,
    ControlAuditEntry,
)

__all__ = [
    # User schemas
    "UserCreate",
    "UserUpdate",
    "UserResponse",
    "UserLogin",
    "Token",
    "TokenData",
    # Plant schemas
    "PlantBase",
    "PlantCreate",
    "PlantResponse",
    "ShopBase",
    "ShopCreate",
    "ShopResponse",
    "LineBase",
    "LineCreate",
    "LineResponse",
    "PlantHierarchy",
    # Machine schemas
    "MachineBase",
    "MachineCreate",
    "MachineUpdate",
    "MachineResponse",
    "MachineSummary",
    "MachineStateHistory",
    # Telemetry schemas
    "TelemetryBase",
    "TelemetryCreate",
    "TelemetryResponse",
    "TelemetryAggregate",
    "TelemetryLatest",
    # Event/Alert schemas
    "EventBase",
    "EventCreate",
    "EventResponse",
    "AlertCreate",
    "AlertResponse",
    "AlertSummary",
    # KPI schemas
    "OEEResponse",
    "ProductionKPI",
    "DowntimeKPI",
    "EnergyKPI",
    "ReliabilityKPI",
    "ShiftKPI",
    "DashboardOverview",
    # Forecast schemas
    "ForecastBase",
    "ForecastCreate",
    "ForecastResponse",
    "FailureProbability",
    "ProductionForecast",
    "RiskSummary",
    # Control schemas
    "CommandRequest",
    "CommandResponse",
    "ControlAuditEntry",
]
