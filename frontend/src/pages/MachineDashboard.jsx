import { useState, useEffect } from 'react'
import { machinesAPI, plantsAPI } from '../services/api'
import { useMachineStatesWebSocket } from '../hooks/useWebSocket'
import logger from '../utils/logger'
import { useFilterStore } from '../store/filterStore'
import MachineStatusGrid from '../components/MachineStatusGrid'
import LocationFilter from '../components/LocationFilter'
import { FilterBarSkeleton, PageHeaderSkeleton, MachineGridSkeleton } from '../components/skeletons'
import {
  FunnelIcon,
  MagnifyingGlassIcon,
  Squares2X2Icon,
  ListBulletIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

const statusFilters = [
  { value: 'all', label: 'All Machines' },
  { value: 'online', label: 'Online' },
  { value: 'idle', label: 'Idle' },
  { value: 'fault', label: 'Fault' },
  { value: 'offline', label: 'Offline' },
  { value: 'maintenance', label: 'Maintenance' },
]

export default function MachineDashboard() {
  const [machines, setMachines] = useState([])
  const [filteredMachines, setFilteredMachines] = useState([])
  const [baseFilteredMachines, setBaseFilteredMachines] = useState([]) // For accurate status counts
  const [machineSummary, setMachineSummary] = useState(null) // API summary with correct total
  const [loadingStates, setLoadingStates] = useState({
    machines: true,
    hierarchy: true,
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [shopFilter, setShopFilter] = useState('all')
  const [viewMode, setViewMode] = useState(() => {
    // Restore view mode from localStorage
    const saved = localStorage.getItem('machinesViewMode')
    return saved || 'grid'
  })
  const [shops, setShops] = useState([])
  const [hierarchy, setHierarchy] = useState(null)
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(12)

  // Global filters
  const { location } = useFilterStore()

  // Map location to plant code for WebSocket
  const getPlantCodeForLocation = (locationValue) => {
    const locationMap = {
      'jamshedpur': 'HOUSTON-001',
      'pune': 'AUSTIN-001',
      'sanand': 'DALLAS-001',
    }
    return locationValue && locationValue !== 'all' ? locationMap[locationValue] : null
  }

  const plantCodeForWs = getPlantCodeForLocation(location)

  // Real-time machine states - pass plant_code to filter WebSocket updates
  const { machines: liveMachineStates, isConnected: connected } = useMachineStatesWebSocket(
    null, // plantId
    null, // shopType
    plantCodeForWs // plantCode
  )

  // Persist view mode to localStorage
  useEffect(() => {
    localStorage.setItem('machinesViewMode', viewMode)
  }, [viewMode])

  useEffect(() => {
    // Clear filtered machines when location changes to prevent stale data
    setBaseFilteredMachines([])
    setFilteredMachines([])
    fetchData()
  }, [location]) // eslint-disable-line react-hooks/exhaustive-deps

  // Enrich machines with shop information from hierarchy
  useEffect(() => {
    if (!loadingStates.machines && !loadingStates.hierarchy && hierarchy && machines.length > 0) {
      setMachines(prevMachines => {
        return prevMachines.map(machine => {
          // Skip if already enriched
          if (machine.plant_name) {
            return machine
          }
          
          // Find shop information for this machine
          let shopInfo = null
          for (const plant of hierarchy) {
            for (const shop of plant.shops || []) {
              for (const line of shop.lines || []) {
                if (line.id === machine.line_id) {
                  shopInfo = {
                    shop_id: shop.id,
                    shop_name: shop.name,
                    shop_type: shop.shop_type,
                    plant_id: plant.id,
                    plant_name: plant.name,
                    plant_code: plant.code,
                  }
                  break
                }
              }
              if (shopInfo) break
            }
            if (shopInfo) break
          }
          
          return shopInfo ? { ...machine, ...shopInfo } : machine
        })
      })
    }
  }, [loadingStates.machines, loadingStates.hierarchy, hierarchy, machines.length])

  // Filter shops based on selected location
  useEffect(() => {
    if (!loadingStates.hierarchy && hierarchy) {
      const allShops = []
      
      hierarchy.forEach(plant => {
        // Check if we should include this plant's shops
        const shouldIncludePlant = location === 'all' || plant.code === getLocationCode(location)
        
        if (shouldIncludePlant) {
          plant.shops?.forEach(shop => {
            allShops.push({ 
              id: shop.id, 
              name: shop.name,
              code: shop.code,
              shop_type: shop.shop_type,
              plant_id: plant.id,
              plant_name: plant.name,
              plant_code: plant.code,
              // Display name with location if showing all locations
              displayName: location === 'all' 
                ? `${shop.name} – ${plant.name}`
                : shop.name
            })
          })
        }
      })
      
      setShops(allShops)
      
      // Reset shop filter if current selection is not in the new list
      if (shopFilter !== 'all' && !allShops.find(s => s.id === parseInt(shopFilter))) {
        setShopFilter('all')
      }
    }
  }, [hierarchy, location, loadingStates.hierarchy, shopFilter])

  // Helper function to get location code
  const getLocationCode = (locationValue) => {
    const locationMap = {
      'jamshedpur': 'HOUSTON-001',
      'pune': 'AUSTIN-001',
      'sanand': 'DALLAS-001',
    }
    return locationMap[locationValue] || null
  }

  // Apply real-time updates
  useEffect(() => {
    if (liveMachineStates && liveMachineStates.length > 0) {
      setMachines(prevMachines => {
        const updatedMachines = [...prevMachines]
        liveMachineStates.forEach(liveState => {
          const index = updatedMachines.findIndex(m => m.machine_id === liveState.machine_id)
          if (index !== -1) {
            updatedMachines[index] = { ...updatedMachines[index], ...liveState }
          }
        })
        return updatedMachines
      })
    }
  }, [liveMachineStates])

  // Apply filters
  // Note: machines array is already filtered by location (via API call in fetchData)
  // So all filtering here is applied on top of location filter
  useEffect(() => {
    let result = machines

    // Search filter: filter by machine code or name
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        m =>
          m.machine_code?.toLowerCase().includes(query) ||
          m.machine_name?.toLowerCase().includes(query)
      )
    }

    // Workshop filter: filter by selected workshop/shop
    // (but NOT status filter for counting purposes)
    if (shopFilter !== 'all') {
      result = result.filter(m => m.shop_id === parseInt(shopFilter))
    }

    // Store the result before status filter for accurate status counts
    // This ensures status counts show machines from selected location + workshop + search
    const baseFiltered = result

    // Status filter: filter by machine status
    if (statusFilter !== 'all') {
      // Handle 'online' filter to include both 'online' and 'running' states
      if (statusFilter === 'online') {
        result = result.filter(m => m.status === 'online' || m.status === 'running')
      } else {
        result = result.filter(m => m.status === statusFilter)
      }
    }

    setFilteredMachines(result)
    setBaseFilteredMachines(baseFiltered)
  }, [machines, searchQuery, statusFilter, shopFilter])

  // Reset to first page when filters change (but not when machines update from WebSocket)
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, statusFilter, shopFilter])

  const fetchData = async () => {
    // Build params based on location filter
    const params = {}
    if (location && location !== 'all') {
      // Map location to plant code
      const locationMap = {
        'jamshedpur': 'HOUSTON-001',
        'pune': 'AUSTIN-001',
        'sanand': 'DALLAS-001',
      }
      const plantCode = locationMap[location]
      if (plantCode) {
        params.plant_code = plantCode
      }
    }
    
    // Reset loading states and clear filtered machines to prevent stale data
    setLoadingStates({
      machines: true,
      hierarchy: true,
    })
    setBaseFilteredMachines([]) // Clear to prevent using stale data during fetch
    
    try {
      // Fetch machines, hierarchy, and summary in parallel
      const [machinesResponse, hierarchyResponse, summaryResponse] = await Promise.all([
        machinesAPI.getAll(params),
        plantsAPI.getHierarchy(),
        machinesAPI.getSummary(params)
      ])
      
      // Process machines data
      const mappedMachines = (machinesResponse.data || []).map(machine => ({
        machine_id: machine.id,
        machine_code: machine.code,
        machine_name: machine.name,
        machine_type: machine.machine_type,
        line_id: machine.line_id,
        manufacturer: machine.manufacturer,
        model: machine.model,
        is_controllable: machine.is_controllable,
        is_active: machine.is_active,
        // Default values for fields that will be updated by WebSocket
        status: 'offline',
        health_score: null,
        current_load: null,
        current_cycle: null,
        temperature: null,
        vibration: null,
        power_consumption: null,
        fault_code: null,
        fault_message: null,
      }))
      
      // Set hierarchy first
      const hierarchyData = hierarchyResponse.data
      setHierarchy(hierarchyData)
      
      // Enrich machines with location data immediately
      const enrichedMachines = mappedMachines.map(machine => {
        let shopInfo = null
        for (const plant of hierarchyData) {
          for (const shop of plant.shops || []) {
            for (const line of shop.lines || []) {
              if (line.id === machine.line_id) {
                shopInfo = {
                  shop_id: shop.id,
                  shop_name: shop.name,
                  shop_type: shop.shop_type,
                  plant_id: plant.id,
                  plant_name: plant.name,
                  plant_code: plant.code,
                }
                break
              }
            }
            if (shopInfo) break
          }
          if (shopInfo) break
        }
        return shopInfo ? { ...machine, ...shopInfo } : machine
      })
      
      // Set enriched machines
      setMachines(enrichedMachines)
      
      // Set machine summary from API (this has the correct total count)
      setMachineSummary(summaryResponse.data)
      
      // Update loading states
      setLoadingStates({
        machines: false,
        hierarchy: false,
      })
    } catch (error) {
      logger.error('Error fetching data:', error)
      setLoadingStates({
        machines: false,
        hierarchy: false,
      })
    }
  }

  // Calculate status counts
  // Use API summary when no filters are active (shows correct 505 total)
  // Use client-side counts when filters are active (search/workshop)
  const hasActiveFilters = searchQuery !== '' || shopFilter !== 'all'
  
  const statusCounts = hasActiveFilters ? {
    // Client-side filtering active - count from filtered machines
    all: baseFilteredMachines.length,
    online: baseFilteredMachines.filter(m => m.status === 'online' || m.status === 'running').length,
    idle: baseFilteredMachines.filter(m => m.status === 'idle').length,
    fault: baseFilteredMachines.filter(m => m.status === 'fault').length,
    offline: baseFilteredMachines.filter(m => m.status === 'offline').length,
    maintenance: baseFilteredMachines.filter(m => m.status === 'maintenance').length,
  } : machineSummary ? {
    // No filters - use API summary (correct 505 total)
    all: machineSummary.total,
    online: machineSummary.online,
    idle: machineSummary.idle,
    fault: machineSummary.fault,
    offline: machineSummary.offline,
    maintenance: machineSummary.maintenance,
  } : {
    // Fallback while loading
    all: 0,
    online: 0,
    idle: 0,
    fault: 0,
    offline: 0,
    maintenance: 0,
  }

  // Pagination calculations
  const totalPages = Math.ceil(filteredMachines.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedMachines = filteredMachines.slice(startIndex, endIndex)

  // Active filter count
  const activeFiltersCount = [
    searchQuery !== '',
    statusFilter !== 'all',
    shopFilter !== 'all',
  ].filter(Boolean).length

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      {loadingStates.machines && loadingStates.hierarchy ? (
        <PageHeaderSkeleton />
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Machines</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {/* Show API summary total when no filters, filtered count otherwise */}
              {hasActiveFilters || statusFilter !== 'all' 
                ? `${filteredMachines.length} machine${filteredMachines.length !== 1 ? 's' : ''}`
                : `${statusCounts.all} machine${statusCounts.all !== 1 ? 's' : ''}`
              }
              {location !== 'all' && shops.length > 0 && (
                <span>
                  {' • '}{shops.length} workshop{shops.length !== 1 ? 's' : ''} in this location
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <LocationFilter />
            {connected && (
              <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Live
              </span>
            )}
            <button
              onClick={fetchData}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              disabled={loadingStates.machines}
            >
              <ArrowPathIcon className={clsx('w-4 h-4', loadingStates.machines && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* Filters bar */}
      {loadingStates.hierarchy ? (
        <FilterBarSkeleton />
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
                  {statusFilters.map(filter => (
                    <option key={filter.value} value={filter.value}>
                      {filter.label} ({statusCounts[filter.value] || 0})
                    </option>
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
                      {shop.displayName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* View mode toggle */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-200">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-700">View:</span>
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5',
                      viewMode === 'grid' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'
                    )}
                  >
                    <Squares2X2Icon className="w-4 h-4" />
                    Grid
                  </button>
                  <button
                    onClick={() => setViewMode('compact')}
                    className={clsx(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5',
                      viewMode === 'compact' ? 'bg-white shadow text-blue-600' : 'text-gray-600 hover:text-gray-900'
                    )}
                  >
                    <ListBulletIcon className="w-4 h-4" />
                    Compact
                  </button>
                </div>
              </div>
            </div>

            {/* Active filters and clear button */}
            {activeFiltersCount > 0 && (
              <div className="flex items-center justify-between pt-3 border-t border-gray-200">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="font-medium">{activeFiltersCount}</span>
                  <span>active filter{activeFiltersCount !== 1 ? 's' : ''}</span>
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

      {/* Machines grid */}
      {loadingStates.machines ? (
        <MachineGridSkeleton viewMode={viewMode} />
      ) : filteredMachines.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl shadow-sm border border-gray-100">
          <p className="text-gray-500">No machines found matching your criteria</p>
          <button
            onClick={() => {
              setSearchQuery('')
              setStatusFilter('all')
              setShopFilter('all')
            }}
            className="mt-4 text-auronix-blue hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {/* Machine grid */}
          <MachineStatusGrid machines={paginatedMachines} compact={viewMode === 'compact'} />

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between bg-white px-6 py-4 rounded-lg shadow-sm border border-gray-200">
              {/* Left section - Jump to Page */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-600">Jump to Page:</label>
                <input
                  type="number"
                  min="1"
                  max={totalPages}
                  value={currentPage}
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === '') return
                    const page = parseInt(value, 10)
                    if (!isNaN(page) && page >= 1 && page <= totalPages) {
                      setCurrentPage(page)
                    }
                  }}
                  onBlur={(e) => {
                    const value = e.target.value
                    const page = parseInt(value, 10)
                    // Only reset if invalid, otherwise keep current valid page
                    if (value === '' || isNaN(page) || page < 1 || page > totalPages) {
                      // Force re-render with current valid page
                      e.target.value = currentPage
                    }
                  }}
                  className="w-24 px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                />
              </div>

              {/* Right section - Navigation arrows */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-gray-600">Total Items Per Page</label>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value))
                      setCurrentPage(1)
                    }}
                    className="px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value={12}>12</option>
                    <option value={24}>24</option>
                    <option value={48}>48</option>
                    <option value={96}>96</option>
                  </select>
                </div>
                <div className="text-sm font-medium text-gray-700">
                  Showing {startIndex + 1} to {Math.min(endIndex, filteredMachines.length)} of {filteredMachines.length} results
                </div>
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className={clsx(
                    'p-2 rounded-md transition-all duration-200',
                    currentPage === 1
                      ? 'text-gray-300 cursor-not-allowed bg-gray-50'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  )}
                  aria-label="Previous page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className={clsx(
                    'p-2 rounded-md transition-all duration-200',
                    currentPage === totalPages
                      ? 'text-gray-300 cursor-not-allowed bg-gray-50'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  )}
                  aria-label="Next page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Pagination skeleton loader (for testing) */}
      {/* <PaginationSkeleton /> */}
    </div>
  )
}