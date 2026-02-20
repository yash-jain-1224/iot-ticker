import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useMemo } from 'react'
import { kpisAPI, plantsAPI } from '../services/api'
import { useFilterStore } from '../store/filterStore'
import { MetricCardSkeleton, FilterBarSkeleton, ChartSkeleton, PanelSkeleton } from '../components/skeletons'
import LocationFilter from '../components/LocationFilter'
import TimeRangeFilter from '../components/TimeRangeFilter'
import {
  ChartBarIcon,
  ClockIcon,
  BoltIcon,
  CogIcon,
  CheckCircleIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  MinusIcon,
  CpuChipIcon,
  TruckIcon,
  WrenchScrewdriverIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline'
import TrendLine from '../components/charts/TrendLine'
import clsx from 'clsx'
import logger from '../utils/logger'

const LEGACY_LOCATION_CODES = {
  jamshedpur: 'HOUSTON-001',
  sanand: 'DALLAS-001',
  pune: 'AUSTIN-001',
}

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const formatPercent = (value, digits = 1) =>
  isFiniteNumber(value) ? `${value.toFixed(digits)}%` : 'N/A'

const formatHours = (minutes) =>
  isFiniteNumber(minutes) ? `${(minutes / 60).toFixed(1)}h` : 'N/A'

const formatThousands = (value, digits = 1) =>
  isFiniteNumber(value) ? `${(value / 1000).toFixed(digits)}k` : 'N/A'

const formatCurrencyThousands = (value, digits = 1) =>
  isFiniteNumber(value) ? `₹${(value / 1000).toFixed(digits)}k` : 'N/A'

const createLocationLookup = (plants = []) => {
  const map = {}

  const register = (key, meta) => {
    if (!key) return
    map[String(key).toLowerCase()] = meta
  }

  plants.forEach((plant) => {
    if (!plant) return
    const meta = {
      id: plant.id ?? plant.plant_id ?? null,
      code: plant.code ?? plant.plant_code ?? null,
      name: plant.name ?? plant.plant_name ?? null,
    }

    register(plant.id, meta)
    register(plant.code, meta)
    register(plant.name, meta)
    register(plant.location, meta)
    register(plant.city, meta)
    register(plant.state, meta)

    Object.entries(LEGACY_LOCATION_CODES).forEach(([slug, code]) => {
      if (code === meta.code) {
        register(slug, meta)
      }
    })
  })

  return map
}

const areLocationMapsEqual = (a = {}, b = {}) => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => {
    const first = a[key]
    const second = b[key]
    return first?.id === second?.id && first?.code === second?.code
  })
}

const getLocationMeta = (location, locationMap = {}) => {
  if (!location || location === 'all') return null
  if (typeof location === 'object') {
    const id = location.id ?? location.plant_id ?? null
    const code = location.code ?? location.plant_code ?? null
    const name = location.name ?? location.plant_name ?? null
    if (id || code || name) {
      return { id, code, name }
    }
  }

  const normalized = String(location).toLowerCase()
  if (locationMap[normalized]) {
    return locationMap[normalized]
  }

  if (LEGACY_LOCATION_CODES[normalized]) {
    return { id: null, code: LEGACY_LOCATION_CODES[normalized], name: null }
  }

  return null
}

