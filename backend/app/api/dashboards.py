"""
AI/BI Dashboards API routes - Databricks dashboard integration
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional

from app.core.config import settings
from app.core.security import get_current_user
from app.models.user import User

router = APIRouter()


# Dashboard definitions
DASHBOARDS = {
    # Operator dashboards
    "operator_overview": {
        "name": "Operator Overview",
        "description": "Real-time KPIs and machine status for operators",
        "role": "operator",
        "dashboard_id": "operator-overview-001",
        "category": "operations",
    },
    "machine_health": {
        "name": "Machine Health Monitor",
        "description": "Live machine health and status",
        "role": "operator",
        "dashboard_id": "machine-health-001",
        "category": "operations",
    },
    "alerts_dashboard": {
        "name": "Alerts Dashboard",
        "description": "Active alerts and notifications",
        "role": "operator",
        "dashboard_id": "alerts-001",
        "category": "operations",
    },

    # Manager dashboards
    "shift_performance": {
        "name": "Shift Performance",
        "description": "Shift-wise performance trends and analysis",
        "role": "manager",
        "dashboard_id": "shift-performance-001",
        "category": "analytics",
    },
    "oee_analysis": {
        "name": "OEE Analysis",
        "description": "Detailed OEE breakdown and trends",
        "role": "manager",
        "dashboard_id": "oee-analysis-001",
        "category": "analytics",
    },
    "downtime_analysis": {
        "name": "Downtime Analysis",
        "description": "Root cause analysis for downtime events",
        "role": "manager",
        "dashboard_id": "downtime-analysis-001",
        "category": "analytics",
    },
    "forecast_vs_actual": {
        "name": "Forecast vs Actual",
        "description": "Compare forecasts with actual performance",
        "role": "manager",
        "dashboard_id": "forecast-actual-001",
        "category": "forecasting",
    },
    "predictive_maintenance": {
        "name": "Predictive Maintenance",
        "description": "Machine failure predictions and maintenance recommendations",
        "role": "manager",
        "dashboard_id": "predictive-maint-001",
        "category": "forecasting",
    },

    # Leadership dashboards
    "plant_comparison": {
        "name": "Plant Comparison",
        "description": "Cross-plant performance comparison",
        "role": "leadership",
        "dashboard_id": "plant-comparison-001",
        "category": "executive",
    },
    "cost_per_vehicle": {
        "name": "Cost per Vehicle",
        "description": "Manufacturing cost analysis",
        "role": "leadership",
        "dashboard_id": "cost-vehicle-001",
        "category": "executive",
    },
    "sustainability": {
        "name": "Sustainability Insights",
        "description": "Energy and sustainability metrics",
        "role": "leadership",
        "dashboard_id": "sustainability-001",
        "category": "executive",
    },
    "risk_indicators": {
        "name": "Predictive Risk Indicators",
        "description": "Risk indicators for downtime, quality, and energy",
        "role": "leadership",
        "dashboard_id": "risk-indicators-001",
        "category": "executive",
    },

    # Workshop-specific dashboards
    "body_shop": {
        "name": "Body Shop Dashboard",
        "description": "Welding robots, electrode wear, weld quality",
        "role": "operator",
        "dashboard_id": "body-shop-001",
        "category": "workshop",
        "shop_type": "body_shop",
    },
    "paint_shop": {
        "name": "Paint Shop Dashboard",
        "description": "Booth conditions, repaint rate, energy",
        "role": "operator",
        "dashboard_id": "paint-shop-001",
        "category": "workshop",
        "shop_type": "paint_shop",
    },
    "final_assembly": {
        "name": "Final Assembly Dashboard",
        "description": "Torque accuracy, line stops, EOL failures",
        "role": "operator",
        "dashboard_id": "final-assembly-001",
        "category": "workshop",
        "shop_type": "final_assembly",
    },
    "utilities": {
        "name": "Utilities Dashboard",
        "description": "Power, air, water, HVAC efficiency",
        "role": "operator",
        "dashboard_id": "utilities-001",
        "category": "workshop",
        "shop_type": "utilities",
    },
}

ROLE_HIERARCHY = {
    "operator": 1,
    "manager": 2,
    "leadership": 3,
    "admin": 4,
}


class DashboardInfo(BaseModel):
    id: str
    name: str
    description: str
    category: str
    role: str
    embed_url: Optional[str] = None
    shop_type: Optional[str] = None


class DashboardEmbed(BaseModel):
    dashboard_id: str
    name: str
    embed_url: str
    embed_token: Optional[str] = None
    expires_at: Optional[str] = None


@router.get("/", response_model=list[DashboardInfo])
async def get_available_dashboards(
    category: Optional[str] = None,
    shop_type: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Get list of dashboards available to the current user"""
    user_role_level = ROLE_HIERARCHY.get(current_user.role.value, 0)

    available = []
    for dash_id, dash_info in DASHBOARDS.items():
        dash_role_level = ROLE_HIERARCHY.get(dash_info["role"], 0)

        # Check if user has sufficient role
        if user_role_level < dash_role_level:
            continue

        # Apply filters
        if category and dash_info.get("category") != category:
            continue

        if shop_type and dash_info.get("shop_type") and dash_info.get("shop_type") != shop_type:
            continue

        available.append(DashboardInfo(
            id=dash_id,
            name=dash_info["name"],
            description=dash_info["description"],
            category=dash_info["category"],
            role=dash_info["role"],
            shop_type=dash_info.get("shop_type"),
        ))

    return available


