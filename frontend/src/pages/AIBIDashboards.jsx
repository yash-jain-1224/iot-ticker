import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { dashboardsAPI } from '../services/api'
import { useAuthStore } from '../store/authStore'
import clsx from 'clsx'
import logger from '../utils/logger'
import {
  ChartPieIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  CpuChipIcon,
  BoltIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ArrowsPointingOutIcon,
  XMarkIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline'

const dashboardCategories = [
  { id: 'overview', name: 'Overview', icon: ChartPieIcon },
  { id: 'production', name: 'Production', icon: CpuChipIcon },
  { id: 'quality', name: 'Quality', icon: ChartBarIcon },
  { id: 'maintenance', name: 'Maintenance', icon: ExclamationTriangleIcon },
  { id: 'energy', name: 'Energy', icon: BoltIcon },
  { id: 'forecasting', name: 'Forecasting', icon: ArrowTrendingUpIcon },
]

export default function AIBIDashboards() {
  const { dashboardId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [loading, setLoading] = useState(true)
  const [dashboards, setDashboards] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('overview')
  const [selectedDashboard, setSelectedDashboard] = useState(null)
  const [embedData, setEmbedData] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    fetchDashboards()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dashboardId) {
      loadDashboard(dashboardId)
    } else {
      setSelectedDashboard(null)
      setEmbedData(null)
    }
  }, [dashboardId]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchDashboards = async () => {
    try {
      setLoading(true)
      const [dashboardsRes, categoriesRes] = await Promise.all([
        dashboardsAPI.getAvailable({ role: user?.role }),
        dashboardsAPI.getCategories(),
      ])

      setDashboards(dashboardsRes.data || [])
      setCategories(categoriesRes.data || dashboardCategories)
    } catch (error) {
      logger.error('Error fetching dashboards:', error)
      // Use default categories if API fails
      setCategories(dashboardCategories)
    } finally {
      setLoading(false)
    }
  }

  const loadDashboard = async (id) => {
    try {
      setLoading(true)
      const [embedRes] = await Promise.all([
        dashboardsAPI.getEmbed(id, { role: user?.role }),
      ])

      const dashboard = dashboards.find(d => d.dashboard_id === id) || { name: 'Dashboard', id }
      setSelectedDashboard(dashboard)
      setEmbedData(embedRes.data)
    } catch (error) {
      logger.error('Error loading dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredDashboards = dashboards.filter(d => 
    selectedCategory === 'all' || d.category === selectedCategory
  )

  // Check if user has access to dashboards
  const hasAccess = ['viewer', 'operator', 'supervisor', 'manager', 'admin', 'executive'].includes(user?.role)

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <LockClosedIcon className="w-16 h-16 text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
        <p className="text-gray-500 mt-2">
          You do not have permission to view AI/BI Dashboards.
        </p>
      </div>
    )
  }

  // Fullscreen view
  if (fullscreen && selectedDashboard) {
    return (
      <div className="fixed inset-0 z-50 bg-white">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{selectedDashboard.name}</h2>
          <button
            onClick={() => setFullscreen(false)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="h-[calc(100vh-64px)]">
          <DashboardEmbed embedData={embedData} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI/BI Dashboards</h1>
          <p className="text-gray-500">Databricks AI-powered analytics dashboards</p>
        </div>
        <button
          onClick={fetchDashboards}
          className="btn btn-secondary flex items-center gap-2"
          disabled={loading}
        >
          <ArrowPathIcon className={clsx('w-4 h-4', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Dashboard content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1 space-y-4">
          {/* Categories */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Categories</h3>
            <nav className="space-y-1">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategory(cat.id)
                    navigate('/dashboards')
                  }}
                  className={clsx(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    selectedCategory === cat.id
                      ? 'bg-auronix-light text-auronix-blue'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                >
                  <cat.icon className="w-5 h-5" />
                  {cat.name}
                </button>
              ))}
            </nav>
          </div>

          {/* Available Dashboards */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">
              Dashboards ({filteredDashboards.length})
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="spinner" />
              </div>
            ) : filteredDashboards.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                No dashboards available
              </p>
            ) : (
              <nav className="space-y-1">
                {filteredDashboards.map(dashboard => (
                  <button
                    key={dashboard.dashboard_id}
                    onClick={() => navigate(`/dashboards/${dashboard.dashboard_id}`)}
                    className={clsx(
                      'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                      selectedDashboard?.dashboard_id === dashboard.dashboard_id
                        ? 'bg-auronix-light text-auronix-blue font-medium'
                        : 'text-gray-600 hover:bg-gray-100'
                    )}
                  >
                    <p className="font-medium truncate">{dashboard.name}</p>
                    {dashboard.description && (
                      <p className="text-xs text-gray-500 truncate mt-0.5">
                        {dashboard.description}
                      </p>
                    )}
                  </button>
                ))}
              </nav>
            )}
          </div>

          {/* Role-based shortcuts */}
          {user?.role && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">
                Quick Access
              </h3>
              <div className="space-y-2">
                {user.role === 'executive' && (
                  <>
                    <QuickLink label="Executive Summary" category="overview" />
                    <QuickLink label="Plant Performance" category="production" />
                  </>
                )}
                {['manager', 'supervisor'].includes(user.role) && (
                  <>
                    <QuickLink label="Shift Report" category="production" />
                    <QuickLink label="Machine Status" category="maintenance" />
                  </>
                )}
                {user.role === 'operator' && (
                  <>
                    <QuickLink label="My Line Status" category="production" />
                    <QuickLink label="Active Alerts" category="maintenance" />
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Dashboard display area */}
        <div className="lg:col-span-3">
          {selectedDashboard ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              {/* Dashboard header */}
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {selectedDashboard.name}
                  </h2>
                  {selectedDashboard.description && (
                    <p className="text-sm text-gray-500">{selectedDashboard.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadDashboard(selectedDashboard.dashboard_id)}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                    title="Refresh"
                  >
                    <ArrowPathIcon className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => setFullscreen(true)}
                    className="p-2 hover:bg-gray-100 rounded-lg"
                    title="Fullscreen"
                  >
                    <ArrowsPointingOutIcon className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Dashboard content */}
              <div className="h-[600px]">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="spinner" />
                  </div>
                ) : (
                  <DashboardEmbed embedData={embedData} />
                )}
              </div>
            </div>
          ) : (
            <DashboardGallery
              dashboards={filteredDashboards}
              category={selectedCategory}
              onSelect={(id) => navigate(`/dashboards/${id}`)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function QuickLink({ label, category: _category }) {
  return (
    <button className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
      {label}
    </button>
  )
}

function DashboardEmbed({ embedData }) {
  if (!embedData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <ChartPieIcon className="w-16 h-16 text-gray-300 mb-4" />
        <p>Unable to load dashboard</p>
      </div>
    )
  }

  // If we have an embed URL (e.g., Databricks dashboard embed)
  if (embedData.embed_url) {
    return (
      <iframe
        src={embedData.embed_url}
        className="w-full h-full border-0"
        title="Dashboard"
        allow="fullscreen"
      />
    )
  }

  // Fallback: Display dashboard info/placeholder
  return (
    <div className="p-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {embedData.kpis?.map((kpi, idx) => (
          <div key={idx} className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-500">{kpi.label}</p>
            <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
            {kpi.change && (
              <p className={clsx(
                'text-sm',
                kpi.trend === 'up' ? 'text-green-600' : 'text-red-600'
              )}>
                {kpi.change > 0 ? '+' : ''}{kpi.change}%
              </p>
            )}
          </div>
        ))}
      </div>

      {embedData.charts?.map((chart, idx) => (
        <div key={idx} className="bg-gray-50 rounded-lg p-6 mb-4">
          <h4 className="font-medium text-gray-900 mb-4">{chart.title}</h4>
          <div className="h-48 flex items-center justify-center text-gray-400">
            <ChartBarIcon className="w-12 h-12" />
            <span className="ml-4">Chart: {chart.type}</span>
          </div>
        </div>
      ))}

      {!embedData.kpis && !embedData.charts && (
        <div className="flex flex-col items-center justify-center h-96 text-gray-500">
          <ChartPieIcon className="w-16 h-16 text-gray-300 mb-4" />
          <p>Dashboard content will be displayed here</p>
          <p className="text-sm mt-2">Connect to Databricks for live data</p>
        </div>
      )}
    </div>
  )
}

