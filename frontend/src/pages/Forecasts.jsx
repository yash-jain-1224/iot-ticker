import { useState, useEffect, useMemo } from 'react'
import { plantsAPI } from '../services/api'
import { useFilterStore } from '../store/filterStore'
import { useForecastsWebSocket } from '../hooks/useWebSocket'
import LocationFilter from '../components/LocationFilter'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { MetricCardSkeleton, TableSkeleton, ChartSkeleton } from '../components/skeletons'
import logger from '../utils/logger'
import {
  ArrowTrendingUpIcon,
  BoltIcon,
  CpuChipIcon,
  ClockIcon,
  FunnelIcon,
  ArrowPathIcon,
  ChartBarIcon,
  ShieldExclamationIcon,
  ExclamationTriangleIcon,
  CheckBadgeIcon,
  MagnifyingGlassIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'

const forecastPeriods = [
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
]

const FAILURE_PAGE_SIZE_OPTIONS = [10, 25, 50]
const DEFAULT_FAILURE_PAGE_SIZE = 10
const FORECAST_PAGE_SIZE = 5
const CRITICAL_INSIGHTS_PAGE_SIZE = 6

const initialRiskSummary = {
  counts: {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  },
  totalForecasts: 0,
  criticalItems: [],
  healthScore: null,
}

const formatNumber = (value, options) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  return Number(value).toLocaleString(undefined, options)
}

const formatPercent = (value, fractionDigits = 1) => {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A'
  return `${Number(value).toFixed(fractionDigits)}%`
}

const formatTimestamp = (value) => {
  if (!value) return null
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return new Date(value).toLocaleString()
  }
}

const parseRecommendations = (recommendations) => {
  if (!recommendations) return null
  if (Array.isArray(recommendations)) return recommendations
  if (typeof recommendations === 'object') {
    if (Array.isArray(recommendations.actions)) {
      return recommendations.actions.map((action) => action.action || action)
    }
    return Object.values(recommendations)
  }
  if (typeof recommendations === 'string') return [recommendations]
  return null
}

const LEGACY_LOCATION_CODES = {
  jamshedpur: 'HOUSTON-001',
  sanand: 'DALLAS-001',
  pune: 'AUSTIN-001',
}

const LOCATION_SLUGS = Object.keys(LEGACY_LOCATION_CODES)

const getLocationMeta = (location, locationMap = {}) => {
  if (!location || location === 'all') return null

  if (typeof location === 'object') {
    const directId = location.plant_id || location.id
    if (directId || location.plant_code) {
      return {
        id: directId ? Number(directId) : undefined,
        code: location.plant_code,
      }
    }
  }

  const normalized = typeof location === 'string'
    ? location.toLowerCase()
    : String(location).toLowerCase()

  if (normalized && locationMap[normalized]) {
    return locationMap[normalized]
  }

  const fallbackCode = LEGACY_LOCATION_CODES[normalized]
  if (fallbackCode) {
    const normalizedCode = fallbackCode.toLowerCase()
    if (locationMap[normalizedCode]) {
      return locationMap[normalizedCode]
    }
    return { code: fallbackCode }
  }

  return null
}

const createLocationLookup = (plants = []) => {
  const map = {}

  const addKey = (key, meta) => {
    if (!key) return
    map[key.toLowerCase()] = meta
  }

  plants.forEach((plant) => {
    if (!plant) return
    const meta = {
      id: plant.id,
      code: plant.code,
    }

    addKey(String(plant.id), meta)
    addKey(plant.code, meta)
    addKey(plant.name, meta)
    addKey(plant.location, meta)
    addKey(plant.city, meta)
    addKey(plant.state, meta)

    LOCATION_SLUGS.forEach((slug) => {
      const matchesSlug = [plant.code, plant.name, plant.location, plant.city, plant.state]
        .some((value) => value?.toLowerCase().includes(slug))
      if (matchesSlug) {
        addKey(slug, meta)
      }
    })
  })

  return map
}

const areLocationMapsEqual = (a, b) => {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => {
    const aMeta = a[key]
    const bMeta = b[key]
    return aMeta?.id === bMeta?.id && aMeta?.code === bMeta?.code
  })
}

const normalizeShopType = (value) => {
  if (!value || value === 'all') return null
  return value.replace(/-/g, '_').toLowerCase()
}