@router.get("/categories")
async def get_dashboard_categories(
    current_user: User = Depends(get_current_user)
):
    """Get dashboard categories"""
    categories = {
        "operations": {
            "name": "Operations",
            "description": "Real-time operational dashboards",
            "icon": "dashboard",
        },
        "analytics": {
            "name": "Analytics",
            "description": "Performance analysis and trends",
            "icon": "analytics",
        },
        "forecasting": {
            "name": "Forecasting",
            "description": "Predictive analytics and forecasts",
            "icon": "trending_up",
        },
        "executive": {
            "name": "Executive",
            "description": "Leadership and strategic insights",
            "icon": "business",
        },
        "workshop": {
            "name": "Workshop",
            "description": "Shop-specific dashboards",
            "icon": "factory",
        },
    }

    return categories


@router.get("/{dashboard_id}/embed", response_model=DashboardEmbed)
async def get_dashboard_embed(
    dashboard_id: str,
    plant_id: Optional[int] = None,
    shop_id: Optional[int] = None,
    current_user: User = Depends(get_current_user)
):
    """Get embed URL for a specific dashboard"""
    if dashboard_id not in DASHBOARDS:
        return {"error": "Dashboard not found"}

    dash_info = DASHBOARDS[dashboard_id]

    # Check role permission
    user_role_level = ROLE_HIERARCHY.get(current_user.role.value, 0)
    dash_role_level = ROLE_HIERARCHY.get(dash_info["role"], 0)

    if user_role_level < dash_role_level:
        return {"error": "Access denied"}

    # Build embed URL
    base_url = settings.DATABRICKS_DASHBOARD_BASE_URL
    embed_url = f"{base_url}/{dash_info['dashboard_id']}"

    # Add filters as query parameters
    params = []
    if plant_id:
        params.append(f"plant_id={plant_id}")
    if shop_id:
        params.append(f"shop_id={shop_id}")

    if params:
        embed_url += "?" + "&".join(params)

    return DashboardEmbed(
        dashboard_id=dashboard_id,
        name=dash_info["name"],
        embed_url=embed_url,
    )


@router.get("/workshop/{shop_type}")
async def get_workshop_dashboard(
    shop_type: str,
    current_user: User = Depends(get_current_user)
):
    """Get workshop-specific dashboard"""
    valid_shops = ["body_shop", "paint_shop", "final_assembly", "utilities"]

    if shop_type not in valid_shops:
        return {"error": f"Invalid shop type. Valid types: {valid_shops}"}

    # Find matching dashboard
    for dash_id, dash_info in DASHBOARDS.items():
        if dash_info.get("shop_type") == shop_type:
            base_url = settings.DATABRICKS_DASHBOARD_BASE_URL
            embed_url = f"{base_url}/{dash_info['dashboard_id']}"

            return {
                "dashboard_id": dash_id,
                "name": dash_info["name"],
                "description": dash_info["description"],
                "embed_url": embed_url,
                "shop_type": shop_type,
            }

    return {"error": "Dashboard not found for this shop type"}


@router.get("/role/{role}")
async def get_dashboards_by_role(
    role: str,
    current_user: User = Depends(get_current_user)
):
    """Get dashboards for a specific role view"""
    if role not in ROLE_HIERARCHY:
        return {"error": "Invalid role"}

    # Check if user can view dashboards for this role
    user_role_level = ROLE_HIERARCHY.get(current_user.role.value, 0)
    target_role_level = ROLE_HIERARCHY.get(role, 0)

    if user_role_level < target_role_level:
        return {"error": "Access denied"}

    dashboards = []
    for dash_id, dash_info in DASHBOARDS.items():
        if dash_info["role"] == role:
            dashboards.append({
                "id": dash_id,
                "name": dash_info["name"],
                "description": dash_info["description"],
                "category": dash_info["category"],
            })

    return {
        "role": role,
        "dashboards": dashboards,
    }