function DashboardGallery({ dashboards, category, onSelect }) {
  const categoryInfo = dashboardCategories.find(c => c.id === category) || dashboardCategories[0]

  return (
    <div className="space-y-6">
      {/* Category header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-auronix-light rounded-xl">
            <categoryInfo.icon className="w-8 h-8 text-auronix-blue" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{categoryInfo.name} Dashboards</h2>
            <p className="text-gray-500">
              {dashboards.length} dashboard{dashboards.length !== 1 ? 's' : ''} available
            </p>
          </div>
        </div>
      </div>

      {/* Dashboard cards */}
      {dashboards.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <ChartPieIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No dashboards available in this category</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {dashboards.map(dashboard => (
            <button
              key={dashboard.dashboard_id}
              onClick={() => onSelect(dashboard.dashboard_id)}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-left hover:shadow-md hover:border-auronix-blue transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <ChartPieIcon className="w-8 h-8 text-auronix-blue" />
                {dashboard.is_new && (
                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                    New
                  </span>
                )}
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">{dashboard.name}</h3>
              <p className="text-sm text-gray-500 line-clamp-2">
                {dashboard.description || 'No description available'}
              </p>
              {dashboard.last_updated && (
                <p className="text-xs text-gray-400 mt-3">
                  Updated: {new Date(dashboard.last_updated).toLocaleDateString()}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Featured dashboards placeholder */}
      <div className="bg-gradient-to-r from-auronix-blue to-blue-700 rounded-xl p-6 text-white">
        <h3 className="text-lg font-semibold mb-2">Databricks AI/BI Integration</h3>
        <p className="text-blue-100 text-sm mb-4">
          Connect your Databricks workspace to unlock AI-powered analytics, 
          natural language queries, and automated insights.
        </p>
        <button className="px-4 py-2 bg-white text-auronix-blue rounded-lg text-sm font-medium hover:bg-blue-50 transition-colors">
          Configure Integration
        </button>
      </div>
    </div>
  )
}