const formatShopType = (shopType) => {
  if (!shopType) return 'Unknown'
  return shopType
    .toString()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

const computeDelta = (series = [], key) => {
  if (!Array.isArray(series) || series.length < 2) return null
  const last = Number(series[series.length - 1]?.[key])
  const previous = Number(series[series.length - 2]?.[key])
  if (!Number.isFinite(last) || !Number.isFinite(previous)) return null
  return last - previous
}

const computeDowntimeDelta = (series = []) => {
  if (!Array.isArray(series) || series.length < 2) return null
  const totalMinutes = (entry) => Number(entry?.planned ?? 0) + Number(entry?.unplanned ?? 0)
  const last = totalMinutes(series[series.length - 1])
  const previous = totalMinutes(series[series.length - 2])
  if (!Number.isFinite(last) || !Number.isFinite(previous)) return null
  return last - previous
}

const computePercentDelta = (series = [], key) => {
  if (!Array.isArray(series) || series.length < 2) return null
  const last = Number(series[series.length - 1]?.[key])
  const previous = Number(series[series.length - 2]?.[key])
  if (!Number.isFinite(last) || !Number.isFinite(previous) || previous === 0) return null
  return ((last - previous) / Math.abs(previous)) * 100
}

const palette = {
  blue: { solid: 'rgba(37, 99, 235, 1)', transparent: 'rgba(37, 99, 235, 0.15)' },
  green: { solid: 'rgba(22, 163, 74, 1)', transparent: 'rgba(22, 163, 74, 0.15)' },
  orange: { solid: 'rgba(249, 115, 22, 1)', transparent: 'rgba(249, 115, 22, 0.18)' },
  purple: { solid: 'rgba(139, 92, 246, 1)', transparent: 'rgba(139, 92, 246, 0.15)' },
  slate: { solid: 'rgba(100, 116, 139, 1)', transparent: 'rgba(100, 116, 139, 0.15)' },
  rose: { solid: 'rgba(244, 63, 94, 1)', transparent: 'rgba(244, 63, 94, 0.18)' },
}

const formatTrendDate = (value, index) => {
  if (!value) return `T+${index + 1}`
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return typeof value === 'string' ? value : `T+${index + 1}`
  }
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const createTrendLabels = (trend = []) =>
  trend.map((entry, index) => formatTrendDate(entry?.date ?? entry?.timestamp, index))

const buildLineDataset = (label, data, { solid, transparent }, extra = {}) => ({
  label,
  data,
  borderColor: solid,
  backgroundColor: transparent,
  tension: 0.35,
  fill: false,
  spanGaps: true,
  pointRadius: 2.5,
  pointHoverRadius: 4,
  borderWidth: 2,
  ...extra,
})

const createLineOptions = ({
  suffix,
  legend = true,
  suggestedMin,
  suggestedMax,
  yAxes = {},
  tooltipFormatter,
} = {}) => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { display: legend, position: 'bottom' },
    tooltip: {
      callbacks: {
        label: (context) => {
          const value = context.parsed.y
          const datasetLabel = context.dataset.label || ''
          if (value === null || Number.isNaN(value)) {
            return `${datasetLabel}: N/A`
          }
          if (tooltipFormatter) {
            return `${datasetLabel}: ${tooltipFormatter(value, context)}`
          }
          if (suffix === '%') return `${datasetLabel}: ${value.toFixed(1)}%`
          if (suffix === 'h') return `${datasetLabel}: ${value.toFixed(2)}h`
          if (suffix === 'kWh') return `${datasetLabel}: ${value.toLocaleString()} kWh`
          if (suffix === 'kWh/unit') return `${datasetLabel}: ${value.toFixed(3)} kWh/unit`
          if (suffix === 'units') return `${datasetLabel}: ${value.toLocaleString()} units`
          return `${datasetLabel}: ${value.toLocaleString()}`
        },
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { maxRotation: 0 },
    },
    y: {
      beginAtZero: suggestedMin === 0,
      suggestedMin,
      suggestedMax,
      grid: { color: 'rgba(148, 163, 184, 0.2)' },
      ticks: {
        callback: (value) => {
          if (suffix === '%') return `${value}%`
          if (suffix === 'h') return `${value}h`
          if (suffix === 'kWh') return `${value}kWh`
          if (suffix === 'kWh/unit') return `${value}`
          if (suffix === 'units') return `${value}`
          return value
        },
      },
    },
    ...yAxes,
  },
})

const STORAGE_KEY = 'analytics-active-tab'

const validTab = (value) => ['overview', 'oee', 'production', 'downtime', 'energy'].includes(value)

