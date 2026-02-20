"""
API routes package
"""
from app.api import (
    auth,
    plants,
    machines,
    telemetry,
    alerts,
    kpis,
    forecasts,
    controls,
    ticker,
    websocket,
    dashboards,
    analytics,
    dashboard_components,
    analytics_components,
    forecast_components,
)

__all__ = [
    "auth",
    "plants",
    "machines",
    "telemetry",
    "alerts",
    "kpis",
    "forecasts",
    "controls",
    "ticker",
    "websocket",
    "dashboards",
    "analytics",
    "dashboard_components",
    "analytics_components",
    "forecast_components",
]
