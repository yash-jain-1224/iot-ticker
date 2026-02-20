import { useState, useEffect, useMemo } from 'react'
import { useDashboardData } from '../../hooks/useDashboardData'
import {
  ChartBarIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  BoltIcon,
  FunnelIcon,
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
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Scatter,
  ScatterChart,
  ZAxis,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'
import { useFilterStore } from '../../store/filterStore'
import LocationFilter from '../../components/LocationFilter'
import TimeRangeFilter from '../../components/TimeRangeFilter'
import KPICard from '../../components/KPICard'
import {
  KPICardSkeleton,
  ChartSkeleton,
  TableSkeleton,
  MetricCardSkeleton,
  PageHeaderSkeleton,
  FilterBarSkeleton,
  PanelSkeleton,
  ForecastCardSkeleton,
  LineTableSkeleton,
} from '../../components/skeletons'

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

const formatNumber = (value, decimals = 1) => {
  if (value == null || Number.isNaN(Number(value))) {
    return '—'
  }
  if (decimals == null) {
    return Number(value).toLocaleString()
  }
  return Number(value).toFixed(decimals)
}

const formatChangeValue = (change, unit = '', decimals = 1) => {
  if (change == null || Number.isNaN(Number(change))) {
    return null
  }
  const numeric = Number(change)
  const magnitude =
    decimals == null ? Math.abs(numeric).toLocaleString() : Math.abs(numeric).toFixed(decimals)
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : ''
  const trimmedUnit = unit?.toString().trim()
  const unitText = trimmedUnit
    ? trimmedUnit.startsWith('%') || trimmedUnit.startsWith('/')
      ? trimmedUnit
      : ` ${trimmedUnit}`
    : ''
  return `${sign}${magnitude}${unitText}`
}

const formatVarianceText = (variance, variancePercent, unit = '', decimals = 1) => {
  if (variance == null || Number.isNaN(Number(variance))) {
    return '—'
  }
  const varianceValue = Number(variance)
  const sign = varianceValue > 0 ? '+' : varianceValue < 0 ? '-' : ''
  const magnitude =
    decimals == null ? Math.abs(varianceValue).toLocaleString() : Math.abs(varianceValue).toFixed(decimals)
  const unitText = unit ? ` ${unit.trim()}` : ''
  let percentText = ''
  if (variancePercent != null && !Number.isNaN(Number(variancePercent))) {
    const percentValue = Number(variancePercent)
    const percentSign = percentValue > 0 ? '+' : percentValue < 0 ? '-' : ''
    percentText = ` (${percentSign}${Math.abs(percentValue).toFixed(1)}%)`
  }
  return `${sign}${magnitude}${unitText}${percentText}`
}

const resolveChangeType = (metric) => {
  if (!metric) return 'neutral'
  if (metric.change_type) return metric.change_type
  const numericChange = Number(metric.change)
  if (Number.isNaN(numericChange) || numericChange === 0) {
    return 'neutral'
  }
  return numericChange > 0 ? 'positive' : 'negative'
}

const formatMetricWithUnit = (value, unit = '', decimals = 1) => {
  if (value == null || Number.isNaN(Number(value))) {
    return '—'
  }
  const formatted = formatNumber(value, decimals)
  const trimmedUnit = unit?.toString().trim()
  return trimmedUnit ? `${formatted} ${trimmedUnit}` : formatted
}

const calcPercentOf = (value, base) => {
  if (value == null || base == null) {
    return 0
  }
  const numericValue = Number(value)
  const numericBase = Number(base)
  if (Number.isNaN(numericValue) || Number.isNaN(numericBase) || numericBase === 0) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round((numericValue / numericBase) * 100)))
}

const buildForecastCard = (card, unit, higherIsBetter = true) => {
  if (!card || (card.forecast == null && card.actual == null)) {
    return null
  }

  const forecast = card.forecast != null ? Number(card.forecast) : null
  const actual = card.actual != null ? Number(card.actual) : null
  const variance = forecast != null && actual != null ? actual - forecast : null
  const variancePercent = variance != null && forecast
    ? (variance / forecast) * 100
    : null

  let changeType = 'neutral'
  if (variance != null) {
    const isPositive = variance >= 0
    changeType = higherIsBetter ? (isPositive ? 'positive' : 'negative') : (isPositive ? 'negative' : 'positive')
  }

  return {
    forecast,
    actual,
    variance,
    variancePercent,
    unit,
    changeType,
  }
}

