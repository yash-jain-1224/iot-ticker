import { useQuery } from '@tanstack/react-query'
import { useState, useEffect, useMemo } from 'react'
import { ChartBarIcon, CubeIcon, ClockIcon, BoltIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { kpisAPI, machinesAPI, alertsAPI } from '../services/api'
import { Link } from 'react-router-dom'
import { useFilterStore } from '../store/filterStore'
import LocationFilter from '../components/LocationFilter'
import TimeRangeFilter from '../components/TimeRangeFilter'
import KPICard from '../components/KPICard'
import useWebSocket from '../hooks/useWebSocket'
import { KPICardSkeleton, StatusCardSkeleton, AlertCardSkeleton } from '../components/skeletons'
import { formatKPIValue } from '../utils/formatNumber'

const LEGACY_LOCATION_CODES = {
  jamshedpur: 'HOUSTON-001',
  sanand: 'DALLAS-001',
  pune: 'AUSTIN-001',
}

const timeRangeToDays = {
  '1h': 1,
  '24h': 1,
  '7d': 7,
  '14d': 14,
  '30d': 30,
}

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

  const normalized = String(location).toLowerCase()
  if (locationMap[normalized]) {
    return locationMap[normalized]
  }

  const fallbackCode = LEGACY_LOCATION_CODES[normalized]
  if (fallbackCode) {
    return {
      code: fallbackCode,
    }
  }

  return null
}

const buildFilterParams = ({ location, timeRange, locationMeta }) => {
  const params = {}

  if (locationMeta?.id) {
    params.plant_id = locationMeta.id
  }

  if (locationMeta?.code) {
    params.plant_code = locationMeta.code
  } else if (typeof location === 'string') {
    const fallbackCode = LEGACY_LOCATION_CODES[location.toLowerCase()]
    if (fallbackCode) {
      params.plant_code = fallbackCode
    }
  }

  if (timeRange) {
    const days = timeRangeToDays[timeRange]
    if (days) {
      params.days = days
    }
    params.period = timeRange
  }

  return params
}

