import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Activity, AlertTriangle, Wrench, TrendingUp, TrendingDown } from 'lucide-react'
import { ClockIcon, SignalIcon } from '@heroicons/react/24/outline'
import { machinesAPI, kpisAPI } from '../../services/api'
import LocationFilter from '../../components/LocationFilter'
import TimeRangeFilter from '../../components/TimeRangeFilter'
import InfoTooltip from '../../components/InfoTooltip'
import { useFilterStore } from '../../store/filterStore'
import { useMachineStatesWebSocket, useAlertsWebSocket } from '../../hooks/useWebSocket'
import { KPICardSkeleton } from '../../components/skeletons'
import clsx from 'clsx'

const SHOP_TYPE = 'body_shop'

function BodyShop() {
  const { location, timeRange } = useFilterStore()
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [linesPage, setLinesPage] = useState(1)
  const [robotsPage, setRobotsPage] = useState(1)
  const [alertsPage, setAlertsPage] = useState(1)
  const [machinesPage, setMachinesPage] = useState(1)
  const [machinesViewMode, setMachinesViewMode] = useState('grid')
  const ITEMS_PER_PAGE = 5

  // Map location filter to plant_code for WebSocket
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
    alerts: liveAlerts, 
    isConnected: alertsConnected, 
    timestamp: alertsTimestamp 
  } = useAlertsWebSocket(null, plantCode)

  const isLive = machinesConnected && alertsConnected

  // Update timestamp when WebSocket data arrives
  useEffect(() => {
    if (machinesTimestamp || alertsTimestamp) {
      setLastUpdated(new Date(machinesTimestamp || alertsTimestamp))
    }
  }, [machinesTimestamp, alertsTimestamp])

  const handleRefresh = () => {
    setLastUpdated(new Date())
    refetchKpis()
    refetchMachines()
  }

  // Fetch KPI data
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
    staleTime: 30000, // Cache for 30 seconds
  })

  // Fetch machines data with status (fallback when WebSocket not connected)
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
    staleTime: 30000, // Cache for 30 seconds
  })

  // Use live machines from WebSocket if connected, otherwise use API data
  const machines = useMemo(() => {
    if (machinesConnected && liveMachines && liveMachines.length > 0) {
      // Filter by shop_type if needed
      return liveMachines.filter(m => m.shop_type === SHOP_TYPE || !m.shop_type)
    }
    return machinesData || []
  }, [machinesConnected, liveMachines, machinesData])

  // Calculate weld quality from machine health scores
  const weldQuality = machines.length > 0
    ? machines.reduce((sum, m) => sum + (m.health_score || 0), 0) / machines.length
    : 0

  // Calculate machine status counts
  const statusCounts = {
    total: machines.length,
    online: machines.filter(m => m.status === 'online').length,
    offline: machines.filter(m => m.status === 'offline').length,
    idle: machines.filter(m => m.status === 'idle').length,
    fault: machines.filter(m => m.status === 'fault').length,
    maintenance: machines.filter(m => m.status === 'maintenance').length,
  }

  // Derive production lines from machine data
  const productionLines = useMemo(() => {
    const linesMap = machines.reduce((acc, machine) => {
      // Use line data from WebSocket or fallback to machine.line for API data
      const lineId = machine.line_id || machine.line?.id
      const lineName = machine.line_name || machine.line?.name || 'Unknown Line'
      const lineCode = machine.line_code || machine.line?.code || `line-${lineId}`
      
      if (!acc[lineId]) {
        acc[lineId] = {
          id: lineId,
          name: lineName,
          code: lineCode,
          machines: [],
          online: 0,
          total: 0,
        }
      }
      acc[lineId].machines.push(machine)
      acc[lineId].total++
      if (machine.status === 'online') {
        acc[lineId].online++
      }
      return acc
    }, {})

    return Object.values(linesMap).map(line => ({
      id: line.id,
      name: line.name,
      code: line.code,
      status: line.online === line.total ? 'running' 
        : line.online > 0 ? 'idle' 
        : 'stopped',
      units_produced: line.machines.reduce((sum, m) => sum + (m.current_cycle || 0), 0),
      target: line.total * 100,
      machine_count: line.total,
      online_count: line.online,
    }))
  }, [machines])

  // Filter welding robots
  const weldingRobots = machines
    .filter(m => m.machine_type === 'welding_robot')
    .map(robot => ({
      name: robot.machine_code || robot.machine_name,
      status: robot.status,
      weld_count: robot.current_cycle || 0,
      quality: robot.health_score || 0,
      health_score: robot.health_score || 0,
      machine_id: robot.machine_id,
    }))

  // Get active alerts from WebSocket or machines with faults
  const activeAlerts = useMemo(() => {
    if (alertsConnected && liveAlerts && liveAlerts.length > 0) {
      // Filter alerts for body shop machines
      return liveAlerts
        .filter(alert => alert.status === 'active' || alert.status === 'acknowledged')
        .filter(alert => {
          // Try to match alerts to body shop machines
          const machine = machines.find(m => m.machine_id === alert.machine_id)
          return machine && machine.shop_type === SHOP_TYPE
        })
        .map(alert => ({
          machine_code: alert.machine_code,
          machine_name: alert.machine_name,
          severity: alert.severity || (alert.alert_type?.includes('critical') ? 'critical' : 'warning'),
          message: alert.message || alert.alert_type || 'Machine fault detected',
          machine_id: alert.machine_id,
          id: alert.id,
        }))
    }
    
    // Fallback to deriving alerts from machine faults
    return machines
      .filter(m => m.status === 'fault' || m.fault_code)
      .map(machine => ({
        machine_code: machine.machine_code,
        machine_name: machine.machine_name,
        severity: machine.status === 'fault' ? 'critical' : 'warning',
        message: machine.fault_message || machine.fault_code || 'Machine fault detected',
        machine_id: machine.machine_id,
      }))
  }, [alertsConnected, liveAlerts, machines])

  // Tooltip metadata for metrics
  const metricsMetadata = {
    oee: {
      title: 'Overall Equipment Effectiveness',
      description: 'Comprehensive measure of manufacturing productivity combining availability, performance, and quality metrics for body shop operations including welding and assembly.',
      calculation: 'OEE = Availability × Performance × Quality',
      significance: 'Industry benchmark is 85%+. Tracks overall effectiveness of welding robots, assembly lines, and body construction equipment. Lower values indicate opportunities for improvement in uptime, speed, or quality.'
    },
    bodiesCompleted: {
      title: 'Bodies Completed',
      description: 'Total number of vehicle bodies that have successfully completed all welding, assembly, and body construction operations within the selected time range.',
      calculation: 'Count of bodies passing final body shop inspection and quality gates',
      significance: 'Key production output metric. Track against daily targets and compare with historical performance for capacity planning. Direct indicator of line efficiency and throughput.'
    },
    weldQuality: {
      title: 'Weld Quality',
      description: 'Composite quality metric based on average machine health scores of welding robots and assembly equipment, indicating overall weld integrity and process stability.',
      calculation: 'Average of all machine health scores across welding and assembly equipment',
      significance: 'Quality excellence indicator. Target is >95%. Higher scores indicate strong process control, proper maintenance, and consistent weld quality. Critical for structural integrity and safety.'
    },
    downtime: {
      title: 'Total Downtime',
      description: 'Cumulative time that body shop operations were stopped or unable to produce due to equipment failures, maintenance, material shortages, or other issues.',
      calculation: 'Sum of all unplanned and planned downtime periods across production lines',
      significance: 'Critical availability metric. Minimize to maximize production capacity. Track root causes (welding robot failures, line stops, etc.) for continuous improvement initiatives and preventive maintenance planning.'
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Body Shop Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Welding, Assembly & Body Construction</p>
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
          <div className={clsx(
            "flex items-center gap-1.5 px-2 py-1 rounded-full",
            isLive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
          )}>
            <SignalIcon className="w-4 h-4" />
            <span className="font-medium">{isLive ? 'Live' : 'Connecting...'}</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500">
            <ClockIcon className="w-4 h-4" />
            <span className="text-sm">
              Last updated: {machinesTimestamp ? new Date(machinesTimestamp).toLocaleTimeString() : lastUpdated.toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {/* KPI Cards - Progressive Loading */}
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
                  <Activity className="w-6 h-6 text-blue-600" />
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
                <Link to="/analytics?metric=oee&shop=body-shop" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
                  View Details
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* Bodies Completed */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-base font-normal text-gray-600">Bodies Completed</h3>
                  <InfoTooltip 
                    title={metricsMetadata.bodiesCompleted.title}
                    description={metricsMetadata.bodiesCompleted.description}
                    calculation={metricsMetadata.bodiesCompleted.calculation}
                    significance={metricsMetadata.bodiesCompleted.significance}
                  />
                </div>
                <div className="p-2.5 rounded-lg bg-green-50">
                  <TrendingUp className="w-6 h-6 text-green-600" />
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
                <Link to="/analytics?metric=production&shop=body-shop" className="inline-flex items-center gap-1 text-sm font-semibold text-green-600 hover:underline">
                  View Details
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* Weld Quality */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-1.5">
                  <h3 className="text-base font-normal text-gray-600">Weld Quality</h3>
                  <InfoTooltip 
                    title={metricsMetadata.weldQuality.title}
                    description={metricsMetadata.weldQuality.description}
                    calculation={metricsMetadata.weldQuality.calculation}
                    significance={metricsMetadata.weldQuality.significance}
                  />
                </div>
                <div className="p-2.5 rounded-lg bg-purple-50">
                  <Activity className="w-6 h-6 text-purple-600" />
                </div>
              </div>
              
              <div className="mb-3">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold text-gray-900 leading-none">
                    {weldQuality.toFixed(1)}
                  </span>
                  <span className="text-lg text-gray-500 font-normal">%</span>
                </div>
              </div>

              <div className="h-5 mb-3">
                <div className="flex items-center gap-1">
                  <Activity className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-sm font-normal text-gray-500">
                    Based on machine health
                  </span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-3">
                <Link to="/analytics?metric=quality&shop=body-shop" className="inline-flex items-center gap-1 text-sm font-semibold text-purple-600 hover:underline">
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
                <div className="p-2.5 rounded-lg bg-orange-50">
                  <AlertTriangle className="w-6 h-6 text-orange-600" />
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
                <Link to="/analytics?metric=downtime&shop=body-shop" className="inline-flex items-center gap-1 text-sm font-semibold text-orange-600 hover:underline">
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

      {/* Machine Status Summary */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {machinesLoading ? (
          <div className="animate-pulse">
            <div className="flex items-center justify-between mb-5">
              <div className="h-6 bg-gray-200 rounded w-40"></div>
              <div className="h-4 bg-gray-200 rounded w-20"></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="rounded-xl p-5 bg-gray-50">
                  <div className="h-10 bg-gray-200 rounded w-16 mb-2"></div>
                  <div className="h-4 bg-gray-200 rounded w-20"></div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-900">Machine Status Summary</h2>
              <Link to="/control-center" className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1">
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="rounded-xl p-5 bg-gray-50 text-gray-700">
                <p className="text-2xl md:text-4xl font-bold mb-1">{statusCounts.total}</p>
                <p className="text-sm font-medium">Total</p>
              </div>
              <div className="rounded-xl p-5 bg-emerald-50 text-emerald-700">
                <p className="text-2xl md:text-4xl font-bold mb-1">{statusCounts.online}</p>
                <p className="text-sm font-medium">Online</p>
              </div>
              <div className="rounded-xl p-5 bg-red-50 text-red-700">
                <p className="text-2xl md:text-4xl font-bold mb-1">{statusCounts.offline}</p>
                <p className="text-sm font-medium">Offline</p>
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
          </>
        )}
      </div>

      {/* Production Lines and Welding Robots - Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Production Lines */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Production Lines</h2>
                {productionLines.length > ITEMS_PER_PAGE && (
                  <span className="text-sm text-gray-500">
                    Showing {((linesPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(linesPage * ITEMS_PER_PAGE, productionLines.length)} of {productionLines.length}
                  </span>
                )}
              </div>
              <div className="space-y-4 mb-4">
                {productionLines.length > 0 ? (
                  productionLines
                    .slice((linesPage - 1) * ITEMS_PER_PAGE, linesPage * ITEMS_PER_PAGE)
                    .map((line, index) => (
                      <ProductionLineCard key={line.id || index} line={line} />
                    ))
                ) : (
                  <p className="text-gray-500 text-center py-8">No production lines available</p>
                )}
              </div>
              {/* Pagination for Production Lines */}
              {productionLines.length > ITEMS_PER_PAGE && (
                <div className="flex items-center justify-center gap-2 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => setLinesPage(prev => Math.max(1, prev - 1))}
                    disabled={linesPage === 1}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-600">
                    Page {linesPage} of {Math.ceil(productionLines.length / ITEMS_PER_PAGE)}
                  </span>
                  <button
                    onClick={() => setLinesPage(prev => Math.min(Math.ceil(productionLines.length / ITEMS_PER_PAGE), prev + 1))}
                    disabled={linesPage === Math.ceil(productionLines.length / ITEMS_PER_PAGE)}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>

            {/* Welding Robots */}
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">Welding Robots</h2>
                {weldingRobots.length > ITEMS_PER_PAGE && (
                  <span className="text-sm text-gray-500">
                    Showing {((robotsPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(robotsPage * ITEMS_PER_PAGE, weldingRobots.length)} of {weldingRobots.length}
                  </span>
                )}
              </div>
              <div className="space-y-4 mb-4">
                {weldingRobots.length > 0 ? (
                  weldingRobots
                    .slice((robotsPage - 1) * ITEMS_PER_PAGE, robotsPage * ITEMS_PER_PAGE)
                    .map((robot, index) => (
                      <WeldingRobotCard key={index} robot={robot} />
                    ))
                ) : (
                  <p className="text-gray-500 text-center py-8">No welding robots available</p>
                )}
              </div>
              {/* Pagination for Welding Robots */}
              {weldingRobots.length > ITEMS_PER_PAGE && (
                <div className="flex items-center justify-center gap-2 pt-4 border-t border-gray-200">
                  <button
                    onClick={() => setRobotsPage(prev => Math.max(1, prev - 1))}
                    disabled={robotsPage === 1}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-600">
                    Page {robotsPage} of {Math.ceil(weldingRobots.length / ITEMS_PER_PAGE)}
                  </span>
                  <button
                    onClick={() => setRobotsPage(prev => Math.min(Math.ceil(weldingRobots.length / ITEMS_PER_PAGE), prev + 1))}
                    disabled={robotsPage === Math.ceil(weldingRobots.length / ITEMS_PER_PAGE)}
                    className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Active Alerts */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
                Active Alerts ({activeAlerts.length})
              </h2>
              {activeAlerts.length > ITEMS_PER_PAGE && (
                <span className="text-sm text-gray-500">
                  Showing {((alertsPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(alertsPage * ITEMS_PER_PAGE, activeAlerts.length)} of {activeAlerts.length}
                </span>
              )}
            </div>
            <div className="space-y-2 mb-4">
              {activeAlerts.length > 0 ? (
                activeAlerts
                  .slice((alertsPage - 1) * ITEMS_PER_PAGE, alertsPage * ITEMS_PER_PAGE)
                  .map((alert, index) => (
                    <AlertCard key={index} alert={alert} />
                  ))
              ) : (
                <p className="text-gray-500 text-center py-8">No active alerts</p>
              )}
            </div>
            {/* Pagination for Active Alerts */}
            {activeAlerts.length > ITEMS_PER_PAGE && (
              <div className="flex items-center justify-center gap-2 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setAlertsPage(prev => Math.max(1, prev - 1))}
                  disabled={alertsPage === 1}
                  className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600">
                  Page {alertsPage} of {Math.ceil(activeAlerts.length / ITEMS_PER_PAGE)}
                </span>
                <button
                  onClick={() => setAlertsPage(prev => Math.min(Math.ceil(activeAlerts.length / ITEMS_PER_PAGE), prev + 1))}
                  disabled={alertsPage === Math.ceil(activeAlerts.length / ITEMS_PER_PAGE)}
                  className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Machines Table */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">All Machines</h2>
                <div className="flex items-center gap-3">
                  {machines.length > ITEMS_PER_PAGE && (
                    <span className="text-sm text-gray-500">
                      Showing {((machinesPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(machinesPage * ITEMS_PER_PAGE, machines.length)} of {machines.length}
                    </span>
                  )}
                  <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => setMachinesViewMode('grid')}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        machinesViewMode === 'grid'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Grid
                    </button>
                    <button
                      onClick={() => setMachinesViewMode('table')}
                      className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        machinesViewMode === 'table'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Table
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            {machinesViewMode === 'grid' ? (
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  {machines
                    .slice((machinesPage - 1) * ITEMS_PER_PAGE, machinesPage * ITEMS_PER_PAGE)
                    .map((machine) => (
                      <MachineCard key={machine.machine_id} machine={machine} />
                    ))}
                </div>
                {/* Pagination for Grid */}
                {machines.length > ITEMS_PER_PAGE && (
                  <div className="flex items-center justify-center gap-2 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => setMachinesPage(prev => Math.max(1, prev - 1))}
                      disabled={machinesPage === 1}
                      className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-600">
                      Page {machinesPage} of {Math.ceil(machines.length / ITEMS_PER_PAGE)}
                    </span>
                    <button
                      onClick={() => setMachinesPage(prev => Math.min(Math.ceil(machines.length / ITEMS_PER_PAGE), prev + 1))}
                      disabled={machinesPage === Math.ceil(machines.length / ITEMS_PER_PAGE)}
                      className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Code</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Health</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Load</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Location</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {machines
                        .slice((machinesPage - 1) * ITEMS_PER_PAGE, machinesPage * ITEMS_PER_PAGE)
                        .map((machine) => (
                          <tr key={machine.machine_id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <StatusBadge status={machine.status} />
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
                              {machine.plant_name || machine.plant?.name || machine.location || '-'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {/* Pagination for Table */}
                {machines.length > ITEMS_PER_PAGE && (
                  <div className="flex items-center justify-center gap-2 p-4 border-t border-gray-200">
                    <button
                      onClick={() => setMachinesPage(prev => Math.max(1, prev - 1))}
                      disabled={machinesPage === 1}
                      className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-gray-600">
                      Page {machinesPage} of {Math.ceil(machines.length / ITEMS_PER_PAGE)}
                    </span>
                    <button
                      onClick={() => setMachinesPage(prev => Math.min(Math.ceil(machines.length / ITEMS_PER_PAGE), prev + 1))}
                      disabled={machinesPage === Math.ceil(machines.length / ITEMS_PER_PAGE)}
                      className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
    </div>
  )
}

// Production Line Card Component
function ProductionLineCard({ line }) {
  const statusColors = {
    running: 'bg-green-500 text-white',
    idle: 'bg-yellow-500 text-gray-900',
    stopped: 'bg-red-500 text-white',
  }

  const progress = (line.units_produced / line.target) * 100

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-gray-900">{line.name}</h3>
        <span className={`px-3 py-1 rounded-full text-xs font-medium uppercase ${statusColors[line.status]}`}>
          {line.status}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-3">
        <div>
          <p className="text-xs text-gray-500 mb-1">Production</p>
          <p className="text-lg font-semibold text-gray-900">{line.units_produced}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Target</p>
          <p className="text-lg font-semibold text-gray-900">{line.target}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Machines</p>
          <p className="text-lg font-semibold text-gray-900">{line.online_count}/{line.machine_count}</p>
        </div>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">{progress.toFixed(1)}% of target</p>
    </div>
  )
}

// Welding Robot Card Component
function WeldingRobotCard({ robot }) {
  const statusBadgeColors = {
    online: 'bg-green-500 text-white',
    offline: 'bg-red-500 text-white',
    idle: 'bg-yellow-500 text-gray-900',
    fault: 'bg-orange-500 text-white',
    maintenance: 'bg-blue-500 text-white',
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5 text-gray-700" />
          <h3 className="font-bold text-gray-900">{robot.name}</h3>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium uppercase ${statusBadgeColors[robot.status]}`}>
          {robot.status}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Welds</p>
          <p className="text-lg font-semibold text-gray-900">{robot.weld_count}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Quality</p>
          <p className="text-lg font-semibold text-gray-900">{robot.quality.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Health</p>
          <p className="text-lg font-semibold text-gray-900">{robot.health_score?.toFixed(1) || 'N/A'}%</p>
        </div>
      </div>
    </div>
  )
}

// Machine Card Component (for grid view)
function MachineCard({ machine }) {
  const statusBadgeColors = {
    online: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    offline: 'bg-red-50 text-red-700 border-red-200',
    idle: 'bg-amber-50 text-amber-700 border-amber-200',
    fault: 'bg-orange-50 text-orange-700 border-orange-200',
    maintenance: 'bg-blue-50 text-blue-700 border-blue-200',
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow">
      {/* Status Badge at Top */}
      <div className={`px-4 py-2 border-b ${statusBadgeColors[machine.status]}`}>
        <span className="text-xs font-semibold uppercase">{machine.status}</span>
      </div>
      
      {/* Card Content */}
      <div className="p-4">
        <h3 className="font-bold text-gray-900 mb-1">{machine.machine_name}</h3>
        <p className="text-sm text-gray-500 mb-1">{machine.machine_code}</p>
        <p className="text-xs text-gray-600 mb-4 capitalize">{machine.machine_type?.replace(/_/g, ' ') || '-'}</p>
        
        {/* Metrics */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Health</span>
            <span className="text-sm font-semibold text-gray-900">{machine.health_score?.toFixed(1) || '-'}%</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Load</span>
            <span className="text-sm font-semibold text-gray-900">{machine.current_load?.toFixed(1) || '-'}%</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Location</span>
            <span className="text-sm font-semibold text-gray-900 truncate ml-2">{machine.plant_name || machine.plant?.name || machine.location || '-'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Alert Card Component
function AlertCard({ alert }) {
  const severityColors = {
    critical: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-orange-50 border-orange-200 text-orange-800',
  }

  return (
    <div className={`border-l-4 p-4 ${severityColors[alert.severity]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">{alert.machine_code} - {alert.machine_name}</p>
          <p className="text-sm mt-1">{alert.message}</p>
        </div>
        <span className="px-2 py-1 text-xs font-medium rounded uppercase">
          {alert.severity}
        </span>
      </div>
    </div>
  )
}

// Status Badge Component
function StatusBadge({ status }) {
  const statusColors = {
    online: 'bg-green-100 text-green-800',
    offline: 'bg-red-100 text-red-800',
    idle: 'bg-yellow-100 text-yellow-800',
    fault: 'bg-orange-100 text-orange-800',
    maintenance: 'bg-blue-100 text-blue-800',
  }

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  )
}

export default BodyShop
