import { useState, useEffect, useMemo, useCallback } from 'react'
import { controlsAPI, plantsAPI } from '../services/api'
import { useMachineStatesWebSocket } from '../hooks/useWebSocket'
import { useAuthStore } from '../store/authStore'
import { useFilterStore } from '../store/filterStore'
import LocationFilter from '../components/LocationFilter'
import clsx from 'clsx'
import logger from '../utils/logger'
import {
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  WrenchScrewdriverIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  FunnelIcon,
  BoltIcon,
  MagnifyingGlassIcon,
  ShieldExclamationIcon,
  SignalIcon,
} from '@heroicons/react/24/outline'

const statusColors = {
  online: 'bg-green-500',
  offline: 'bg-gray-400',
  idle: 'bg-yellow-500',
  fault: 'bg-red-500',
  maintenance: 'bg-purple-500',
}

const commandConfig = {
  start: { 
    icon: PlayIcon, 
    label: 'Start', 
    color: 'green', 
    disabled: (status) => status === 'online' || status === 'maintenance'
  },
  stop: { 
    icon: StopIcon, 
    label: 'Stop', 
    color: 'red', 
    disabled: (status) => status === 'offline'
  },
  reset_alarm: { 
    icon: ArrowPathIcon, 
    label: 'Reset Alarm', 
    color: 'blue', 
    disabled: () => false
  },
  acknowledge: { 
    icon: CheckCircleIcon, 
    label: 'Acknowledge', 
    color: 'blue', 
    disabled: () => false
  },
  maintenance: { 
    icon: WrenchScrewdriverIcon, 
    label: 'Maintenance', 
    color: 'purple', 
    disabled: (status) => status === 'maintenance'
  },
  emergency_stop: { 
    icon: ShieldExclamationIcon, 
    label: 'Emergency Stop', 
    color: 'red', 
    disabled: (status) => status === 'offline'
  },
}