const getCorrelationStyles = (severity) => {
  switch (severity) {
    case 'critical':
      return {
        container: 'bg-red-50 border border-red-200',
        iconClass: 'text-red-600',
        Icon: ExclamationTriangleIcon,
      }
    case 'high':
      return {
        container: 'bg-yellow-50 border border-yellow-200',
        iconClass: 'text-yellow-600',
        Icon: ExclamationTriangleIcon,
      }
    case 'medium':
      return {
        container: 'bg-blue-50 border border-blue-200',
        iconClass: 'text-blue-600',
        Icon: CheckCircleIcon,
      }
    default:
      return {
        container: 'bg-gray-50 border border-gray-200',
        iconClass: 'text-gray-600',
        Icon: CheckCircleIcon,
      }
  }
}

const getInsightStyles = (severity) => {
  switch (severity) {
    case 'critical':
      return {
        container: 'bg-red-50 border border-red-200',
        iconClass: 'text-red-600',
        Icon: ExclamationTriangleIcon,
      }
    case 'warning':
      return {
        container: 'bg-yellow-50 border border-yellow-200',
        iconClass: 'text-yellow-600',
        Icon: ClockIcon,
      }
    default:
      return {
        container: 'bg-blue-50 border border-blue-200',
        iconClass: 'text-blue-600',
        Icon: CheckCircleIcon,
      }
  }
}

