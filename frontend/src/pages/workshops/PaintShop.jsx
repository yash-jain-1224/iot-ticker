import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { 
  Activity, 
  TrendingUp, 
  TrendingDown,
  Gauge,
  CheckCircle,
  Clock,
  Sparkles
} from 'lucide-react'
import { ClockIcon } from '@heroicons/react/24/outline'
import { machinesAPI, kpisAPI, telemetryAPI } from '../../services/api'
import LocationFilter from '../../components/LocationFilter'
import TimeRangeFilter from '../../components/TimeRangeFilter'
import { useFilterStore } from '../../store/filterStore'
import InfoTooltip from '../../components/InfoTooltip'
import { KPICardSkeleton } from '../../components/skeletons'
import { useMachineStatesWebSocket, useAlertsWebSocket, useShopTelemetryWebSocket, useKpisWebSocket } from '../../hooks/useWebSocket'

const SHOP_TYPE = 'paint_shop'

function PaintShop() {
  const { location, timeRange, plantId } = useFilterStore()
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [viewMode, setViewMode] = useState('table') // 'table' or 'grid'
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12 // 12 items per page for grid, works well for table too
  const [boothPage, setBoothPage] = useState(1)
  const boothsPerPage = 5

  // Map location to plant_code for WebSocket filtering
  const plantCode = useMemo(() => {
    if (!location || location === 'all') return null
    const plantCodes = {
      'jamshedpur': 'HOUSTON-001',
      'sanand': 'DALLAS-001',
      'pune': 'AUSTIN-001'
    }
    return plantCodes[location] || null
  }, [location])

  // WebSocket connections for live data
  const { 
    machines: liveMachines, 
    isConnected: machinesConnected, 
    timestamp: machinesTimestamp 
  } = useMachineStatesWebSocket(null, plantCode, SHOP_TYPE)

  const { 
    isConnected: alertsConnected, 
    timestamp: alertsTimestamp 
  } = useAlertsWebSocket(null, plantCode)

  const {
    environmentalConditions: liveEnvironmentalConditions,
    colorDistribution: liveColorDistribution,
    isConnected: telemetryConnected,
    timestamp: telemetryTimestamp
  } = useShopTelemetryWebSocket(null, plantCode, SHOP_TYPE)

  // KPI WebSocket for real-time quality and other metrics
  const {
    kpis: liveKpis,
    isConnected: kpisConnected,
    timestamp: kpisTimestamp
  } = useKpisWebSocket(null, plantCode, SHOP_TYPE)

  const isLive = machinesConnected && alertsConnected && kpisConnected

  const handleRefresh = () => {
    setLastUpdated(new Date())
    refetchKpis()
    refetchMachines()
    refetchTelemetrySummary()
    refetchColorDistribution()
  }

  // Fetch KPI data - Always enabled for fast initial load with 30s cache
  const { data: kpiData, isLoading: kpiLoading, refetch: refetchKpis } = useQuery({
    queryKey: ['kpis', 'overview', SHOP_TYPE, location, timeRange],
    queryFn: async () => {
      const params = {
        shop_type: SHOP_TYPE,
      }
      
      // Map location to plant_code
      if (location && location !== 'all') {
        const plantCodes = {
          'jamshedpur': 'HOUSTON-001',
          'sanand': 'DALLAS-001',
          'pune': 'AUSTIN-001'
        }
        if (plantCodes[location]) {
          params.plant_code = plantCodes[location]
        }
      }
      
      // Add time range filter
      if (timeRange) {
        const timeRangeToDays = {
          '1h': 1,
          '24h': 1,
          '7d': 7,
          '30d': 30
        }
        if (timeRangeToDays[timeRange]) {
          params.days = timeRangeToDays[timeRange]
        }
        params.period = timeRange
      }
      
      const response = await kpisAPI.getDashboardOverview(params)
      return response.data
    },
    staleTime: 30000, // Cache for 30 seconds for fast initial loads
  })

  // Fetch machines data with status - Always enabled for fast initial load with 30s cache
  const { data: machinesData, isLoading: machinesLoading, refetch: refetchMachines } = useQuery({
    queryKey: ['machines', 'status-board', SHOP_TYPE, location, timeRange],
    queryFn: async () => {
      const params = {
        shop_type: SHOP_TYPE,
      }
      
      // Map location to plant_code
      if (location && location !== 'all') {
        const plantCodes = {
          'jamshedpur': 'HOUSTON-001',
          'sanand': 'DALLAS-001',
          'pune': 'AUSTIN-001'
        }
        if (plantCodes[location]) {
          params.plant_code = plantCodes[location]
        }
      }
      
      const response = await machinesAPI.getStatusBoard(params)
      return response.data
    },
    staleTime: 30000, // Cache for 30 seconds for fast initial loads
  })

  // Use live machines from WebSocket if connected, otherwise use API data
  const machines = useMemo(() => {
    if (machinesConnected && liveMachines && liveMachines.length > 0) {
      // Filter by shop_type if needed
      return liveMachines.filter(m => m.shop_type === SHOP_TYPE || !m.shop_type)
    }
    return machinesData || []
  }, [machinesConnected, liveMachines, machinesData])

  const isLoading = machinesLoading && !machinesConnected

  // Calculate machine status counts
  const statusCounts = {
    total: machines.length,
    online: machines.filter(m => m.status === 'online').length,
    offline: machines.filter(m => m.status === 'offline').length,
    idle: machines.filter(m => m.status === 'idle').length,
    fault: machines.filter(m => m.status === 'fault').length,
    maintenance: machines.filter(m => m.status === 'maintenance').length,
  }

  // Pagination calculations
  const totalPages = Math.ceil(machines.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedMachines = machines.slice(startIndex, endIndex)

  // Get all paint booth machines from WebSocket/API data
  const paintBoothMachines = useMemo(() => {
    return machines.filter(m => 
      m.machine_type === 'spray_booth' || 
      m.machine_type === 'paint_booth'
    )
  }, [machines])

  // Fetch environmental telemetry data - Always enabled for fast initial load with 30s cache
  const { data: telemetrySummary, isLoading: telemetrySummaryLoading, refetch: refetchTelemetrySummary } = useQuery({
    queryKey: ['telemetry', 'summary', location],
    queryFn: async () => {
      const params = { shop_type: SHOP_TYPE }
      if (plantId) {
        params.plant_id = plantId
      }
      const response = await telemetryAPI.getLatestSummary(params)
      return response.data || {}
    },
    staleTime: 30000, // Cache for 30 seconds for fast initial loads
  })

  const { data: colorDistributionSnapshots = [], isLoading: colorDistributionLoading, refetch: refetchColorDistribution } = useQuery({
    queryKey: ['paint-color-distribution', location],
    queryFn: async () => {
      const params = { shop_type: SHOP_TYPE }
      if (plantId) {
        params.plant_id = plantId
      }
      const response = await telemetryAPI.getPaintColorDistribution(params)
      return response.data?.data || []
    },
    staleTime: 30000, // Cache for 30 seconds for fast initial loads
  })

  // Update timestamp when WebSocket data arrives
  useEffect(() => {
    if (machinesTimestamp || alertsTimestamp || telemetryTimestamp || kpisTimestamp) {
      setLastUpdated(new Date())
    }
  }, [machinesTimestamp, alertsTimestamp, telemetryTimestamp, kpisTimestamp])

  // Use live environmental conditions from WebSocket if connected, otherwise use API data
  const environmentalConditions = useMemo(() => {
    if (telemetryConnected && liveEnvironmentalConditions) {
      return {
        ambient_temp: liveEnvironmentalConditions.temperature?.value ?? null,
        humidity: liveEnvironmentalConditions.humidity?.value ?? null,
        air_quality: liveEnvironmentalConditions.air_quality?.value ?? null,
        dust_level: liveEnvironmentalConditions.dust_level?.value ?? null,
      }
    }
    const summary = telemetrySummary || {}
    return {
      ambient_temp: summary.temperature?.value ?? null,
      humidity: summary.humidity?.value ?? null,
      air_quality: summary.air_quality?.value ?? null,
      dust_level: summary.dust_level?.value ?? null,
    }
  }, [telemetryConnected, liveEnvironmentalConditions, telemetrySummary])

  // Use live KPI data from WebSocket if connected, otherwise use API data
  const mergedKpiData = useMemo(() => {
    if (kpisConnected && liveKpis) {
      // WebSocket KPIs are already in the correct format
      return liveKpis
    }
    return kpiData
  }, [kpisConnected, liveKpis, kpiData])

  // Derive paint booths with telemetry data from machine states (WebSocket)
  // No need for separate API polling - we get temperature from machine state
  const paintBooths = useMemo(() => {
    if (!paintBoothMachines.length) return []
    
    
    return paintBoothMachines.map((booth, index) => {
      // Handle location from both API and WebSocket formats
      let location = 'Unknown'
      
      // WebSocket format: direct fields from machine
      if (booth.location) {
        location = booth.location
      } else if (booth.plant_name) {
        location = booth.plant_name
      }
      // API format: nested objects
      else if (booth.plant?.name) {
        location = booth.plant.name
      } else if (booth.shop?.plant?.name) {
        location = booth.shop.plant.name
      } else if (booth.line?.shop?.plant?.name) {
        location = booth.line.shop.plant.name
      }
      
      return {
        id: booth.machine_id,
        name: booth.machine_name || `Booth ${index + 1}`,
        code: booth.machine_code,
        status: booth.status === 'online' ? 'active' : 'idle',
        bodies_today: booth.current_cycle || 0,
        // Use temperature from machine state (WebSocket includes this)
        temperature: booth.temperature || 0,
        // Use humidity from environmental conditions (already using the right source)
        humidity: environmentalConditions.humidity || 0,
        air_pressure: 0, // Air pressure not in machine state, could be added if needed
        location: location
      }
    })
  }, [paintBoothMachines, environmentalConditions])

  // Pagination for paint booths
  const totalBoothPages = Math.ceil(paintBooths.length / boothsPerPage)
  const boothStartIndex = (boothPage - 1) * boothsPerPage
  const boothEndIndex = boothStartIndex + boothsPerPage
  const paginatedBooths = paintBooths.slice(boothStartIndex, boothEndIndex)

  // Use live color distribution from WebSocket if connected, otherwise use API data
  const latestColorSnapshot = useMemo(() => {
    if (telemetryConnected && liveColorDistribution) {
      return liveColorDistribution
    }
    if (!colorDistributionSnapshots.length) return null
    return colorDistributionSnapshots[0]
  }, [telemetryConnected, liveColorDistribution, colorDistributionSnapshots])

  const colorDistribution = latestColorSnapshot?.distribution || []
  const totalPainted = latestColorSnapshot?.total || 0
  
  // Debug logging for color distribution
  const colorPalette = {
    White: 'bg-gray-200',
    Silver: 'bg-gray-400',
    Black: 'bg-gray-800',
    Blue: 'bg-blue-500',
    Red: 'bg-red-500',
    Green: 'bg-emerald-500',
    Yellow: 'bg-amber-400',
    Orange: 'bg-orange-500',
    Purple: 'bg-purple-500',
  }

  // Tooltip metadata for metrics
  const metricsMetadata = {
    oee: {
      title: 'Overall Equipment Effectiveness',
      description: 'Comprehensive measure of manufacturing productivity combining availability, performance, and quality metrics for paint shop operations.',
      calculation: 'OEE = Availability × Performance × Quality',
      significance: 'Industry benchmark is 85%+. Tracks overall effectiveness of painting equipment and processes. Lower values indicate opportunities for improvement.'
    },
    bodiesPainted: {
      title: 'Bodies Painted',
      description: 'Total number of vehicle bodies that have successfully completed the painting process within the selected time range.',
      calculation: 'Count of bodies passing final paint inspection and quality gates',
      significance: 'Key production output metric. Track against daily targets and compare with historical performance for capacity planning.'
    },
    paintQuality: {
      title: 'Paint Quality',
      description: 'Percentage of painted bodies that meet quality standards on the first attempt without requiring rework or touch-ups.',
      calculation: '(Bodies Passed Quality Check ÷ Total Bodies Painted) × 100',
      significance: 'Quality excellence indicator. Target is >95%. Higher quality reduces costs, improves throughput, and indicates strong process control.'
    },
    downtime: {
      title: 'Total Downtime',
      description: 'Cumulative time that paint shop operations were stopped or unable to produce due to equipment failures, maintenance, or other issues.',
      calculation: 'Sum of all unplanned and planned downtime periods',
      significance: 'Critical availability metric. Minimize to maximize production capacity. Track root causes for continuous improvement initiatives.'
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header with Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Paint Shop Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Painting operations and quality control</p>
          </div>
          {/* Live Status Badge */}
          {isLive && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <div className="absolute inset-0 w-2 h-2 bg-green-500 rounded-full animate-ping"></div>
                </div>
                <span className="text-xs font-medium text-green-700">LIVE</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <LocationFilter />
          <TimeRangeFilter />
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <div className="flex items-center gap-2 text-gray-500">
            <ClockIcon className="w-4 h-4" />
            <span className="text-sm">
              Last updated: {isLive && machinesTimestamp 
                ? new Date(machinesTimestamp).toLocaleTimeString() 
                : lastUpdated.toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {kpiLoading ? (
          <>
            <KPICardSkeleton />
            <KPICardSkeleton />
            <KPICardSkeleton />
            <KPICardSkeleton />
          </>
        ) : (
          <>
        {/* OEE */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-normal text-gray-600">OEE</h3>
              <InfoTooltip 
                title={metricsMetadata.oee.title}
                description={metricsMetadata.oee.description}
                calculation={metricsMetadata.oee.calculation}
                significance={metricsMetadata.oee.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-blue-50">
              <Gauge className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {mergedKpiData?.oee?.value?.toFixed(1) || 0}
              </span>
              <span className="text-lg text-gray-500 font-normal">%</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            {mergedKpiData?.oee?.change && mergedKpiData?.oee?.change !== 0 ? (
              <div className="flex items-center gap-1">
                {mergedKpiData.oee.trend === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                )}
                <span className={`text-sm font-normal ${mergedKpiData.oee.trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                  {Math.abs(mergedKpiData.oee.change).toFixed(1)}% vs yesterday
                </span>
              </div>
            ) : (
            <div className="flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-sm font-normal text-gray-500">
                No change
              </span>
            </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-3">
            <Link to="/analytics?metric=oee&shop=paint-shop" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Bodies Painted */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-normal text-gray-600">Bodies Painted</h3>
              <InfoTooltip 
                title={metricsMetadata.bodiesPainted.title}
                description={metricsMetadata.bodiesPainted.description}
                calculation={metricsMetadata.bodiesPainted.calculation}
                significance={metricsMetadata.bodiesPainted.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-green-50">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {mergedKpiData?.production?.value || 0}
              </span>
              <span className="text-lg text-gray-500 font-normal">units</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            {mergedKpiData?.production?.change && mergedKpiData?.production?.change !== 0 ? (
              <div className="flex items-center gap-1">
                {mergedKpiData.production.trend === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                )}
                <span className={`text-sm font-normal ${mergedKpiData.production.trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                  {Math.abs(mergedKpiData.production.change).toFixed(1)}% vs yesterday
                </span>
              </div>
            ) : (
            <div className="flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-sm font-normal text-gray-500">
                No change
              </span>
            </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-3">
            <Link to="/analytics?metric=production&shop=paint-shop" className="inline-flex items-center gap-1 text-sm font-semibold text-green-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Paint Quality */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-normal text-gray-600">Paint Quality</h3>
              <InfoTooltip 
                title={metricsMetadata.paintQuality.title}
                description={metricsMetadata.paintQuality.description}
                calculation={metricsMetadata.paintQuality.calculation}
                significance={metricsMetadata.paintQuality.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-purple-50">
              <Sparkles className="w-6 h-6 text-purple-600" />
            </div>
          </div>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {mergedKpiData?.quality?.value?.toFixed(1) || 0}
              </span>
              <span className="text-lg text-gray-500 font-normal">%</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            {mergedKpiData?.quality?.change && mergedKpiData?.quality?.change !== 0 ? (
              <div className="flex items-center gap-1">
                {mergedKpiData.quality.trend === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                )}
                <span className={`text-sm font-normal ${mergedKpiData.quality.trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                  {Math.abs(mergedKpiData.quality.change).toFixed(1)}% vs yesterday
                </span>
              </div>
            ) : (
            <div className="flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-sm font-normal text-gray-500">
                No change
              </span>
            </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-3">
            <Link to="/analytics?metric=quality&shop=paint-shop" className="inline-flex items-center gap-1 text-sm font-semibold text-purple-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Downtime */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-normal text-gray-600">Downtime</h3>
              <InfoTooltip 
                title={metricsMetadata.downtime.title}
                description={metricsMetadata.downtime.description}
                calculation={metricsMetadata.downtime.calculation}
                significance={metricsMetadata.downtime.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-yellow-50">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {mergedKpiData?.downtime?.value?.toFixed(1) || 0}
              </span>
              <span className="text-lg text-gray-500 font-normal">{mergedKpiData?.downtime?.unit || 'min'}</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            <div className="flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-sm font-normal text-gray-500">
                Planned + Unplanned
              </span>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-3">
            <Link to="/analytics?metric=downtime&shop=paint-shop" className="inline-flex items-center gap-1 text-sm font-semibold text-yellow-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
          </>
        )}
      </div>

      {/* Equipment Status */}
      {isLoading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-pulse">
          <div className="flex items-center justify-between mb-5">
            <div className="h-6 bg-gray-200 rounded w-40"></div>
            <div className="h-4 bg-gray-200 rounded w-20"></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="rounded-xl p-5 bg-gray-50">
                <div className="h-10 bg-gray-200 rounded w-16 mb-2"></div>
                <div className="h-4 bg-gray-200 rounded w-20"></div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-gray-900">Equipment Status</h2>
            <Link to="/control-center" className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1">
              View all →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="rounded-xl p-5 bg-gray-50 text-gray-700">
              <p className="text-2xl md:text-4xl font-bold mb-1">{statusCounts.total}</p>
              <p className="text-sm font-medium">Total</p>
            </div>
            <div className="rounded-xl p-5 bg-emerald-50 text-emerald-700">
              <p className="text-2xl md:text-4xl font-bold mb-1">{statusCounts.online}</p>
              <p className="text-sm font-medium">Online</p>
            </div>
            <div className="rounded-xl p-5 bg-amber-50 text-amber-700">
              <p className="text-2xl md:text-4xl font-bold mb-1">{statusCounts.idle}</p>
              <p className="text-sm font-medium">Idle</p>
            </div>
            <div className="rounded-xl p-5 bg-rose-50 text-rose-700">
              <p className="text-2xl md:text-4xl font-bold mb-1">{statusCounts.fault}</p>
              <p className="text-sm font-medium">Fault</p>
            </div>
            <div className="rounded-xl p-5 bg-purple-50 text-purple-700">
              <p className="text-2xl md:text-4xl font-bold mb-1">{statusCounts.maintenance}</p>
              <p className="text-sm font-medium">Maintenance</p>
            </div>
          </div>
        </div>
      )}

      {/* Paint Booths and Color Distribution Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Paint Booths */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  Paint Booths
                </h2>
                {paintBooths.length > 0 && (
                  <p className="text-sm text-gray-600 mt-1">
                    Showing {boothStartIndex + 1}-{Math.min(boothEndIndex, paintBooths.length)} of {paintBooths.length} booths
                  </p>
                )}
              </div>
              {paintBooths.length > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                    {paintBooths.filter(b => b.status === 'active').length} Active
                  </span>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5"></span>
                    {paintBooths.filter(b => b.status === 'idle').length} Idle
                  </span>
                </div>
              )}
            </div>
          </div>
          
          <div className="p-6">
            <div className="space-y-3">
              {paginatedBooths.length > 0 ? (
                paginatedBooths.map((booth) => (
                <div 
                  key={booth.id} 
                  className="group relative bg-gradient-to-r from-gray-50 to-white border border-gray-200 rounded-xl p-4 hover:shadow-lg hover:border-blue-300 transition-all duration-300"
                >
                  {/* Status indicator bar */}
                  <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${
                    booth.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}></div>
                  
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      {/* Booth Badge */}
                      <div className={`relative w-14 h-14 flex-shrink-0 rounded-xl flex items-center justify-center shadow-md ${
                        booth.status === 'active' 
                          ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' 
                          : 'bg-gradient-to-br from-amber-400 to-amber-600'
                      }`}>
                        <span className="text-base font-bold text-white">
                          {booth.code || `B${booth.id}`}
                        </span>
                        {booth.status === 'active' && (
                          <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-white animate-pulse"></span>
                        )}
                      </div>
                      
                      {/* Booth Info */}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-base font-bold text-gray-900 mb-1 group-hover:text-blue-600 transition-colors truncate">
                          {booth.name}
                        </h4>
                        <div className="flex items-center flex-wrap gap-3 text-xs text-gray-600">
                          {/* Temperature */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                            </svg>
                            <span className="font-medium whitespace-nowrap">{booth.temperature.toFixed(1)}°C</span>
                          </div>
                          {/* Humidity */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                            </svg>
                            <span className="font-medium whitespace-nowrap">{booth.humidity.toFixed(1)}%</span>
                          </div>
                          {/* Location */}
                          {booth.location && (
                            <div className="flex items-center gap-1 min-w-0">
                              <svg className="w-4 h-4 text-purple-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              <span className="font-medium truncate">{booth.location}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Status and Production */}
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold shadow-sm whitespace-nowrap ${
                        booth.status === 'active' 
                          ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-200' 
                          : 'bg-amber-100 text-amber-700 ring-2 ring-amber-200'
                      }`}>
                        {booth.status === 'active' ? '● Active' : '○ Idle'}
                      </span>
                      <div className="flex items-center gap-1.5 text-sm whitespace-nowrap">
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        <span className="font-bold text-gray-900">{booth.bodies_today}</span>
                        <span className="text-gray-500">bodies</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
              ) : (
                <div className="text-center py-12">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <p className="text-gray-500 text-base font-medium">No paint booths available</p>
                  <p className="text-gray-400 text-sm mt-1">Check back later or adjust your filters</p>
                </div>
              )}
            </div>
          </div>
          
          {/* Booth Pagination */}
          {paintBooths.length > boothsPerPage && (
            <div className="bg-gray-50 px-4 sm:px-6 py-4 border-t border-gray-200">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                {/* Previous Button */}
                <button
                  onClick={() => setBoothPage(prev => Math.max(prev - 1, 1))}
                  disabled={boothPage === 1}
                  className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="whitespace-nowrap">Previous</span>
                </button>
                
                {/* Page Numbers */}
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  {[...Array(totalBoothPages)].map((_, idx) => {
                    const pageNum = idx + 1
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setBoothPage(pageNum)}
                        className={`min-w-[2.5rem] px-3 py-2 text-sm font-medium rounded-md transition-all ${
                          boothPage === pageNum
                            ? 'bg-blue-600 text-white shadow-md hover:bg-blue-700'
                            : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 hover:border-gray-400'
                        }`}
                      >
                        {pageNum}
                      </button>
                    )
                  })}
                </div>
                
                {/* Next Button */}
                <button
                  onClick={() => setBoothPage(prev => Math.min(prev + 1, totalBoothPages))}
                  disabled={boothPage === totalBoothPages}
                  className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <span className="whitespace-nowrap">Next</span>
                  <svg className="w-4 h-4 ml-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Color Distribution Today */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Color Distribution Today</h2>
              <p className="text-sm text-gray-500">Total bodies painted: {totalPainted}</p>
            </div>
            {(colorDistributionLoading || telemetrySummaryLoading) && (
              <span className="text-xs text-gray-400">Refreshing…</span>
            )}
          </div>
          {colorDistribution.length ? (
            <div className="space-y-3">
              {colorDistribution.map((item, idx) => (
                <div key={`${item.color}-${idx}`} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">{item.color}</span>
                    <span className="text-sm font-semibold text-gray-900">
                      {item.count} ({item.percentage}%)
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${colorPalette[item.color] || 'bg-slate-500'}`}
                      style={{ width: `${item.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-gray-500">No distribution data available</div>
          )}
        </div>
      </div>

      {/* Environmental Conditions */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Environmental Conditions</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Ambient Temp */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-600 mb-2">Ambient Temp</p>
            <p className="text-2xl font-bold text-gray-900">
              {environmentalConditions.ambient_temp != null
                ? `${environmentalConditions.ambient_temp.toFixed(1)} °C`
                : 'N/A'}
            </p>
          </div>

          {/* Humidity */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-600 mb-2">Humidity</p>
            <p className="text-2xl font-bold text-gray-900">
              {environmentalConditions.humidity != null
                ? `${environmentalConditions.humidity.toFixed(1)} %`
                : 'N/A'}
            </p>
          </div>

          {/* Air Quality */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-600 mb-2">Air Quality</p>
            <p className="text-2xl font-bold text-gray-900">
              {environmentalConditions.air_quality != null
                ? environmentalConditions.air_quality.toFixed(1)
                : 'N/A'}
            </p>
            {environmentalConditions.air_quality != null && (
              <p className="text-xs text-gray-500 mt-1">AQI</p>
            )}
          </div>

          {/* Dust Level */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-sm text-gray-600 mb-2">Dust Level</p>
            <p className="text-2xl font-bold text-gray-900">
              {environmentalConditions.dust_level != null
                ? environmentalConditions.dust_level.toFixed(1)
                : 'N/A'}
            </p>
            {environmentalConditions.dust_level != null && (
              <p className="text-xs text-gray-500 mt-1">µg/m³</p>
            )}
          </div>
        </div>
      </div>

      {/* All Machines */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">All Machines</h2>
            <div className="flex items-center gap-3">
              {/* View Toggle */}
              <div className="inline-flex rounded-lg border border-gray-300 p-1 bg-gray-50">
                <button
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'table'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2h2a2 2 0 002-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
              </div>
              <Link to="/control-center?shop=paint-shop" className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1">
                View in Control Center →
              </Link>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : machines.length === 0 ? (
            <div className="p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                <Activity className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 text-lg">No machines to display</p>
              <p className="text-gray-400 text-sm mt-1">No equipment found for the selected filters</p>
            </div>
          ) : viewMode === 'table' ? (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Code
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Health
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Load
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Location
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedMachines.map((machine) => (
                  <tr key={machine.machine_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        machine.status === 'online' ? 'bg-green-100 text-green-800' :
                        machine.status === 'offline' ? 'bg-gray-100 text-gray-800' :
                        machine.status === 'idle' ? 'bg-yellow-100 text-yellow-800' :
                        machine.status === 'fault' ? 'bg-red-100 text-red-800' :
                        machine.status === 'maintenance' ? 'bg-purple-100 text-purple-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {machine.status || 'unknown'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {machine.machine_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {machine.machine_code}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">
                      {machine.machine_type?.replace(/_/g, ' ') || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {machine.health_score?.toFixed(1) || '-'}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {machine.current_load?.toFixed(1) || machine.load?.toFixed(1) || '-'}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {/* Handle location from both API and WebSocket formats */}
                      {machine.location || machine.plant_name || machine.plant?.name || machine.shop?.plant?.name || machine.line?.shop?.plant?.name || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {paginatedMachines.map((machine) => (
                  <Link
                    key={machine.machine_id}
                    to={`/machines/${machine.machine_id}`}
                    className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow group"
                  >
                    {/* Status Header */}
                    <div className={`px-4 py-2 border-b ${
                      machine.status === 'online' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      machine.status === 'offline' ? 'bg-red-50 text-red-700 border-red-200' :
                      machine.status === 'idle' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      machine.status === 'fault' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                      machine.status === 'maintenance' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      'bg-gray-50 text-gray-700 border-gray-200'
                    }`}>
                      <span className="text-xs font-semibold uppercase">
                        {machine.status || 'unknown'}
                      </span>
                    </div>

                    {/* Card Body */}
                    <div className="p-4">
                      {/* Machine Info */}
                      <h3 className="font-bold text-gray-900 mb-1">{machine.machine_name}</h3>
                      <p className="text-sm text-gray-500 mb-1">{machine.machine_code}</p>
                      <p className="text-xs text-gray-600 mb-4 capitalize">{machine.machine_type?.replace(/_/g, ' ') || '-'}</p>

                      {/* Metrics */}
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Health</span>
                          <span className="text-sm font-semibold text-gray-900">
                            {machine.health_score?.toFixed(1) || '-'}%
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Load</span>
                          <span className="text-sm font-semibold text-gray-900">
                            {machine.current_load?.toFixed(1) || machine.load?.toFixed(1) || '-'}%
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Location</span>
                          <span className="text-sm font-semibold text-gray-900 truncate ml-2">
                            {/* Handle location from both API and WebSocket formats */}
                            {machine.location || machine.plant_name || machine.plant?.name || machine.shop?.plant?.name || machine.line?.shop?.plant?.name || '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Pagination */}
        {!isLoading && machines.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing <span className="font-medium text-gray-900">{startIndex + 1}</span> to{' '}
                  <span className="font-medium text-gray-900">{Math.min(endIndex, machines.length)}</span> of{' '}
                  <span className="font-medium text-gray-900">{machines.length}</span> results
                </p>
              </div>
              <div>
                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="sr-only">Previous</span>
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                  
                  {/* Page Numbers */}
                  {[...Array(totalPages)].map((_, idx) => {
                    const pageNum = idx + 1
                    // Show first page, last page, current page, and pages around current
                    if (
                      pageNum === 1 ||
                      pageNum === totalPages ||
                      (pageNum >= currentPage - 1 && pageNum <= currentPage + 1)
                    ) {
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                            currentPage === pageNum
                              ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                              : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      )
                    } else if (
                      pageNum === currentPage - 2 ||
                      pageNum === currentPage + 2
                    ) {
                      return (
                        <span
                          key={pageNum}
                          className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700"
                        >
                          ...
                        </span>
                      )
                    }
                    return null
                  })}
                  
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="sr-only">Next</span>
                    <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PaintShop