function Dashboard() {
  const { location, timeRange, workshop } = useFilterStore();
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [isUpdating, setIsUpdating] = useState(false)
  const [lastMachineUpdate, setLastMachineUpdate] = useState(null)
  const [lastAlertUpdate, setLastAlertUpdate] = useState(null)

  const locationMeta = useMemo(() => getLocationMeta(location, {}), [location])
  const filterParams = useMemo(
    () => {
      const params = buildFilterParams({ location, timeRange, locationMeta })
      // Add workshop filter
      if (workshop && workshop !== 'all') {
        params.workshop = workshop
      }
      return params
    },
    [location, timeRange, locationMeta, workshop]
  )
  const socketParams = useMemo(() => {
    const params = {}
    if (filterParams.plant_id) {
      params.plant_id = filterParams.plant_id
    }
    if (filterParams.plant_code) {
      params.plant_code = filterParams.plant_code
    }
    // Pass days parameter to WebSocket to match API time range
    if (filterParams.days) {
      params.days = filterParams.days
    }
    // Pass workshop parameter to WebSocket
    if (filterParams.workshop) {
      params.workshop = filterParams.workshop
    }
    // Return params with a timestamp to force reconnection on filter change
    return params
  }, [filterParams.plant_id, filterParams.plant_code, filterParams.days, filterParams.workshop])

  // Use separate WebSocket connections for real-time updates
  const { data: kpisWsData, isConnected: kpisConnected } = useWebSocket('/kpis', socketParams)
  const { data: machinesWsData, isConnected: machinesConnected } = useWebSocket('/machines', socketParams)
  const { data: alertsWsData, isConnected: alertsConnected } = useWebSocket('/alerts', socketParams)
  
  // Overall connection status
  const isConnected = kpisConnected || machinesConnected || alertsConnected

  // State to hold real-time data - initialize with null to prevent showing 0 during load
  const [kpiData, setKpiData] = useState(null)
  const [machineSummary, setMachineSummary] = useState(null)
  const [alertsSummary, setAlertsSummary] = useState(null)

  // Fetch initial overview KPIs with filters
  const { data: initialKpiData, isLoading: kpiLoading, error: kpiError, refetch: refetchKpis } = useQuery({
    queryKey: ['kpis', 'overview', filterParams.plant_id ?? 'all', filterParams.plant_code ?? 'all', filterParams.days ?? 'default', filterParams.period ?? 'default'],
    queryFn: async () => {
      const response = await kpisAPI.getDashboardOverview(filterParams)
      return response.data
    }
  })

  // Fetch initial machine summary with filters
  const { data: initialMachineSummary, isLoading: machinesLoading, error: machinesError, refetch: refetchMachines } = useQuery({
    queryKey: ['machines', 'summary', filterParams.plant_id ?? 'all', filterParams.plant_code ?? 'all'],
    queryFn: async () => {
      const response = await machinesAPI.getSummary(filterParams)
      return response.data
    }
  })

  // Fetch initial alerts summary with filters
  const { data: initialAlertsSummary, isLoading: alertsLoading, error: alertsError, refetch: refetchAlerts } = useQuery({
    queryKey: ['alerts', 'summary', filterParams.plant_id ?? 'all', filterParams.plant_code ?? 'all', filterParams.days ?? 'default', filterParams.period ?? 'default'],
    queryFn: async () => {
      const response = await alertsAPI.getSummary(filterParams)
      return response.data
    }
  })

  // Manual refresh function
  const handleRefresh = async () => {
    setIsUpdating(true)
    await Promise.all([
      refetchKpis(),
      refetchMachines(),
      refetchAlerts()
    ])
    setLastUpdated(new Date())
    setTimeout(() => setIsUpdating(false), 500)
  }

  // Update state when initial data is loaded - only set if we have valid data
  useEffect(() => {
    if (initialKpiData && Object.keys(initialKpiData).length > 0) {
      setKpiData(initialKpiData)
    }
  }, [initialKpiData])

  useEffect(() => {
    if (initialMachineSummary && initialMachineSummary.total !== undefined) {
      setMachineSummary(initialMachineSummary)
    }
  }, [initialMachineSummary])

  useEffect(() => {
    if (initialAlertsSummary && initialAlertsSummary.total_active !== undefined) {
      setAlertsSummary(initialAlertsSummary)
    }
  }, [initialAlertsSummary])

  // Update state when WebSocket data arrives from /ws/kpis
  useEffect(() => {
    if (kpisWsData?.type === 'update') {
      let hasChanges = false
      
      if (kpisWsData.kpis && Object.keys(kpisWsData.kpis).length > 0) {
        const currentKpis = JSON.stringify(kpiData)
        const newKpis = JSON.stringify(kpisWsData.kpis)
        
        if (currentKpis !== newKpis) {
          setKpiData(kpisWsData.kpis)
          hasChanges = true
        }
      }
      
      if (kpisWsData.machines && !machinesConnected && kpisWsData.machines.total !== undefined) {
        const currentMachines = JSON.stringify(machineSummary)
        const newMachines = JSON.stringify(kpisWsData.machines)
        if (currentMachines !== newMachines) {
          setMachineSummary(kpisWsData.machines)
          setLastMachineUpdate(new Date())
          hasChanges = true
        }
      }
      
      if (kpisWsData.alerts && !alertsConnected && kpisWsData.alerts.total_active !== undefined) {
        const currentAlerts = JSON.stringify(alertsSummary)
        const newAlerts = JSON.stringify(kpisWsData.alerts)
        if (currentAlerts !== newAlerts) {
          setAlertsSummary(kpisWsData.alerts)
          setLastAlertUpdate(new Date())
          hasChanges = true
        }
      }

      if (hasChanges) {
        setIsUpdating(true)
        setLastUpdated(new Date())
        setTimeout(() => setIsUpdating(false), 500)
      }
    }
  }, [kpisWsData, machinesConnected, alertsConnected, kpiData, machineSummary, alertsSummary])

  // Update state when WebSocket data arrives from /ws/machines
  useEffect(() => {
    if (machinesWsData?.type === 'update' && machinesWsData.machines && Array.isArray(machinesWsData.machines)) {
      const summary = {
        total: machinesWsData.machines.length,
        online: 0, idle: 0, fault: 0, maintenance: 0, offline: 0
      }
      
      machinesWsData.machines.forEach(machine => {
        const status = machine.status?.toLowerCase()
        if (status === 'online' || status === 'running') summary.online++
        else if (status === 'idle') summary.idle++
        else if (status === 'fault') summary.fault++
        else if (status === 'maintenance') summary.maintenance++
        else if (status === 'offline') summary.offline++
      })
      
      const currentMachines = JSON.stringify(machineSummary)
      const newMachines = JSON.stringify(summary)
      
      if (currentMachines !== newMachines) {
        setMachineSummary(summary)
        setLastMachineUpdate(new Date())
        setLastUpdated(new Date())
        setIsUpdating(true)
        setTimeout(() => setIsUpdating(false), 500)
      }
    } else if (machinesWsData?.type === 'update' && machinesWsData.machines && machinesWsData.machines.total !== undefined) {
      const currentMachines = JSON.stringify(machineSummary)
      const newMachines = JSON.stringify(machinesWsData.machines)
      
      if (currentMachines !== newMachines) {
        setMachineSummary(machinesWsData.machines)
        setLastMachineUpdate(new Date())
        setLastUpdated(new Date())
        setIsUpdating(true)
        setTimeout(() => setIsUpdating(false), 500)
      }
    }
  }, [machinesWsData, machineSummary])

  // Update state when WebSocket data arrives from /ws/alerts
  useEffect(() => {
    if (alertsWsData?.type === 'update' || alertsWsData?.type === 'initial') {
      if (alertsWsData.summary && alertsWsData.summary.total_active !== undefined) {
        const currentAlerts = JSON.stringify(alertsSummary)
        const newAlerts = JSON.stringify(alertsWsData.summary)
        
        if (currentAlerts !== newAlerts) {
          setAlertsSummary(alertsWsData.summary)
          setLastAlertUpdate(new Date())
          setLastUpdated(new Date())
          setIsUpdating(true)
          setTimeout(() => setIsUpdating(false), 500)
        }
      }
      else if (alertsWsData.alerts && alertsWsData.alerts.total_active !== undefined) {
        const currentAlerts = JSON.stringify(alertsSummary)
        const newAlerts = JSON.stringify(alertsWsData.alerts)
        
        if (currentAlerts !== newAlerts) {
          setAlertsSummary(alertsWsData.alerts)
          setLastAlertUpdate(new Date())
          setLastUpdated(new Date())
          
          setIsUpdating(true)
          setTimeout(() => setIsUpdating(false), 500)
        }
      }
    }
  }, [alertsWsData, alertsSummary])

  // KPI metadata for tooltips
  const kpiMetadata = {
    oee: {
      title: 'Overall Equipment Effectiveness (OEE)',
      description: 'A comprehensive measure of manufacturing productivity that combines availability, performance, and quality.',
      calculation: 'OEE = Availability × Performance × Quality',
      significance: 'Industry standard metric. World-class OEE is 85%+. Below 60% indicates significant improvement opportunities.'
    },
    production: {
      title: 'Production Volume',
      description: 'Total number of units produced during the selected time period.',
      calculation: 'Sum of all completed units across all production lines',
      significance: 'Direct measure of output. Compare against targets to track production efficiency and capacity utilization.'
    },
    downtime: {
      title: 'Total Downtime',
      description: 'Accumulated time when machines were not operational due to faults, maintenance, or changeovers.',
      calculation: 'Sum of all downtime events (unplanned stops + planned maintenance)',
      significance: 'Key efficiency indicator. Reducing downtime directly increases production capacity and profitability.'
    },
    energy: {
      title: 'Energy Consumption',
      description: 'Total electrical energy consumed by all manufacturing equipment and facilities.',
      calculation: 'Sum of kWh readings from all monitored equipment and utilities',
      significance: 'Critical for cost management and sustainability. Track against production volume for energy efficiency metrics.'
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Error Messages */}
      {(kpiError || machinesError || alertsError) && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800">Failed to load dashboard data</p>
            <p className="text-xs text-red-700 mt-0.5">
              {kpiError?.message || machinesError?.message || alertsError?.message || 'Please check your connection and try again'}
            </p>
          </div>
        </div>
      )}
      
      {/* Connection Status Banner */}
      {!isConnected && !kpiLoading && !machinesLoading && !alertsLoading && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm font-medium text-yellow-800">Real-time updates disconnected</p>
            <p className="text-xs text-yellow-700 mt-0.5">Data will update when connection is restored</p>
          </div>
        </div>
      )}
      
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">Real-time manufacturing overview</p>
          </div>
          {/* Live indicator - positioned immediately after title */}
          {isConnected && (
            <span className="flex items-center gap-1.5 text-green-600">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-xs font-medium">Live</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <LocationFilter />
          <TimeRangeFilter />
          
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isUpdating || kpiLoading || machinesLoading || alertsLoading}
            className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Refresh data"
          >
            <ArrowPathIcon className={`w-4 h-4 text-gray-600 ${isUpdating ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium text-gray-700">Refresh</span>
          </button>
          
          <div className="flex items-center gap-2 text-gray-500">
            <ClockIcon className="w-4 h-4" />
            <span className="text-sm">Last updated: {lastUpdated.toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {/* KPI Cards - Progressive Loading */}
      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 transition-opacity duration-300 ${isUpdating ? 'opacity-90' : 'opacity-100'}`}>
        {kpiLoading ? (
          <>
            <KPICardSkeleton />
            <KPICardSkeleton />
            <KPICardSkeleton />
            <KPICardSkeleton />
          </>
        ) : !kpiData ? (
          <div className="col-span-full bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <p className="text-gray-600 font-medium">No KPI data available</p>
            <p className="text-sm text-gray-500 mt-1">The database may not have data for the selected time period</p>
          </div>
        ) : (
          <>
            <KPICard
              title="OEE"
              value={
                kpiData?.oee?.value !== undefined && kpiData?.oee?.value !== null
                  ? formatKPIValue(kpiData.oee.value, 'oee').value
                  : "N/A"
              }
              unit={
                kpiData?.oee?.value !== undefined && kpiData?.oee?.value !== null
                  ? formatKPIValue(kpiData.oee.value, 'oee').unit
                  : ""
              }
              change={
                kpiData?.oee?.change !== undefined && kpiData?.oee?.change !== null
                  ? `${kpiData.oee.change > 0 ? '+' : ''}${kpiData.oee.change.toFixed(1)} vs yesterday`
                  : null
              }
              changeType={
                kpiData?.oee?.change !== undefined && kpiData?.oee?.change !== null
                  ? kpiData.oee.change > 0 ? "positive" : kpiData.oee.change < 0 ? "negative" : "neutral"
                  : null
              }
              icon={ChartBarIcon}
              iconBg="bg-blue-100"
              iconColor="text-blue-600"
              tooltipData={kpiMetadata.oee}
            />
            <KPICard
              title="Production"
              value={
                kpiData?.production?.value !== undefined && kpiData?.production?.value !== null
                  ? formatKPIValue(kpiData.production.value, 'production').value
                  : "N/A"
              }
              unit={
                kpiData?.production?.value !== undefined && kpiData?.production?.value !== null
                  ? formatKPIValue(kpiData.production.value, 'production').unit
                  : ""
              }
              change={
                kpiData?.production?.change !== undefined && kpiData?.production?.change !== null
                  ? `${kpiData.production.change > 0 ? '+' : ''}${kpiData.production.change} vs yesterday`
                  : null
              }
              changeType={
                kpiData?.production?.change !== undefined && kpiData?.production?.change !== null
                  ? kpiData.production.change > 0 ? "positive" : kpiData.production.change < 0 ? "negative" : "neutral"
                  : null
              }
              icon={CubeIcon}
              iconBg="bg-green-100"
              iconColor="text-green-600"
              tooltipData={kpiMetadata.production}
            />
            <KPICard
              title="Downtime"
              value={
                kpiData?.downtime?.value !== undefined && kpiData?.downtime?.value !== null
                  ? formatKPIValue(kpiData.downtime.value, 'downtime').value
                  : "N/A"
              }
              unit={
                kpiData?.downtime?.value !== undefined && kpiData?.downtime?.value !== null
                  ? formatKPIValue(kpiData.downtime.value, 'downtime').unit
                  : ""
              }
              icon={ClockIcon}
              iconBg="bg-yellow-100"
              iconColor="text-yellow-600"
              tooltipData={kpiMetadata.downtime}
            />
            <KPICard
              title="Energy"
              value={
                kpiData?.energy?.value !== undefined && kpiData?.energy?.value !== null
                  ? formatKPIValue(kpiData.energy.value, 'energy').value
                  : "N/A"
              }
              unit={
                kpiData?.energy?.value !== undefined && kpiData?.energy?.value !== null
                  ? formatKPIValue(kpiData.energy.value, 'energy').unit
                  : ""
              }
              icon={BoltIcon}
              iconBg="bg-purple-100"
              iconColor="text-purple-600"
              tooltipData={kpiMetadata.energy}
            />
          </>
        )}
      </div>

      {/* Machine Status - Independent Loading */}
      {machinesLoading ? (
        <StatusCardSkeleton count={5} />
      ) : (
        <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 transition-all duration-300 ${isUpdating ? 'ring-2 ring-blue-100' : ''} ${lastMachineUpdate && (new Date() - lastMachineUpdate) < 1000 ? 'animate-pulse' : ''}`}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold text-gray-900">Machine Status</h2>
            <div className="flex items-center gap-2">
              {lastMachineUpdate && (new Date() - lastMachineUpdate) < 2000 && (
                <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
                  Updated
                </span>
              )}
              <Link to="/machines" className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1">
                View all →
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <StatusCard 
              label="Total" 
              count={machineSummary?.total ?? null} 
              color="gray" 
            />
            <StatusCard 
              label="Online" 
              count={machineSummary?.online ?? null} 
              color="green" 
            />
            <StatusCard 
              label="Offline" 
              count={machineSummary?.offline ?? null} 
              color="gray" 
            />
            <StatusCard 
              label="Idle" 
              count={machineSummary?.idle ?? null} 
              color="yellow" 
            />
            <StatusCard 
              label="Fault" 
              count={machineSummary?.fault ?? null} 
              color="red" 
            />
            <StatusCard 
              label="Maintenance" 
              count={machineSummary?.maintenance ?? null} 
              color="purple" 
            />
          </div>
        </div>
      )}

      {/* Active Alerts and Quick Actions Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Alerts - Independent Loading */}
        {alertsLoading ? (
          <AlertCardSkeleton count={4} />
        ) : (
          <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-6 transition-all duration-300 ${isUpdating ? 'ring-2 ring-blue-100' : ''} ${lastAlertUpdate && (new Date() - lastAlertUpdate) < 1000 ? 'animate-pulse' : ''}`}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-900">Active Alerts</h2>
              <div className="flex items-center gap-2">
                {lastAlertUpdate && (new Date() - lastAlertUpdate) < 2000 && (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
                    Updated
                  </span>
                )}
                <Link to="/alerts" className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1">
                  View all →
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <AlertCard 
                label="Critical" 
                count={alertsSummary?.critical ?? null} 
                color="red" 
              />
              <AlertCard 
                label="Error" 
                count={alertsSummary?.error ?? null} 
                color="orange" 
              />
              <AlertCard 
                label="Warning" 
                count={alertsSummary?.warning ?? null} 
                color="yellow" 
              />
              <AlertCard 
                label="Info" 
                count={alertsSummary?.info ?? null} 
                color="blue" 
              />
            </div>
            {alertsSummary?.total_active === 0 && (
              <div className="text-center py-8 text-gray-400">
                No active alerts
              </div>
            )}
          </div>
        )}

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-5">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <QuickActionCard 
              title="Body Shop" 
              subtitle="Welding robots status" 
              path="/workshops/body-shop"
              color="blue" 
            />
            <QuickActionCard 
              title="Paint Shop" 
              subtitle="Booth conditions" 
              path="/workshops/paint-shop"
              color="green" 
            />
            <QuickActionCard 
              title="Final Assembly" 
              subtitle="Line performance" 
              path="/workshops/final-assembly"
              color="yellow" 
            />
            <QuickActionCard 
              title="Utilities" 
              subtitle="Power & HVAC" 
              path="/workshops/utilities"
              color="gray" 
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusCard({ label, count, color }) {
  const [displayCount, setDisplayCount] = useState(count)
  const [isChanging, setIsChanging] = useState(false)

  useEffect(() => {
    // Only update if count is valid and different
    if (count !== displayCount && count !== null && count !== undefined) {
      setIsChanging(true)
      setDisplayCount(count)
      setTimeout(() => setIsChanging(false), 600)
    }
  }, [count, displayCount])

  const colorClasses = {
    gray: 'bg-gray-50 text-gray-700',
    green: 'bg-emerald-50 text-emerald-700',
    yellow: 'bg-amber-50 text-amber-700',
    red: 'bg-rose-50 text-rose-700',
    purple: 'bg-purple-50 text-purple-700',
  }

  return (
    <div className={`rounded-xl p-5 ${colorClasses[color]} transition-all duration-300 ${isChanging ? 'scale-105 ring-2 ring-blue-400' : 'scale-100'}`}>
      <p className={`text-2xl md:text-4xl font-bold mb-1 transition-all duration-300 ${isChanging ? 'scale-110' : 'scale-100'}`}>
        {displayCount !== null && displayCount !== undefined ? displayCount : 'N/A'}
      </p>
      <p className="text-sm font-medium">{label}</p>
    </div>
  )
}

