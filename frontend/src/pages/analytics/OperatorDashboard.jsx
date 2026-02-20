import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import {
  CpuChipIcon,
  BoltIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  WrenchScrewdriverIcon,
  ChartBarIcon,
  ArrowPathIcon,
  BeakerIcon,
  BuildingOffice2Icon,
} from '@heroicons/react/24/outline'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { useFilterStore } from '../../store/filterStore'
import LocationFilter from '../../components/LocationFilter'
import TimeRangeFilter from '../../components/TimeRangeFilter'
import KPICard from '../../components/KPICard'
import useWebSocket from '../../hooks/useWebSocket'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Chart colors
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

const PLANT_CODE_MAP = {
  jamshedpur: 'HOUSTON-001',
  sanand: 'DALLAS-001',
  pune: 'AUSTIN-001',
}

const mapLocationToPlantId = (location) => {
  if (!location || location === 'all') {
    return undefined
  }

  if (typeof location === 'string') {
    return PLANT_CODE_MAP[location] || location
  }

  if (typeof location === 'object') {
    return location.plant_id || location.code || location.id || location.value || undefined
  }

  return undefined
}

const formatKpiValue = (value, decimals = 1) => {
  if (value == null || Number.isNaN(Number(value))) {
    return '—'
  }
  if (decimals == null) {
    return Number(value).toLocaleString()
  }
  return Number(value).toFixed(decimals)
}

const formatChange = (change, unit = '', decimals = 1) => {
  if (change == null || Number.isNaN(Number(change))) {
    return null
  }
  const numeric = Number(change)
  const magnitude =
    decimals == null ? Math.abs(numeric).toLocaleString() : Math.abs(numeric).toFixed(decimals)
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : ''
  return `${sign}${magnitude}${unit}`
}

const getHealthBars = (distribution) => {
  const entries = [
    { key: 'excellent', label: 'Excellent (90-100)', color: 'bg-green-500' },
    { key: 'good', label: 'Good (75-89)', color: 'bg-blue-500' },
    { key: 'fair', label: 'Fair (60-74)', color: 'bg-yellow-500' },
    { key: 'poor', label: 'Poor (<60)', color: 'bg-red-500' },
  ]

  const total = entries.reduce((sum, entry) => sum + (Number(distribution?.[entry.key]) || 0), 0) || 1

  return entries.map((entry) => {
    const value = Number(distribution?.[entry.key]) || 0
    const width = Math.min(100, (value / total) * 100)
    return {
      ...entry,
      value,
      width,
    }
  })
}

