import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { 
  Activity, 
  AlertTriangle, 
  Zap, 
  Wind, 
  Droplets, 
  Gauge,
  TrendingUp,
  TrendingDown,
  Fan
} from 'lucide-react'
import { ClockIcon } from '@heroicons/react/24/outline'
import { machinesAPI, kpisAPI, dashboardComponentsAPI } from '../../services/api'
import InfoTooltip from '../../components/InfoTooltip'
import LocationFilter from '../../components/LocationFilter'
import TimeRangeFilter from '../../components/TimeRangeFilter'
import { useFilterStore } from '../../store/filterStore'
import { useMachineStatesWebSocket, useAlertsWebSocket, useWorkshopInsightsWebSocket } from '../../hooks/useWebSocket'

const powerSystemSkeletons = [1, 2, 3, 4]

const SkeletonHeaderPill = () => (
  <div className="flex items-center gap-2">
    <div className="h-6 w-24 bg-gray-200 rounded animate-pulse"></div>
    <div className="h-4 w-16 bg-gray-200 rounded animate-pulse"></div>
  </div>
)

const PowerDistributionSkeleton = ({ variant }) => {
  if (variant === 'header') {
    return <SkeletonHeaderPill />
  }

  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="h-4 w-20 bg-blue-100 rounded mb-3"></div>
          <div className="h-7 w-24 bg-blue-200 rounded"></div>
        </div>
        <div className="bg-indigo-50 rounded-lg p-4">
          <div className="h-4 w-24 bg-indigo-100 rounded mb-3"></div>
          <div className="h-7 w-28 bg-indigo-200 rounded"></div>
        </div>
        <div className="bg-cyan-50 rounded-lg p-4">
          <div className="h-4 w-24 bg-cyan-100 rounded mb-3"></div>
          <div className="h-7 w-28 bg-cyan-200 rounded"></div>
        </div>
        <div className="bg-rose-50 rounded-lg p-4">
          <div className="h-4 w-28 bg-rose-100 rounded mb-3"></div>
          <div className="h-7 w-16 bg-rose-200 rounded"></div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {powerSystemSkeletons.map((idx) => (
          <div key={`power-skeleton-${idx}`} className="border rounded-lg p-4 bg-white">
            <div className="h-5 w-32 bg-gray-200 rounded mb-3"></div>
            <div className="space-y-2">
              <div className="h-4 w-full bg-gray-100 rounded"></div>
              <div className="h-4 w-3/4 bg-gray-100 rounded"></div>
              <div className="h-4 w-2/3 bg-gray-100 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const waterSystemSkeletons = [1, 2, 3]

const WaterTreatmentSkeleton = () => (
  <div className="space-y-6 animate-pulse">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-teal-50 rounded-lg p-4">
        <div className="h-4 w-24 bg-teal-100 rounded mb-3"></div>
        <div className="h-7 w-20 bg-teal-200 rounded"></div>
      </div>
      <div className="bg-sky-50 rounded-lg p-4">
        <div className="h-4 w-28 bg-sky-100 rounded mb-3"></div>
        <div className="h-7 w-24 bg-sky-200 rounded"></div>
      </div>
      <div className="bg-emerald-50 rounded-lg p-4">
        <div className="h-4 w-24 bg-emerald-100 rounded mb-3"></div>
        <div className="h-7 w-20 bg-emerald-200 rounded"></div>
      </div>
      <div className="bg-amber-50 rounded-lg p-4">
        <div className="h-4 w-20 bg-amber-100 rounded mb-3"></div>
        <div className="h-7 w-24 bg-amber-200 rounded"></div>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {waterSystemSkeletons.map((idx) => (
        <div key={`water-skeleton-${idx}`} className="border rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-4">
            <div className="h-5 w-28 bg-gray-200 rounded"></div>
            <div className="h-6 w-16 bg-gray-100 rounded-full"></div>
          </div>
          <div className="space-y-2">
            <div className="h-4 w-24 bg-gray-100 rounded"></div>
            <div className="h-4 w-20 bg-gray-100 rounded"></div>
            <div className="h-4 w-16 bg-gray-100 rounded"></div>
            <div className="h-4 w-28 bg-gray-100 rounded"></div>
          </div>
        </div>
      ))}
    </div>
  </div>
)

const wasteBreakdownSkeletons = [1, 2, 3, 4]

const WasteManagementSkeleton = () => (
  <div className="space-y-6 animate-pulse">
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="bg-amber-50 rounded-lg p-4">
        <div className="h-4 w-24 bg-amber-100 rounded mb-3"></div>
        <div className="h-7 w-20 bg-amber-200 rounded"></div>
      </div>
      <div className="bg-emerald-50 rounded-lg p-4">
        <div className="h-4 w-28 bg-emerald-100 rounded mb-3"></div>
        <div className="h-7 w-24 bg-emerald-200 rounded"></div>
      </div>
      <div className="bg-rose-50 rounded-lg p-4">
        <div className="h-4 w-20 bg-rose-100 rounded mb-3"></div>
        <div className="h-7 w-24 bg-rose-200 rounded"></div>
      </div>
      <div className="bg-indigo-50 rounded-lg p-4">
        <div className="h-4 w-24 bg-indigo-100 rounded mb-3"></div>
        <div className="h-7 w-16 bg-indigo-200 rounded"></div>
      </div>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {wasteBreakdownSkeletons.map((idx) => (
        <div key={`waste-skeleton-${idx}`} className="border rounded-lg p-4 bg-white">
          <div className="h-5 w-32 bg-gray-200 rounded mb-2"></div>
          <div className="h-3 w-full bg-gray-100 rounded"></div>
          <div className="h-3 w-4/5 bg-gray-100 rounded mt-2"></div>
        </div>
      ))}
    </div>
  </div>
)

const OeeMetricsSkeleton = () => (
  <div className="grid grid-cols-1 md:grid-cols-4 gap-6 animate-pulse">
    {["Availability", "Performance", "Quality", "Overall"].map((label) => (
      <div key={label} className="text-center">
        <div className="h-4 w-24 bg-gray-200 rounded mx-auto mb-4"></div>
        <div className="relative inline-flex">
          <div className="w-24 h-24 rounded-full border-8 border-gray-200"></div>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-6 w-12 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    ))}
  </div>
)

const SHOP_TYPE = 'utilities'

function Utilities() {
  const { location, timeRange } = useFilterStore()
  const normalizePercent = (value) => {
    if (value == null) return null
    const numeric = Number(value)
    if (Number.isNaN(numeric)) return null
    return numeric <= 1 ? numeric * 100 : numeric
  }
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [viewMode, setViewMode] = useState('table') // 'table' or 'grid'
  const [currentPage, setCurrentPage] = useState(1)
  const [alertsPage, setAlertsPage] = useState(1)
  const [powerPage, setPowerPage] = useState(1)
  const powerPageSize = 4
  const [waterPage, setWaterPage] = useState(1)
  const waterPageSize = 3
  const [wastePage, setWastePage] = useState(1)
  const wastePageSize = 4
  const itemsPerPage = 12 // 12 items per page for grid, works well for table too
  const alertsPerPage = 5 // 5 alerts per page

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
    powerDistribution: livePowerDistribution,
    waterTreatment: liveWaterTreatment,
    wasteManagement: liveWasteManagement,
    hvacSystems: liveHvacSystems,
    utilityOEE: liveUtilityOEE,
    machineStatusCounts: liveMachineStatusCounts,
    isConnected: insightsConnected,
    timestamp: insightsTimestamp
  } = useWorkshopInsightsWebSocket(SHOP_TYPE, null, plantCode)

  const isLive = machinesConnected && alertsConnected && insightsConnected

  const handleRefresh = () => {
    setLastUpdated(new Date())
    refetchKpis()
    refetchMachines()
    refetchInsights()
  }

  // Fetch KPI data with filters (for trend data and initial load)
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
      setLastUpdated(new Date())
      return response.data
    },
    // Always enabled for initial load, provides trend data
    staleTime: 30000, // Consider data fresh for 30 seconds (WebSocket will update in real-time)
  })

  // Fetch machines data with status and filters (for initial load)
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
      setLastUpdated(new Date())
      return response.data
    },
    // Always enabled for fast initial load, then WebSocket takes over
    staleTime: 30000, // Consider data fresh for 30 seconds (WebSocket will update in real-time)
  })

  // Fetch utilities insights (for initial load)
  const {
    data: insightsResponse,
    isLoading: insightsLoading,
    error: insightsError,
    refetch: refetchInsights,
  } = useQuery({
    queryKey: ['utilities-insights', SHOP_TYPE, location, timeRange],
    queryFn: async () => {
      const params = {
        time_range: timeRange,
      }

      if (location && location !== 'all') {
        params.location = location
      }

      const response = await dashboardComponentsAPI.getWorkshopInsights(SHOP_TYPE, params)
      const { data, metadata, last_updated: lastUpdated } = response.data || {}
      return {
        insights: data || {},
        metadata: metadata || {},
        lastUpdated,
      }
    },
    // Always enabled for fast initial load, then WebSocket takes over
    staleTime: 30000, // Consider data fresh for 30 seconds (WebSocket will update in real-time)
  })

  // Use WebSocket data when available, fallback to API
  const machines = useMemo(() => {
    // Prefer WebSocket data when connected and has data
    if (machinesConnected && liveMachines.length > 0) {
      return liveMachines
    }
    // Fallback to API data (used for initial load or when WebSocket disconnected)
    return machinesData || []
  }, [machinesConnected, liveMachines, machinesData])

  const isLoading = (machinesLoading || insightsLoading) && !machinesConnected && !insightsConnected
  // Show loading only during initial load when no data is available yet
  const overviewLoading = !isLive && machines.length === 0 && (kpiLoading || machinesLoading || insightsLoading)

  // Use WebSocket insights when available, fallback to API
  const insights = useMemo(() => {
    // Prefer WebSocket data when connected
    if (insightsConnected && (livePowerDistribution || liveWaterTreatment || liveWasteManagement || liveUtilityOEE)) {
      return {
        power_distribution: livePowerDistribution || {},
        water_treatment: liveWaterTreatment || {},
        waste_management: liveWasteManagement || {},
        hvac_systems: liveHvacSystems || [],
        utility_oee: liveUtilityOEE || {},
        machine_status_counts: liveMachineStatusCounts || {},
      }
    }
    // Fallback to API data (used for initial load or when WebSocket disconnected)
    return insightsResponse?.insights || {}
  }, [insightsConnected, livePowerDistribution, liveWaterTreatment, liveWasteManagement, liveHvacSystems, liveUtilityOEE, liveMachineStatusCounts, insightsResponse])

  const powerDistribution = insights.power_distribution || {}
  const waterTreatment = insights.water_treatment || {}
  const wasteManagement = insights.waste_management || {}
  const utilityOEE = insights.utility_oee || {}
  const machineStatusCounts = insights.machine_status_counts || utilityOEE.machine_status_counts || {}

  const resolvedAvailability = normalizePercent(
    utilityOEE.availability ?? kpiData?.availability?.value ?? kpiData?.availability
  )
  const resolvedPerformance = normalizePercent(
    utilityOEE.performance ?? kpiData?.performance?.value ?? kpiData?.performance
  )
  const resolvedQuality = normalizePercent(
    utilityOEE.quality ?? kpiData?.quality?.value ?? kpiData?.quality
  )
  const resolvedOEE = normalizePercent(
    utilityOEE.oee ?? kpiData?.oee?.value ?? kpiData?.oee
  )

  const availabilityRatio = resolvedAvailability != null ? resolvedAvailability / 100 : 0
  const performanceRatio = resolvedPerformance != null ? resolvedPerformance / 100 : 0
  const qualityRatio = resolvedQuality != null ? resolvedQuality / 100 : 0
  const oeeRatio = resolvedOEE != null ? resolvedOEE / 100 : 0
  const hasOeeMetrics = [resolvedAvailability, resolvedPerformance, resolvedQuality, resolvedOEE].some(
    (value) => value != null
  )

  // Pagination calculations
  const totalPages = Math.ceil(machines.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedMachines = machines.slice(startIndex, endIndex)

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
    setAlertsPage(1)
    setPowerPage(1)
    setWaterPage(1)
    setWastePage(1)
  }, [location, timeRange])

  // Update timestamp when WebSocket data arrives
  useEffect(() => {
    if (machinesTimestamp || insightsTimestamp || alertsTimestamp) {
      setLastUpdated(new Date())
    }
  }, [machinesTimestamp, insightsTimestamp, alertsTimestamp])

  if (insightsError) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4">
          <h2 className="text-lg font-semibold">Failed to load utilities insights</h2>
          <p className="text-sm mt-1">
            {insightsError?.response?.data?.message || insightsError.message || 'An unexpected error occurred.'}
          </p>
        </div>
      </div>
    )
  }

  // Calculate machine status counts
  const statusCounts = {
    total: machineStatusCounts.total ?? machines.length,
    online: machineStatusCounts.online ?? machines.filter(m => m.status === 'online').length,
    offline: machineStatusCounts.offline ?? machines.filter(m => m.status === 'offline').length,
    idle: machineStatusCounts.idle ?? machines.filter(m => m.status === 'idle').length,
    fault: machineStatusCounts.fault ?? machines.filter(m => m.status === 'fault').length,
    maintenance: machineStatusCounts.maintenance ?? machines.filter(m => m.status === 'maintenance').length,
  }

  const fallbackOnlineRatio = statusCounts.total > 0 ? normalizePercent(statusCounts.online / statusCounts.total) : null
  const equipmentOeeValue = resolvedOEE ?? fallbackOnlineRatio

  // Group machines by system type
  const hvacSystems = machines.filter(m => 
    ['hvac_unit', 'chiller', 'cooling_tower'].includes(m.machine_type)
  )
  const compressedAir = machines.filter(m => 
    ['air_compressor', 'air_dryer', 'air_receiver'].includes(m.machine_type)
  )
  const _powerSystems = machines.filter(m => 
    ['transformer', 'switchgear', 'ups', 'generator'].includes(m.machine_type)
  )
  const waterSystems = machines.filter(m => 
    ['ro_system', 'softener', 'cooling_pump', 'boiler'].includes(m.machine_type)
  )

  // Calculate power metrics
  const totalPowerConsumption = machines.reduce((sum, m) => 
    sum + (m.power_consumption || 0), 0
  )
  const _avgPowerFactor = machines.length > 0
    ? machines.reduce((sum, m) => sum + (m.current_load || 0.95), 0) / machines.length
    : 0

  // Calculate compressed air metrics
  const avgAirPressure = compressedAir.length > 0
    ? compressedAir.reduce((sum, m) => sum + (m.current_load || 7.0), 0) / compressedAir.length
    : 0

  // Calculate water metrics
  const totalWaterFlow = waterSystems.reduce((sum, m) => 
    sum + (m.current_cycle || 0), 0
  )

  // Get active alerts
  const activeAlerts = machines
    .filter(m => m.status === 'fault' || m.fault_code)
    .map(machine => ({
      machine_code: machine.machine_code,
      machine_name: machine.machine_name,
      severity: machine.status === 'fault' ? 'critical' : 'warning',
      message: machine.fault_message || machine.fault_code || 'Equipment fault detected',
      machine_id: machine.machine_id,
    }))

  // Pagination for alerts
  const totalAlertPages = Math.ceil(activeAlerts.length / alertsPerPage)
  const startAlertIndex = (alertsPage - 1) * alertsPerPage
  const endAlertIndex = startAlertIndex + alertsPerPage
  const currentAlerts = activeAlerts.slice(startAlertIndex, endAlertIndex)

  // Tooltip metadata for metrics
  const metricsMetadata = {
    power: {
      title: 'Total Power Consumption',
      description: 'Real-time total electrical power consumed by all utility equipment including HVAC, compressors, transformers, and support systems.',
      calculation: 'Sum of instantaneous power readings (kW) from all monitored equipment',
      significance: 'Critical for energy management and cost control. Track against production output for energy efficiency metrics. Reduction indicates improved efficiency or reduced load.'
    },
    airPressure: {
      title: 'Compressed Air System Pressure',
      description: 'Average system pressure across all compressed air network equipment including compressors, dryers, and receivers.',
      calculation: 'Mean pressure (bar) from all active compressed air system components',
      significance: 'Optimal range is 6.5-8.0 bar. Low pressure indicates system inefficiency or leaks. High pressure wastes energy. Stable pressure ensures consistent production quality.'
    },
    waterUsage: {
      title: 'Water Usage & Flow Rate',
      description: 'Total water flow rate through treatment, cooling, and distribution systems including RO plants, cooling towers, and process water.',
      calculation: 'Sum of flow rates (m³/h) from all water system flow meters',
      significance: 'Key sustainability metric. Monitor for leaks, efficiency improvements, and regulatory compliance. Compare against production volume for water efficiency KPIs.'
    },
    oee: {
      title: 'Equipment Overall Effectiveness',
      description: 'Percentage of utility equipment currently operational and available to support production operations.',
      calculation: '(Online Equipment ÷ Total Equipment) × 100',
      significance: 'Utility equipment availability directly impacts production capability. Target >95% for critical utilities. Lower values indicate maintenance needs or systemic issues.'
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header with Controls */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Utilities Dashboard</h1>
            {isLive && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Live
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">Central utilities monitoring - Power, HVAC, Compressed Air & Water Systems</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <LocationFilter />
          <TimeRangeFilter />
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
          <div className="flex items-center gap-2 text-gray-500">
            <ClockIcon className="w-4 h-4" />
            <span className="text-sm">Last updated: {lastUpdated.toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Total Power Consumption */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-normal text-gray-600">Total Power</h3>
              <InfoTooltip 
                title={metricsMetadata.power.title}
                description={metricsMetadata.power.description}
                calculation={metricsMetadata.power.calculation}
                significance={metricsMetadata.power.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-blue-50">
              <Zap className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {isLoading ? '...' : 
                  powerDistribution.total_power_kw ? Math.round(powerDistribution.total_power_kw) :
                  kpiData?.power?.value ? Math.round(kpiData.power.value) : 
                  Math.round(totalPowerConsumption)}
              </span>
              <span className="text-lg text-gray-500 font-normal">kW</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            {kpiData?.power?.change && kpiData?.power?.change !== 0 ? (
              <div className="flex items-center gap-1">
                {kpiData.power.trend === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-red-500" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-green-500" />
                )}
                <span className={`text-sm font-normal ${kpiData.power.trend === 'up' ? 'text-red-500' : 'text-green-500'}`}>
                  {Math.abs(kpiData.power.change).toFixed(1)}% vs yesterday
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
            <Link to="/analytics?metric=power" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Compressed Air Pressure */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-normal text-gray-600">Air Pressure</h3>
              <InfoTooltip 
                title={metricsMetadata.airPressure.title}
                description={metricsMetadata.airPressure.description}
                calculation={metricsMetadata.airPressure.calculation}
                significance={metricsMetadata.airPressure.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-cyan-50">
              <Wind className="w-6 h-6 text-cyan-600" />
            </div>
          </div>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {isLoading ? '...' : kpiData?.airPressure?.value ? kpiData.airPressure.value.toFixed(1) : avgAirPressure.toFixed(1)}
              </span>
              <span className="text-lg text-gray-500 font-normal">bar</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            {kpiData?.airPressure?.change && kpiData?.airPressure?.change !== 0 ? (
              <div className="flex items-center gap-1">
                {kpiData.airPressure.trend === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                )}
                <span className={`text-sm font-normal ${kpiData.airPressure.trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                  {Math.abs(kpiData.airPressure.change).toFixed(1)}% vs yesterday
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-sm font-normal text-gray-500">
                  Normal range
                </span>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-3">
            <Link to="/analytics?metric=air-pressure" className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Water Flow */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-normal text-gray-600">Water Usage</h3>
              <InfoTooltip 
                title={metricsMetadata.waterUsage.title}
                description={metricsMetadata.waterUsage.description}
                calculation={metricsMetadata.waterUsage.calculation}
                significance={metricsMetadata.waterUsage.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-teal-50">
              <Droplets className="w-6 h-6 text-teal-600" />
            </div>
          </div>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {isLoading ? '...' : kpiData?.waterUsage?.value ? Math.round(kpiData.waterUsage.value) : Math.round(totalWaterFlow)}
              </span>
              <span className="text-lg text-gray-500 font-normal">m³/h</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            {kpiData?.waterUsage?.change && kpiData?.waterUsage?.change !== 0 ? (
              <div className="flex items-center gap-1">
                {kpiData.waterUsage.trend === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-red-500" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-green-500" />
                )}
                <span className={`text-sm font-normal ${kpiData.waterUsage.trend === 'up' ? 'text-red-500' : 'text-green-500'}`}>
                  {Math.abs(kpiData.waterUsage.change).toFixed(1)}% vs yesterday
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
            <Link to="/analytics?metric=water-usage" className="inline-flex items-center gap-1 text-sm font-semibold text-teal-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Equipment Status */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-semibold text-gray-900">Equipment OEE</h3>
              <InfoTooltip
                title={metricsMetadata.oee.title}
                description={metricsMetadata.oee.description}
                calculation={metricsMetadata.oee.calculation}
                significance={metricsMetadata.oee.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-purple-50">
              <Gauge className="w-6 h-6 text-purple-600" />
            </div>
          </div>

          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {overviewLoading ? '…' : equipmentOeeValue != null ? Math.round(equipmentOeeValue) : '—'}
              </span>
              <span className="text-lg text-gray-500 font-normal">%</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            <div className="flex items-center gap-1">
              <Activity className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-sm font-normal text-gray-500">
                {utilityOEE.fault_count ?? statusCounts.fault ?? 0} faults detected
              </span>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-3">
            <Link to="/analytics?metric=oee&shop=utilities" className="inline-flex items-center gap-1 text-sm font-semibold text-purple-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
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

      {/* Power Distribution */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Power Distribution</h2>
            <p className="text-sm text-gray-500 mt-1">Real-time power consumption and distribution</p>
          </div>
          {!insightsConnected && insightsLoading && <PowerDistributionSkeleton variant="header" />}
        </div>
        <div className="p-6">
          {!insightsConnected && insightsLoading ? (
            <PowerDistributionSkeleton />
          ) : powerDistribution.systems && powerDistribution.systems.length > 0 ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-xs text-blue-600 font-medium uppercase">Total Load</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{Math.round(powerDistribution.total_power_kw)} kW</p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-4">
                  <p className="text-xs text-indigo-600 font-medium uppercase">Peak Load</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{normalizePercent(powerDistribution.peak_load_pct)?.toFixed(1)}%</p>
                </div>
                <div className="bg-cyan-50 rounded-lg p-4">
                  <p className="text-xs text-cyan-600 font-medium uppercase">Average Load</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{normalizePercent(powerDistribution.average_load_pct)?.toFixed(1)}%</p>
                </div>
                <div className="bg-rose-50 rounded-lg p-4">
                  <p className="text-xs text-rose-600 font-medium uppercase">Faulty Assets</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{powerDistribution.faulty_assets}</p>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700">System Overview</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {powerDistribution.systems.slice((powerPage - 1) * powerPageSize, powerPage * powerPageSize).map((system, idx) => (
                    <div key={`${system.name}-${idx}`} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-gray-900">{system.name}</p>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${system.status === 'alert' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {system.status === 'alert' ? 'Alert' : 'Normal'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p><span className="font-semibold text-gray-900">Power:</span> {system.power_kw} kW</p>
                        <p><span className="font-semibold text-gray-900">Load:</span> {system.load_pct}%</p>
                        <p><span className="font-semibold text-gray-900">Equipment:</span> {system.equipment_count}</p>
                        <p><span className="font-semibold text-gray-900">Faulty:</span> {system.faulty_count}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {powerDistribution.systems.length > powerPageSize && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-sm text-gray-500">
                      Showing {Math.min(powerPageSize, powerDistribution.systems.length - (powerPage - 1) * powerPageSize)} of {powerDistribution.systems.length} systems
                    </span>
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPowerPage(prev => Math.max(1, prev - 1))}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={powerPage === 1}
                      >
                        Previous
                      </button>
                      <span className="text-sm text-gray-500">Page {powerPage} of {Math.ceil(powerDistribution.systems.length / powerPageSize)}</span>
                      <button
                        type="button"
                        onClick={() => setPowerPage(prev => Math.min(Math.ceil(powerDistribution.systems.length / powerPageSize), prev + 1))}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={powerPage === Math.ceil(powerDistribution.systems.length / powerPageSize)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                <Zap className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 text-base font-medium">Power Distribution Data Not Available</p>
              <p className="text-gray-400 text-sm mt-1">Connect power monitoring system to view real-time distribution metrics</p>
            </div>
          )}
        </div>
      </div>

      {/* System Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compressed Air System */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Compressed Air System</h2>
            <p className="text-sm text-gray-500 mt-1">Compressor network monitoring</p>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-6 mb-6">
              {/* System Pressure */}
              <div className="space-y-2">
                <p className="text-sm text-gray-600">System Pressure</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-green-600">
                    {compressedAir.length > 0 ? avgAirPressure.toFixed(1) : '--'}
                  </span>
                  <span className="text-sm text-gray-600">bar</span>
                </div>
                {compressedAir.length > 0 ? (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min((avgAirPressure / 10) * 100, 100)}%` }}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No data available</p>
                )}
              </div>

              {/* Compressor Count */}
              <div className="space-y-2">
                <p className="text-sm text-gray-600">Active Compressors</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-green-600">
                    {compressedAir.filter(m => m.status === 'online').length}
                  </span>
                  <span className="text-sm text-gray-600">/ {compressedAir.length}</span>
                </div>
                {compressedAir.length > 0 ? (
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(compressedAir.filter(m => m.status === 'online').length / compressedAir.length) * 100}%` }}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No compressor equipment found</p>
                )}
              </div>
            </div>

            {/* Compressor Status */}
            <div className="pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-600 mb-3">Equipment Summary</p>
              {compressedAir.length > 0 ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-blue-600 font-medium mb-1">Compressors</p>
                    <p className="text-lg font-bold text-gray-900">
                      {compressedAir.filter(m => m.machine_type === 'air_compressor').length}
                    </p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-purple-600 font-medium mb-1">Dryers</p>
                    <p className="text-lg font-bold text-gray-900">
                      {compressedAir.filter(m => m.machine_type === 'air_dryer').length}
                    </p>
                  </div>
                  <div className="bg-teal-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-teal-600 font-medium mb-1">Receivers</p>
                    <p className="text-lg font-bold text-gray-900">
                      {compressedAir.filter(m => m.machine_type === 'air_receiver').length}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-20">
                  <p className="text-sm text-gray-400">No compressed air equipment found</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* HVAC System */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">HVAC Systems</h2>
              <Fan className="w-5 h-5 text-cyan-600" />
            </div>
          </div>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-600">System Efficiency</span>
              <span className="text-lg font-semibold text-gray-900">
                {hvacSystems.length > 0
                  ? `${Math.round((hvacSystems.filter(m => m.status === 'online').length / hvacSystems.length) * 100)}%`
                  : '0%'}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
              <div 
                className="bg-cyan-600 h-2 rounded-full transition-all duration-300"
                style={{ 
                  width: hvacSystems.length > 0
                    ? `${(hvacSystems.filter(m => m.status === 'online').length / hvacSystems.length) * 100}%`
                    : '0%'
                }}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-cyan-50 rounded-lg p-4">
                <p className="text-xs text-cyan-600 font-medium">AHU</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {hvacSystems.filter(m => m.machine_type === 'hvac_unit').length}
                </p>
                <p className="text-xs text-gray-500 mt-1">Units</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-xs text-blue-600 font-medium">Chillers</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {hvacSystems.filter(m => m.machine_type === 'chiller').length}
                </p>
                <p className="text-xs text-gray-500 mt-1">Units</p>
              </div>
              <div className="bg-teal-50 rounded-lg p-4">
                <p className="text-xs text-teal-600 font-medium">Cooling Towers</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {hvacSystems.filter(m => m.machine_type === 'cooling_tower').length}
                </p>
                <p className="text-xs text-gray-500 mt-1">Units</p>
              </div>
            </div>
          </div>
        </div>

        {/* Water Treatment */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <Droplets className="w-5 h-5 text-gray-700" />
              <h2 className="text-lg font-semibold text-gray-900">Water Treatment</h2>
            </div>
            <p className="text-sm text-gray-500 mt-1">Water systems monitoring</p>
          </div>
          <div className="p-6">
            {!insightsConnected && insightsLoading ? (
              <WaterTreatmentSkeleton />
            ) : waterTreatment.systems && waterTreatment.systems.length > 0 ? (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-teal-50 rounded-lg p-4">
                  <p className="text-xs text-teal-600 font-medium uppercase">Flow Rate</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{waterTreatment.flow_rate_m3h} m³/h</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-xs text-blue-600 font-medium uppercase">Recovery</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{waterTreatment.recovery_pct}%</p>
                </div>
                <div className="bg-cyan-50 rounded-lg p-4">
                  <p className="text-xs text-cyan-600 font-medium uppercase">pH Level</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{waterTreatment.ph_level}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-4">
                  <p className="text-xs text-emerald-600 font-medium uppercase">Alerts</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{waterTreatment.alerts}</p>
                </div>
              </div>
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700">Systems</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {waterTreatment.systems.slice((waterPage - 1) * waterPageSize, waterPage * waterPageSize).map((system, idx) => (
                    <div key={`${system.name}-${idx}`} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-semibold text-gray-900">{system.name}</p>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${system.status === 'alert' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {system.status === 'alert' ? 'Alert' : 'Normal'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p><span className="font-semibold text-gray-900">Flow:</span> {system.flow_rate_m3h} m³/h</p>
                        <p><span className="font-semibold text-gray-900">Uptime:</span> {system.uptime_pct}%</p>
                        <p><span className="font-semibold text-gray-900">Quality:</span> {system.quality_index}</p>
                        <p><span className="font-semibold text-gray-900">Units:</span> {system.equipment_count}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {waterTreatment.systems.length > waterPageSize && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-sm text-gray-500">
                      Showing {Math.min(waterPageSize, waterTreatment.systems.length - (waterPage - 1) * waterPageSize)} of {waterTreatment.systems.length} systems
                    </span>
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setWaterPage(prev => Math.max(1, prev - 1))}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={waterPage === 1}
                      >
                        Previous
                      </button>
                      <span className="text-sm text-gray-500">Page {waterPage} of {Math.ceil(waterTreatment.systems.length / waterPageSize)}</span>
                      <button
                        type="button"
                        onClick={() => setWaterPage(prev => Math.min(Math.ceil(waterTreatment.systems.length / waterPageSize), prev + 1))}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={waterPage === Math.ceil(waterTreatment.systems.length / waterPageSize)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                <Droplets className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 text-base font-medium">Water Treatment Data Not Available</p>
              <p className="text-gray-400 text-sm mt-1">Connect water monitoring system to view treatment metrics</p>
            </div>
          )}
        </div>
        </div>

        {/* Waste Management */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <h2 className="text-lg font-semibold text-gray-900">Waste Management</h2>
            </div>
            <p className="text-sm text-gray-500 mt-1">Waste tracking and recycling metrics</p>
          </div>
          <div className="p-6">
            {!insightsConnected && insightsLoading ? (
              <WasteManagementSkeleton />
            ) : wasteManagement.breakdown && wasteManagement.breakdown.length > 0 ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-amber-50 rounded-lg p-4">
                    <p className="text-xs text-amber-600 font-medium uppercase">Total Waste</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{wasteManagement.total_tonnage} t</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-4">
                    <p className="text-xs text-emerald-600 font-medium uppercase">Recycling Rate</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{wasteManagement.recycling_rate}%</p>
                  </div>
                  <div className="bg-rose-50 rounded-lg p-4">
                    <p className="text-xs text-rose-600 font-medium uppercase">Hazardous Incidents</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{wasteManagement.hazardous_incidents}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-4">
                    <p className="text-xs text-slate-600 font-medium uppercase">CO₂ Savings</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{wasteManagement.co2_savings_tonnes} t</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-gray-700">Waste Streams</h3>
                  <div className="space-y-3">
                    {wasteManagement.breakdown.slice((wastePage - 1) * wastePageSize, wastePage * wastePageSize).map((stream, idx) => (
                      <div key={`${stream.category}-${idx}`} className="border rounded-lg p-4 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{stream.category}</p>
                          <p className="text-sm text-gray-500">Trend: {stream.trend_pct > 0 ? '+' : ''}{stream.trend_pct}%</p>
                        </div>
                        <div className="text-lg font-bold text-gray-900">{stream.tonnage} t</div>
                      </div>
                    ))}
                  </div>
                  {wasteManagement.breakdown.length > wastePageSize && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-sm text-gray-500">
                        Showing {Math.min(wastePageSize, wasteManagement.breakdown.length - (wastePage - 1) * wastePageSize)} of {wasteManagement.breakdown.length} streams
                      </span>
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setWastePage(prev => Math.max(1, prev - 1))}
                          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={wastePage === 1}
                        >
                          Previous
                        </button>
                        <span className="text-sm text-gray-500">Page {wastePage} of {Math.ceil(wasteManagement.breakdown.length / wastePageSize)}</span>
                        <button
                          type="button"
                          onClick={() => setWastePage(prev => Math.min(Math.ceil(wasteManagement.breakdown.length / wastePageSize), prev + 1))}
                          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={wastePage === Math.ceil(wasteManagement.breakdown.length / wastePageSize)}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <p className="text-gray-500 text-base font-medium">Waste Management Data Not Available</p>
                <p className="text-gray-400 text-sm mt-1">Connect waste tracking system to view waste and recycling metrics</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* All Equipment Table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">All Equipment</h2>
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
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
              <Link to="/control-center?shop=utilities" className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1">
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
                      {machine.current_load?.toFixed(1) || '-'}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {machine.plant?.name || machine.shop?.plant?.name || machine.line?.shop?.plant?.name || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {paginatedMachines.map((machine) => (
                  <div
                    key={machine.machine_id}
                    onClick={() => window.location.href = `/machines/${machine.machine_id}`}
                    className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer group"
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
                            {machine.current_load?.toFixed(1) || '-'}%
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-600">Location</span>
                          <span className="text-sm font-semibold text-gray-900 truncate ml-2">
                            {machine.plant?.name || machine.shop?.plant?.name || machine.line?.shop?.plant?.name || '-'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
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

      {/* Alerts Section */}
      {activeAlerts.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Active Alerts
              <span className="text-sm font-normal text-gray-500">
                ({activeAlerts.length} total)
              </span>
            </h2>
          </div>
          <div className="p-6">
            <div className="space-y-3">
              {currentAlerts.map((alert, idx) => (
                <div key={idx} className={`p-4 rounded-lg border-l-4 ${
                  alert.severity === 'critical' 
                    ? 'bg-red-50 border-red-500' 
                    : 'bg-yellow-50 border-yellow-500'
                }`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className={`w-5 h-5 mt-0.5 ${
                        alert.severity === 'critical' ? 'text-red-600' : 'text-yellow-600'
                      }`} />
                      <div>
                        <p className="font-medium text-gray-900">{alert.machine_name}</p>
                        <p className="text-sm text-gray-600 mt-1">{alert.message}</p>
                        <p className="text-xs text-gray-500 mt-1">Equipment ID: {alert.machine_code}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      alert.severity === 'critical'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {alert.severity.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Alerts Pagination */}
            {totalAlertPages > 1 && (
              <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span>
                    Showing <span className="font-medium text-gray-900">{startAlertIndex + 1}</span> to <span className="font-medium text-gray-900">{Math.min(endAlertIndex, activeAlerts.length)}</span> of <span className="font-medium text-gray-900">{activeAlerts.length}</span> alerts
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAlertsPage(p => Math.max(1, p - 1))}
                    disabled={alertsPage === 1}
                    className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Previous
                  </button>
                  <div className="hidden sm:flex items-center gap-1">
                    {Array.from({ length: totalAlertPages }, (_, i) => i + 1).map(page => (
                      <button
                        key={page}
                        onClick={() => setAlertsPage(page)}
                        className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                          page === alertsPage
                            ? 'bg-blue-600 text-white font-medium'
                            : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                  <div className="sm:hidden">
                    <span className="text-sm text-gray-700">
                      Page <span className="font-medium text-gray-900">{alertsPage}</span> of <span className="font-medium text-gray-900">{totalAlertPages}</span>
                    </span>
                  </div>
                  <button
                    onClick={() => setAlertsPage(p => Math.min(totalAlertPages, p + 1))}
                    disabled={alertsPage === totalAlertPages}
                    className="px-3 py-1.5 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* OEE Metrics */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Overall Equipment Effectiveness (OEE)</h2>
          <p className="text-sm text-gray-500 mt-1">Equipment performance breakdown</p>
        </div>
        <div className="p-6">
          {isLoading ? (
            <OeeMetricsSkeleton />
          ) : hasOeeMetrics ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">Availability</p>
                <div className="relative inline-flex">
                  <svg className="w-24 h-24 transform -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="#e5e7eb"
                      strokeWidth="8"
                      fill="none"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="#3b82f6"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 40}`}
                      strokeDashoffset={`${2 * Math.PI * 40 * (1 - availabilityRatio)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-bold text-gray-900">
                      {resolvedAvailability != null ? Math.round(resolvedAvailability) : '—'}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">Performance</p>
                <div className="relative inline-flex">
                  <svg className="w-24 h-24 transform -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="#e5e7eb"
                      strokeWidth="8"
                      fill="none"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="#10b981"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 40}`}
                      strokeDashoffset={`${2 * Math.PI * 40 * (1 - performanceRatio)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-bold text-gray-900">
                      {resolvedPerformance != null ? Math.round(resolvedPerformance) : '—'}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">Quality</p>
                <div className="relative inline-flex">
                  <svg className="w-24 h-24 transform -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="#e5e7eb"
                      strokeWidth="8"
                      fill="none"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="#f59e0b"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 40}`}
                      strokeDashoffset={`${2 * Math.PI * 40 * (1 - qualityRatio)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-bold text-gray-900">
                      {resolvedQuality != null ? Math.round(resolvedQuality) : '—'}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">Overall OEE</p>
                <div className="relative inline-flex">
                  <svg className="w-24 h-24 transform -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="#e5e7eb"
                      strokeWidth="8"
                      fill="none"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="#8b5cf6"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 40}`}
                      strokeDashoffset={`${2 * Math.PI * 40 * (1 - oeeRatio)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-bold text-gray-900">
                      {resolvedOEE != null ? Math.round(resolvedOEE) : '—'}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                <Gauge className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 text-base font-medium">OEE Metrics Not Available</p>
              <p className="text-gray-400 text-sm mt-1">No OEE data available for the selected filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Utilities