export default function ControlCenter() {
  const { user } = useAuthStore()
  const { location } = useFilterStore()
  const [selectedMachines, setSelectedMachines] = useState([])
  const [auditLoading, setAuditLoading] = useState(true)
  const [shopsLoading, setShopsLoading] = useState(true)
  const [sendingCommand, setSendingCommand] = useState(false)
  const [auditLog, setAuditLog] = useState([])
  const [statusFilter, setStatusFilter] = useState('all')
  const [shopFilter, setShopFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [shops, setShops] = useState([])
  const [commandResult, setCommandResult] = useState(null)
  const [auditPage, setAuditPage] = useState(0)
  const [auditRowsPerPage, setAuditRowsPerPage] = useState(10)
  const [machinePage, setMachinePage] = useState(0)
  const [machineRowsPerPage, setMachineRowsPerPage] = useState(40)

  // Map location to plant code for WebSocket
  const plantCode = useMemo(() => {
    if (!location || location === 'all') return null
    const locationMap = {
      'jamshedpur': 'HOUSTON-001',
      'pune': 'AUSTIN-001',
      'sanand': 'DALLAS-001',
    }
    return locationMap[location]
  }, [location])

  // Real-time machine states via WebSocket
  const { machines: liveMachineStates, isConnected, timestamp: wsTimestamp } = useMachineStatesWebSocket(
    null, // plantId - using plantCode instead
    null, // shopType
    plantCode // pass as third parameter
  )

  // Check permissions
  const canControl = ['operator', 'supervisor', 'manager', 'admin'].includes(user?.role)

  // Map WebSocket machine data to expected format
  const machines = useMemo(() => {
    if (!liveMachineStates || liveMachineStates.length === 0) return []
    
    return liveMachineStates.map(machine => ({
      machine_id: machine.machine_id,
      machine_code: machine.machine_code,
      machine_name: machine.machine_name,
      machine_type: machine.machine_type,
      shop_id: machine.shop_id,
      shop_name: machine.shop_name,
      shop_type: machine.shop_type,
      status: machine.status || 'unknown',
      health_score: machine.health_score,
      current_load: machine.current_load,
      current_cycle: machine.current_cycle,
      temperature: machine.temperature,
      vibration: machine.vibration,
      power_consumption: machine.power_consumption,
      fault_code: machine.fault_code,
      fault_message: machine.fault_message,
      is_controllable: machine.is_controllable === true, // Only true if explicitly set to true
    }))
  }, [liveMachineStates])

  const machinesLoading = !isConnected && machines.length === 0

  useEffect(() => {
    fetchAuditLog()
    fetchShops()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch shops when location changes
  useEffect(() => {
    fetchShops()
  }, [location]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh audit log every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchAuditLog()
    }, 30000) // 30 seconds

    return () => clearInterval(interval)
  }, [])

  const fetchAuditLog = async () => {
    try {
      setAuditLoading(true)
      const auditRes = await controlsAPI.getAuditLog({ limit: 50 })
      setAuditLog(auditRes.data || [])
    } catch (error) {
      logger.error('Error fetching audit log:', error)
      setAuditLog([])
    } finally {
      setAuditLoading(false)
    }
  }

  const fetchShops = async () => {
    try {
      setShopsLoading(true)
      const hierarchyRes = await plantsAPI.getHierarchy()

      // Helper function to get location code
      const getLocationCode = (locationValue) => {
        const locationMap = {
          'jamshedpur': 'HOUSTON-001',
          'pune': 'AUSTIN-001',
          'sanand': 'DALLAS-001',
        }
        return locationMap[locationValue] || null
      }

      // Extract shops from hierarchy
      const allShops = []
      if (hierarchyRes.data && Array.isArray(hierarchyRes.data)) {
        hierarchyRes.data.forEach(plant => {
          // Check if we should include this plant's shops based on location filter
          const shouldIncludePlant = location === 'all' || plant.code === getLocationCode(location)
          
          if (shouldIncludePlant && plant.shops && Array.isArray(plant.shops)) {
            plant.shops.forEach(shop => {
              allShops.push({ 
                id: shop.shop_id || shop.id, 
                name: shop.shop_name || shop.name,
                plant_id: plant.id,
                plant_name: plant.name,
                // Display name with plant if showing all locations
                displayName: location === 'all'
                  ? `${shop.shop_name || shop.name} – ${plant.name}`
                  : shop.shop_name || shop.name
              })
            })
          }
        })
      }
      setShops(allShops)
      
      // Reset shop filter if current selection is not in the new list
      if (shopFilter !== 'all' && !allShops.find(s => s.id === parseInt(shopFilter))) {
        setShopFilter('all')
      }
    } catch (error) {
      logger.error('Error fetching shops:', error)
      setShops([])
    } finally {
      setShopsLoading(false)
    }
  }

  // First apply search and shop filters (but NOT status filter) for counting
  const baseFilteredMachines = machines.filter(m => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const matchesCode = m.machine_code?.toLowerCase().includes(query)
      const matchesName = m.machine_name?.toLowerCase().includes(query)
      if (!matchesCode && !matchesName) return false
    }
    // Shop filter
    if (shopFilter !== 'all' && m.shop_id?.toString() !== shopFilter) return false
    return true
  })

  // Status counts based on baseFilteredMachines (location + search + workshop, but NOT status)
  const statusCounts = {
    all: baseFilteredMachines.length,
    online: baseFilteredMachines.filter(m => m.status === 'online').length,
    idle: baseFilteredMachines.filter(m => m.status === 'idle').length,
    fault: baseFilteredMachines.filter(m => m.status === 'fault').length,
    offline: baseFilteredMachines.filter(m => m.status === 'offline').length,
    maintenance: baseFilteredMachines.filter(m => m.status === 'maintenance').length,
  }

  // Then apply status filter on top for final display
  const filteredMachines = baseFilteredMachines.filter(m => {
    if (statusFilter !== 'all' && m.status !== statusFilter) return false
    return true
  })

  // Paginated machines for display
  const paginatedMachines = filteredMachines.slice(
    machinePage * machineRowsPerPage,
    machinePage * machineRowsPerPage + machineRowsPerPage
  )

  // Reset machine page when filters change
  useEffect(() => {
    setMachinePage(0)
  }, [statusFilter, shopFilter, searchQuery, location])

  // Get the list of controllable machines from selected machines
  const selectedControllableMachines = useMemo(() => {
    return selectedMachines.filter(machineId => {
      const machine = machines.find(m => m.machine_id === machineId)
      return machine && machine.is_controllable
    })
  }, [selectedMachines, machines])

  // Check if a command should be disabled based on selected machines' statuses
  const isCommandDisabled = useCallback((command) => {
    if (selectedControllableMachines.length === 0) return true
    
    const config = commandConfig[command]
    if (!config || !config.disabled) return false
    
    // Check if ALL selected controllable machines have the command disabled
    // This ensures we don't send commands to machines that shouldn't receive them
    const selectedMachineObjects = selectedControllableMachines
      .map(id => machines.find(m => m.machine_id === id))
      .filter(Boolean)
    
    // If any machine can accept the command, enable the button
    // This allows sending commands to eligible machines in a mixed selection
    return selectedMachineObjects.every(machine => config.disabled(machine.status))
  }, [selectedControllableMachines, machines])

  const toggleMachineSelection = (machineId) => {
    setSelectedMachines(prev => {
      if (prev.includes(machineId)) {
        return prev.filter(id => id !== machineId)
      }
      return [...prev, machineId]
    })
  }

  const selectAll = () => {
    if (selectedMachines.length === filteredMachines.length) {
      setSelectedMachines([])
    } else {
      setSelectedMachines(filteredMachines.map(m => m.machine_id))
    }
  }

  const sendBulkCommand = async (command) => {
    if (!canControl || selectedControllableMachines.length === 0) return

    try {
      setSendingCommand(true)
      const results = await Promise.all(
        selectedControllableMachines.map(machineId =>
          controlsAPI.sendCommand(machineId, { action: command }).catch(err => ({ error: err.message, machineId }))
        )
      )

      const successes = results.filter(r => !r.error).length
      const failures = results.filter(r => r.error).length

      setCommandResult({
        type: failures === 0 ? 'success' : failures === results.length ? 'error' : 'warning',
        message: `Command sent: ${successes} succeeded, ${failures} failed`,
      })

      // Refresh audit log to show new commands
      fetchAuditLog()
      // Clear selection after successful commands
      if (failures === 0) {
        setSelectedMachines([])
      }
      setTimeout(() => setCommandResult(null), 5000)
    } catch (error) {
      setCommandResult({
        type: 'error',
        message: 'Failed to send commands',
      })
    } finally {
      setSendingCommand(false)
    }
  }

  if (!canControl) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <ExclamationTriangleIcon className="w-16 h-16 text-yellow-500 mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">Access Restricted</h2>
        <p className="text-gray-500 mt-2">
          You do not have permission to access the Control Center.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Control Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">Send commands to machines</p>
        </div>
        <div className="flex items-center gap-3">
          <LocationFilter />
          <div className="flex items-center gap-2 text-sm">
            <div className={clsx(
              "flex items-center gap-1.5 px-2 py-1 rounded-full",
              isConnected ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
            )}>
              <SignalIcon className="w-4 h-4" />
              <span className="font-medium">{isConnected ? 'Live' : 'Connecting...'}</span>
            </div>
            {wsTimestamp && (
              <div className="flex items-center gap-1.5 text-gray-500">
                <ClockIcon className="w-4 h-4" />
                <span>{new Date(wsTimestamp).toLocaleTimeString()}</span>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              fetchAuditLog()
              fetchShops()
            }}
            className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
            disabled={auditLoading || shopsLoading}
            title="Refresh audit log and shops"
          >
            <ArrowPathIcon className={clsx('w-5 h-5 text-gray-600', (auditLoading || shopsLoading) && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Command result alert */}
      {commandResult && (
        <div className={clsx(
          'p-4 rounded-lg flex items-center gap-3',
          commandResult.type === 'success' && 'bg-green-50 text-green-800',
          commandResult.type === 'error' && 'bg-red-50 text-red-800',
          commandResult.type === 'warning' && 'bg-yellow-50 text-yellow-800',
        )}>
          {commandResult.type === 'success' ? (
            <CheckCircleIcon className="w-5 h-5" />
          ) : commandResult.type === 'error' ? (
            <XCircleIcon className="w-5 h-5" />
          ) : (
            <ExclamationTriangleIcon className="w-5 h-5" />
          )}
          {commandResult.message}
        </div>
      )}

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

              {/* Status filter */}
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-2">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                >
                  <option value="all">All Machines ({statusCounts.all})</option>
                  <option value="online">Online ({statusCounts.online})</option>
                  <option value="idle">Idle ({statusCounts.idle})</option>
                  <option value="fault">Fault ({statusCounts.fault})</option>
                  <option value="offline">Offline ({statusCounts.offline})</option>
                  <option value="maintenance">Maintenance ({statusCounts.maintenance})</option>
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
                    {location === 'all' 
                      ? 'All Workshops (All Locations)' 
                      : `All Workshops (${location.charAt(0).toUpperCase() + location.slice(1)})`
                    }
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
            {(searchQuery || statusFilter !== 'all' || shopFilter !== 'all') && (
              <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="font-medium">
                    {[searchQuery !== '', statusFilter !== 'all', shopFilter !== 'all'].filter(Boolean).length}
                  </span>
                  <span>
                    active filter{[searchQuery !== '', statusFilter !== 'all', shopFilter !== 'all'].filter(Boolean).length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setStatusFilter('all')
                    setShopFilter('all')
                  }}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Control panel */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {/* Selection info */}
        <div className="flex items-center justify-between mb-6">
          {machinesLoading ? (
            <div className="h-5 bg-gray-200 rounded w-32 animate-pulse"></div>
          ) : (
            <>
              <span className="text-sm text-gray-500">
                {selectedMachines.length} of {filteredMachines.length} selected
              </span>
              <button
                onClick={selectAll}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                {selectedMachines.length === filteredMachines.length ? 'Deselect all' : 'Select all'}
              </button>
            </>
          )}
        </div>

        {/* Command buttons */}
        {machinesLoading ? (
          <div className="flex flex-wrap gap-3 mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="h-5 bg-gray-200 rounded w-24 animate-pulse self-center mr-2"></div>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-9 bg-gray-200 rounded w-24 animate-pulse"></div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 mb-6 p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-2 mr-2">
              <span className="text-sm font-medium text-gray-700">Commands:</span>
              {selectedMachines.length > 0 && selectedControllableMachines.length === 0 && (
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                  ⚠ Selected machines are not controllable
                </span>
              )}
              {selectedMachines.length > 0 && selectedControllableMachines.length > 0 && selectedControllableMachines.length < selectedMachines.length && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                  ℹ {selectedControllableMachines.length} of {selectedMachines.length} machines are controllable
                </span>
              )}
            </div>
            {Object.entries(commandConfig).map(([cmd, config]) => {
              const commandDisabled = isCommandDisabled(cmd)
              const isDisabled = sendingCommand || selectedControllableMachines.length === 0 || commandDisabled
              
              return (
                <button
                  key={cmd}
                  onClick={() => sendBulkCommand(cmd)}
                  disabled={isDisabled}
                  title={commandDisabled ? `Cannot ${config.label.toLowerCase()} - all selected machines are already in this state or incompatible` : ''}
                  className={clsx(
                    'px-4 py-2.5 rounded-lg font-medium text-sm flex items-center gap-2 transition-all',
                    isDisabled
                      ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      : config.color === 'green'
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm hover:shadow-md'
                      : config.color === 'red'
                      ? 'bg-red-600 text-white hover:bg-red-700 shadow-sm hover:shadow-md'
                      : config.color === 'yellow'
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                      : config.color === 'blue'
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                      : config.color === 'purple'
                      ? 'bg-purple-100 text-purple-700 hover:bg-purple-200 border border-purple-300'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
                  )}
                >
                  <config.icon className="w-4 h-4" />
                  {config.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Machine grid */}
        {machinesLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {[...Array(24)].map((_, i) => (
              <div key={i} className="p-3 rounded-lg border-2 border-gray-200 bg-white animate-pulse">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-200 flex-shrink-0"></div>
                  <div className="h-4 bg-gray-200 rounded w-16"></div>
                </div>
                <div className="h-3 bg-gray-200 rounded w-20 mb-1"></div>
                <div className="h-3 bg-gray-200 rounded w-12"></div>
              </div>
            ))}
          </div>
        ) : filteredMachines.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No machines found matching the selected filters</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
              {paginatedMachines.map(machine => (
                <button
                  key={machine.machine_id}
                  onClick={() => toggleMachineSelection(machine.machine_id)}
                  className={clsx(
                    'p-3 rounded-lg border-2 text-left transition-all bg-white relative',
                    selectedMachines.includes(machine.machine_id)
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                    !machine.is_controllable && 'opacity-75'
                  )}
                >
                  {!machine.is_controllable && (
                    <div className="absolute top-1 right-1" title="Not remotely controllable">
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', statusColors[machine.status] || statusColors.offline)} />
                    <span className="font-semibold text-sm text-gray-900 truncate">{machine.machine_code || 'N/A'}</span>
                  </div>
                  <p className="text-xs text-gray-600 truncate mb-1">{machine.machine_name || 'Unknown'}</p>
                  <p className="text-xs text-gray-600 capitalize">{machine.status || 'unknown'}</p>
                </button>
              ))}
            </div>

            {/* Machine Pagination */}
            {filteredMachines.length > machineRowsPerPage && (
              <div className="mt-6 pt-4 border-t border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">Machines per page:</span>
                  <select
                    value={machineRowsPerPage}
                    onChange={(e) => {
                      setMachineRowsPerPage(parseInt(e.target.value))
                      setMachinePage(0)
                    }}
                    className="px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value={20}>20</option>
                    <option value={40}>40</option>
                    <option value={60}>60</option>
                    <option value={80}>80</option>
                  </select>
                </div>
                
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-700">
                    {machinePage * machineRowsPerPage + 1}-{Math.min((machinePage + 1) * machineRowsPerPage, filteredMachines.length)} of {filteredMachines.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setMachinePage(0)}
                      disabled={machinePage === 0}
                      className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="First page"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setMachinePage(prev => Math.max(0, prev - 1))}
                      disabled={machinePage === 0}
                      className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Previous page"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setMachinePage(prev => Math.min(Math.ceil(filteredMachines.length / machineRowsPerPage) - 1, prev + 1))}
                      disabled={machinePage >= Math.ceil(filteredMachines.length / machineRowsPerPage) - 1}
                      className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Next page"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setMachinePage(Math.ceil(filteredMachines.length / machineRowsPerPage) - 1)}
                      disabled={machinePage >= Math.ceil(filteredMachines.length / machineRowsPerPage) - 1}
                      className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      title="Last page"
                    >
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Audit log */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">Recent Commands</h3>
        </div>
        {auditLoading ? (
          <div className="p-6">
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-32"></div>
                  <div className="h-4 bg-gray-200 rounded w-24"></div>
                  <div className="h-4 bg-gray-200 rounded w-20"></div>
                  <div className="h-4 bg-gray-200 rounded w-28"></div>
                  <div className="h-6 bg-gray-200 rounded-full w-16"></div>
                </div>
              ))}
            </div>
          </div>
        ) : auditLog.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p>No recent commands</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Machine</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Command</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white">
                  {auditLog
                    .slice(auditPage * auditRowsPerPage, auditPage * auditRowsPerPage + auditRowsPerPage)
                    .map((log, idx) => (
                      <tr key={log.id || idx} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <div className="flex items-center gap-2">
                            <ClockIcon className="w-4 h-4 text-gray-400" />
                            {log.completed_at || log.requested_at || log.timestamp || log.executed_at || log.created_at 
                              ? new Date(log.completed_at || log.requested_at || log.timestamp || log.executed_at || log.created_at).toLocaleString() 
                              : 'N/A'}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          {log.machine_code || log.machine_name || log.machine_id || 'N/A'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 capitalize">
                          <div className="flex items-center gap-2">
                            <BoltIcon className="w-4 h-4 text-gray-400" />
                            {log.action || log.command || 'N/A'}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">{log.user_name || log.user_username || log.username || log.user || 'System'}</td>
                        <td className="px-6 py-4">
                          <span className={clsx(
                            'px-2.5 py-1 text-xs font-medium rounded-full',
                            log.status === 'success' && 'bg-green-100 text-green-700',
                            log.status === 'failed' && 'bg-red-100 text-red-700',
                            log.status === 'pending' && 'bg-yellow-100 text-yellow-700',
                            !['success', 'failed', 'pending'].includes(log.status) && 'bg-gray-100 text-gray-700'
                          )}>
                            {log.status || 'unknown'}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            
            {/* Pagination */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">Rows per page:</span>
                <select
                  value={auditRowsPerPage}
                  onChange={(e) => {
                    setAuditRowsPerPage(parseInt(e.target.value))
                    setAuditPage(0)
                  }}
                  className="px-2 py-1 text-sm text-gray-900 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </div>
              
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-700">
                  {auditPage * auditRowsPerPage + 1}-{Math.min((auditPage + 1) * auditRowsPerPage, auditLog.length)} of {auditLog.length}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setAuditPage(0)}
                    disabled={auditPage === 0}
                    className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="First page"
                  >
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setAuditPage(prev => Math.max(0, prev - 1))}
                    disabled={auditPage === 0}
                    className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Previous page"
                  >
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setAuditPage(prev => Math.min(Math.ceil(auditLog.length / auditRowsPerPage) - 1, prev + 1))}
                    disabled={auditPage >= Math.ceil(auditLog.length / auditRowsPerPage) - 1}
                    className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Next page"
                  >
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                  </button>
                  <button
                    onClick={() => setAuditPage(Math.ceil(auditLog.length / auditRowsPerPage) - 1)}
                    disabled={auditPage >= Math.ceil(auditLog.length / auditRowsPerPage) - 1}
                    className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Last page"
                  >
                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                      </svg>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
