import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useMemo } from 'react'
import { alertsAPI, plantsAPI, machinesAPI, authAPI } from '../services/api'
import { useAlertsWebSocket } from '../hooks/useWebSocket'
import { useFilterStore } from '../store/filterStore'
import { useAuthStore } from '../store/authStore'
import LocationFilter from '../components/LocationFilter'
import TimeRangeFilter from '../components/TimeRangeFilter'
import {
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  ShieldExclamationIcon,
  BellAlertIcon,
  CheckCircleIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  FunnelIcon,
  InformationCircleIcon,
  TagIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SignalIcon,
  XMarkIcon,
  ArrowUpCircleIcon,
  PlusCircleIcon,
} from '@heroicons/react/24/outline'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import logger from '../utils/logger'

const severityConfig = {
  critical: {
    icon: ShieldExclamationIcon,
    label: 'Critical',
    containerClass: 'border-red-200/80 bg-gradient-to-br from-red-50 via-white to-white',
    accentBarClass: 'bg-red-500/80',
    iconWrapperClass: 'bg-red-100 text-red-600',
    headlineClass: 'text-red-700',
    chipClass: 'bg-red-100 text-red-700'
  },
  error: {
    icon: ExclamationCircleIcon,
    label: 'Error',
    containerClass: 'border-orange-200/70 bg-gradient-to-br from-orange-50/80 via-white to-white',
    accentBarClass: 'bg-orange-400/80',
    iconWrapperClass: 'bg-orange-100 text-orange-600',
    headlineClass: 'text-orange-700',
    chipClass: 'bg-orange-100 text-orange-700'
  },
  warning: {
    icon: ExclamationTriangleIcon,
    label: 'Warning',
    containerClass: 'border-yellow-200/70 bg-gradient-to-br from-yellow-50/70 via-white to-white',
    accentBarClass: 'bg-yellow-400/80',
    iconWrapperClass: 'bg-yellow-100 text-yellow-600',
    headlineClass: 'text-yellow-700',
    chipClass: 'bg-yellow-100 text-yellow-700'
  },
  info: {
    icon: BellAlertIcon,
    label: 'Info',
    containerClass: 'border-blue-200/70 bg-gradient-to-br from-blue-50/80 via-white to-white',
    accentBarClass: 'bg-blue-400/80',
    iconWrapperClass: 'bg-blue-100 text-blue-600',
    headlineClass: 'text-blue-700',
    chipClass: 'bg-blue-100 text-blue-700'
  },
}

const PAGE_SIZE_OPTIONS = [10, 25, 50]
const DEFAULT_PAGE_SIZE = 10
const MAX_ALERT_LIMIT = 500

const statusStyles = {
  active: 'bg-red-100 text-red-700',
  acknowledged: 'bg-blue-100 text-blue-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  escalated: 'bg-purple-100 text-purple-700',
  default: 'bg-gray-100 text-gray-700'
}

const FiltersSkeleton = () => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center gap-2">
        <div className="h-5 w-5 rounded-full bg-gray-200" />
        <div className="h-4 w-32 rounded bg-gray-200" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="space-y-2">
            <div className="h-4 w-24 rounded bg-gray-200" />
            <div className="h-11 rounded-lg border border-gray-200 bg-gray-100" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-3 border-t border-gray-100">
        <div className="h-4 w-32 rounded bg-gray-200" />
        <div className="h-4 w-24 rounded bg-gray-200" />
      </div>
    </div>
  </div>
)

const SummarySkeleton = () => (
  <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
    {Array.from({ length: 8 }).map((_, index) => (
      <div
        key={index}
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col items-center space-y-2 animate-pulse">
          <div className="h-9 w-16 rounded bg-gray-200" />
          <div className="h-3 w-20 rounded bg-gray-200" />
        </div>
      </div>
    ))}
  </div>
)

const AlertsListSkeleton = () => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-100">
    <div className="p-6 border-b border-gray-200">
      <div className="space-y-2 animate-pulse">
        <div className="h-6 w-40 rounded bg-gray-200" />
        <div className="h-4 w-64 rounded bg-gray-200" />
      </div>
    </div>
    <div className="p-6 space-y-4">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="relative overflow-hidden rounded-xl border border-gray-200 p-5"
        >
          <div className="absolute left-0 top-0 h-full w-1 bg-gray-200" aria-hidden="true" />
          <div className="space-y-4 animate-pulse">
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gray-200" />
              <div className="h-4 w-32 rounded bg-gray-200" />
              <div className="h-4 w-20 rounded bg-gray-200" />
              <div className="h-4 w-16 rounded bg-gray-200" />
            </div>
            <div className="h-3 w-3/4 rounded bg-gray-200" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, childIndex) => (
                <div key={childIndex} className="space-y-2">
                  <div className="h-3 w-20 rounded bg-gray-200" />
                  <div className="h-8 rounded bg-gray-100" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
)