function ManagerDashboard() {
  const { location, timeRange } = useFilterStore()
  const [selectedView, setSelectedView] = useState('trends')
  const [linePage, setLinePage] = useState(1)
  const [alertPage, setAlertPage] = useState(1)
  const LINE_PAGE_SIZE = 10
  const ALERT_PAGE_SIZE = 10

  // Fetch manager view data with hybrid API + WebSocket approach
  const {
    data: managerData,
    isLoading,
    isError,
    error,
    refetch,
    isConnected,
    lastUpdated,
    dataSource,
  } = useDashboardData(
    'manager',
    // API params
    {
      plant_id: mapLocationToPlantId(location),
      shop_type: location?.shop_type,
      time_range: timeRange,
    },
    // WebSocket params
    {
      plant_id: mapLocationToPlantId(location),
      shop_type: location?.shop_type,
      time_range: timeRange,
    }
  )

  // Provide default empty object if data is null
  const safeManagerData = managerData || {}
  const kpis = safeManagerData.kpis || {}
  const oeeKpi = kpis.oee || {}
  const productionKpi = kpis.production || {}
  const downtimeKpi = kpis.downtime || {}
  const energyKpi = kpis.energy || {}

  const shifts = Array.isArray(safeManagerData.shifts) ? safeManagerData.shifts : []
  const lines = useMemo(() => Array.isArray(safeManagerData.lines) ? safeManagerData.lines : [], [safeManagerData.lines])

  const trends = safeManagerData.trends || {}
  const shiftOeeTrend = Array.isArray(trends.shift_oee) ? trends.shift_oee : []
  const productionVsTarget = Array.isArray(trends.production_vs_target) ? trends.production_vs_target : []
  const downtimeCategories = Array.isArray(trends.downtime_categories) ? trends.downtime_categories : []
  const qualityVsCycle = Array.isArray(trends.quality_vs_cycle) ? trends.quality_vs_cycle : []
  const energyTrend = Array.isArray(trends.energy) ? trends.energy : []
  const shopPerformanceProfile = Array.isArray(trends.shop_performance) ? trends.shop_performance : []

  const rootCause = safeManagerData.root_cause_analysis || {}
  const topRootCauses = Array.isArray(rootCause.top_causes) ? rootCause.top_causes : []
  const sensorCorrelations = Array.isArray(rootCause.sensor_correlations) ? rootCause.sensor_correlations : []
  const drilldowns = Array.isArray(rootCause.drilldowns) ? rootCause.drilldowns : []

  const forecast = safeManagerData.forecast || {}
  const forecastCards = forecast.cards || {}
  const forecastInsights = Array.isArray(forecast.insights) ? forecast.insights : []
  const productionForecastSeries = Array.isArray(forecast.production_series) ? forecast.production_series : []
  const downtimeForecastSeries = Array.isArray(forecast.downtime_series) ? forecast.downtime_series : []
  const qualityForecastSeries = Array.isArray(forecast.quality_series) ? forecast.quality_series : []
  const modelAccuracySeries = Array.isArray(forecast.model_accuracy) ? forecast.model_accuracy : []

  const alertSummary = safeManagerData.alert_summary || {}
  const alerts = useMemo(() => Array.isArray(safeManagerData.alerts) ? safeManagerData.alerts : [], [safeManagerData.alerts])

  const resolvedForecastCards = {
    production: buildForecastCard(forecastCards.production, forecastCards.production?.unit || 'units', true),
    downtime: buildForecastCard(forecastCards.downtime, forecastCards.downtime?.unit || 'min', false),
    energy: buildForecastCard(forecastCards.energy, forecastCards.energy?.unit || 'kWh', false),
  }
  const resolvedAlerts = alerts

  const _hasAlerts = resolvedAlerts.length > 0

  const renderEmptyState = (message) => (
    <div className="bg-white rounded-xl border border-gray-200 p-6 text-sm text-gray-600">{message}</div>
  )

  const paginatedLines = useMemo(() => {
    if (!lines.length) {
      return []
    }
    const start = (linePage - 1) * LINE_PAGE_SIZE
    return lines.slice(start, start + LINE_PAGE_SIZE)
  }, [lines, linePage])

  const totalLinePages = useMemo(() => {
    return lines.length ? Math.ceil(lines.length / LINE_PAGE_SIZE) : 0
  }, [lines])

  useEffect(() => {
    if (linePage > totalLinePages && totalLinePages > 0) {
      setLinePage(1)
    }
  }, [linePage, totalLinePages])

  useEffect(() => {
    setLinePage(1)
  }, [lines.length])

  const paginatedAlerts = useMemo(() => {
    if (!alerts.length) {
      return []
    }
    const start = (alertPage - 1) * ALERT_PAGE_SIZE
    return alerts.slice(start, start + ALERT_PAGE_SIZE)
  }, [alerts, alertPage])

  const totalAlertPages = useMemo(() => {
    return alerts.length ? Math.ceil(alerts.length / ALERT_PAGE_SIZE) : 0
  }, [alerts])

  useEffect(() => {
    if (alertPage > totalAlertPages && totalAlertPages > 0) {
      setAlertPage(1)
    }
  }, [alertPage, totalAlertPages])

  useEffect(() => {
    setAlertPage(1)
  }, [alerts.length, selectedView])

  const _productionForecastCard = resolvedForecastCards.production
  const _downtimeForecastCard = resolvedForecastCards.downtime
  const _energyForecastCard = resolvedForecastCards.energy

  const renderSkeletonByView = () => {
    switch (selectedView) {
      case 'rootcause':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PanelSkeleton className="min-h-[240px]" />
            <PanelSkeleton className="min-h-[240px]" />
            <PanelSkeleton className="min-h-[200px]" />
          </div>
        )
      case 'forecast':
        return (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ForecastCardSkeleton />
              <ForecastCardSkeleton />
              <ForecastCardSkeleton />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartSkeleton />
              <ChartSkeleton />
              <ChartSkeleton />
              <ChartSkeleton />
            </div>
          </>
        )
      case 'alerts':
        return (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
              <MetricCardSkeleton />
            </div>
            <TableSkeleton rows={8} />
          </>
        )
      case 'trends':
      default:
        return (
          <>
            <PanelSkeleton className="min-h-[220px]" />
            <LineTableSkeleton />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartSkeleton />
              <ChartSkeleton />
              <ChartSkeleton />
              <ChartSkeleton />
            </div>
          </>
        )
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <PageHeaderSkeleton />
        <FilterBarSkeleton />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICardSkeleton />
          <KPICardSkeleton />
          <KPICardSkeleton />
          <KPICardSkeleton />
        </div>
        {renderSkeletonByView()}
      </div>
    )
  }

  const views = [
    { id: 'trends', name: 'Performance Trends', icon: ArrowTrendingUpIcon },
    { id: 'rootcause', name: 'Root Cause Analysis', icon: FunnelIcon },
    { id: 'forecast', name: 'Forecast vs Actual', icon: ChartBarIcon },
    { id: 'alerts', name: 'Alert Escalation', icon: ExclamationTriangleIcon },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
              <ChartBarIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Manager View</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Shift analysis, root cause investigation & forecasting
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LocationFilter />
          <TimeRangeFilter />
          {/* Connection Status Badge */}
          {isConnected ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-xs font-medium text-green-700">Live</span>
            </div>
          ) : dataSource === 'api' ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              <span className="text-xs font-medium text-yellow-700">Connecting...</span>
            </div>
          ) : null}
          <div className="text-xs text-gray-500">
            Updated{' '}
            {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
          </div>
        </div>
      </div>

      {/* View Selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3 overflow-x-auto">
          {views.map((view) => {
            const Icon = view.icon
            return (
              <button
                key={view.id}
                onClick={() => setSelectedView(view.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
                  selectedView === view.id
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {view.name}
              </button>
            )
          })}
        </div>
      </div>

      {isError ? (
        <div className="flex items-center justify-center py-12">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-6 max-w-lg text-center">
            <h2 className="text-lg font-semibold">Failed to load manager analytics</h2>
            <p className="text-sm text-red-600 mt-2">
              {error?.response?.data?.message || error?.message || 'An unexpected error occurred while fetching manager dashboard data.'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-md hover:bg-purple-700"
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <>
          {isLoading && (
            <div className="space-y-6">
              <PageHeaderSkeleton />
              <FilterBarSkeleton />
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICardSkeleton />
                <KPICardSkeleton />
                <KPICardSkeleton />
                <KPICardSkeleton />
              </div>
              <PanelSkeleton className="min-h-[240px]" />
              <LineTableSkeleton />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartSkeleton />
                <ChartSkeleton />
                <ChartSkeleton />
                <ChartSkeleton />
              </div>
            </div>
          )}
          {/* KPI Summary */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Key Performance Indicators</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="Overall OEE"
                value={formatNumber(oeeKpi.value, 1)}
                unit={oeeKpi.unit || '%'}
                change={formatChangeValue(oeeKpi.change, oeeKpi.unit || '%')}
                changeType={resolveChangeType(oeeKpi)}
                icon={ChartBarIcon}
                iconBg="bg-green-100"
                iconColor="text-green-600"
              />
              <KPICard
                title="Production Output"
                value={formatNumber(productionKpi.value, null)}
                unit={productionKpi.unit || 'units'}
                change={formatChangeValue(productionKpi.change, productionKpi.unit || 'units', null)}
                changeType={resolveChangeType(productionKpi)}
                icon={ArrowTrendingUpIcon}
                iconBg="bg-blue-100"
                iconColor="text-blue-600"
              />
              <KPICard
                title="Total Downtime"
                value={formatNumber(downtimeKpi.value, null)}
                unit={downtimeKpi.unit || 'min'}
                change={formatChangeValue(downtimeKpi.change, downtimeKpi.unit || 'min', null)}
                changeType={resolveChangeType(downtimeKpi)}
                icon={ClockIcon}
                iconBg="bg-orange-100"
                iconColor="text-orange-600"
              />
              <KPICard
                title="Energy Consumption"
                value={formatNumber(energyKpi.value, null)}
                unit={energyKpi.unit || 'kWh'}
                change={formatChangeValue(energyKpi.change, energyKpi.unit || 'kWh', null)}
                changeType={resolveChangeType(energyKpi)}
                icon={BoltIcon}
                iconBg="bg-yellow-100"
                iconColor="text-yellow-600"
              />
            </div>
          </div>

          {selectedView === 'trends' && !isLoading && (
            <>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Shift-wise Performance Trends</h2>
                {shifts.length ? (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {shifts.map((shift, idx) => (
                      <div key={`${shift.name || shift.shift_number}-${idx}`} className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold text-gray-900">{shift.name || `Shift ${idx + 1}`}</h3>
                          {shift.trend === 'up' ? (
                            <ArrowTrendingUpIcon className="w-5 h-5 text-green-600" />
                          ) : shift.trend === 'down' ? (
                            <ArrowTrendingDownIcon className="w-5 h-5 text-red-600" />
                          ) : (
                            <div className="w-5 h-1 bg-gray-400 rounded" />
                          )}
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">OEE</span>
                            <span className="text-lg font-bold text-gray-900">{formatNumber(shift.oee, 1)}%</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">Production</span>
                            <span className="text-sm font-semibold text-gray-700">{formatNumber(shift.production, null)} units</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">Downtime</span>
                            <span className="text-sm font-medium text-orange-600">{formatNumber(shift.downtime, 1)} min</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-600">Quality</span>
                            <span className="text-sm font-medium text-green-600">{formatNumber(shift.quality, 1)}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  renderEmptyState('No shift performance data available for the selected filters.')
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Production Line Performance</h2>
                {lines.length ? (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Line</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Plant</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Shop</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">OEE</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Availability</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Performance</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Quality</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Downtime</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {paginatedLines.map((line, idx) => (
                            <tr key={`line-${idx}-${line.id || ''}-${line.name || ''}`} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">{line.name}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{line.plant || '—'}</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{line.shop || '—'}</td>
                              <td className="px-4 py-3 text-sm font-bold text-gray-900">{formatNumber(line.oee, 1)}%</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{formatNumber(line.availability, 1)}%</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{formatNumber(line.performance, 1)}%</td>
                              <td className="px-4 py-3 text-sm text-gray-600">{formatNumber(line.quality, 1)}%</td>
                              <td className="px-4 py-3 text-sm font-medium text-orange-600">{formatNumber(line.downtime, 1)} min</td>
                              <td className="px-4 py-3">
                                <span
                                  className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${
                                    line.status === 'excellent'
                                      ? 'bg-green-100 text-green-800'
                                      : line.status === 'good'
                                        ? 'bg-blue-100 text-blue-800'
                                        : 'bg-yellow-100 text-yellow-800'
                                  }`}
                                >
                                  {line.status ? line.status.charAt(0).toUpperCase() + line.status.slice(1) : 'Unknown'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {totalLinePages > 1 && (
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
                        <div className="text-xs text-gray-500">
                          Showing {(linePage - 1) * LINE_PAGE_SIZE + 1} - {Math.min(linePage * LINE_PAGE_SIZE, lines.length)} of {lines.length}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setLinePage((prev) => Math.max(1, prev - 1))}
                            disabled={linePage === 1}
                            className={`px-3 py-1 text-xs font-medium rounded-md border ${
                              linePage === 1 ? 'text-gray-400 border-gray-200 cursor-not-allowed' : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                            }`}
                          >
                            Previous
                          </button>
                          <span className="text-xs text-gray-500">Page {linePage} of {totalLinePages}</span>
                          <button
                            type="button"
                            onClick={() => setLinePage((prev) => Math.min(totalLinePages, prev + 1))}
                            disabled={linePage === totalLinePages}
                            className={`px-3 py-1 text-xs font-medium rounded-md border ${
                              linePage === totalLinePages ? 'text-gray-400 border-gray-200 cursor-not-allowed' : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                            }`}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  renderEmptyState('No production line metrics available for the selected filters.')
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Performance Analytics & Trends</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">OEE Trend by Shift</h3>
                    {shiftOeeTrend.length ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={shiftOeeTrend}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="day" stroke="#6b7280" fontSize={12} />
                          <YAxis stroke="#6b7280" fontSize={12} domain={[0, 100]} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#fff',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                            }}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="shiftA" stroke="#10b981" strokeWidth={2} name="Shift A" dot={{ fill: '#10b981', r: 4 }} />
                          <Line type="monotone" dataKey="shiftB" stroke="#3b82f6" strokeWidth={2} name="Shift B" dot={{ fill: '#3b82f6', r: 4 }} />
                          <Line type="monotone" dataKey="shiftC" stroke="#f59e0b" strokeWidth={2} name="Shift C" dot={{ fill: '#f59e0b', r: 4 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      renderEmptyState('No shift trend data available.')
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Production vs Target</h3>
                    {productionVsTarget.length ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={productionVsTarget}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis dataKey="day" stroke="#6b7280" fontSize={12} />
                          <YAxis stroke="#6b7280" fontSize={12} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#fff',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                            }}
                          />
                          <Legend />
                          <Bar dataKey="actual" fill="#3b82f6" name="Actual" radius={[8, 8, 0, 0]} />
                          <Line type="monotone" dataKey="target" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" name="Target" dot={{ fill: '#ef4444', r: 4 }} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    ) : (
                      renderEmptyState('No production trend data available.')
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Downtime by Category</h3>
                    {downtimeCategories.length ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie
                            data={downtimeCategories}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, value }) => `${name} ${value}`}
                            outerRadius={90}
                            fill="#8884d8"
                            dataKey="value"
                          >
                            {downtimeCategories.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      renderEmptyState('No downtime breakdown available.')
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Quality vs Cycle Time</h3>
                    {qualityVsCycle.length ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis type="number" dataKey="cycleTime" name="Cycle Time" unit="s" stroke="#6b7280" fontSize={12} />
                          <YAxis type="number" dataKey="quality" name="Quality" unit="%" stroke="#6b7280" fontSize={12} domain={[0, 100]} />
                          <ZAxis type="number" dataKey="downtime" range={[50, 400]} />
                          <Tooltip
                            cursor={{ strokeDasharray: '3 3' }}
                            contentStyle={{
                              backgroundColor: '#fff',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                            }}
                          />
                          <Legend />
                          <Scatter name="Lines" data={qualityVsCycle} fill="#8b5cf6" />
                        </ScatterChart>
                      </ResponsiveContainer>
                    ) : (
                      renderEmptyState('No quality vs cycle time data available.')
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Energy Consumption</h3>
                    {energyTrend.length ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={energyTrend}>
                          <defs>
                            <linearGradient id="colorEnergy" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="day" stroke="#6b7280" fontSize={12} />
                          <YAxis stroke="#6b7280" fontSize={12} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#fff',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                            }}
                          />
                          <Area type="monotone" dataKey="energy" stroke="#f59e0b" strokeWidth={2} fill="url(#colorEnergy)" name="Energy (kWh)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      renderEmptyState('No energy trend data available.')
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Shop Performance Profile</h3>
                    {shopPerformanceProfile.length ? (
                      <ResponsiveContainer width="100%" height={280}>
                        <RadarChart data={shopPerformanceProfile}>
                          <PolarGrid stroke="#e5e7eb" />
                          <PolarAngleAxis dataKey="metric" stroke="#6b7280" fontSize={11} />
                          <PolarRadiusAxis angle={90} domain={[0, 100]} stroke="#6b7280" fontSize={10} />
                          <Radar name="Body Shop" dataKey="bodyShop" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                          <Radar name="Paint Shop" dataKey="paintShop" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
                          <Radar name="Final Assembly" dataKey="finalAssembly" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                          <Radar name="Utilities" dataKey="utilities" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                          <Legend />
                          <Tooltip />
                        </RadarChart>
                      </ResponsiveContainer>
                    ) : (
                      renderEmptyState('No shop performance data available.')
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {selectedView === 'rootcause' && !isLoading && (
            <>
              {/* Root Cause Analysis */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Downtime Root Cause Analysis
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Top Downtime Causes */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Top Downtime Causes</h3>
                    <div className="space-y-3">
                      {topRootCauses.map((cause) => (
                        <div key={`${cause.cause}-${cause.shop}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div>
                              <span className="text-sm font-medium text-gray-900">{cause.cause}</span>
                              <span className="text-xs text-gray-500 ml-2">• {cause.shop}</span>
                            </div>
                            <span className="text-sm font-semibold text-gray-900">
                              {cause.minutes} min ({cause.percentage}%)
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-orange-500 h-2 rounded-full"
                              style={{ width: `${cause.percentage}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Sensor Correlations */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Sensor Correlations</h3>
                    <div className="space-y-4">
                      {sensorCorrelations.map((correlation) => {
                        const { container, iconClass, Icon } = getCorrelationStyles(correlation.severity)
                        return (
                          <div key={correlation.id} className={`p-3 rounded-lg ${container}`}>
                            <div className="flex items-start gap-3">
                              <Icon className={`w-5 h-5 ${iconClass} flex-shrink-0 mt-0.5`} />
                              <div className="flex-1">
                                <h4 className="text-sm font-semibold text-gray-900 mb-1">
                                  {correlation.title}
                                </h4>
                                <p className="text-xs text-gray-600 mb-2">
                                  {correlation.shop}, {correlation.asset} - Correlation: {formatNumber(correlation.correlation, 2)}
                                </p>
                                <div className="text-xs text-gray-700 mb-1">{correlation.summary}</div>
                                {correlation.recommendation && (
                                  <div className="text-xs text-gray-500">Recommendation: {correlation.recommendation}</div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Machine Performance Drill-Down */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Machine-Level Drill-Down</h2>
                <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl border border-purple-200 p-6">
                  <div className="mb-4">
                    <h3 className="font-semibold text-gray-900 mb-2">Hierarchical Navigation</h3>
                    <p className="text-sm text-gray-700">
                      <strong>Plant</strong> → <strong>Location</strong> → <strong>Line</strong> →{' '}
                      <strong>Machine</strong> → <strong>Sensor</strong>
                    </p>
                  </div>
                  <div className="space-y-2">
                    {drilldowns.map((item, index) => (
                      <button
                        key={`${item.path}-${index}`}
                        className="w-full px-4 py-3 bg-white rounded-lg border border-gray-200 hover:border-purple-300 hover:shadow-md transition-all text-left"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-semibold text-gray-900">{item.path}</div>
                            <div className="text-xs text-gray-500 mt-1">{item.description}</div>
                          </div>
                          <svg
                            className="w-5 h-5 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {selectedView === 'forecast' && !isLoading && (
            <>
              {/* Forecast vs Actual */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Forecast vs Actual Performance
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Production Output</h3>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-gray-600">Forecast</span>
                          <span className="text-sm font-medium text-gray-500">
                            {formatMetricWithUnit(resolvedForecastCards.production.forecast, 'units', null)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gray-400 h-2 rounded-full"
                            style={{
                              width: `${calcPercentOf(
                                resolvedForecastCards.production.forecast,
                                resolvedForecastCards.production.forecast || 1,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-gray-900">Actual</span>
                          <span className="text-sm font-bold text-green-600">
                            {formatMetricWithUnit(resolvedForecastCards.production.actual, 'units', null)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full"
                            style={{
                              width: `${calcPercentOf(
                                resolvedForecastCards.production.actual,
                                resolvedForecastCards.production.forecast || 1,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="pt-2 border-t border-gray-200">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Variance</span>
                          <span
                            className={`text-sm font-semibold ${
                              resolvedForecastCards.production.change_type === 'negative'
                                ? 'text-red-600'
                                : 'text-green-600'
                            }`}
                          >
                            {formatVarianceText(
                              resolvedForecastCards.production.variance,
                              resolvedForecastCards.production.variance_percent,
                              resolvedForecastCards.production.unit,
                              1,
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Downtime Prediction</h3>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-gray-600">Forecast</span>
                          <span className="text-sm font-medium text-gray-500">
                            {formatMetricWithUnit(resolvedForecastCards.downtime.forecast, 'min', null)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gray-400 h-2 rounded-full"
                            style={{
                              width: `${calcPercentOf(
                                resolvedForecastCards.downtime.forecast,
                                (resolvedForecastCards.downtime.forecast || 1) * 1.2,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-gray-900">Actual</span>
                          <span className="text-sm font-bold text-orange-600">
                            {formatMetricWithUnit(resolvedForecastCards.downtime.actual, 'min', null)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-orange-500 h-2 rounded-full"
                            style={{
                              width: `${calcPercentOf(
                                resolvedForecastCards.downtime.actual,
                                (resolvedForecastCards.downtime.forecast || 1) * 1.2,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="pt-2 border-t border-gray-200">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Variance</span>
                          <span
                            className={`text-sm font-semibold ${
                              resolvedForecastCards.downtime.change_type === 'positive'
                                ? 'text-green-600'
                                : 'text-red-600'
                            }`}
                          >
                            {formatVarianceText(
                              resolvedForecastCards.downtime.variance,
                              resolvedForecastCards.downtime.variance_percent,
                              resolvedForecastCards.downtime.unit,
                              1,
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Energy Consumption</h3>
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-gray-600">Forecast</span>
                          <span className="text-sm font-medium text-gray-500">
                            {formatMetricWithUnit(resolvedForecastCards.energy.forecast, 'kWh', null)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gray-400 h-2 rounded-full"
                            style={{
                              width: `${calcPercentOf(
                                resolvedForecastCards.energy.forecast,
                                (resolvedForecastCards.energy.forecast || 1) * 1.05,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-gray-900">Actual</span>
                          <span className="text-sm font-bold text-yellow-600">
                            {formatMetricWithUnit(resolvedForecastCards.energy.actual, 'kWh', null)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className="bg-yellow-500 h-2 rounded-full" style={{ width: '92%' }} />
                        </div>
                      </div>
                      <div className="pt-2 border-t border-gray-200">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">Variance</span>
                          <span
                            className={`text-sm font-semibold ${
                              resolvedForecastCards.energy.change_type === 'negative'
                                ? 'text-red-600'
                                : 'text-green-600'
                            }`}
                          >
                            {formatVarianceText(
                              resolvedForecastCards.energy.variance,
                              resolvedForecastCards.energy.variance_percent,
                              resolvedForecastCards.energy.unit,
                              1,
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Predictive Insights */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Predictive Insights</h2>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="space-y-4">
                    {forecastInsights.map((insight, idx) => {
                      const { container, iconClass, Icon } = getInsightStyles(insight.severity)
                      return (
                        <div key={`${insight.title}-${idx}`} className={`p-4 rounded-lg ${container}`}>
                          <div className="flex items-start gap-3">
                            <Icon className={`w-6 h-6 flex-shrink-0 ${iconClass}`} />
                            <div className="flex-1">
                              <h4 className="text-sm font-semibold text-gray-900 mb-1">{insight.title}</h4>
                              <p className="text-sm text-gray-700 mb-2">{insight.description}</p>
                              {insight.factors?.length ? (
                                <ul className="text-xs text-gray-600 list-disc pl-4 space-y-1">
                                  {insight.factors.map((factor, factorIdx) => (
                                    <li key={`${factor}-${factorIdx}`}>{factor}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Forecast Charts */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Forecast Analytics & Predictions
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Production Forecast */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Production Forecast (7 Days)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={productionForecastSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="day" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="upper"
                          stroke="none"
                          fill="#bfdbfe"
                          fillOpacity={0.3}
                          name="Upper Bound"
                        />
                        <Area
                          type="monotone"
                          dataKey="lower"
                          stroke="none"
                          fill="#fff"
                          fillOpacity={1}
                          name="Lower Bound"
                        />
                        <Line
                          type="monotone"
                          dataKey="forecast"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          name="Forecast"
                          dot={{ fill: '#3b82f6', r: 4 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="actual"
                          stroke="#10b981"
                          strokeWidth={2}
                          name="Actual"
                          dot={{ fill: '#10b981', r: 5 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Downtime Forecast */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Downtime Forecast (7 Days)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={downtimeForecastSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="day" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Bar dataKey="predicted" fill="#94a3b8" name="Predicted (min)" radius={[8, 8, 0, 0]} />
                        <Bar dataKey="actual" fill="#f59e0b" name="Actual (min)" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Quality Forecast Accuracy */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Quality Rate Forecast</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={qualityForecastSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="day" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} domain={[96, 99]} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="forecast"
                          stroke="#8b5cf6"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          name="Forecast (%)"
                          dot={{ fill: '#8b5cf6', r: 4 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="actual"
                          stroke="#10b981"
                          strokeWidth={2}
                          name="Actual (%)"
                          dot={{ fill: '#10b981', r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Forecast Model Accuracy */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Model Accuracy by Metric</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart layout="vertical" data={modelAccuracySeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis type="number" domain={[0, 100]} stroke="#6b7280" fontSize={12} />
                        <YAxis type="category" dataKey="metric" stroke="#6b7280" fontSize={12} width={80} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Bar dataKey="accuracy" fill="#3b82f6" name="Accuracy (%)" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}

          {selectedView === 'alerts' && !isLoading && (
            <>
              {/* Alert Escalation Status */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Alert Escalation Management</h2>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">Open Alerts</span>
                      <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="text-3xl font-bold text-gray-900">
                      {alertSummary.open ?? 23}
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">Acknowledged</span>
                      <CheckCircleIcon className="w-5 h-5 text-blue-600" />
                    </div>
                    <div className="text-3xl font-bold text-gray-900">
                      {alertSummary.acknowledged ?? 15}
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">SLA Risk</span>
                      <ClockIcon className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="text-3xl font-bold text-gray-900">
                      {alertSummary.sla_risk ?? 5}
                    </div>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">Resolved Today</span>
                      <CheckCircleIcon className="w-5 h-5 text-green-600" />
                    </div>
                    <div className="text-3xl font-bold text-gray-900">
                      {alertSummary.resolved ?? 42}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Alert ID
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Severity
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Machine / Location
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Issue
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Status
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Assigned To
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            SLA
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {paginatedAlerts.map((alert) => (
                          <tr key={alert.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-mono text-gray-900">{alert.id}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${
                                  alert.severity === 'critical'
                                    ? 'bg-red-100 text-red-800'
                                    : alert.severity === 'high'
                                      ? 'bg-orange-100 text-orange-800'
                                      : 'bg-yellow-100 text-yellow-800'
                                }`}
                              >
                                {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div>
                                <div className="text-sm font-medium text-gray-900">{alert.machine}</div>
                                <div className="text-xs text-gray-500">{alert.location}</div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">{alert.issue}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex px-2 py-1 rounded-md text-xs font-medium ${
                                  alert.status === 'open'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-blue-100 text-blue-800'
                                }`}
                              >
                                {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">{alert.assigned}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`text-xs font-medium ${alert.sla_risk ? 'text-red-600' : 'text-gray-600'}`}
                              >
                                {alert.sla}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <button className="text-xs font-medium text-purple-600 hover:text-purple-700">
                                Manage →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalAlertPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
                      <div className="text-xs text-gray-500">
                        Showing {(alertPage - 1) * ALERT_PAGE_SIZE + 1} - {Math.min(alertPage * ALERT_PAGE_SIZE, alerts.length)} of {alerts.length}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setAlertPage((prev) => Math.max(1, prev - 1))}
                          disabled={alertPage === 1}
                          className={`px-3 py-1 text-xs font-medium rounded-md border ${
                            alertPage === 1 ? 'text-gray-400 border-gray-200 cursor-not-allowed' : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          Previous
                        </button>
                        <span className="text-xs text-gray-500">Page {alertPage} of {totalAlertPages}</span>
                        <button
                          type="button"
                          onClick={() => setAlertPage((prev) => Math.min(totalAlertPages, prev + 1))}
                          disabled={alertPage === totalAlertPages}
                          className={`px-3 py-1 text-xs font-medium rounded-md border ${
                            alertPage === totalAlertPages
                              ? 'text-gray-400 border-gray-200 cursor-not-allowed'
                              : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                          }`}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default ManagerDashboard
