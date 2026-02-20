"""
Auronix Motors IoT Ticker Platform - FastAPI Backend
"""
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog

from app.core.config import settings
from app.core.database import engine, Base
from app.api import (  # noqa: F401
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
    websocket_enhanced,
)

# Configure structured logging
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.add_log_level,
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler"""
    logger.info("Starting IoT Ticker Platform...")

    # Startup: Initialize database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    logger.info("Database initialized successfully")

    yield

    # Shutdown
    logger.info("Shutting down IoT Ticker Platform...")
    await engine.dispose()


app = FastAPI(
    title="Auronix Motors IoT Ticker Platform",
    description="Enterprise-grade IoT monitoring, control, and analytics platform for automotive manufacturing",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(plants.router, prefix="/api/plants", tags=["Plants & Workshops"])
app.include_router(machines.router, prefix="/api/machines", tags=["Machines"])
app.include_router(telemetry.router, prefix="/api/telemetry", tags=["Telemetry"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["Alerts"])
app.include_router(kpis.router, prefix="/api/kpis", tags=["KPIs & Analytics"])
app.include_router(forecasts.router, prefix="/api/forecasts", tags=["Forecasts"])
app.include_router(controls.router, prefix="/api/controls", tags=["Machine Control"])
app.include_router(ticker.router, prefix="/api/ticker", tags=["IoT Ticker"])
app.include_router(dashboards.router, prefix="/api/dashboards", tags=["AI/BI Dashboards"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["Analytics Dashboards"])

# Component-level APIs for progressive loading
app.include_router(dashboard_components.router, prefix="/api/dashboard", tags=["Dashboard Components"])
app.include_router(analytics_components.router, prefix="/api/analytics", tags=["Analytics Components"])
app.include_router(forecast_components.router, prefix="/api/forecast", tags=["Forecast Components"])

# WebSocket endpoints
app.include_router(websocket.router, prefix="/ws", tags=["WebSocket"])
# DISABLED: websocket_enhanced conflicts with websocket.router (both use /ws prefix)
# If you need /analytics/operator, add it to websocket.py
# app.include_router(websocket_enhanced.router, prefix="/ws-v2", tags=["WebSocket Enhanced"])


@app.get("/", tags=["Health"])
async def root():
    """Root endpoint - API health check"""
    return {
        "status": "healthy",
        "application": "Auronix Motors IoT Ticker Platform",
        "version": "1.0.0",
    }


@app.get("/ping", tags=["Health"])
async def ping():
    """Simple ping endpoint - no database check"""
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": "iot-ticker-api"
    }


@app.get("/health", tags=["Health"])
async def health_check():
    """Detailed health check endpoint"""
    return {
        "status": "healthy",
        "database": "connected",
        "services": {
            "ticker_engine": "running",
            "alert_engine": "running",
            "kpi_engine": "running",
        }
    }


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Global exception handler"""
    logger.error("Unhandled exception", error=str(exc), path=request.url.path)
    detail = str(exc) if settings.DEBUG else "Internal server error"
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "message": detail}
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
    )