function AlertCard({ label, count, color }) {
  const [displayCount, setDisplayCount] = useState(count)
  const [isChanging, setIsChanging] = useState(false)

  useEffect(() => {
    // Only update if count is valid and different
    if (count !== displayCount && count !== null && count !== undefined) {
      setIsChanging(true)
      setDisplayCount(count)
      setTimeout(() => setIsChanging(false), 600)
    }
  }, [count, displayCount])

  const colorClasses = {
    red: 'bg-red-50 text-red-700',
    orange: 'bg-orange-50 text-orange-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    blue: 'bg-blue-50 text-blue-700',
  }

  return (
    <div className={`rounded-lg p-4 ${colorClasses[color]} transition-all duration-300 ${isChanging ? 'scale-105 ring-2 ring-blue-400' : 'scale-100'}`}>
      <p className={`text-3xl font-bold mb-1 transition-all duration-300 ${isChanging ? 'scale-110' : 'scale-100'}`}>
        {displayCount !== null && displayCount !== undefined ? displayCount : 'N/A'}
      </p>
      <p className="text-sm font-medium">{label}</p>
    </div>
  )
}

function QuickActionCard({ title, subtitle, path, color }) {
  const borderColorClasses = {
    blue: 'border-blue-200 hover:border-blue-300 hover:bg-blue-50',
    green: 'border-green-200 hover:border-green-300 hover:bg-green-50',
    yellow: 'border-yellow-200 hover:border-yellow-300 hover:bg-yellow-50',
    gray: 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
  }

  return (
    <Link
      to={path}
      className={`block border-2 rounded-lg p-5 transition-all ${borderColorClasses[color]}`}
    >
      <h3 className="text-base font-bold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-600">{subtitle}</p>
    </Link>
  )
}

export default Dashboard