export default function Forecasts() {
  const { location, plantId, shopType } = useFilterStore()
  const [loading, _setLoading] = useState(false) // WebSocket handles loading
  const [shopsLoading, setShopsLoading] = useState(true)
  const [forecastPeriod, setForecastPeriod] = useState('7d')
  const [searchQuery, setSearchQuery] = useState('')
  const [shopFilter, setShopFilter] = useState('all')
  const [shops, setShops] = useState([])
  const [riskSummary, setRiskSummary] = useState(() => ({
    ...initialRiskSummary,
    counts: { ...initialRiskSummary.counts },
  }))
  const [failureProbabilities, setFailureProbabilities] = useState([])
  const [failureStats, setFailureStats] = useState({ totalMachines: 0, highRiskCount: 0 })
  const [productionForecast, setProductionForecast] = useState(null)
  const [energyDemand, setEnergyDemand] = useState(null)
  const [locationMap, setLocationMap] = useState({})
  const [failuresPage, setFailuresPage] = useState(1)
  const [failuresPageSize, setFailuresPageSize] = useState(DEFAULT_FAILURE_PAGE_SIZE)
  const [productionPage, setProductionPage] = useState(1)
  const [energyPage, setEnergyPage] = useState(1)
  const [criticalPage, setCriticalPage] = useState(1)

  const locationMeta = useMemo(() => getLocationMeta(location, locationMap), [location, locationMap])

  // WebSocket connection for real-time forecast updates
  const {
    riskSummary: liveRiskSummary,
    failureProbabilities: liveFailureProbabilities,
    productionForecast: liveProductionForecast,
    energyDemand: liveEnergyDemand,
    isConnected: wsConnected,
  } = useForecastsWebSocket(
    locationMeta?.id || plantId,
    locationMeta?.code,
    normalizeShopType(shopType),
    shopFilter !== 'all' ? shopFilter : null,
    forecastPeriod
  )

  // Update local state when WebSocket data arrives
  useEffect(() => {
    if (liveRiskSummary) {
      const summaryCounts = liveRiskSummary.summary || {}
      const counts = {
        critical: summaryCounts.critical ?? 0,
        high: summaryCounts.high ?? 0,
        medium: summaryCounts.medium ?? 0,
        low: summaryCounts.low ?? 0,
      }
      const totalRiskEntries = Object.values(counts).reduce((total, value) => total + (value || 0), 0)
      const healthScore = totalRiskEntries
        ? (
            (counts.low * 100 +
              counts.medium * 70 +
              counts.high * 40 +
              counts.critical * 10) /
            totalRiskEntries
          )
        : null

      setRiskSummary({
        counts,
        totalForecasts: liveRiskSummary.total_forecasts ?? totalRiskEntries,
        criticalItems: liveRiskSummary.critical_items ?? [],
        healthScore,
      })
      setCriticalPage(1)
    }
  }, [liveRiskSummary])

  useEffect(() => {
    if (liveFailureProbabilities) {
      const failureEntries = Array.isArray(liveFailureProbabilities) ? liveFailureProbabilities : []
      setFailureProbabilities(failureEntries)
      setFailureStats({
        totalMachines: failureEntries.length,
        highRiskCount: failureEntries.filter(f => (f.failure_probability ?? 0) >= 0.7).length,
      })
    }
  }, [liveFailureProbabilities])

  useEffect(() => {
    if (liveProductionForecast) {
      const productionEntries = Array.isArray(liveProductionForecast) ? liveProductionForecast : []
      if (productionEntries.length) {
        const totalPredictedUnits = productionEntries.reduce((sum, entry) => sum + (entry.predicted_units || 0), 0)
        const avgConfidence =
          productionEntries.reduce((sum, entry) => sum + (entry.confidence_score ?? 0), 0) /
          productionEntries.length || 0
        const lowerBand = productionEntries.reduce((min, entry) => {
          if (entry.confidence_lower === null || entry.confidence_lower === undefined) return min
          return Math.min(min, entry.confidence_lower)
        }, Infinity)
        const upperBand = productionEntries.reduce((max, entry) => {
          if (entry.confidence_upper === null || entry.confidence_upper === undefined) return max
          return Math.max(max, entry.confidence_upper)
        }, -Infinity)

        setProductionForecast({
          entries: productionEntries
            .slice()
            .sort((a, b) => (b.predicted_units || 0) - (a.predicted_units || 0)),
          totalPredictedUnits,
          avgConfidence,
          confidenceBand: {
            lower: Number.isFinite(lowerBand) ? lowerBand : null,
            upper: Number.isFinite(upperBand) ? upperBand : null,
          },
          horizon: productionEntries[0]?.horizon ?? forecastPeriod,
          lastUpdated: productionEntries[0]?.valid_until || null,
        })
      } else {
        setProductionForecast(null)
      }
      setProductionPage(1)
    }
  }, [liveProductionForecast, forecastPeriod])

  useEffect(() => {
    if (liveEnergyDemand) {
      const energyEntries = Array.isArray(liveEnergyDemand) ? liveEnergyDemand : []
      if (energyEntries.length) {
        const totalKwh = energyEntries.reduce((sum, entry) => sum + (entry.predicted_kwh || 0), 0)
        const avgConfidence =
          energyEntries.reduce((sum, entry) => sum + (entry.confidence_score ?? 0), 0) / energyEntries.length || 0
        const lowerBand = energyEntries.reduce((min, entry) => {
          if (entry.confidence_lower === null || entry.confidence_lower === undefined) return min
          return Math.min(min, entry.confidence_lower)
        }, Infinity)
        const upperBand = energyEntries.reduce((max, entry) => {
          if (entry.confidence_upper === null || entry.confidence_upper === undefined) return max
          return Math.max(max, entry.confidence_upper)
        }, -Infinity)

        setEnergyDemand({
          entries: energyEntries
            .slice()
            .sort((a, b) => (b.predicted_kwh || 0) - (a.predicted_kwh || 0)),
          totalKwh,
          avgConfidence,
          confidenceBand: {
            lower: Number.isFinite(lowerBand) ? lowerBand : null,
            upper: Number.isFinite(upperBand) ? upperBand : null,
          },
          horizon: energyEntries[0]?.horizon ?? forecastPeriod,
          lastUpdated: energyEntries[0]?.valid_until || null,
        })
      } else {
        setEnergyDemand(null)
      }
      setEnergyPage(1)
    }
  }, [liveEnergyDemand, forecastPeriod])

  useEffect(() => {
    fetchShops()
  }, [location, plantId, shopType]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchShops = async () => {
    try {
      setShopsLoading(true)
      const hierarchyRes = await plantsAPI.getHierarchy()

      // Extract shops from hierarchy and respect active location/plant filters
      const allShops = []
      const hierarchy = hierarchyRes.data && Array.isArray(hierarchyRes.data) ? hierarchyRes.data : []

      const newLocationMap = createLocationLookup(hierarchy)
      setLocationMap((prev) => (areLocationMapsEqual(prev, newLocationMap) ? prev : newLocationMap))

      const activeLocation = getLocationMeta(location, newLocationMap)
      const normalizedShopType = normalizeShopType(shopType)
      const activePlantId = plantId ? Number(plantId) : activeLocation?.id
      const activePlantCode = activeLocation?.code

      hierarchy.forEach((plant) => {
        const matchesPlantId = activePlantId ? plant.id === activePlantId : true
        const matchesPlantCode = activePlantCode ? plant.code === activePlantCode : true

        if (matchesPlantId && matchesPlantCode && Array.isArray(plant.shops)) {
          plant.shops.forEach((shop) => {
            const matchesShopType = normalizedShopType
              ? shop.shop_type?.toLowerCase() === normalizedShopType
              : true

            if (!matchesShopType) return

            allShops.push({
              id: shop.shop_id || shop.id,
              name: shop.shop_name || shop.name,
              type: shop.shop_type,
              plant_id: plant.id,
              plant_name: plant.name,
              displayName:
                activePlantId || activePlantCode
                  ? shop.shop_name || shop.name
                  : `${shop.shop_name || shop.name} – ${plant.name}`,
            })
          })
        }
      })

      setShops(allShops)
      
      // Reset shop filter if current selection is not in the new list
      if (shopFilter !== 'all' && !allShops.find((s) => s.id === Number(shopFilter))) {
        setShopFilter('all')
      }
    } catch (error) {
      logger.error('Error fetching shops:', error)
      setShops([])
    } finally {
      setShopsLoading(false)
    }
  }

  // Manual refresh function (fallback if WebSocket fails)
  const fetchData = async () => {
    // WebSocket provides real-time data, manual refresh is just to force reconnection
    // The WebSocket hook will handle reconnection if needed
  }

  const filteredFailureProbabilities = useMemo(() => {
    if (!searchQuery) return failureProbabilities
    const query = searchQuery.toLowerCase()

    return failureProbabilities.filter((item) => {
      const haystack = [
        item.machine_code,
        item.machine_name,
        item.machine_type,
        item.machine_id,
        item.risk_level,
        item.explanation,
        JSON.stringify(item.recommendations || ''),
      ]

      return haystack.some((value) => value && value.toString().toLowerCase().includes(query))
    })
  }, [failureProbabilities, searchQuery])

  const paginatedFailureProbabilities = useMemo(() => {
    const start = (failuresPage - 1) * failuresPageSize
    return filteredFailureProbabilities.slice(start, start + failuresPageSize)
  }, [filteredFailureProbabilities, failuresPage, failuresPageSize])

  const productionEntries = useMemo(() => productionForecast?.entries || [], [productionForecast?.entries])
  const productionTotalPages = Math.max(1, Math.ceil(productionEntries.length / FORECAST_PAGE_SIZE) || 1)
  const paginatedProductionEntries = useMemo(() => {
    const start = (productionPage - 1) * FORECAST_PAGE_SIZE
    return productionEntries.slice(start, start + FORECAST_PAGE_SIZE)
  }, [productionEntries, productionPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const energyEntries = useMemo(() => energyDemand?.entries || [], [energyDemand?.entries])
  const energyTotalPages = Math.max(1, Math.ceil(energyEntries.length / FORECAST_PAGE_SIZE) || 1)
  const paginatedEnergyEntries = useMemo(() => {
    const start = (energyPage - 1) * FORECAST_PAGE_SIZE
    return energyEntries.slice(start, start + FORECAST_PAGE_SIZE)
  }, [energyEntries, energyPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const productionStartIndex = (productionPage - 1) * FORECAST_PAGE_SIZE
  const energyStartIndex = (energyPage - 1) * FORECAST_PAGE_SIZE

  const productionMetrics = useMemo(() => {
    if (!productionForecast) return []

    const { totalPredictedUnits, confidenceBand, avgConfidence, entries } = productionForecast
    const entryCount = entries.length
    const topEntry = entries[0]

    const confidenceRange =
      confidenceBand.lower !== null && confidenceBand.upper !== null
        ? `${formatNumber(confidenceBand.lower, { maximumFractionDigits: 2 })} - ${formatNumber(confidenceBand.upper, { maximumFractionDigits: 2 })}`
        : 'N/A'

    const topPerformer = topEntry
      ? `${topEntry.line_id ? `Line ${topEntry.line_id}` : topEntry.shop_id ? `Shop ${topEntry.shop_id}` : 'Aggregate'} · ${formatNumber(topEntry.predicted_units, { maximumFractionDigits: 2 })} units`
      : 'Top contributor data unavailable'

    return [
      {
        id: 'total-units',
        label: 'Total Predicted Units',
        value: formatNumber(totalPredictedUnits, { maximumFractionDigits: 2 }),
        meta: `${entryCount.toLocaleString()} forecast points`,
        icon: ArrowTrendingUpIcon,
        accent: 'text-indigo-600',
        iconBg: 'bg-indigo-500/10',
        gradient: 'from-indigo-500/15 via-indigo-500/5 to-white',
      },
      {
        id: 'confidence-range',
        label: 'Confidence Range',
        value: confidenceRange,
        meta: 'Model spread across selected horizon',
        icon: ShieldExclamationIcon,
        accent: 'text-amber-600',
        iconBg: 'bg-amber-500/10',
        gradient: 'from-amber-500/15 via-amber-500/5 to-white',
      },
      {
        id: 'average-confidence',
        label: 'Average Confidence',
        value: formatPercent((avgConfidence || 0) * 100, 0),
        meta: topPerformer,
        icon: CheckBadgeIcon,
        accent: 'text-emerald-600',
        iconBg: 'bg-emerald-500/10',
        gradient: 'from-emerald-500/15 via-emerald-500/5 to-white',
      },
    ]
  }, [productionForecast])

  const energyMetrics = useMemo(() => {
    if (!energyDemand) return []

    const { totalKwh, confidenceBand, avgConfidence, entries } = energyDemand
    const entryCount = entries.length
    const topEntry = entries[0]

    const confidenceRange =
      confidenceBand.lower !== null && confidenceBand.upper !== null
        ? `${formatNumber(confidenceBand.lower, { maximumFractionDigits: 2 })} - ${formatNumber(confidenceBand.upper, { maximumFractionDigits: 2 })} kWh`
        : 'N/A'

    const topConsumer = topEntry
      ? `${topEntry.shop_id ? `Shop ${topEntry.shop_id}` : topEntry.plant_id ? `Plant ${topEntry.plant_id}` : 'Aggregate'} · ${formatNumber(topEntry.predicted_kwh, { maximumFractionDigits: 2 })} kWh`
      : 'Top consumer data unavailable'

    return [
      {
        id: 'total-demand',
        label: 'Total Forecasted Demand',
        value: `${formatNumber(totalKwh, { maximumFractionDigits: 2 })} kWh`,
        meta: `${entryCount.toLocaleString()} forecast points`,
        icon: BoltIcon,
        accent: 'text-amber-600',
        iconBg: 'bg-amber-500/15',
        gradient: 'from-amber-400/20 via-amber-400/5 to-white',
      },
      {
        id: 'demand-range',
        label: 'Confidence Range',
        value: confidenceRange,
        meta: 'Expected load swing across horizon',
        icon: ShieldExclamationIcon,
        accent: 'text-orange-600',
        iconBg: 'bg-orange-500/10',
        gradient: 'from-orange-400/20 via-orange-400/5 to-white',
      },
      {
        id: 'demand-confidence',
        label: 'Average Confidence',
        value: formatPercent((avgConfidence || 0) * 100, 0),
        meta: topConsumer,
        icon: CheckBadgeIcon,
        accent: 'text-emerald-600',
        iconBg: 'bg-emerald-500/10',
        gradient: 'from-emerald-400/20 via-emerald-400/5 to-white',
      },
    ]
  }, [energyDemand])

  const failureTotalPages = Math.max(1, Math.ceil(filteredFailureProbabilities.length / failuresPageSize) || 1)

  const criticalEntries = useMemo(() => riskSummary.criticalItems || [], [riskSummary.criticalItems])
  const criticalTotalPages = Math.max(1, Math.ceil(criticalEntries.length / CRITICAL_INSIGHTS_PAGE_SIZE) || 1)
  const paginatedCriticalEntries = useMemo(() => {
    const start = (criticalPage - 1) * CRITICAL_INSIGHTS_PAGE_SIZE
    return criticalEntries.slice(start, start + CRITICAL_INSIGHTS_PAGE_SIZE)
  }, [criticalEntries, criticalPage]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (failuresPage > failureTotalPages) {
      setFailuresPage(failureTotalPages)
    }
  }, [failuresPage, failureTotalPages])

  useEffect(() => {
    if (productionPage > productionTotalPages) {
      setProductionPage(productionTotalPages)
    }
  }, [productionPage, productionTotalPages])

  useEffect(() => {
    if (energyPage > energyTotalPages) {
      setEnergyPage(energyTotalPages)
    }
  }, [energyPage, energyTotalPages])

  useEffect(() => {
    if (criticalPage > criticalTotalPages) {
      setCriticalPage(criticalTotalPages)
    }
  }, [criticalPage, criticalTotalPages])

  const riskCards = useMemo(() => [
    {
      title: 'Critical Risk',
      value: riskSummary.counts.critical,
      description: 'Immediate attention required',
      icon: ShieldExclamationIcon,
      accent: 'text-red-600',
      bg: 'bg-red-50',
    },
    {
      title: 'High Risk',
      value: riskSummary.counts.high,
      description: 'Trending towards failure',
      icon: ExclamationTriangleIcon,
      accent: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      title: 'Medium Risk',
      value: riskSummary.counts.medium,
      description: 'Requires monitoring',
      icon: ArrowTrendingUpIcon,
      accent: 'text-yellow-600',
      bg: 'bg-yellow-50',
    },
    {
      title: 'Fleet Health Score',
      value: riskSummary.healthScore ? `${riskSummary.healthScore.toFixed(0)}%` : 'N/A',
      description: `${riskSummary.totalForecasts} forecasts evaluated`,
      icon: ChartBarIcon,
      accent: 'text-blue-600',
      bg: 'bg-blue-50',
    },
  ], [riskSummary])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Forecasts</h1>
            {wsConnected && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full border border-emerald-200">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                Live
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Predictive analytics and demand forecasting {wsConnected ? '· Real-time updates via WebSocket' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LocationFilter />
          <button
            onClick={fetchData}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center gap-2"
            disabled={loading}
            title="WebSocket provides real-time updates"
          >
            <ArrowPathIcon className={clsx('w-4 h-4', loading && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters bar */}
      {shopsLoading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="space-y-5 animate-pulse">
            {/* Filter header */}
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 bg-gray-200 rounded" />
              <div className="h-5 w-20 bg-gray-200 rounded" />
            </div>

            {/* Filter controls */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => (
                <div key={i}>
                  <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
                  <div className="h-11 w-full bg-gray-200 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </div>
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
                  Search Machines
                </label>
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search by code or name..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      setFailuresPage(1)
                    }}
                    className="w-full h-11 pl-10 pr-10 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery('')
                        setFailuresPage(1)
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Forecast Period filter */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Forecast Period
                </label>
                <select
                  value={forecastPeriod}
                  onChange={(e) => {
                    setForecastPeriod(e.target.value)
                    setFailuresPage(1)
                  }}
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                >
                  {forecastPeriods.map(period => (
                    <option key={period.value} value={period.value}>{period.label}</option>
                  ))}
                </select>
              </div>

              {/* Shop filter */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Workshop
                </label>
                <select
                  value={shopFilter}
                  onChange={(e) => {
                    setShopFilter(e.target.value)
                    setFailuresPage(1)
                  }}
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                >
                  <option value="all">
                    {(location && location !== 'all') || plantId ? 'All Workshops' : 'All Workshops (All Locations)'}
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
            {(searchQuery || forecastPeriod !== '7d' || shopFilter !== 'all') && (
              <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="font-medium">
                    {[searchQuery !== '', forecastPeriod !== '7d', shopFilter !== 'all'].filter(Boolean).length}
                  </span>
                  <span>
                    active filter{[searchQuery !== '', forecastPeriod !== '7d', shopFilter !== 'all'].filter(Boolean).length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setForecastPeriod('7d')
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

      {/* Risk Summary - Progressive Loading */}
      {loading ? (
        <MetricCardSkeleton count={4} columns={4} />
      ) : (
        <>
          {/* Risk Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {riskCards.map(({ title, value, description, icon: Icon, accent, bg }) => (
              <div key={title} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600">{title}</p>
                    <p className={clsx('text-3xl font-bold mt-2', accent)}>{value}</p>
                    <p className="text-xs text-gray-500 mt-1">{description}</p>
                  </div>
                  <div className={clsx('w-12 h-12 rounded-lg flex items-center justify-center', bg)}>
                    <Icon className={clsx('w-7 h-7', accent)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

          {/* Failure Probabilities - Independent Loading */}
          {loading ? (
            <TableSkeleton rows={10} columns={6} title={true} />
          ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  Predicted Failures (Next {forecastPeriod})
                  {searchQuery && ` · Filtered (${filteredFailureProbabilities.length}/${failureProbabilities.length})`}
                </h3>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <CheckBadgeIcon className="w-4 h-4 text-blue-500" />
                    <span>
                      Monitoring <span className="font-medium text-gray-800">{failureStats.totalMachines}</span> machines
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ArrowTrendingUpIcon className="w-4 h-4 text-red-500" />
                    <span>
                      <span className="font-medium text-gray-800">{failureStats.highRiskCount}</span> at or above risk threshold
                    </span>
                  </div>
                </div>
              </div>
              {filteredFailureProbabilities.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                  <span className="font-medium">
                    Showing {(failuresPage - 1) * failuresPageSize + 1}–{Math.min(failuresPage * failuresPageSize, filteredFailureProbabilities.length)} of {filteredFailureProbabilities.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Page size</span>
                    <select
                      value={failuresPageSize}
                      onChange={(event) => {
                        setFailuresPageSize(Number(event.target.value))
                        setFailuresPage(1)
                      }}
                      className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {FAILURE_PAGE_SIZE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setFailuresPage((prev) => Math.max(1, prev - 1))}
                      disabled={failuresPage === 1}
                      className={clsx(
                        'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors',
                        failuresPage === 1
                          ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      )}
                      aria-label="Previous page"
                    >
                      <ChevronLeftIcon className="h-4 w-4" />
                    </button>
                    <span className="font-medium text-gray-700">
                      Page {failuresPage} of {failureTotalPages}
                    </span>
                    <button
                      onClick={() => setFailuresPage((prev) => Math.min(failureTotalPages, prev + 1))}
                      disabled={failuresPage === failureTotalPages}
                      className={clsx(
                        'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors',
                        failuresPage === failureTotalPages
                          ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      )}
                      aria-label="Next page"
                    >
                      <ChevronRightIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
            {filteredFailureProbabilities.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {searchQuery ? 'No machines match your search' : 'No high-risk machines detected'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Machine</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Risk Level</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Failure Probability</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Horizon</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Valid Until</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Insights</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedFailureProbabilities.map((item, idx) => (
                      <tr key={`failure-${idx}-${item.machine_id}-${item.valid_until || idx}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link 
                            to={`/machines/${item.machine_id}`}
                            className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {item.machine_code || `Machine #${item.machine_id}`}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 capitalize">{item.risk_level || 'unknown'}</td>
                        <td className="px-4 py-3">
                          <RiskBadge probability={(item.failure_probability ?? 0) * 100} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {item.confidence !== undefined && item.confidence !== null
                            ? formatPercent((item.confidence || 0) * 100, 0)
                            : 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{item.prediction_horizon || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {item.valid_until
                            ? new Date(item.valid_until).toLocaleString()
                            : 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {item.explanation || parseRecommendations(item.recommendations)?.join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          )}

          {/* Production & Energy Forecasts - Independent Loading */}
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartSkeleton height="h-64" />
              <ChartSkeleton height="h-64" />
            </div>
          ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Production Forecast */}
            <div className="relative overflow-hidden rounded-3xl border border-indigo-100/70 bg-white/95 shadow-lg">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/8 via-white/0 to-white/0" />
              <div className="relative p-6 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-indigo-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-600">
                      <CpuChipIcon className="h-4 w-4" />
                      Production Forecast
                    </span>
                    <p className="text-base font-semibold text-slate-900">
                      {productionForecast?.horizon ? `Horizon · ${productionForecast.horizon}` : 'Forecast horizon unavailable'}
                    </p>
                    {productionForecast?.lastUpdated && (
                      <p className="text-xs text-slate-500">
                        Last updated {formatTimestamp(productionForecast.lastUpdated)}
                      </p>
                    )}
                  </div>
                  {productionForecast?.totalPredictedUnits !== undefined && (
                    <div className="text-right text-sm text-slate-500">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Aggregate Output</p>
                      <p className="text-lg font-semibold text-slate-900">
                        {formatNumber(productionForecast.totalPredictedUnits, { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  )}
                </div>
                {productionForecast ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {productionMetrics.map(({ id, label, value, meta, icon: Icon, accent, iconBg, gradient }) => (
                        <div
                          key={id}
                          className={clsx(
                            'group relative overflow-hidden rounded-2xl border border-white/60 bg-gradient-to-br p-4 shadow-sm transition-all hover:-translate-y-1',
                            gradient
                          )}
                        >
                          <div className="absolute inset-0 bg-white/30 opacity-0 blur-2xl transition-all duration-300 group-hover:opacity-100" />
                          <div className="relative flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                              <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
                              <p className="mt-1 text-xs text-slate-500">{meta}</p>
                            </div>
                            <div className={clsx('flex h-10 w-10 items-center justify-center rounded-full', iconBg)}>
                              <Icon className={clsx('h-5 w-5', accent)} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                        <span>
                          Showing {productionStartIndex + 1}
                          –
                          {Math.min(productionPage * FORECAST_PAGE_SIZE, productionEntries.length)} of {productionEntries.length}
                        </span>
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <button
                            onClick={() => setProductionPage((prev) => Math.max(1, prev - 1))}
                            disabled={productionPage === 1}
                            className={clsx(
                              'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all',
                              productionPage === 1
                                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600'
                            )}
                            aria-label="Previous production page"
                          >
                            <ChevronLeftIcon className="h-4 w-4" />
                          </button>
                          <span className="font-medium text-slate-700">
                            Page {productionPage} of {productionTotalPages}
                          </span>
                          <button
                            onClick={() => setProductionPage((prev) => Math.min(productionTotalPages, prev + 1))}
                            disabled={productionPage === productionTotalPages}
                            className={clsx(
                              'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all',
                              productionPage === productionTotalPages
                                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600'
                            )}
                            aria-label="Next production page"
                          >
                            <ChevronRightIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {paginatedProductionEntries.map((entry, idx) => {
                          const rank = productionStartIndex + idx + 1
                          const locationLabel = entry.line_id
                            ? `Line ${entry.line_id}`
                            : entry.shop_id
                            ? `Shop ${entry.shop_id}`
                            : entry.plant_id
                            ? `Plant ${entry.plant_id}`
                            : 'Aggregate'
                          const confidenceRangeText =
                            entry.confidence_lower !== null &&
                            entry.confidence_lower !== undefined &&
                            entry.confidence_upper !== null &&
                            entry.confidence_upper !== undefined
                              ? `${formatNumber(entry.confidence_lower, { maximumFractionDigits: 2 })} - ${formatNumber(entry.confidence_upper, { maximumFractionDigits: 2 })}`
                              : null
                          return (
                            <div
                              key={`prod-${rank}-${locationLabel}-${entry.valid_until || idx}`}
                              className="group flex items-center justify-between gap-4 rounded-2xl border border-indigo-100/50 bg-white/80 px-4 py-4 shadow-sm transition-all hover:-translate-y-1 hover:border-indigo-200 hover:bg-indigo-50/70"
                            >
                              <div className="flex items-start gap-3">
                                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/10 text-sm font-semibold text-indigo-600">
                                  {rank}
                                </span>
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold text-slate-900">{locationLabel}</p>
                                  <p className="text-xs text-slate-500">
                                    Valid until {formatTimestamp(entry.valid_until) || 'N/A'}
                                  </p>
                                  {confidenceRangeText && (
                                    <p className="text-xs text-slate-500">Range {confidenceRangeText}</p>
                                  )}
                                </div>
                              </div>
                              <div className="text-right space-y-1">
                                <p className="text-lg font-semibold text-slate-900">
                                  {formatNumber(entry.predicted_units, { maximumFractionDigits: 2 })}
                                </p>
                                <p className="text-xs font-medium text-indigo-600">
                                  Confidence{' '}
                                  {entry.confidence_score !== undefined && entry.confidence_score !== null
                                    ? formatPercent((entry.confidence_score || 0) * 100, 0)
                                    : 'N/A'}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">No production forecasts available for the selected filters.</p>
                )}
              </div>
            </div>

            {/* Energy Demand Forecast */}
            <div className="relative overflow-hidden rounded-3xl border border-amber-100/70 bg-white/95 shadow-lg">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-400/10 via-white/0 to-white/0" />
              <div className="relative p-6 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-600">
                      <BoltIcon className="h-4 w-4" />
                      Energy Demand Forecast
                    </span>
                    <p className="text-base font-semibold text-slate-900">
                      {energyDemand?.horizon ? `Horizon · ${energyDemand.horizon}` : 'Forecast horizon unavailable'}
                    </p>
                    {energyDemand?.lastUpdated && (
                      <p className="text-xs text-slate-500">
                        Last updated {formatTimestamp(energyDemand.lastUpdated)}
                      </p>
                    )}
                  </div>
                  {energyDemand?.totalKwh !== undefined && (
                    <div className="text-right text-sm text-slate-500">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Aggregate Demand</p>
                      <p className="text-lg font-semibold text-slate-900">
                        {formatNumber(energyDemand.totalKwh, { maximumFractionDigits: 2 })} kWh
                      </p>
                    </div>
                  )}
                </div>
                {energyDemand ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {energyMetrics.map(({ id, label, value, meta, icon: Icon, accent, iconBg, gradient }) => (
                        <div
                          key={id}
                          className={clsx(
                            'group relative overflow-hidden rounded-2xl border border-white/60 bg-gradient-to-br p-4 shadow-sm transition-all hover:-translate-y-1',
                            gradient
                          )}
                        >
                          <div className="absolute inset-0 bg-white/40 opacity-0 blur-2xl transition-all duration-300 group-hover:opacity-100" />
                          <div className="relative flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                              <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
                              <p className="mt-1 text-xs text-slate-500">{meta}</p>
                            </div>
                            <div className={clsx('flex h-10 w-10 items-center justify-center rounded-full', iconBg)}>
                              <Icon className={clsx('h-5 w-5', accent)} />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                        <span>
                          Showing {energyStartIndex + 1}
                          –
                          {Math.min(energyPage * FORECAST_PAGE_SIZE, energyEntries.length)} of {energyEntries.length}
                        </span>
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <button
                            onClick={() => setEnergyPage((prev) => Math.max(1, prev - 1))}
                            disabled={energyPage === 1}
                            className={clsx(
                              'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all',
                              energyPage === 1
                                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600'
                            )}
                            aria-label="Previous energy page"
                          >
                            <ChevronLeftIcon className="h-4 w-4" />
                          </button>
                          <span className="font-medium text-slate-700">
                            Page {energyPage} of {energyTotalPages}
                          </span>
                          <button
                            onClick={() => setEnergyPage((prev) => Math.min(energyTotalPages, prev + 1))}
                            disabled={energyPage === energyTotalPages}
                            className={clsx(
                              'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-all',
                              energyPage === energyTotalPages
                                ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600'
                            )}
                            aria-label="Next energy page"
                          >
                            <ChevronRightIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {paginatedEnergyEntries.map((entry, idx) => {
                          const rank = energyStartIndex + idx + 1
                          const locationLabel = entry.shop_id
                            ? `Shop ${entry.shop_id}`
                            : entry.plant_id
                            ? `Plant ${entry.plant_id}`
                            : 'Aggregate'
                          const confidenceRangeText =
                            entry.confidence_lower !== null &&
                            entry.confidence_lower !== undefined &&
                            entry.confidence_upper !== null &&
                            entry.confidence_upper !== undefined
                              ? `${formatNumber(entry.confidence_lower, { maximumFractionDigits: 2 })} - ${formatNumber(entry.confidence_upper, { maximumFractionDigits: 2 })} kWh`
                              : null
                          return (
                            <div
                              key={`energy-${rank}-${locationLabel}-${entry.valid_until || idx}`}
                              className="group flex items-center justify-between gap-4 rounded-2xl border border-amber-100/60 bg-white/80 px-4 py-4 shadow-sm transition-all hover:-translate-y-1 hover:border-amber-200 hover:bg-amber-50/70"
                            >
                              <div className="flex items-start gap-3">
                                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-400/15 text-sm font-semibold text-amber-600">
                                  {rank}
                                </span>
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold text-slate-900">{locationLabel}</p>
                                  <p className="text-xs text-slate-500">
                                    Valid until {formatTimestamp(entry.valid_until) || 'N/A'}
                                  </p>
                                  {confidenceRangeText && (
                                    <p className="text-xs text-slate-500">Range {confidenceRangeText}</p>
                                  )}
                                </div>
                              </div>
                              <div className="text-right space-y-1">
                                <p className="text-lg font-semibold text-slate-900">
                                  {formatNumber(entry.predicted_kwh, { maximumFractionDigits: 2 })} kWh
                                </p>
                                <p className="text-xs font-medium text-amber-600">
                                  Confidence{' '}
                                  {entry.confidence_score !== undefined && entry.confidence_score !== null
                                    ? formatPercent((entry.confidence_score || 0) * 100, 0)
                                    : 'N/A'}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">No energy demand forecasts available for the selected filters.</p>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Maintenance Schedule - Independent Loading */}
          {loading ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 animate-pulse">
              <div className="h-6 bg-gray-200 rounded w-64 mb-4"></div>
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
                      <div>
                        <div className="h-4 bg-gray-200 rounded w-24 mb-2"></div>
                        <div className="h-3 bg-gray-200 rounded w-32"></div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="h-4 bg-gray-200 rounded w-24 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-16"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Critical Forecast Insights
            </h3>
            {riskSummary.criticalItems.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-2">
                  <span>
                    Showing {(criticalPage - 1) * CRITICAL_INSIGHTS_PAGE_SIZE + 1}
                    –{Math.min(criticalPage * CRITICAL_INSIGHTS_PAGE_SIZE, criticalEntries.length)} of {criticalEntries.length}
                  </span>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <button
                      onClick={() => setCriticalPage((prev) => Math.max(1, prev - 1))}
                      disabled={criticalPage === 1}
                      className={clsx(
                        'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                        criticalPage === 1
                          ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      )}
                      aria-label="Previous critical insight page"
                    >
                      <ChevronLeftIcon className="h-4 w-4" />
                    </button>
                    <span className="font-medium text-gray-700">
                      Page {criticalPage} of {criticalTotalPages}
                    </span>
                    <button
                      onClick={() => setCriticalPage((prev) => Math.min(criticalTotalPages, prev + 1))}
                      disabled={criticalPage === criticalTotalPages}
                      className={clsx(
                        'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                        criticalPage === criticalTotalPages
                          ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      )}
                      aria-label="Next critical insight page"
                    >
                      <ChevronRightIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {paginatedCriticalEntries.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-red-100 text-red-600 rounded-lg flex items-center justify-center">
                        <ClockIcon className="w-6 h-6" />
                      </div>
                      <div>
                        <Link
                          to={`/machines/${item.machine_id}`}
                          className="font-medium text-gray-900 hover:text-blue-600"
                        >
                          {item.machine_code || `Machine #${item.machine_id}`}
                        </Link>
                        <p className="text-sm text-gray-500 capitalize">{item.forecast_type?.replaceAll('_', ' ') || 'Forecast insight'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">
                        Risk Score: {item.risk_score !== undefined && item.risk_score !== null ? formatNumber(item.risk_score, { maximumFractionDigits: 1 }) : 'N/A'}
                      </p>
                      <p className="text-sm text-gray-500 max-w-xs line-clamp-2">{item.explanation || 'No explanation provided'}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-8">No critical forecasts for the selected filters.</p>
            )}
          </div>
          )}
    </div>
  )
}

function RiskBadge({ probability }) {
  const level = probability >= 70 ? 'high' : probability >= 40 ? 'medium' : 'low'
  const colorClasses = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-green-100 text-green-700',
  }

  return (
    <span className={clsx(
      'px-2 py-0.5 text-xs font-medium rounded-full',
      colorClasses[level]
    )}>
      {probability !== undefined && probability !== null ? probability.toFixed(0) : 0}%
    </span>
  )
}