function Analytics() {
  const { location, timeRange } = useFilterStore()
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === 'undefined') return 'overview'
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored && validTab(stored) ? stored : 'overview'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [metricFilter, setMetricFilter] = useState('all')
  const [shopFilter, setShopFilter] = useState('all')
  const [shops, setShops] = useState([])
  const [shopsLoading, setShopsLoading] = useState(true)
  const [locationMap, setLocationMap] = useState({})
  const [refreshKey, setRefreshKey] = useState(0)

  // Fetch shops
  useEffect(() => {
    fetchShops()
    setShopFilter('all')
  }, [location]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchShops = async () => {
    try {
      setShopsLoading(true)
      const hierarchyRes = await plantsAPI.getHierarchy()
      const hierarchy = Array.isArray(hierarchyRes.data) ? hierarchyRes.data : []

      const lookup = createLocationLookup(hierarchy)
      setLocationMap((prev) => (areLocationMapsEqual(prev, lookup) ? prev : lookup))

      const activeMeta = getLocationMeta(location, lookup)
      const activePlantId = activeMeta?.id ?? null
      const activePlantCode = activeMeta?.code ?? null

      const aggregatedShops = new Map()

      hierarchy.forEach((plant) => {
        if (!plant) return
        const plantId = plant.id ?? plant.plant_id ?? null
        const plantCode = plant.code ?? plant.plant_code ?? null
        const includePlant =
          (!activePlantId && !activePlantCode) ||
          (activePlantId && plantId === activePlantId) ||
          (activePlantCode && plantCode === activePlantCode)

        if (!includePlant || !Array.isArray(plant.shops)) {
          return
        }

        plant.shops.forEach((shop) => {
          if (!shop) return
          const rawId = shop.shop_id ?? shop.id
          if (rawId === undefined || rawId === null) {
            return
          }

          const formattedType = formatShopType(shop.shop_type ?? shop.type)
          const plantName = plant.name ?? plant.plant_name ?? 'Unknown Plant'
          const shopId = String(rawId)

          aggregatedShops.set(shopId, {
            id: shopId,
            type: formattedType,
            plantName,
            displayName:
              activePlantId || activePlantCode
                ? formattedType
                : `${formattedType} – ${plantName}`,
          })
        })
      })

      const orderedShops = Array.from(aggregatedShops.values()).sort((a, b) => {
        if (!activePlantId && !activePlantCode) {
          const plantCompare = a.plantName.localeCompare(b.plantName)
          if (plantCompare !== 0) return plantCompare
        }
        return a.type.localeCompare(b.type)
      })

      setShops(orderedShops)

      if (shopFilter !== 'all' && !orderedShops.some((shop) => shop.id === shopFilter)) {
        setShopFilter('all')
      }
    } catch (error) {
      logger.error('Error fetching shops:', error)
      setShops([])
    } finally {
      setShopsLoading(false)
    }
  }

  const locationMeta = useMemo(() => getLocationMeta(location, locationMap), [location, locationMap])

  const filterParams = useMemo(() => {
    const params = {}

    if (location && location !== 'all') {
      params.location = location
    }

    if (timeRange) {
      params.timeRange = timeRange
    }

    if (locationMeta?.id) {
      params.plant_id = locationMeta.id
    }

    if (locationMeta?.code) {
      params.plant_code = locationMeta.code
    }

    if (shopFilter !== 'all') {
      const numericShopId = Number(shopFilter)
      if (!Number.isNaN(numericShopId)) {
        params.shop_id = numericShopId
      }
    }

    return params
  }, [location, locationMeta, timeRange, shopFilter])

  const filterParamsKey = useMemo(() => JSON.stringify(filterParams), [filterParams])

  // Fetch KPI data with filters
  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1)
  }

  const { data: oeeResponse, isLoading: oeeLoading, isFetching: oeeFetching } = useQuery({
    queryKey: ['kpis', 'oee', filterParamsKey, refreshKey],
    queryFn: async () => {
      const response = await kpisAPI.getOEE(filterParams)
      return response.data
    },
  })

  const { data: productionResponse, isLoading: productionLoading, isFetching: productionFetching } = useQuery({
    queryKey: ['kpis', 'production', filterParamsKey, refreshKey],
    queryFn: async () => {
      const response = await kpisAPI.getProduction(filterParams)
      return response.data
    },
  })

  const { data: downtimeResponse, isLoading: downtimeLoading, isFetching: downtimeFetching } = useQuery({
    queryKey: ['kpis', 'downtime', filterParamsKey, refreshKey],
    queryFn: async () => {
      const response = await kpisAPI.getDowntime(filterParams)
      return response.data
    },
  })

  const { data: energyResponse, isLoading: energyLoading, isFetching: energyFetching } = useQuery({
    queryKey: ['kpis', 'energy', filterParamsKey, refreshKey],
    queryFn: async () => {
      const response = await kpisAPI.getEnergy(filterParams)
      return response.data
    },
  })

  const { data: reliabilityResponse, isLoading: reliabilityLoading, isFetching: reliabilityFetching } = useQuery({
    queryKey: ['kpis', 'reliability', filterParamsKey, refreshKey],
    queryFn: async () => {
      const response = await kpisAPI.getReliability(filterParams)
      return response.data
    },
  })

  const oeeData = useMemo(() => {
    if (!oeeResponse) return null
    const current = oeeResponse.current || {}
    const trend = oeeResponse.trend || []
    const average = oeeResponse.average || {}
    const percentDelta = computePercentDelta(trend, 'oee')
    return {
      availability: isFiniteNumber(current.availability) ? current.availability : null,
      performance: isFiniteNumber(current.performance) ? current.performance : null,
      quality: isFiniteNumber(current.quality) ? current.quality : null,
      oee: isFiniteNumber(current.oee) ? current.oee : null,
      trend,
      average,
      delta: computeDelta(trend, 'oee'),
      percentDelta,
    }
  }, [oeeResponse])

  const productionData = useMemo(() => {
    if (!productionResponse) return null
    const summary = productionResponse.summary || {}
    const trend = productionResponse.trend || []
    const percentDelta = computePercentDelta(trend, 'actual')

    return {
      totalPlanned: summary.planned ?? null,
      totalActual: summary.actual ?? null,
      efficiency: summary.efficiency ?? null,
      goodUnits: summary.good_units ?? null,
      defectUnits: summary.defects ?? null,
      scrapUnits: summary.scrap ?? null,
      qualityRate: summary.quality_rate ?? null,
      trend,
      delta: computeDelta(trend, 'actual'),
      percentDelta,
    }
  }, [productionResponse])

  const downtimeData = useMemo(() => {
    if (!downtimeResponse) return null
    const summary = downtimeResponse.summary || {}
    const trend = downtimeResponse.trend || []
    const plannedMinutes = summary.planned_minutes ?? summary.plannedMinutes ?? null
    const unplannedMinutes = summary.unplanned_minutes ?? summary.unplannedMinutes ?? null
    const totalMinutesRaw = summary.total_minutes ?? summary.totalMinutes ?? (Number(plannedMinutes ?? 0) + Number(unplannedMinutes ?? 0))
    const totalMinutes = Number.isFinite(Number(totalMinutesRaw)) ? Number(totalMinutesRaw) : null
    const totalHours = Number.isFinite(totalMinutes) ? totalMinutes / 60 : (summary.total_hours ?? summary.totalHours ?? null)

    const downtimePercentDelta = (() => {
      if (!Array.isArray(trend) || trend.length < 2) return null
      const totalForEntry = (entry) => Number(entry?.planned ?? 0) + Number(entry?.unplanned ?? 0)
      const last = totalForEntry(trend[trend.length - 1])
      const previous = totalForEntry(trend[trend.length - 2])
      if (!Number.isFinite(last) || !Number.isFinite(previous) || previous === 0) return null
      return ((last - previous) / Math.abs(previous)) * 100
    })()

    return {
      plannedMinutes: Number.isFinite(Number(plannedMinutes)) ? Number(plannedMinutes) : null,
      unplannedMinutes: Number.isFinite(Number(unplannedMinutes)) ? Number(unplannedMinutes) : null,
      totalMinutes,
      totalHours: Number.isFinite(Number(totalHours)) ? Number(totalHours) : null,
      count: summary.count ?? null,
      trend,
      delta: computeDowntimeDelta(trend),
      percentDelta: downtimePercentDelta,
      byReason: downtimeResponse.by_reason || downtimeResponse.byReason || null,
    }
  }, [downtimeResponse])

  const energyData = useMemo(() => {
    if (!energyResponse) return null
    const summary = energyResponse.summary || {}
    const trend = energyResponse.trend || []
    const percentDelta = computePercentDelta(trend, 'consumption')
    return {
      totalKwh: summary.total_kwh ?? summary.totalKwh ?? null,
      perUnitKwh: summary.per_unit_kwh ?? summary.perUnitKwh ?? null,
      costEstimate: summary.cost_estimate ?? summary.costEstimate ?? null,
      trend,
      delta: computeDelta(trend, 'consumption'),
      percentDelta,
    }
  }, [energyResponse])

  const reliabilityData = useMemo(() => {
    if (!reliabilityResponse) return null
    const summary = reliabilityResponse.summary || {}
    const trend = reliabilityResponse.trend || []
    return {
      mtbfHours: summary.avg_mtbf_hours ?? summary.avgMtbfHours ?? summary.mtbf ?? null,
      mttrHours: summary.avg_mttr_hours ?? summary.avgMttrHours ?? summary.mttr ?? null,
      availability: summary.availability ?? summary.uptime ?? null,
      trend,
    }
  }, [reliabilityResponse])

  const isLoading = oeeLoading || productionLoading || downtimeLoading || energyLoading || reliabilityLoading

  const renderTrendIcon = (change) => {
    if (!Number.isFinite(change) || change === 0) return <MinusIcon className="w-4 h-4" />
    if (change > 0) return <ArrowTrendingUpIcon className="w-4 h-4" />
    return <ArrowTrendingDownIcon className="w-4 h-4" />
  }

  const getTrendColor = (change, isPositiveGood = true) => {
    if (!Number.isFinite(change) || change === 0) return 'text-gray-500'
    const isPositive = change > 0
    const isGood = isPositiveGood ? isPositive : !isPositive
    return isGood ? 'text-green-600' : 'text-red-600'
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, activeTab)
  }, [activeTab])

  const isFetchingAny = oeeFetching || productionFetching || downtimeFetching || energyFetching || reliabilityFetching

  const tabs = [
    { id: 'overview', label: 'Overview', icon: ChartBarIcon },
    { id: 'oee', label: 'OEE Analysis', icon: CheckCircleIcon },
    { id: 'production', label: 'Production', icon: TruckIcon },
    { id: 'downtime', label: 'Downtime', icon: ClockIcon },
    { id: 'energy', label: 'Energy', icon: BoltIcon },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500 mt-0.5">Advanced analytics and insights</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <LocationFilter />
          <TimeRangeFilter />
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            disabled={isFetchingAny}
          >
            <ArrowPathIcon className={clsx('w-4 h-4', isFetchingAny && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters bar - Independent Loading */}
      {shopsLoading ? (
        <FilterBarSkeleton filterCount={3} />
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="space-y-5">
          {/* Filter header */}
          <div className="flex items-center gap-2">
            <FunnelIcon className="w-5 h-5 text-gray-700" />
            <h3 className="text-base font-semibold text-gray-900">Filters</h3>
          </div>

          {/* Filter controls */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Search Metrics
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search metrics..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-11 pl-10 pr-10 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Metric Type filter */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Metric Type
              </label>
              <select
                value={metricFilter}
                onChange={(e) => setMetricFilter(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              >
                <option value="all">All Metrics</option>
                <option value="oee">OEE</option>
                <option value="production">Production</option>
                <option value="downtime">Downtime</option>
                <option value="energy">Energy</option>
              </select>
            </div>

            {/* Shop filter */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Workshop
              </label>
              <select
                value={shopFilter}
                onChange={(e) => setShopFilter(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              >
                <option value="all">
                  {location?.plant_id ? 'All Workshops' : 'All Workshops (All Locations)'}
                </option>
                {shops.map(shop => (
                  <option key={shop.id} value={shop.id}>
                    {shop.displayName || shop.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active filters and clear button */}
          {(searchQuery || metricFilter !== 'all' || shopFilter !== 'all') && (
            <div className="flex items-center justify-between pt-3 border-t border-gray-200">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">
                  {[searchQuery !== '', metricFilter !== 'all', shopFilter !== 'all'].filter(Boolean).length}
                </span>
                <span>
                  active filter{[searchQuery !== '', metricFilter !== 'all', shopFilter !== 'all'].filter(Boolean).length !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={() => {
                  setSearchQuery('')
                  setMetricFilter('all')
                  setShopFilter('all')
                }}
                className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'py-4 px-1 inline-flex items-center gap-2 border-b-2 font-medium text-sm transition-colors',
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Main KPI Cards - Progressive Loading */}
              {isLoading ? (
                <MetricCardSkeleton count={4} columns={4} />
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* OEE */}
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6 border border-blue-200">
                  <div className="flex items-center justify-between mb-4">
                    <CogIcon className="w-10 h-10 text-blue-600" />
                    <div className={clsx(
                      'flex items-center gap-1 text-sm font-medium',
                      getTrendColor(oeeData?.percentDelta ?? null)
                    )}>
                      {renderTrendIcon(oeeData?.percentDelta)}
                      {Number.isFinite(oeeData?.percentDelta)
                        ? `${Math.abs(oeeData.percentDelta).toFixed(1)}%`
                        : 'N/A'}
                    </div>
                  </div>
                  <p className="text-sm font-medium text-blue-900 mb-1">OEE</p>
                  <p className="text-3xl font-bold text-blue-900">
                    {Number.isFinite(oeeData?.oee) ? formatPercent(oeeData.oee, 1) : 'N/A'}
                  </p>
                  <p className="text-xs text-blue-700 mt-2">Overall Equipment Effectiveness</p>
                </div>

                {/* Production */}
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6 border border-green-200">
                  <div className="flex items-center justify-between mb-4">
                    <TruckIcon className="w-10 h-10 text-green-600" />
                    <div className={clsx(
                      'flex items-center gap-1 text-sm font-medium',
                      getTrendColor(productionData?.percentDelta ?? null)
                    )}>
                      {renderTrendIcon(productionData?.percentDelta)}
                      {Number.isFinite(productionData?.percentDelta)
                        ? `${Math.abs(productionData.percentDelta).toFixed(1)}%`
                        : 'N/A'}
                    </div>
                  </div>
                  <p className="text-sm font-medium text-green-900 mb-1">Production</p>
                  <p className="text-3xl font-bold text-green-900">
                    {Number.isFinite(productionData?.totalActual)
                      ? productionData.totalActual.toLocaleString()
                      : 'N/A'}
                  </p>
                  <p className="text-xs text-green-700 mt-2">Units Produced</p>
                </div>

                {/* Downtime */}
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-6 border border-orange-200">
                  <div className="flex items-center justify-between mb-4">
                    <ClockIcon className="w-10 h-10 text-orange-600" />
                    <div className={clsx(
                      'flex items-center gap-1 text-sm font-medium',
                      getTrendColor(downtimeData?.percentDelta ?? null, false)
                    )}>
                      {renderTrendIcon(downtimeData?.percentDelta)}
                      {Number.isFinite(downtimeData?.percentDelta)
                        ? `${Math.abs(downtimeData.percentDelta).toFixed(1)}%`
                        : 'N/A'}
                    </div>
                  </div>
                  <p className="text-sm font-medium text-orange-900 mb-1">Downtime</p>
                  <p className="text-3xl font-bold text-orange-900">
                    {Number.isFinite(downtimeData?.totalMinutes)
                      ? formatHours(downtimeData.totalMinutes)
                      : 'N/A'}
                  </p>
                  <p className="text-xs text-orange-700 mt-2">Total Downtime Hours</p>
                </div>

                {/* Energy */}
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6 border border-purple-200">
                  <div className="flex items-center justify-between mb-4">
                    <BoltIcon className="w-10 h-10 text-purple-600" />
                    <div className={clsx(
                      'flex items-center gap-1 text-sm font-medium',
                      getTrendColor(energyData?.percentDelta ?? null, false)
                    )}>
                      {renderTrendIcon(energyData?.percentDelta)}
                      {Number.isFinite(energyData?.percentDelta)
                        ? `${Math.abs(energyData.percentDelta).toFixed(1)}%`
                        : 'N/A'}
                    </div>
                  </div>
                  <p className="text-sm font-medium text-purple-900 mb-1">Energy</p>
                  <p className="text-3xl font-bold text-purple-900">
                    {Number.isFinite(energyData?.totalKwh)
                      ? formatThousands(energyData.totalKwh, 1)
                      : 'N/A'}
                  </p>
                  <p className="text-xs text-purple-700 mt-2">kWh Consumed</p>
                </div>
              </div>
              )}

              {/* Overview Trend Grid */}
              {isLoading ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <ChartSkeleton key={index} height="h-64" title={false} />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">OEE Trend</h3>
                        <p className="text-xs text-gray-500">Availability · Performance · Quality</p>
                      </div>
                    </div>
                    <div className="h-64">
                      <TrendLine
                        labels={createTrendLabels(oeeData?.trend)}
                        datasets={[
                          buildLineDataset('OEE', oeeData?.trend?.map((item) => item?.oee ?? null) ?? [], palette.blue, { fill: true }),
                          buildLineDataset('Availability', oeeData?.trend?.map((item) => item?.availability ?? null) ?? [], palette.green),
                          buildLineDataset('Performance', oeeData?.trend?.map((item) => item?.performance ?? null) ?? [], palette.orange),
                          buildLineDataset('Quality', oeeData?.trend?.map((item) => item?.quality ?? null) ?? [], palette.purple),
                        ]}
                        options={createLineOptions({ suffix: '%', suggestedMin: 0, suggestedMax: 100 })}
                      />
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">Production vs Planned</h3>
                        <p className="text-xs text-gray-500">Actual, Planned, Good Units</p>
                      </div>
                    </div>
                    <div className="h-64">
                      <TrendLine
                        labels={createTrendLabels(productionData?.trend)}
                        datasets={[
                          buildLineDataset('Actual', productionData?.trend?.map((item) => item?.actual ?? null) ?? [], palette.green, { fill: true }),
                          buildLineDataset('Planned', productionData?.trend?.map((item) => item?.planned ?? null) ?? [], palette.blue),
                          buildLineDataset('Good Units', productionData?.trend?.map((item) => item?.good ?? null) ?? [], palette.purple),
                        ]}
                        options={createLineOptions({ suffix: 'units' })}
                      />
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">Downtime Trend</h3>
                        <p className="text-xs text-gray-500">Planned vs Unplanned Minutes</p>
                      </div>
                    </div>
                    <div className="h-64">
                      <TrendLine
                        labels={createTrendLabels(downtimeData?.trend)}
                        datasets={[
                          buildLineDataset('Planned', downtimeData?.trend?.map((item) => (item?.planned != null ? item.planned / 60 : null)) ?? [], palette.blue, { fill: true }),
                          buildLineDataset('Unplanned', downtimeData?.trend?.map((item) => (item?.unplanned != null ? item.unplanned / 60 : null)) ?? [], palette.rose, { fill: true }),
                        ]}
                        options={createLineOptions({ suffix: 'h', tooltipFormatter: (value) => `${value.toFixed(2)}h` })}
                      />
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">Energy Consumption</h3>
                        <p className="text-xs text-gray-500">Consumption · Per Unit</p>
                      </div>
                    </div>
                    <div className="h-64">
                      <TrendLine
                        labels={createTrendLabels(energyData?.trend)}
                        datasets={[
                          buildLineDataset('Consumption (kWh)', energyData?.trend?.map((item) => item?.consumption ?? null) ?? [], palette.orange, { fill: true }),
                          buildLineDataset('Per Unit', energyData?.trend?.map((item) => item?.per_unit ?? item?.perUnit ?? null) ?? [], palette.green),
                        ]}
                        options={createLineOptions({ suffix: 'kWh', tooltipFormatter: (value, context) => {
                          const label = context.dataset.label || ''
                          if (label.includes('Per Unit')) return `${value.toFixed(3)} kWh/unit`
                          return `${value.toLocaleString()} kWh`
                        } })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Reliability Metrics - Independent Loading */}
              {reliabilityLoading ? (
                <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
                  <div className="h-6 bg-gray-200 rounded w-48 mb-4"></div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="border-l-4 border-gray-200 pl-4">
                        <div className="h-4 bg-gray-200 rounded w-40 mb-2"></div>
                        <div className="h-8 bg-gray-200 rounded w-24"></div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : reliabilityData && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <CpuChipIcon className="w-5 h-5 text-blue-600" />
                    Reliability Metrics
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="border-l-4 border-blue-500 pl-4">
                      <p className="text-sm text-gray-600 mb-1">MTBF (Mean Time Between Failures)</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {Number.isFinite(reliabilityData?.mtbfHours) ? `${reliabilityData.mtbfHours.toFixed(2)}h` : 'N/A'}
                      </p>
                    </div>
                    <div className="border-l-4 border-green-500 pl-4">
                      <p className="text-sm text-gray-600 mb-1">MTTR (Mean Time To Repair)</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {Number.isFinite(reliabilityData?.mttrHours) ? `${reliabilityData.mttrHours.toFixed(2)}h` : 'N/A'}
                      </p>
                    </div>
                    <div className="border-l-4 border-purple-500 pl-4">
                      <p className="text-sm text-gray-600 mb-1">Availability</p>
                      <p className="text-2xl font-bold text-gray-900">
                        {Number.isFinite(reliabilityData?.availability) ? `${reliabilityData.availability.toFixed(1)}%` : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Key Insights */}
              <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Key Insights</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                    <CheckCircleIcon className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">OEE Performance</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {Number.isFinite(oeeData?.oee) && oeeData.oee >= 85
                          ? 'World-class performance maintained' 
                          : Number.isFinite(oeeData?.oee) && oeeData.oee >= 60 
                          ? 'Good performance with room for improvement' 
                          : 'Significant improvement opportunities identified'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-green-50 rounded-lg">
                    <TruckIcon className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">Production Trend</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {Number.isFinite(productionData?.percentDelta) && productionData.percentDelta > 5 
                          ? 'Strong production growth observed' 
                          : Number.isFinite(productionData?.percentDelta) && productionData.percentDelta > 0 
                          ? 'Steady production levels maintained' 
                          : 'Production efficiency needs attention'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg">
                    <WrenchScrewdriverIcon className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-gray-900">Maintenance Impact</p>
                      <p className="text-sm text-gray-600 mt-1">
                        {Number.isFinite(downtimeData?.percentDelta) && downtimeData.percentDelta < 0 
                          ? 'Downtime reduction strategies showing results' 
                          : Number.isFinite(downtimeData?.percentDelta) && downtimeData.percentDelta > 0 
                          ? 'Increasing downtime requires investigation' 
                          : 'Stable downtime patterns observed'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* OEE Analysis Tab */}
          {activeTab === 'oee' && (
            <div className="space-y-6">
              {oeeLoading ? (
                <>
                  <PanelSkeleton height="h-48" />
                  <PanelSkeleton height="h-56" />
                  <PanelSkeleton height="h-72" />
                </>
              ) : (
                <>
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-8 border border-blue-200">
                    <h3 className="text-2xl font-bold text-blue-900 mb-2">
                      {Number.isFinite(oeeData?.oee) ? formatPercent(oeeData.oee, 1) : 'N/A'}
                    </h3>
                    <p className="text-blue-700 mb-6">Overall Equipment Effectiveness</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white/50 rounded-lg p-4">
                        <p className="text-sm text-blue-900 mb-1">Availability</p>
                        <p className="text-2xl font-bold text-blue-900">
                          {Number.isFinite(oeeData?.availability) ? formatPercent(oeeData.availability, 1) : 'N/A'}
                        </p>
                      </div>
                      <div className="bg-white/50 rounded-lg p-4">
                        <p className="text-sm text-blue-900 mb-1">Performance</p>
                        <p className="text-2xl font-bold text-blue-900">
                          {Number.isFinite(oeeData?.performance) ? formatPercent(oeeData.performance, 1) : 'N/A'}
                        </p>
                      </div>
                      <div className="bg-white/50 rounded-lg p-4">
                        <p className="text-sm text-blue-900 mb-1">Quality</p>
                        <p className="text-2xl font-bold text-blue-900">
                          {Number.isFinite(oeeData?.quality) ? formatPercent(oeeData.quality, 1) : 'N/A'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">OEE Breakdown</h3>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium text-gray-700">Availability</span>
                          <span className="text-sm font-bold text-gray-900">{Number.isFinite(oeeData?.availability) ? oeeData.availability.toFixed(1) : 'N/A'}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all"
                            style={{ width: `${Number.isFinite(oeeData?.availability) ? oeeData.availability : 0}%` }}
                          ></div>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Time machine was available vs planned production time</p>
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium text-gray-700">Performance</span>
                          <span className="text-sm font-bold text-gray-900">{Number.isFinite(oeeData?.performance) ? oeeData.performance.toFixed(1) : 'N/A'}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-green-600 h-2 rounded-full transition-all"
                            style={{ width: `${Number.isFinite(oeeData?.performance) ? oeeData.performance : 0}%` }}
                          ></div>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Actual output vs maximum possible output</p>
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium text-gray-700">Quality</span>
                          <span className="text-sm font-bold text-gray-900">{Number.isFinite(oeeData?.quality) ? oeeData.quality.toFixed(1) : 'N/A'}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className="bg-purple-600 h-2 rounded-full transition-all"
                            style={{ width: `${Number.isFinite(oeeData?.quality) ? oeeData.quality : 0}%` }}
                          ></div>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Good units vs total units produced</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">OEE Trend</h3>
                    <TrendLine
                      labels={createTrendLabels(oeeData?.trend)}
                      datasets={[
                        buildLineDataset('OEE', oeeData?.trend?.map((item) => item?.oee ?? null) ?? [], palette.blue, { fill: true }),
                        buildLineDataset('Availability', oeeData?.trend?.map((item) => item?.availability ?? null) ?? [], palette.green),
                        buildLineDataset('Performance', oeeData?.trend?.map((item) => item?.performance ?? null) ?? [], palette.orange),
                        buildLineDataset('Quality', oeeData?.trend?.map((item) => item?.quality ?? null) ?? [], palette.purple),
                      ]}
                      options={createLineOptions({ suffix: '%', suggestedMin: 0, suggestedMax: 100 })}
                      height={288}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Production Tab */}
          {activeTab === 'production' && (
            <div className="space-y-6">
              {productionLoading ? (
                <>
                  <PanelSkeleton height="h-48" />
                  <PanelSkeleton height="h-72" />
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <p className="text-sm text-gray-600 mb-1">Total Production</p>
                      <p className="text-3xl font-bold text-gray-900">
                        {Number.isFinite(productionData?.totalActual)
                          ? productionData.totalActual.toLocaleString()
                          : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">Units</p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <p className="text-sm text-gray-600 mb-1">Efficiency</p>
                      <p className="text-3xl font-bold text-gray-900">
                        {Number.isFinite(productionData?.efficiency)
                          ? formatPercent(productionData.efficiency, 1)
                          : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">Actual vs Planned</p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <p className="text-sm text-gray-600 mb-1">Quality Rate</p>
                      <p className="text-3xl font-bold text-gray-900">
                        {Number.isFinite(productionData?.qualityRate)
                          ? formatPercent(productionData.qualityRate, 1)
                          : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">Good Units Share</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Production Trend</h3>
                    <TrendLine
                      labels={createTrendLabels(productionData?.trend)}
                      datasets={[
                        buildLineDataset('Actual', productionData?.trend?.map((item) => item?.actual ?? null) ?? [], palette.green, { fill: true }),
                        buildLineDataset('Planned', productionData?.trend?.map((item) => item?.planned ?? null) ?? [], palette.blue),
                        buildLineDataset('Good Units', productionData?.trend?.map((item) => item?.good ?? null) ?? [], palette.purple),
                        buildLineDataset('Defects', productionData?.trend?.map((item) => item?.defects ?? null) ?? [], palette.rose),
                      ]}
                      options={createLineOptions({ suffix: 'units' })}
                      height={288}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Downtime Tab */}
          {activeTab === 'downtime' && (
            <div className="space-y-6">
              {downtimeLoading ? (
                <>
                  <PanelSkeleton height="h-48" />
                  <PanelSkeleton height="h-48" />
                  <PanelSkeleton height="h-72" />
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <p className="text-sm text-gray-600 mb-1">Total Downtime</p>
                      <p className="text-3xl font-bold text-gray-900">
                        {Number.isFinite(downtimeData?.totalMinutes)
                          ? formatHours(downtimeData.totalMinutes)
                          : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">Hours</p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <p className="text-sm text-gray-600 mb-1">Unplanned Downtime</p>
                      <p className="text-3xl font-bold text-orange-600">
                        {Number.isFinite(downtimeData?.unplannedMinutes)
                          ? formatHours(downtimeData.unplannedMinutes)
                          : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">Hours</p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <p className="text-sm text-gray-600 mb-1">Planned Downtime</p>
                      <p className="text-3xl font-bold text-blue-600">
                        {Number.isFinite(downtimeData?.plannedMinutes)
                          ? formatHours(downtimeData.plannedMinutes)
                          : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">Hours</p>
                    </div>
                  </div>

                  {Array.isArray(downtimeData?.byReason) && downtimeData.byReason.length > 0 && (
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4">Downtime by Reason</h3>
                      <div className="space-y-3">
                        {downtimeData.byReason.map((reason) => {
                          const label = reason?.cause || reason?.reason || 'Other'
                          const minutes = reason?.minutes ?? reason?.duration ?? null
                          return (
                            <div key={label} className="flex items-center justify-between">
                              <span className="text-sm text-gray-700 capitalize">{label}</span>
                              <span className="text-sm font-bold text-gray-900">
                                {Number.isFinite(Number(minutes)) ? formatHours(Number(minutes)) : 'N/A'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Downtime Trend</h3>
                    <TrendLine
                      labels={createTrendLabels(downtimeData?.trend)}
                      datasets={[
                        buildLineDataset('Planned', downtimeData?.trend?.map((item) => (item?.planned != null ? item.planned / 60 : null)) ?? [], palette.blue, { fill: true }),
                        buildLineDataset('Unplanned', downtimeData?.trend?.map((item) => (item?.unplanned != null ? item.unplanned / 60 : null)) ?? [], palette.rose, { fill: true }),
                        buildLineDataset('Events', downtimeData?.trend?.map((item) => item?.count ?? null) ?? [], palette.slate, {
                          yAxisID: 'y1',
                          borderDash: [6, 6],
                          fill: false,
                        }),
                      ]}
                      options={createLineOptions({
                        suffix: 'h',
                        yAxes: {
                          y1: {
                            position: 'right',
                            grid: { drawOnChartArea: false },
                            ticks: {
                              callback: (value) => `${value}`,
                            },
                            title: {
                              display: true,
                              text: 'Event Count',
                            },
                          },
                        },
                        tooltipFormatter: (value, context) => {
                          if (context.dataset.yAxisID === 'y1') return `${value} events`
                          return `${value.toFixed(2)}h`
                        },
                      })}
                      height={288}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Energy Tab */}
          {activeTab === 'energy' && (
            <div className="space-y-6">
              {energyLoading ? (
                <>
                  <PanelSkeleton height="h-48" />
                  <PanelSkeleton height="h-72" />
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <p className="text-sm text-gray-600 mb-1">Total Consumption</p>
                      <p className="text-3xl font-bold text-gray-900">
                        {Number.isFinite(energyData?.totalKwh)
                          ? formatThousands(energyData.totalKwh, 1)
                          : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">kWh</p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <p className="text-sm text-gray-600 mb-1">Energy Efficiency</p>
                      <p className="text-3xl font-bold text-gray-900">
                        {Number.isFinite(energyData?.perUnitKwh)
                          ? `${energyData.perUnitKwh.toFixed(2)} kWh`
                          : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">kWh/Unit</p>
                    </div>
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                      <p className="text-sm text-gray-600 mb-1">Cost Estimate</p>
                      <p className="text-3xl font-bold text-gray-900">
                        {Number.isFinite(energyData?.costEstimate)
                          ? formatCurrencyThousands(energyData.costEstimate, 1)
                          : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 mt-2">INR</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Energy Trend</h3>
                    <TrendLine
                      labels={createTrendLabels(energyData?.trend)}
                      datasets={[
                        buildLineDataset('Consumption (kWh)', energyData?.trend?.map((item) => item?.consumption ?? null) ?? [], palette.orange, { fill: true }),
                        buildLineDataset('Per Unit', energyData?.trend?.map((item) => item?.per_unit ?? item?.perUnit ?? null) ?? [], palette.green),
                      ]}
                      options={createLineOptions({
                        suffix: 'kWh',
                        tooltipFormatter: (value, context) => {
                          const datasetLabel = context.dataset.label || ''
                          if (datasetLabel.includes('Per Unit')) return `${value.toFixed(3)} kWh/unit`
                          return `${value.toLocaleString()} kWh`
                        },
                      })}
                      height={288}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Analytics