const formatAlertType = (value) => {
  if (!value) return 'Unknown'
  return value
    .toString()
    .split(/[_-]/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

const formatDateTime = (value) => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const formatNumber = (value) => {
  if (value === null || value === undefined) return '—'
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return '—'
  if (Number.isInteger(numeric)) return numeric.toString()
  if (Math.abs(numeric) >= 100) return numeric.toLocaleString()
  return numeric.toFixed(2)
}

const formatRelativeTime = (value) => {
  if (!value) return '—'
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return '—'

  const diff = Date.now() - timestamp.getTime()
  if (diff < 0) return 'Just now'

  const minutes = Math.floor(diff / (1000 * 60))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`

  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`

  const years = Math.floor(days / 365)
  return `${years}y ago`
}

const LEGACY_LOCATION_CODES = {
  jamshedpur: 'HOUSTON-001',
  sanand: 'DALLAS-001',
  pune: 'AUSTIN-001',
}

const LOCATION_LABELS = {
  jamshedpur: 'Houston',
  sanand: 'Dallas',
  pune: 'Austin',
}

const createLocationLookup = (plants = []) => {
  const map = {}

  const addKey = (key, meta) => {
    if (!key) return
    map[String(key).toLowerCase()] = meta
  }

  plants.forEach((plant) => {
    if (!plant) return
    const meta = {
      id: plant.id,
      code: plant.code,
      name: plant.name,
    }

    addKey(plant.id, meta)
    addKey(plant.code, meta)
    addKey(plant.name, meta)
    addKey(plant.location, meta)
    addKey(plant.city, meta)
    addKey(plant.state, meta)

    Object.entries(LEGACY_LOCATION_CODES).forEach(([slug, code]) => {
      if (code === plant.code) {
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

const getLocationMeta = (location, locationMap = {}) => {
  if (!location || location === 'all') return null

  if (typeof location === 'object') {
    const directId = location.plant_id || location.id
    if (directId || location.plant_code) {
      return {
        id: directId ? Number(directId) : undefined,
        code: location.plant_code,
        name: location.name || location.plant_name,
      }
    }
  }

  const normalized = String(location).toLowerCase()
  return locationMap[normalized] || null
}

const formatShopType = (shopType) => {
  if (!shopType) return 'Unknown'
  return shopType
    .toString()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function Alerts() {
  const { location, timeRange } = useFilterStore()
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [shopFilter, setShopFilter] = useState('all')
  const [shops, setShops] = useState([])
  const [shopsLoading, setShopsLoading] = useState(true)
  const [locationMap, setLocationMap] = useState({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [actionResult, setActionResult] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showActionModal, setShowActionModal] = useState(false)
  const [showEscalateModal, setShowEscalateModal] = useState(false)
  const [actionModalConfig, setActionModalConfig] = useState({ type: '', alertId: null, alertTitle: '' })
  const [escalateModalConfig, setEscalateModalConfig] = useState({ alertId: null, alertTitle: '' })
  const [actionNote, setActionNote] = useState('')
  const [escalateFormData, setEscalateFormData] = useState({
    escalation_level: 1,
    escalated_to: '',
    escalation_type: 'technical',
    notes: ''
  })
  const [createFormData, setCreateFormData] = useState({
    machine_id: '',
    alert_type: '',
    severity: 'warning',
    title: '',
    description: '',
    trigger_value: '',
    threshold_value: '',
    threshold_type: '',
    sla_minutes: '60'
  })

  // Check if user can manage alerts
  const canManageAlerts = ['operator', 'supervisor', 'manager', 'admin'].includes(user?.role)

  // Mutations for alert actions
  const acknowledgeMutation = useMutation({
    mutationFn: ({ alertId, note }) => alertsAPI.acknowledge(alertId, note),
    onSuccess: () => {
      queryClient.invalidateQueries(['alerts'])
      setActionResult({ type: 'success', message: 'Alert acknowledged successfully' })
      setShowActionModal(false)
      setActionNote('')
      setTimeout(() => setActionResult(null), 3000)
    },
    onError: (error) => {
      setActionResult({ type: 'error', message: error.response?.data?.detail || 'Failed to acknowledge alert' })
      setTimeout(() => setActionResult(null), 5000)
    }
  })

  const resolveMutation = useMutation({
    mutationFn: ({ alertId, note }) => alertsAPI.resolve(alertId, note),
    onSuccess: () => {
      queryClient.invalidateQueries(['alerts'])
      setActionResult({ type: 'success', message: 'Alert resolved successfully' })
      setShowActionModal(false)
      setActionNote('')
      setTimeout(() => setActionResult(null), 3000)
    },
    onError: (error) => {
      setActionResult({ type: 'error', message: error.response?.data?.detail || 'Failed to resolve alert' })
      setTimeout(() => setActionResult(null), 5000)
    }
  })

  const escalateMutation = useMutation({
    mutationFn: ({ alertId, data }) => alertsAPI.escalate(alertId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['alerts'])
      setActionResult({ type: 'success', message: 'Alert escalated successfully' })
      setShowEscalateModal(false)
      setEscalateFormData({
        escalation_level: 1,
        escalated_to: '',
        escalation_type: 'technical',
        notes: ''
      })
      setTimeout(() => setActionResult(null), 3000)
    },
    onError: (error) => {
      setActionResult({ type: 'error', message: error.response?.data?.detail || 'Failed to escalate alert' })
      setTimeout(() => setActionResult(null), 5000)
    }
  })

  const createMutation = useMutation({
    mutationFn: (data) => alertsAPI.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['alerts'])
      setActionResult({ type: 'success', message: 'Alert created successfully' })
      setShowCreateModal(false)
      setCreateFormData({
        machine_id: '',
        alert_type: '',
        severity: 'warning',
        title: '',
        description: '',
        trigger_value: '',
        threshold_value: '',
        threshold_type: '',
        sla_minutes: '60'
      })
      setTimeout(() => setActionResult(null), 3000)
    },
    onError: (error) => {
      setActionResult({ type: 'error', message: error.response?.data?.detail || 'Failed to create alert' })
      setTimeout(() => setActionResult(null), 5000)
    }
  })

  // Action handlers
  const handleAcknowledge = (alertId, alertTitle) => {
    setActionModalConfig({ type: 'acknowledge', alertId, alertTitle })
    setShowActionModal(true)
  }

  const handleResolve = (alertId, alertTitle) => {
    setActionModalConfig({ type: 'resolve', alertId, alertTitle })
    setShowActionModal(true)
  }

  const handleEscalate = (alertId, alertTitle) => {
    setEscalateModalConfig({ alertId, alertTitle })
    setShowEscalateModal(true)
  }

  const handleActionSubmit = () => {
    if (actionModalConfig.type === 'acknowledge') {
      acknowledgeMutation.mutate({ alertId: actionModalConfig.alertId, note: actionNote })
    } else if (actionModalConfig.type === 'resolve') {
      resolveMutation.mutate({ alertId: actionModalConfig.alertId, note: actionNote })
    }
  }

  const handleCreateSubmit = () => {
    const data = {
      ...createFormData,
      machine_id: parseInt(createFormData.machine_id),
      trigger_value: parseFloat(createFormData.trigger_value) || null,
      threshold_value: parseFloat(createFormData.threshold_value) || null,
      sla_minutes: parseInt(createFormData.sla_minutes) || 60,
    }
    createMutation.mutate(data)
  }

  const handleEscalateSubmit = () => {
    const data = {
      escalation_level: parseInt(escalateFormData.escalation_level),
      escalated_to: parseInt(escalateFormData.escalated_to),
      escalation_type: escalateFormData.escalation_type,
      notes: escalateFormData.notes || null,
    }
    escalateMutation.mutate({ alertId: escalateModalConfig.alertId, data })
  }

  // Map location to plant code for WebSocket
  const plantCode = useMemo(() => {
    if (!location || location === 'all') return null
    const locationCodes = {
      'jamshedpur': 'HOUSTON-001',
      'pune': 'AUSTIN-001',
      'sanand': 'DALLAS-001',
    }
    return locationCodes[location]
  }, [location])

  // Map timeRange to days for WebSocket
  const days = useMemo(() => {
    if (!timeRange) return null
    const timeRangeToDays = {
      '1h': 1,
      '24h': 1,
      '7d': 7,
      '30d': 30
    }
    return timeRangeToDays[timeRange] || null
  }, [timeRange])

  // Get shop ID from shopFilter (if not 'all')
  const shopId = useMemo(() => {
    if (!shopFilter || shopFilter === 'all') return null
    // Extract numeric shop ID from shopFilter
    const numericId = parseInt(shopFilter)
    return isNaN(numericId) ? null : numericId
  }, [shopFilter])

  // Real-time alerts via WebSocket with all filters
  const { alerts: liveAlerts, summary: liveSummary, isConnected, timestamp: wsTimestamp } = useAlertsWebSocket(
    null,      // plantId
    plantCode, // plantCode for location filtering
    shopId,    // shopId for shop filtering
    null,      // shopType (not used in Alerts page, uses shopId instead)
    days       // days for time range filtering
  )

  const locationMeta = useMemo(() => getLocationMeta(location, locationMap), [location, locationMap])
  const locationLabel = useMemo(() => {
    if (!location || location === 'all') return null
    if (typeof location === 'string') {
      return LOCATION_LABELS[location] || location.charAt(0).toUpperCase() + location.slice(1)
    }
    return locationMeta?.name || locationMeta?.code || null
  }, [location, locationMeta])

  const fetchShops = async () => {
    try {
      setShopsLoading(true)
      const hierarchyRes = await plantsAPI.getHierarchy()
      const hierarchy = hierarchyRes.data && Array.isArray(hierarchyRes.data) ? hierarchyRes.data : []

      const lookup = createLocationLookup(hierarchy)
      setLocationMap((prev) => (areLocationMapsEqual(prev, lookup) ? prev : lookup))

      const activeMeta = getLocationMeta(location, lookup)
      const activePlantId = activeMeta?.id
      const activePlantCode = activeMeta?.code

      const aggregatedShops = new Map()

      hierarchy.forEach((plant) => {
        const includePlant = (!activePlantId && !activePlantCode)
          || (activePlantId && plant.id === activePlantId)
          || (activePlantCode && plant.code === activePlantCode)

        if (!includePlant || !Array.isArray(plant.shops)) {
          return
        }

        plant.shops.forEach((shop) => {
          const rawId = shop?.shop_id ?? shop?.id
          if (rawId === undefined || rawId === null) {
            return
          }

          const formattedType = formatShopType(shop?.shop_type)
          const plantName = plant.name || 'Unknown Plant'
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

  // Fetch shops when location changes
  useEffect(() => {
    fetchShops()
    setShopFilter('all')
    setPage(1)
  }, [location]) // eslint-disable-line react-hooks/exhaustive-deps

  const filterParams = useMemo(() => {
    const params = {}

    if (location) {
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

    // Use page size from UI table for better performance
    // Fetch slightly more than one page to handle filtering/searching
    params.limit = Math.min(pageSize * 3, MAX_ALERT_LIMIT)

    return params
  }, [location, timeRange, locationMeta, shopFilter, pageSize])

  const filterParamsKey = useMemo(() => JSON.stringify(filterParams), [filterParams])

  // Disable REST API polling since we use WebSocket for real-time updates
  const shouldEnableAPI = false // WebSocket provides real-time data
  
  const { data: apiAlerts, isLoading: apiAlertsLoading } = useQuery({
    queryKey: ['alerts', 'list', filterParamsKey],
    queryFn: async () => {
      const response = await alertsAPI.getAll(filterParams)
      return response.data
    },
    enabled: shouldEnableAPI,
    staleTime: Infinity, // Data stays fresh since WebSocket provides updates
    retry: 3,
  })

  // Fetch summary data (WebSocket provides real-time updates)
  const { data: apiSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ['alerts', 'summary', filterParamsKey],
    queryFn: async () => {
      const response = await alertsAPI.getSummary(filterParams)
      return response.data
    },
    enabled: false, // Disabled - WebSocket provides real-time summary
    staleTime: Infinity,
  })

  // Use WebSocket summary if connected and available, otherwise use API summary
  const summary = useMemo(() => {
    if (isConnected && liveSummary) {
      return liveSummary
    }
    if (apiSummary) {
      return apiSummary
    }
    return null
  }, [isConnected, liveSummary, apiSummary])

  // Use live alerts from WebSocket, fallback to REST API
  const alerts = useMemo(() => {
    // Prefer WebSocket data if connected and has data
    if (isConnected && liveAlerts && liveAlerts.length > 0) {
      return liveAlerts
    }
    
    // Fallback to API data
    if (apiAlerts && Array.isArray(apiAlerts) && apiAlerts.length > 0) {
      return apiAlerts
    }
    
    // No data available
    return []
  }, [isConnected, liveAlerts, apiAlerts]) // eslint-disable-line react-hooks/exhaustive-deps
  
  const alertsLoading = apiAlertsLoading && liveAlerts.length === 0

  // Filter alerts based on search and filters
  const filteredAlerts = useMemo(() => {
    return alerts?.filter(alert => {
      const normalizedQuery = searchQuery.trim().toLowerCase()
      const haystack = [
        alert.machine_code,
        alert.machine_name,
        alert.alert_type,
        alert.title,
        alert.description,
        alert.id ?? alert.alert_id,
        alert.status,
        alert.severity,
      ]
        .filter(Boolean)
        .map((value) => value.toString().toLowerCase())

      const matchesSearch = normalizedQuery === '' || haystack.some((value) => value.includes(normalizedQuery))

      const severityValue = alert.severity?.toString().toLowerCase()
      const statusValue = alert.status?.toString().toLowerCase()

      let matchesSeverity = true
      if (severityFilter === 'total_active') {
        matchesSeverity = statusValue === 'active'
      } else if (['critical', 'error', 'warning', 'info'].includes(severityFilter)) {
        matchesSeverity = severityValue === severityFilter
      } else if (severityFilter === 'sla_breached') {
        matchesSeverity = alert.sla_breached === true || alert.is_sla_breached === true
      } else if (severityFilter === 'acknowledged') {
        matchesSeverity = statusValue === 'acknowledged'
      } else if (severityFilter === 'unacknowledged') {
        matchesSeverity = statusValue === 'active' && statusValue !== 'acknowledged'
      }

      const matchesShop = shopFilter === 'all' || String(alert.shop_id) === shopFilter

      return matchesSearch && matchesSeverity && matchesShop
    }) || []
  }, [alerts, searchQuery, severityFilter, shopFilter])

  const paginatedAlerts = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredAlerts.slice(start, start + pageSize)
  }, [filteredAlerts, page, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / pageSize))

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  // Count alerts by severity and status
  const severityCounts = {
    all: alerts?.length || 0,
    total_active: summary?.total_active || 0,
    critical: alerts?.filter(a => a.severity === 'critical').length || 0,
    error: alerts?.filter(a => a.severity === 'error').length || 0,
    warning: alerts?.filter(a => a.severity === 'warning').length || 0,
    info: alerts?.filter(a => a.severity === 'info').length || 0,
    sla_breached: summary?.sla_breached || 0,
    acknowledged: summary?.acknowledged || 0,
    unacknowledged: summary?.unacknowledged || 0,
  }

  // Fetch available machines for create form
  const { data: machinesData } = useQuery({
    queryKey: ['machines', 'all'],
    queryFn: () => machinesAPI.getAll({ limit: 500 }),
    enabled: showCreateModal,
  })

  const availableMachines = machinesData?.data || []

  // Fetch available users for escalation (supervisors, managers, admins)
  const { data: usersData } = useQuery({
    queryKey: ['users', 'escalation'],
    queryFn: async () => {
      const response = await authAPI.getUsers()
      return response.data
    },
    enabled: showEscalateModal,
  })

  const availableUsers = usersData || []

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
          <p className="text-sm text-gray-500 mt-0.5">System alerts and notifications</p>
        </div>
        <div className="flex items-center gap-3">
          {canManageAlerts && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
            >
              <PlusCircleIcon className="w-5 h-5" />
              Create Alert
            </button>
          )}
          <LocationFilter />
          <TimeRangeFilter />
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
        </div>
      </div>

      {/* Action Result Message */}
      {actionResult && (
        <div className={clsx(
          "p-4 rounded-lg border",
          actionResult.type === 'success' ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
        )}>
          <div className="flex items-center gap-2">
            {actionResult.type === 'success' ? (
              <CheckCircleIcon className="w-5 h-5" />
            ) : (
              <ExclamationCircleIcon className="w-5 h-5" />
            )}
            <p className="font-medium">{actionResult.message}</p>
          </div>
        </div>
      )}

      {/* Filters bar - Independent Loading */}
      {shopsLoading ? (
        <FiltersSkeleton />
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
                Search Alerts
              </label>
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by machine or alert..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setPage(1)
                  }}
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

            {/* Severity filter */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Filter By
              </label>
              <select
                value={severityFilter}
                onChange={(e) => {
                  setSeverityFilter(e.target.value)
                  setPage(1)
                }}
                className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              >
                <option value="all">All Alerts ({severityCounts.all})</option>
                <option value="total_active">Total Active ({severityCounts.total_active})</option>
                <optgroup label="Severity">
                  <option value="critical">Critical ({severityCounts.critical})</option>
                  <option value="error">Error ({severityCounts.error})</option>
                  <option value="warning">Warning ({severityCounts.warning})</option>
                  <option value="info">Info ({severityCounts.info})</option>
                </optgroup>
                <optgroup label="Status">
                  <option value="sla_breached">SLA Breached ({severityCounts.sla_breached})</option>
                  <option value="acknowledged">Acknowledged ({severityCounts.acknowledged})</option>
                  <option value="unacknowledged">Unacknowledged ({severityCounts.unacknowledged})</option>
                </optgroup>
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
                  setPage(1)
                }}
                className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              >
                <option value="all">
                  {location === 'all' || !locationLabel
                    ? 'All Workshops (All Locations)'
                    : `All Workshops (${locationLabel})`}
                </option>
                {shops.map(shop => (
                  <option key={shop.id} value={shop.id}>
                    {shop.displayName || shop.type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active filters and clear button */}
          {(searchQuery || severityFilter !== 'all' || shopFilter !== 'all') && (
            <div className="flex items-center justify-between pt-3 border-t border-gray-200">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">
                  {[searchQuery !== '', severityFilter !== 'all', shopFilter !== 'all'].filter(Boolean).length}
                </span>
                <span>
                  active filter{[searchQuery !== '', severityFilter !== 'all', shopFilter !== 'all'].filter(Boolean).length !== 1 ? 's' : ''}
                </span>
              </div>
              <button
                onClick={() => {
                  setSearchQuery('')
                  setSeverityFilter('all')
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

      {/* Summary Cards - Progressive Loading */}
      {summaryLoading ? (
        <SummarySkeleton />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          {/* Total Active */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-gray-900 mb-1">{summary?.total_active || 0}</p>
              <p className="text-sm text-gray-600 font-medium">Total Active</p>
            </div>
          </div>

          {/* Critical */}
          <div className="bg-red-50 rounded-xl shadow-sm border border-red-100 p-5 hover:shadow-md transition-shadow">
            <div className="flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-red-600 mb-1">{summary?.critical || 0}</p>
              <p className="text-sm text-red-700 font-medium">Critical</p>
            </div>
          </div>

          {/* Error */}
          <div className="bg-orange-50 rounded-xl shadow-sm border border-orange-100 p-5 hover:shadow-md transition-shadow">
            <div className="flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-orange-600 mb-1">{summary?.error || 0}</p>
              <p className="text-sm text-orange-700 font-medium">Error</p>
            </div>
          </div>

          {/* Warning */}
          <div className="bg-yellow-50 rounded-xl shadow-sm border border-yellow-100 p-5 hover:shadow-md transition-shadow">
            <div className="flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-yellow-600 mb-1">{summary?.warning || 0}</p>
              <p className="text-sm text-yellow-700 font-medium">Warning</p>
            </div>
          </div>

          {/* Info */}
          <div className="bg-blue-50 rounded-xl shadow-sm border border-blue-100 p-5 hover:shadow-md transition-shadow">
            <div className="flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-blue-600 mb-1">{summary?.info || 0}</p>
              <p className="text-sm text-blue-700 font-medium">Info</p>
            </div>
          </div>

          {/* Acknowledged */}
          <div className="bg-green-50 rounded-xl shadow-sm border border-green-100 p-5 hover:shadow-md transition-shadow">
            <div className="flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-green-600 mb-1">{summary?.acknowledged || 0}</p>
              <p className="text-sm text-green-700 font-medium">Acknowledged</p>
            </div>
          </div>

          {/* Unacknowledged */}
          <div className="bg-gray-50 rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-gray-700 mb-1">{summary?.unacknowledged || 0}</p>
              <p className="text-sm text-gray-600 font-medium">Unacknowledged</p>
            </div>
          </div>

          {/* SLA Breached */}
          <div className="bg-red-50 rounded-xl shadow-sm border border-red-100 p-5 hover:shadow-md transition-shadow">
            <div className="flex flex-col items-center text-center">
              <p className="text-4xl font-bold text-red-600 mb-1">{summary?.sla_breached || 0}</p>
              <p className="text-sm text-red-700 font-medium">SLA Breached</p>
            </div>
          </div>
        </div>
      )}

      {/* Alerts List - Progressive Loading */}
      {alertsLoading ? (
        <AlertsListSkeleton />
      ) : (
      <div className="bg-white rounded-lg shadow-sm border border-gray-100">
        <div className="p-6 border-b border-gray-200">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Alerts ({filteredAlerts.length})</h2>
              <p className="text-sm text-gray-500 mt-1">
                Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, filteredAlerts.length)} of {filteredAlerts.length}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">Page size</span>
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value))
                    setPage(1)
                  }}
                  className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page === 1}
                  className={clsx(
                    'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors',
                    page === 1
                      ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  )}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
                <span className="text-sm font-medium text-gray-600">
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page === totalPages}
                  className={clsx(
                    'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors',
                    page === totalPages
                      ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  )}
                  aria-label="Next page"
                >
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="p-6">
          {filteredAlerts.length > 0 ? (
            <div className="space-y-4">
              {paginatedAlerts.map((alert) => {
                const severity = alert.severity || 'warning'
                const config = severityConfig[severity] || severityConfig.warning
                const Icon = config.icon

                return (
                  <div
                    key={alert.id || alert.alert_id}
                    className={clsx(
                      'relative overflow-hidden rounded-xl border p-5 transition-all hover:shadow-lg',
                      config.containerClass
                    )}
                  >
                    <div className={clsx('absolute left-0 top-0 h-full w-1', config.accentBarClass)} aria-hidden="true" />
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex flex-1 flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={clsx('inline-flex h-10 w-10 items-center justify-center rounded-full', config.iconWrapperClass)}>
                            <Icon className="h-5 w-5" />
                          </span>
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className={clsx('text-base font-semibold leading-tight', config.headlineClass)}>
                                {formatAlertType(alert.alert_type)}
                              </p>
                              <span className={clsx('px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide', statusStyles[alert.status] || statusStyles.default)}>
                                {alert.status || 'Unknown'}
                              </span>
                              {alert.severity && (
                                <span className={clsx('px-2.5 py-0.5 rounded-full text-xs font-medium capitalize', config.chipClass)}>
                                  {alert.severity}
                                </span>
                              )}
                              {alert.sla_breached && (
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide bg-rose-100 text-rose-700">
                                  SLA Breached
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600 mt-1 max-w-2xl">
                              {alert.title || alert.description || alert.message || 'No description provided.'}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 text-sm text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
                          <div className="space-y-1">
                            <p className="font-medium text-gray-700">Machine</p>
                            <Link
                              to={`/machines/${alert.machine_id}`}
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              <TagIcon className="h-4 w-4" />
                              {alert.machine_code || 'Unknown'}
                              {alert.machine_name ? ` • ${alert.machine_name}` : ''}
                            </Link>
                          </div>

                          <div className="space-y-1">
                            <p className="font-medium text-gray-700">Triggered</p>
                            <div className="flex flex-col">
                              <span>{formatDateTime(alert.triggered_at || alert.created_at)}</span>
                              <span className="text-xs text-gray-500">{formatRelativeTime(alert.triggered_at || alert.created_at)}</span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="font-medium text-gray-700">SLA Deadline</p>
                            <div className="flex flex-col">
                              <span>{formatDateTime(alert.sla_deadline)}</span>
                              <span className="text-xs text-gray-500">{formatRelativeTime(alert.sla_deadline)}</span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="font-medium text-gray-700">Threshold</p>
                            <div className="flex items-center gap-3 text-sm">
                              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-slate-700">
                                <InformationCircleIcon className="h-4 w-4" />
                                Target {formatNumber(alert.threshold_value)}
                              </span>
                              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-amber-700">
                                Current {formatNumber(alert.trigger_value)}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="font-medium text-gray-700">Location</p>
                            <div className="flex flex-wrap gap-2 text-sm">
                              {alert.plant_name && (
                                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">{alert.plant_name}</span>
                              )}
                              {alert.shop_name && (
                                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">{alert.shop_name}</span>
                              )}
                              {alert.line_name && (
                                <span className="rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">{alert.line_name}</span>
                              )}
                            </div>
                          </div>

                          <div className="space-y-1">
                            <p className="font-medium text-gray-700">Lifecycle</p>
                            <div className="flex flex-col gap-1 text-sm">
                              <span>Created: {formatDateTime(alert.created_at)}</span>
                              <span>Acknowledged: {formatDateTime(alert.acknowledged_at)}</span>
                              <span>Resolved: {formatDateTime(alert.resolved_at)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        {canManageAlerts && alert.status !== 'resolved' && (
                          <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-200">
                            {alert.status === 'active' && (
                              <>
                                <button
                                  onClick={() => handleAcknowledge(alert.id || alert.alert_id, alert.title)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors text-sm font-medium"
                                >
                                  <CheckCircleIcon className="w-4 h-4" />
                                  Acknowledge
                                </button>
                                <button
                                  onClick={() => handleEscalate(alert.id || alert.alert_id, alert.title)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-sm font-medium"
                                >
                                  <ArrowUpCircleIcon className="w-4 h-4" />
                                  Escalate
                                </button>
                              </>
                            )}
                            {(alert.status === 'active' || alert.status === 'acknowledged' || alert.status === 'escalated') && (
                              <button
                                onClick={() => handleResolve(alert.id || alert.alert_id, alert.title)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors text-sm font-medium"
                              >
                                <CheckCircleIcon className="w-4 h-4" />
                                Resolve
                              </button>
                            )}
                            {alert.status === 'acknowledged' && (
                              <button
                                onClick={() => handleEscalate(alert.id || alert.alert_id, alert.title)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition-colors text-sm font-medium"
                              >
                                <ArrowUpCircleIcon className="w-4 h-4" />
                                Escalate
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-3 text-sm text-gray-600 lg:w-48">
                        <div className="rounded-lg border border-gray-200 bg-white/70 p-3 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Identifiers</p>
                          <div className="mt-2 space-y-1">
                            <p>
                              <span className="text-gray-500">Alert ID: </span>
                              <span className="font-medium text-gray-700">{alert.id || alert.alert_id}</span>
                            </p>
                            {alert.source_event_id && (
                              <p>
                                <span className="text-gray-500">Event ID: </span>
                                <span className="font-medium text-gray-700">{alert.source_event_id}</span>
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-white/70 p-3 shadow-sm">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Metrics</p>
                          <div className="mt-2 space-y-1">
                            <p>
                              <span className="text-gray-500">Trigger: </span>
                              <span className="font-medium text-gray-700">{formatNumber(alert.trigger_value)}</span>
                            </p>
                            <p>
                              <span className="text-gray-500">Threshold: </span>
                              <span className="font-medium text-gray-700">{formatNumber(alert.threshold_value)}</span>
                            </p>
                            {alert.threshold_type && (
                              <p>
                                <span className="text-gray-500">Type: </span>
                                <span className="font-medium text-gray-700">{formatAlertType(alert.threshold_type)}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <CheckCircleIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg font-medium">No alerts found</p>
              <p className="text-gray-400 text-sm mt-1">
                {searchQuery || severityFilter !== 'all' || shopFilter !== 'all' 
                  ? 'Try adjusting your filters'
                  : 'All systems operating normally'}
              </p>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Action Modal (Acknowledge/Resolve) */}
      {showActionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">
                {actionModalConfig.type === 'acknowledge' ? 'Acknowledge Alert' : 'Resolve Alert'}
              </h2>
              <button
                onClick={() => {
                  setShowActionModal(false)
                  setActionNote('')
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 font-medium">{actionModalConfig.alertTitle}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Note (Optional)
                </label>
                <textarea
                  value={actionNote}
                  onChange={(e) => setActionNote(e.target.value)}
                  placeholder="Add a note about this action..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-400"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowActionModal(false)
                    setActionNote('')
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleActionSubmit}
                  disabled={acknowledgeMutation.isPending || resolveMutation.isPending}
                  className={clsx(
                    "flex-1 px-4 py-2 rounded-lg font-medium transition-colors",
                    actionModalConfig.type === 'acknowledge'
                      ? "bg-blue-600 text-white hover:bg-blue-700"
                      : "bg-green-600 text-white hover:bg-green-700",
                    (acknowledgeMutation.isPending || resolveMutation.isPending) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {acknowledgeMutation.isPending || resolveMutation.isPending
                    ? 'Processing...'
                    : actionModalConfig.type === 'acknowledge'
                    ? 'Acknowledge'
                    : 'Resolve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Escalate Modal */}
      {showEscalateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Escalate Alert</h2>
              <button
                onClick={() => {
                  setShowEscalateModal(false)
                  setEscalateFormData({
                    escalation_level: 1,
                    escalated_to: '',
                    escalation_type: 'technical',
                    notes: ''
                  })
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 font-medium">{escalateModalConfig.alertTitle}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Escalation Level
                </label>
                <select
                  value={escalateFormData.escalation_level}
                  onChange={(e) => setEscalateFormData({ ...escalateFormData, escalation_level: e.target.value })}
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                >
                  <option value={1}>Level 1</option>
                  <option value={2}>Level 2</option>
                  <option value={3}>Level 3</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Escalate To *
                </label>
                <select
                  value={escalateFormData.escalated_to}
                  onChange={(e) => setEscalateFormData({ ...escalateFormData, escalated_to: e.target.value })}
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  required
                >
                  <option value="">Select a user</option>
                  {availableUsers
                    .filter(u => ['supervisor', 'manager', 'admin'].includes(u.role))
                    .map(user => (
                      <option key={user.id} value={user.id}>
                        {user.full_name || user.username} ({user.role})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Escalation Type
                </label>
                <select
                  value={escalateFormData.escalation_type}
                  onChange={(e) => setEscalateFormData({ ...escalateFormData, escalation_type: e.target.value })}
                  className="w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                >
                  <option value="technical">Technical</option>
                  <option value="managerial">Managerial</option>
                  <option value="operational">Operational</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  value={escalateFormData.notes}
                  onChange={(e) => setEscalateFormData({ ...escalateFormData, notes: e.target.value })}
                  placeholder="Additional notes for escalation"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-6 border-t border-gray-200 mt-6">
              <button
                onClick={() => setShowEscalateModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleEscalateSubmit}
                disabled={escalateMutation.isPending || !escalateFormData.escalated_to}
                className={clsx(
                  "flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium",
                  (escalateMutation.isPending || !escalateFormData.escalated_to) && "opacity-50 cursor-not-allowed"
                )}
              >
                {escalateMutation.isPending ? 'Escalating...' : 'Escalate Alert'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Alert Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 my-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-900">Create New Alert</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Machine *
                  </label>
                  <select
                    value={createFormData.machine_id}
                    onChange={(e) => setCreateFormData({ ...createFormData, machine_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900"
                    required
                  >
                    <option value="">Select a machine</option>
                    {availableMachines.map(machine => (
                      <option key={machine.id} value={machine.id}>
                        {machine.code} - {machine.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Severity *
                  </label>
                  <select
                    value={createFormData.severity}
                    onChange={(e) => setCreateFormData({ ...createFormData, severity: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900"
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Alert Type *
                </label>
                <select
                  value={createFormData.alert_type}
                  onChange={(e) => setCreateFormData({ ...createFormData, alert_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900"
                  required
                >
                  <option value="">Select alert type</option>
                  <option value="temperature_high">Temperature High</option>
                  <option value="temperature_low">Temperature Low</option>
                  <option value="vibration_excessive">Vibration Excessive</option>
                  <option value="pressure_high">Pressure High</option>
                  <option value="pressure_low">Pressure Low</option>
                  <option value="power_consumption_high">Power Consumption High</option>
                  <option value="cycle_time_exceeded">Cycle Time Exceeded</option>
                  <option value="quality_defect">Quality Defect</option>
                  <option value="maintenance_required">Maintenance Required</option>
                  <option value="error_rate_high">Error Rate High</option>
                  <option value="downtime_unplanned">Downtime Unplanned</option>
                  <option value="safety_violation">Safety Violation</option>
                  <option value="material_shortage">Material Shortage</option>
                  <option value="tool_wear">Tool Wear</option>
                  <option value="calibration_required">Calibration Required</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Title *
                </label>
                <input
                  type="text"
                  value={createFormData.title}
                  onChange={(e) => setCreateFormData({ ...createFormData, title: e.target.value })}
                  placeholder="Brief alert title"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-400"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={createFormData.description}
                  onChange={(e) => setCreateFormData({ ...createFormData, description: e.target.value })}
                  placeholder="Detailed description of the alert"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-400"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Trigger Value
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={createFormData.trigger_value}
                    onChange={(e) => setCreateFormData({ ...createFormData, trigger_value: e.target.value })}
                    placeholder="Current value"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Threshold Value
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={createFormData.threshold_value}
                    onChange={(e) => setCreateFormData({ ...createFormData, threshold_value: e.target.value })}
                    placeholder="Threshold"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    SLA (minutes)
                  </label>
                  <input
                    type="number"
                    value={createFormData.sla_minutes}
                    onChange={(e) => setCreateFormData({ ...createFormData, sla_minutes: e.target.value })}
                    placeholder="60"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Threshold Type
                </label>
                <select
                  value={createFormData.threshold_type}
                  onChange={(e) => setCreateFormData({ ...createFormData, threshold_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900"
                >
                  <option value="">Select threshold type</option>
                  <option value="above">Above (Greater Than)</option>
                  <option value="below">Below (Less Than)</option>
                  <option value="equals">Equals</option>
                  <option value="not_equals">Not Equals</option>
                  <option value="between">Between Range</option>
                  <option value="outside">Outside Range</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-6 border-t border-gray-200 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSubmit}
                disabled={createMutation.isPending || !createFormData.machine_id || !createFormData.alert_type || !createFormData.title}
                className={clsx(
                  "flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium",
                  (createMutation.isPending || !createFormData.machine_id || !createFormData.alert_type || !createFormData.title) && "opacity-50 cursor-not-allowed"
                )}
              >
                {createMutation.isPending ? 'Creating...' : 'Create Alert'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Alerts