function OperatorDashboard() {
  const { location, timeRange } = useFilterStore()
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [selectedShop, setSelectedShop] = useState('all')

  // Fetch initial data via REST API
  const {
    data: apiResponse,
    isLoading: isApiLoading,
    isError: isApiError,
    error: apiError,
  } = useQuery({
    queryKey: ['analytics', 'operator', mapLocationToPlantId(location), selectedShop, timeRange],
    queryFn: async () => {
      const response = await axios.get(`${API_BASE_URL}/api/analytics/operator`, {
        params: {
          plant_id: mapLocationToPlantId(location),
          shop_type: selectedShop !== 'all' ? selectedShop : undefined,
          time_range: timeRange,
        },
      })
      return response.data
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // Use WebSocket for live updates after initial load
  const { data: wsData, isConnected, error: wsError } = useWebSocket('/analytics/operator', {
    plant_id: mapLocationToPlantId(location),
    shop_type: selectedShop !== 'all' ? selectedShop : undefined,
    time_range: timeRange,
  })

  // Combine API and WebSocket data (prefer WebSocket when available and has content)
  const apiData = apiResponse?.data || {}
  const liveData = wsData?.data || {}
  
  // Check if WebSocket data has meaningful content (not just empty objects)
  const hasWebSocketData = liveData && (
    (liveData.kpis && Object.keys(liveData.kpis).length > 0) ||
    (liveData.machine_status && Object.values(liveData.machine_status).some(v => v > 0)) ||
    (liveData.alerts && liveData.alerts.length > 0)
  )
  
  const data = hasWebSocketData ? liveData : apiData
  
  // Determine loading and error states
  const isLoading = isApiLoading && !wsData
  const isError = isApiError && !data

  // Update timestamp when data arrives
  useEffect(() => {
    if (wsData?.timestamp) {
      setLastUpdated(new Date(wsData.timestamp))
    } else if (apiResponse?.timestamp) {
      setLastUpdated(new Date(apiResponse.timestamp))
    }
  }, [wsData, apiResponse])

  const kpis = data?.kpis || {}
  const oeeKpi = kpis?.oee || {}
  const cycleTimeKpi = kpis?.cycle_time || {}
  const downtimeKpi = kpis?.downtime || {}
  const qualityPassKpi = kpis?.quality_pass_rate || {}

  const oeeTrend = data?.trends?.oee || []
  const cycleTimeTrend = data?.trends?.cycle_time || []
  const machineStatusBreakdown = data?.trends?.machine_status || []

  const machineStatus = data?.machine_status || {}
  const qualityByShop = data?.quality?.by_shop || []
  const alerts = data?.alerts || []
  const events = data?.events || []
  const healthBars = getHealthBars(data?.health_distribution || {})

  const formatPercentChange = (metric, decimals = 1) =>
    formatChange(metric?.change, '%', decimals)

  const formatUnitChange = (metric, unit, decimals = 1) =>
    formatChange(metric?.change, unit, decimals)

  const machineStatusPieData = machineStatusBreakdown.length
    ? machineStatusBreakdown.map((item) => ({
        name: item.label,
        value: item.value,
        status: item.status,
        percentage: item.percentage,
      }))
    : [
        { name: 'Online', value: machineStatus.online || 0, status: 'online' },
        { name: 'Idle', value: machineStatus.idle || 0, status: 'idle' },
        { name: 'Fault', value: machineStatus.fault || 0, status: 'fault' },
        { name: 'Offline', value: machineStatus.offline || 0, status: 'offline' },
      ]

  const qualityTrendData = qualityByShop.length
    ? qualityByShop.map((entry) => ({
        shop: entry.shop,
        passRate: entry.pass_rate,
        rework: entry.rework,
      }))
    : [
        { shop: 'Body Shop', passRate: 0, rework: 0 },
        { shop: 'Paint Shop', passRate: 0, rework: 0 },
        { shop: 'Final Assembly', passRate: 0, rework: 0 },
      ]

  const getQualityMetrics = (metricKey, legacyPrefix) => {
    const entry = qualityByShop.find((item) => item.metric_key === metricKey) || {}
    return {
      pass_rate: entry.pass_rate ?? data?.quality?.[`${legacyPrefix}_pass_rate`] ?? null,
      rework: entry.rework ?? data?.quality?.[`${legacyPrefix}_rework`] ?? null,
    }
  }

  const weldMetrics = getQualityMetrics('weld', 'weld')
  const paintMetrics = getQualityMetrics('paint', 'paint')
  const torqueMetrics = getQualityMetrics('torque', 'torque')

  const hasOeeTrend = oeeTrend.length > 0
  const hasCycleTrend = cycleTimeTrend.length > 0
  const hasMachineStatusData = machineStatusPieData.some((item) => item.value > 0)
  const hasQualityTrend = qualityTrendData.some((entry) => entry.passRate > 0)

  const shops = [
    { id: 'all', name: 'All Shops', icon: CpuChipIcon },
    { id: 'body_shop', name: 'Body Shop', icon: WrenchScrewdriverIcon },
    { id: 'paint_shop', name: 'Paint Shop', icon: BeakerIcon },
    { id: 'final_assembly', name: 'Final Assembly', icon: BuildingOffice2Icon },
    { id: 'utilities', name: 'Utilities', icon: BoltIcon },
  ]

  const _getStatusBadgeClass = (status) => {
    const statusMap = {
      online: 'bg-green-100 text-green-800 border-green-300',
      offline: 'bg-gray-100 text-gray-800 border-gray-300',
      idle: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      fault: 'bg-red-100 text-red-800 border-red-300',
    }
    return statusMap[status] || 'bg-gray-100 text-gray-800 border-gray-300'
  }

  const _getStatusIcon = (status) => {
    switch (status) {
      case 'online':
        return <CheckCircleIcon className="w-4 h-4" />
      case 'fault':
        return <XCircleIcon className="w-4 h-4" />
      case 'offline':
        return <XCircleIcon className="w-4 h-4" />
      default:
        return <ClockIcon className="w-4 h-4" />
    }
  }

  const getSeverityBadge = (severity) => {
    const severityMap = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300',
    }
    return severityMap[severity] || 'bg-gray-100 text-gray-800 border-gray-300'
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
              <CpuChipIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Operator View</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Live performance monitoring & threshold alerts
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LocationFilter />
          <TimeRangeFilter />
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <div
              className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
            />
            <span>{isConnected ? 'Live' : 'Offline'}</span>
            <span className="text-gray-400">•</span>
            <span>Updated {lastUpdated.toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {/* Shop Filter */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3 overflow-x-auto">
          {shops.map((shop) => {
            const Icon = shop.icon
            return (
              <button
                key={shop.id}
                onClick={() => setSelectedShop(shop.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
                  selectedShop === shop.id
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {shop.name}
              </button>
            )
          })}
        </div>
      </div>

      {isError ? (
        <div className="flex items-center justify-center py-12">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-6 max-w-lg text-center">
            <h2 className="text-lg font-semibold">Failed to load operator analytics</h2>
            <p className="text-sm text-red-600 mt-2">
              {apiError?.response?.data?.message || apiError?.message || wsError || 'Unable to load data. Please check your connection and try again.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <ArrowPathIcon className="w-8 h-8 text-blue-600 animate-spin" />
            <p className="text-sm text-gray-500">Loading operator data...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Live KPI Tiles */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Live KPI Metrics</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="OEE"
                value={formatKpiValue(oeeKpi?.value)}
                unit={oeeKpi?.unit || '%'}
                change={formatPercentChange(oeeKpi)}
                changeType={oeeKpi?.change_type}
                icon={ChartBarIcon}
                iconBg="bg-green-100"
                iconColor="text-green-600"
                linkText="View trend"
                linkTo="#oee-trend"
              />
              <KPICard
                title="Cycle Time"
                value={formatKpiValue(cycleTimeKpi?.value)}
                unit={cycleTimeKpi?.unit || 'sec'}
                change={formatUnitChange(cycleTimeKpi, cycleTimeKpi?.unit || ' sec')}
                changeType={cycleTimeKpi?.change_type}
                icon={ClockIcon}
                iconBg="bg-blue-100"
                iconColor="text-blue-600"
                linkText="View details"
                linkTo="#cycle-time"
              />
              <KPICard
                title="Downtime"
                value={formatKpiValue(downtimeKpi?.value, 0)}
                unit={downtimeKpi?.unit || 'min'}
                change={formatUnitChange(downtimeKpi, downtimeKpi?.unit ? ` ${downtimeKpi.unit}` : ' min', 0)}
                changeType={downtimeKpi?.change_type}
                icon={ExclamationTriangleIcon}
                iconBg="bg-red-100"
                iconColor="text-red-600"
                linkText="View causes"
                linkTo="#downtime"
              />
              <KPICard
                title="Quality Pass Rate"
                value={formatKpiValue(qualityPassKpi?.value)}
                unit={qualityPassKpi?.unit || '%'}
                change={formatPercentChange(qualityPassKpi)}
                changeType={qualityPassKpi?.change_type}
                icon={CheckCircleIcon}
                iconBg="bg-purple-100"
                iconColor="text-purple-600"
                linkText="View defects"
                linkTo="#quality"
              />
            </div>
          </div>

          {/* Real-Time Performance Charts */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Live Performance Trends</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* OEE Trend Chart */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">OEE Trend (Last Hour)</h3>
                {hasOeeTrend ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <AreaChart data={oeeTrend}>
                      <defs>
                        <linearGradient id="colorOEE" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                        }}
                        formatter={(value) => [`${value}%`, 'OEE']}
                      />
                      <Area
                        type="monotone"
                        dataKey="oee"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="url(#colorOEE)"
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-48 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg">
                    No OEE trend data available for the selected filters.
                  </div>
                )}
              </div>

              {/* Cycle Time Trend Chart */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Cycle Time Trend (Last Hour)</h3>
                {hasCycleTrend ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={cycleTimeTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                        }}
                        formatter={(value) => [`${value}`, cycleTimeKpi?.unit || 'Cycle Time']}
                      />
                      <Line
                        type="monotone"
                        dataKey="cycle_time"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ fill: '#10b981', r: 4 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-48 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg">
                    No cycle time data available for the selected filters.
                  </div>
                )}
              </div>

              {/* Machine Status Distribution */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Machine Status Distribution</h3>
                {hasMachineStatusData ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={machineStatusPieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percentage }) => `${name} ${(percentage || 0).toFixed(0)}%`}
                        outerRadius={80}
                        dataKey="value"
                      >
                        {machineStatusPieData.map((entry, index) => {
                          const statusColorMap = {
                            online: '#10b981',
                            idle: '#f59e0b',
                            fault: '#ef4444',
                            offline: '#6b7280',
                          }
                          const fill = statusColorMap[entry.status] || COLORS[index % COLORS.length]
                          return <Cell key={`cell-${index}`} fill={fill} />
                        })}
                      </Pie>
                      <Tooltip
                        formatter={(value, name, payload) => [value, payload.payload.status?.replace('_', ' ') || name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-48 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg">
                    No machine status data available.
                  </div>
                )}
              </div>

              {/* Quality Metrics Chart */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Quality Metrics by Shop</h3>
                {hasQualityTrend ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={qualityTrendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="shop" stroke="#6b7280" fontSize={12} />
                      <YAxis stroke="#6b7280" fontSize={12} domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                        }}
                        formatter={(value) => [`${value}%`, 'Pass Rate']}
                      />
                      <Bar dataKey="passRate" fill="#8b5cf6" radius={[8, 8, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-48 flex items-center justify-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg">
                    No quality metrics available.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Quality Metrics by Shop */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Shop-Specific Quality Metrics</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                    <WrenchScrewdriverIcon className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Weld Quality</h3>
                    <p className="text-xs text-gray-500">Body Shop</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Pass Rate</span>
                    <span className="text-lg font-bold text-gray-900">
                      {weldMetrics.pass_rate != null ? `${weldMetrics.pass_rate}%` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Rework</span>
                    <span className="text-sm font-medium text-red-600">
                      {weldMetrics.rework != null ? `${weldMetrics.rework}%` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <BeakerIcon className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Paint Quality</h3>
                    <p className="text-xs text-gray-500">Paint Shop</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Pass Rate</span>
                    <span className="text-lg font-bold text-gray-900">
                      {paintMetrics.pass_rate != null ? `${paintMetrics.pass_rate}%` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Rework</span>
                    <span className="text-sm font-medium text-red-600">
                      {paintMetrics.rework != null ? `${paintMetrics.rework}%` : '—'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                    <BuildingOffice2Icon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Torque Pass Rate</h3>
                    <p className="text-xs text-gray-500">Final Assembly</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Pass Rate</span>
                    <span className="text-lg font-bold text-gray-900">
                      {torqueMetrics.pass_rate != null ? `${torqueMetrics.pass_rate}%` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Retorque</span>
                    <span className="text-sm font-medium text-yellow-600">
                      {torqueMetrics.rework != null ? `${torqueMetrics.rework}%` : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Threshold-Based Alerts */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Threshold Alerts & Breaches</h2>
              <Link
                to="/alerts"
                className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                View all alerts
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                        Severity
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                        Alert Type
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                        Machine / Sensor
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                        Value
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                        Threshold
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                        Time
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {alerts.length ? (
                      alerts.map((alert) => (
                        <tr key={alert.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border ${getSeverityBadge(alert.severity)}`}
                            >
                              {alert.severity === 'critical' && (
                                <ExclamationTriangleIcon className="w-3 h-3" />
                              )}
                              {alert.severity?.charAt(0).toUpperCase() + alert.severity?.slice(1)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{alert.type}</td>
                          <td className="px-4 py-3">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{alert.machine || '—'}</div>
                              <div className="text-xs text-gray-500">{alert.sensor || '—'}</div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm font-semibold text-red-600">
                              {alert.value != null ? `${alert.value} ${alert.unit || ''}`.trim() : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-gray-600">
                              {alert.threshold != null ? `${alert.threshold} ${alert.unit || ''}`.trim() : '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">{alert.time || '—'}</td>
                          <td className="px-4 py-3">
                            <button className="text-xs font-medium text-blue-600 hover:text-blue-700">
                              View →
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">
                          No alerts for the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Real-Time IoT Ticker Events */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Live IoT Events</h2>
              <div className="flex items-center gap-2 text-xs">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-gray-500">Real-time feed</span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="space-y-3 max-h-80 overflow-y-auto">
                {events.length ? (
                  events.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 transition-all"
                    >
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          event.severity === 'critical'
                            ? 'bg-red-100'
                            : event.severity === 'high'
                              ? 'bg-orange-100'
                              : event.severity === 'medium'
                                ? 'bg-yellow-100'
                                : 'bg-green-100'
                        }`}
                      >
                        <BoltIcon
                          className={`w-4 h-4 ${
                            event.severity === 'critical'
                              ? 'text-red-600'
                              : event.severity === 'high'
                                ? 'text-orange-600'
                                : event.severity === 'medium'
                                  ? 'text-yellow-600'
                                  : 'text-green-600'
                          }`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold text-gray-900">{event.title}</h4>
                          <span className="text-xs text-gray-500 whitespace-nowrap">{event.time || '—'}</span>
                        </div>
                        <p className="text-sm text-gray-600 mt-0.5">{event.message}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-24 flex items-center justify-center text-sm text-gray-500">
                    No IoT events in the selected window.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Current Machine Health & Status */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Machine Health & Status</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Status Summary */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Status Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[{
                    key: 'online',
                    label: 'Online',
                    icon: CheckCircleIcon,
                    bg: 'bg-green-50 border border-green-200',
                    textColor: 'text-green-900',
                  }, {
                    key: 'fault',
                    label: 'Fault',
                    icon: XCircleIcon,
                    bg: 'bg-red-50 border border-red-200',
                    textColor: 'text-red-900',
                  }, {
                    key: 'idle',
                    label: 'Idle',
                    icon: ClockIcon,
                    bg: 'bg-yellow-50 border border-yellow-200',
                    textColor: 'text-yellow-900',
                  }, {
                    key: 'offline',
                    label: 'Offline',
                    icon: XCircleIcon,
                    bg: 'bg-gray-50 border border-gray-200',
                    textColor: 'text-gray-900',
                  }].map((item) => {
                    const Icon = item.icon
                    const value = Number(machineStatus[item.key]) || 0
                    return (
                      <div key={item.key} className={`p-4 rounded-lg ${item.bg}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={`w-5 h-5 ${item.textColor}`} />
                          <span className={`text-sm font-medium ${item.textColor}`}>{item.label}</span>
                        </div>
                        <div className={`text-2xl font-bold ${item.textColor}`}>
                          {value.toLocaleString()}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Health Score Distribution */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Health Score Distribution</h3>
                <div className="space-y-3">
                  {healthBars.map((bar) => (
                    <div key={bar.key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">{bar.label}</span>
                        <span className="text-sm font-semibold text-gray-900">
                          {bar.value.toLocaleString()} machines
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div className={`${bar.color} h-2 rounded-full`} style={{ width: `${bar.width}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Drill-Down Navigation */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Drill-Down</h2>
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-6">
              <p className="text-sm text-gray-700 mb-4">
                Navigate through the hierarchy: <strong>Plant → Shop → Line → Machine → Sensor</strong>
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/workshops/body-shop"
                  className="px-4 py-2 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all text-sm font-medium text-gray-900"
                >
                  Body Shop → Line 2 → Weld Robot 18
                </Link>
                <Link
                  to="/workshops/paint-shop"
                  className="px-4 py-2 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all text-sm font-medium text-gray-900"
                >
                  Paint Shop → Line 3 → Oven 2 → Temp Sensor
                </Link>
                <Link
                  to="/workshops/final-assembly"
                  className="px-4 py-2 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all text-sm font-medium text-gray-900"
                >
                  Final Assembly → EOL Test Station 4
                </Link>
                <Link
                  to="/workshops/utilities"
                  className="px-4 py-2 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all text-sm font-medium text-gray-900"
                >
                  Utilities → Compressor 3 → Pressure Monitor
                </Link>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default OperatorDashboard
