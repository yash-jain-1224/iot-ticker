import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { 
  Activity, 
  TrendingUp, 
  TrendingDown,
  Gauge,
  CheckCircle,
  Clock
} from 'lucide-react'
import { ClockIcon } from '@heroicons/react/24/outline'
import { machinesAPI, kpisAPI, dashboardComponentsAPI } from '../../services/api'
import LocationFilter from '../../components/LocationFilter'
import TimeRangeFilter from '../../components/TimeRangeFilter'
import { useFilterStore } from '../../store/filterStore'
import InfoTooltip from '../../components/InfoTooltip'
import {
  KPICardSkeleton,
  TableSkeleton,
  PanelSkeleton,
  MachineGridSkeleton,
} from '../../components/skeletons'
import { useMachineStatesWebSocket, useAlertsWebSocket, useWorkshopInsightsWebSocket } from '../../hooks/useWebSocket'

const PipelineSkeleton = () => <PanelSkeleton height="h-56" />

const StationsSkeleton = () => <PanelSkeleton height="h-72" />

const QualitySkeleton = () => <PanelSkeleton height="h-64" />

const TorqueTableSkeleton = ({ rows = 8 }) => <TableSkeleton rows={rows} columns={7} />

const SHOP_TYPE = 'final_assembly'

function FinalAssembly() {
  const { location, timeRange } = useFilterStore()
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [viewMode, setViewMode] = useState('table') // 'table' or 'grid'
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 12 // 12 items per page for grid, works well for table too

  const [pipelinePage, setPipelinePage] = useState(1)
  const pipelinePageSize = 3
  const [stationPage, setStationPage] = useState(1)
  const stationPageSize = 4
  const [defectPage, setDefectPage] = useState(1)
  const defectPageSize = 4

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
    productionPipeline: liveProductionPipeline,
    assemblyStations: liveAssemblyStations,
    qualityMetrics: liveQualityMetrics,
    torqueTools: liveTorqueTools,
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

  // Fetch workshop insights for panels - Always enabled for fast initial load with 30s cache
  const {
    data: insightsResponse,
    isLoading: insightsLoading,
    refetch: refetchInsights,
  } = useQuery({
    queryKey: ['workshop-insights', SHOP_TYPE, location, timeRange],
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
    staleTime: 30000, // Cache for 30 seconds for fast initial loads
  })

  const machines = useMemo(() => {
    if (machinesConnected && liveMachines.length > 0) {
      return liveMachines
    }
    return machinesData || []
  }, [machinesConnected, liveMachines, machinesData])

  const isLoading = machinesLoading && !machinesConnected

  // Use WebSocket insights when available, fallback to API
  const insights = useMemo(() => {
    if (insightsConnected) {
      return {
        production_pipeline: liveProductionPipeline || [],
        assembly_stations: liveAssemblyStations || [],
        quality_metrics: liveQualityMetrics || null,
        torque_tools: liveTorqueTools || [],
      }
    }
    return insightsResponse?.insights || {}
  }, [insightsConnected, liveProductionPipeline, liveAssemblyStations, liveQualityMetrics, liveTorqueTools, insightsResponse])

  const _insightsMetadata = insightsResponse?.metadata || {}
  const _insightsLastUpdated = insightsResponse?.lastUpdated
  
  // Compute insights loading state - only show loading if WebSocket not connected AND API is loading
  const insightsLoadingState = insightsLoading && !insightsConnected

  // Update timestamp when WebSocket data arrives
  useEffect(() => {
    if (machinesTimestamp || alertsTimestamp || insightsTimestamp) {
      setLastUpdated(new Date())
    }
  }, [machinesTimestamp, alertsTimestamp, insightsTimestamp])

  const [torquePage, setTorquePage] = useState(1)
  const torquePageSize = 8
  const torqueTools = insights.torque_tools || []
  const totalTorquePages = Math.max(1, Math.ceil(torqueTools.length / torquePageSize))
  const paginatedTorqueTools = torqueTools.slice((torquePage - 1) * torquePageSize, torquePage * torquePageSize)

  const handleTorquePageChange = (direction) => {
    setTorquePage((prev) => {
      if (direction === 'prev') {
        return prev > 1 ? prev - 1 : prev
      }
      if (direction === 'next') {
        return prev < totalTorquePages ? prev + 1 : prev
      }
      return prev
    })
  }

  useEffect(() => {
    setTorquePage(1)
  }, [torqueTools.length])

  useEffect(() => {
    setPipelinePage(1)
  }, [insights.production_pipeline?.length])

  useEffect(() => {
    setStationPage(1)
  }, [insights.assembly_stations?.length])

  useEffect(() => {
    setDefectPage(1)
  }, [insights.quality_metrics?.top_defects?.length])

  const pipelineData = insights.production_pipeline || []
  const totalPipelinePages = Math.max(1, Math.ceil(pipelineData.length / pipelinePageSize))
  const paginatedPipeline = pipelineData.slice((pipelinePage - 1) * pipelinePageSize, pipelinePage * pipelinePageSize)

  const stationData = insights.assembly_stations || []
  const totalStationPages = Math.max(1, Math.ceil(stationData.length / stationPageSize))
  const paginatedStations = stationData.slice((stationPage - 1) * stationPageSize, stationPage * stationPageSize)

  const defectData = Array.isArray(insights.quality_metrics?.top_defects)
    ? insights.quality_metrics.top_defects
    : []
  const totalDefectPages = Math.max(1, Math.ceil(defectData.length / defectPageSize))
  const paginatedDefects = defectData.slice((defectPage - 1) * defectPageSize, defectPage * defectPageSize)

  const handlePagerChange = (setter, page, total, direction) => {
    setter(direction === 'prev' ? Math.max(1, page - 1) : Math.min(total, page + 1))
  }
  
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

  // Tooltip metadata for metrics
  const metricsMetadata = {
    oee: {
      title: 'Overall Equipment Effectiveness',
      description: 'Comprehensive measure of manufacturing productivity combining availability, performance, and quality metrics for final assembly operations.',
      calculation: 'OEE = Availability × Performance × Quality',
      significance: 'Industry benchmark is 85%+. Tracks overall effectiveness of assembly line operations. Lower values indicate opportunities for process improvements.'
    },
    vehiclesCompleted: {
      title: 'Vehicles Completed',
      description: 'Total number of vehicles that have successfully completed the final assembly process within the selected time range.',
      calculation: 'Count of vehicles passing final inspection and quality gates',
      significance: 'Key production output metric. Track against daily targets and compare with historical performance for capacity planning.'
    },
    firstPassYield: {
      title: 'First Pass Yield',
      description: 'Percentage of vehicles that pass final quality inspection on the first attempt without requiring rework or corrections.',
      calculation: '(Vehicles Passed First Time ÷ Total Vehicles) × 100',
      significance: 'Quality excellence indicator. Target is >95%. Higher FPY reduces costs, improves throughput, and indicates strong process control.'
    },
    downtime: {
      title: 'Total Downtime',
      description: 'Cumulative time that assembly line operations were stopped or unable to produce due to equipment failures, maintenance, or other issues.',
      calculation: 'Sum of all unplanned and planned downtime periods',
      significance: 'Critical availability metric. Minimize to maximize production capacity. Track root causes for continuous improvement initiatives.'
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header with Controls */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Final Assembly Dashboard</h1>
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
          <p className="text-sm text-gray-500 mt-0.5">Final assembly line operations and monitoring</p>
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
            <span className="text-sm">Last updated: {lastUpdated.toLocaleTimeString()}</span>
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
                {kpiData?.oee?.value?.toFixed(1) || 0}
              </span>
              <span className="text-lg text-gray-500 font-normal">%</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            {kpiData?.oee?.change && kpiData?.oee?.change !== 0 ? (
              <div className="flex items-center gap-1">
                {kpiData.oee.trend === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                )}
                <span className={`text-sm font-normal ${kpiData.oee.trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                  {Math.abs(kpiData.oee.change).toFixed(1)}% vs yesterday
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
            <Link to="/analytics?metric=oee&shop=final-assembly" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Vehicles Completed */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-normal text-gray-600">Vehicles Completed</h3>
              <InfoTooltip 
                title={metricsMetadata.vehiclesCompleted.title}
                description={metricsMetadata.vehiclesCompleted.description}
                calculation={metricsMetadata.vehiclesCompleted.calculation}
                significance={metricsMetadata.vehiclesCompleted.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-green-50">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {kpiData?.production?.value || 0}
              </span>
              <span className="text-lg text-gray-500 font-normal">units</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            {kpiData?.production?.change && kpiData?.production?.change !== 0 ? (
              <div className="flex items-center gap-1">
                {kpiData.production.trend === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                )}
                <span className={`text-sm font-normal ${kpiData.production.trend === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                  {Math.abs(kpiData.production.change).toFixed(1)}% vs yesterday
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
            <Link to="/analytics?metric=production&shop=final-assembly" className="inline-flex items-center gap-1 text-sm font-semibold text-green-600 hover:underline">
              View Details
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>

        {/* First Pass Yield */}
        <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-normal text-gray-600">First Pass Yield</h3>
              <InfoTooltip 
                title={metricsMetadata.firstPassYield.title}
                description={metricsMetadata.firstPassYield.description}
                calculation={metricsMetadata.firstPassYield.calculation}
                significance={metricsMetadata.firstPassYield.significance}
              />
            </div>
            <div className="p-2.5 rounded-lg bg-purple-50">
              <Activity className="w-6 h-6 text-purple-600" />
            </div>
          </div>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1.5">
              <span className="text-4xl font-bold text-gray-900 leading-none">
                {kpiData?.first_pass_yield?.value?.toFixed(1) || kpiData?.quality?.value?.toFixed(1) || 0}
              </span>
              <span className="text-lg text-gray-500 font-normal">%</span>
            </div>
          </div>

          <div className="h-5 mb-3">
            {((kpiData?.first_pass_yield?.change || kpiData?.quality?.change) && (kpiData?.first_pass_yield?.change !== 0 || kpiData?.quality?.change !== 0)) ? (
              <div className="flex items-center gap-1">
                {(kpiData?.first_pass_yield?.trend || kpiData?.quality?.trend) === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                )}
                <span className={`text-sm font-normal ${(kpiData?.first_pass_yield?.trend || kpiData?.quality?.trend) === 'up' ? 'text-green-500' : 'text-red-500'}`}>
                  {Math.abs(kpiData?.first_pass_yield?.change || kpiData?.quality?.change || 0).toFixed(1)}% vs yesterday
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
            <Link to="/analytics?metric=quality&shop=final-assembly" className="inline-flex items-center gap-1 text-sm font-semibold text-purple-600 hover:underline">
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
                {kpiData?.downtime?.value?.toFixed(1) || 0}
              </span>
              <span className="text-lg text-gray-500 font-normal">{kpiData?.downtime?.unit || 'min'}</span>
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
            <Link to="/analytics?metric=downtime&shop=final-assembly" className="inline-flex items-center gap-1 text-sm font-semibold text-yellow-600 hover:underline">
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
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">Equipment Status</h2>
              {isLive && (
                <span className="text-xs text-green-600 font-medium">Real-time</span>
              )}
            </div>
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

      {/* Production Pipeline */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Production Pipeline</h2>
          <p className="text-sm text-gray-500 mt-1">Real-time production flow visualization</p>
        </div>
        {insightsLoadingState ? (
          <PipelineSkeleton />
        ) : pipelineData.length > 0 ? (
          <div className="space-y-4">
            {paginatedPipeline.map((stage, idx) => (
              <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{stage.stage}</h3>
                    <p className="text-sm text-gray-500">
                      Target: {stage.target_units} | Completed: {stage.completed_units} | WIP: {stage.work_in_progress}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">
                      Efficiency: {(stage.efficiency * 100).toFixed(1)}%
                    </p>
                    {stage.is_bottleneck && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 mt-1">
                        Bottleneck
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{ width: `${Math.min((stage.completed_units / stage.target_units) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>
            ))}
            {totalPipelinePages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-gray-500">Showing {paginatedPipeline.length} of {pipelineData.length} stages</span>
                <div className="inline-flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePagerChange(setPipelinePage, pipelinePage, totalPipelinePages, 'prev')}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={pipelinePage === 1}
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-500">Page {pipelinePage} of {totalPipelinePages}</span>
                  <button
                    type="button"
                    onClick={() => handlePagerChange(setPipelinePage, pipelinePage, totalPipelinePages, 'next')}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={pipelinePage === totalPipelinePages}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
              <Activity className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-500 text-base font-medium">Production Pipeline Data Not Available</p>
            <p className="text-gray-400 text-sm mt-1">Connect to production monitoring system to view live pipeline data</p>
          </div>
        )}
      </div>

      {/* Assembly Stations and Quality Metrics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Assembly Stations */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-gray-900">Assembly Stations</h2>
            <p className="text-sm text-gray-500 mt-1">Station-level monitoring</p>
          </div>
          {insightsLoadingState ? (
            <StationsSkeleton />
          ) : stationData.length > 0 ? (
            <div className="space-y-3">
              {paginatedStations.map((station, idx) => (
                <div key={idx} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-gray-900">{station.name}</h3>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      station.status === 'operational' ? 'bg-green-100 text-green-800' :
                      station.status === 'attention' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {station.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                    <div>OEE: {station.oee}%</div>
                    <div>Throughput: {station.throughput}</div>
                    <div>Utilization: {(station.utilization * 100).toFixed(1)}%</div>
                    <div>Queued Jobs: {station.queued_jobs}</div>
                  </div>
                  {station.open_alerts > 0 && (
                    <div className="mt-2 text-xs text-red-600 font-medium">
                      {station.open_alerts} open alert{station.open_alerts > 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              ))}
              {totalStationPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-sm text-gray-500">Showing {paginatedStations.length} of {stationData.length} stations</span>
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handlePagerChange(setStationPage, stationPage, totalStationPages, 'prev')}
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={stationPage === 1}
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-500">Page {stationPage} of {totalStationPages}</span>
                    <button
                      type="button"
                      onClick={() => handlePagerChange(setStationPage, stationPage, totalStationPages, 'next')}
                      className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={stationPage === totalStationPages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                <Activity className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 text-base font-medium">Station Data Not Available</p>
              <p className="text-gray-400 text-sm mt-1">Configure station monitoring to view live data</p>
            </div>
          )}
        </div>

        {/* Quality Metrics */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-gray-900">Quality Metrics</h2>
            <p className="text-sm text-gray-500 mt-1">Detailed quality indicators</p>
          </div>
          {insightsLoadingState ? (
            <QualitySkeleton />
          ) : insights.quality_metrics ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4">
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                  <span className="text-sm font-medium text-gray-700">First Pass Yield</span>
                  <span className="text-lg font-bold text-green-600">{insights.quality_metrics.first_pass_yield}%</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                  <span className="text-sm font-medium text-gray-700">Torque Compliance</span>
                  <span className="text-lg font-bold text-blue-600">{insights.quality_metrics.torque_compliance}%</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                  <span className="text-sm font-medium text-gray-700">Rework Rate</span>
                  <span className="text-lg font-bold text-yellow-600">{insights.quality_metrics.rework_rate}%</span>
                </div>
              </div>
              {defectData.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Top Defects</h4>
                  <div className="space-y-2">
                    {paginatedDefects.map((defect, idx) => (
                      <div key={idx} className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">{defect.defect || defect.title || defect.name || 'Unknown'}</span>
                        <span className="font-medium text-gray-900">{defect.count ?? defect.value ?? '--'}</span>
                      </div>
                    ))}
                  </div>
                  {totalDefectPages > 1 && (
                    <div className="flex items-center justify-between pt-2">
                      <span className="text-sm text-gray-500">Showing {paginatedDefects.length} of {defectData.length} defects</span>
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handlePagerChange(setDefectPage, defectPage, totalDefectPages, 'prev')}
                          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={defectPage === 1}
                        >
                          Previous
                        </button>
                        <span className="text-sm text-gray-500">Page {defectPage} of {totalDefectPages}</span>
                        <button
                          type="button"
                          onClick={() => handlePagerChange(setDefectPage, defectPage, totalDefectPages, 'next')}
                          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={defectPage === totalDefectPages}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
                <Activity className="w-8 h-8 text-gray-400" />
              </div>
              <p className="text-gray-500 text-base font-medium">Quality Metrics Not Available</p>
              <p className="text-gray-400 text-sm mt-1">Connect quality monitoring system to view metrics</p>
            </div>
          )}
        </div>
      </div>

      {/* Critical Torque Tools */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">Critical Torque Tools</h2>
          <p className="text-sm text-gray-500 mt-1">Calibration and usage monitoring</p>
        </div>
        {insightsLoadingState ? (
          <TorqueTableSkeleton rows={torquePageSize} />
        ) : torqueTools.length > 0 ? (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tool</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Health</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Torque</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Compliance</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Calibration</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Alerts</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {paginatedTorqueTools.map((tool) => (
                    <tr key={tool.machine_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                        {tool.name}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          tool.status === 'online' ? 'bg-green-100 text-green-800' :
                          tool.status === 'offline' ? 'bg-gray-100 text-gray-800' :
                          tool.status === 'idle' ? 'bg-yellow-100 text-yellow-800' :
                          tool.status === 'fault' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {tool.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {tool.health}%
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {tool.torque_nm} / {tool.torque_target_nm} Nm
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {tool.compliance}%
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {tool.calibration_due_in_days} days
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                        {tool.alerts}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">
                Showing {paginatedTorqueTools.length} of {torqueTools.length} tools
              </span>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleTorquePageChange('prev')}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={torquePage === 1}
                >
                  Previous
                </button>
                <span className="text-sm text-gray-500">
                  Page {torquePage} of {totalTorquePages}
                </span>
                <button
                  type="button"
                  onClick={() => handleTorquePageChange('next')}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={torquePage === totalTorquePages}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
              <Activity className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-500 text-base font-medium">Torque Tool Data Not Available</p>
            <p className="text-gray-400 text-sm mt-1">Connect torque management system to view tool status and calibration data</p>
          </div>
        )}
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
              <Link to="/control-center?shop=final-assembly" className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1">
                View in Control Center →
              </Link>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-6">
              {viewMode === 'grid' ? (
                <MachineGridSkeleton viewMode="grid" />
              ) : (
                <TableSkeleton rows={itemsPerPage} columns={8} />
              )}
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
                            {machine.plant?.name || machine.shop?.plant?.name || machine.line?.shop?.plant?.name || '-'}
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

export default FinalAssembly
