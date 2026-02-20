import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth-storage')
    if (token) {
      try {
        const parsed = JSON.parse(token)
        if (parsed.state?.token) {
          config.headers.Authorization = `Bearer ${parsed.state.token}`
        }
      } catch {
        // Ignore parse errors
      }
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Only redirect on 401 if NOT on login/auth endpoints
    const isAuthEndpoint = error.config?.url?.includes('/auth/')
    
    if (error.response?.status === 401 && !isAuthEndpoint) {
      localStorage.removeItem('auth-storage')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api

// API service functions
export const authAPI = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  register: (data) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
  getUsers: () => api.get('/auth/users'),
}

export const plantsAPI = {
  getAll: () => api.get('/plants'),
  getById: (id) => api.get(`/plants/${id}`),
  getHierarchy: () => api.get('/plants/hierarchy'),
  getShops: (plantId) => api.get(`/plants/${plantId}/shops`),
  getLines: (shopId) => api.get(`/plants/shops/${shopId}/lines`),
}

// Helper function to transform filters into API parameters
const transformFilters = (filters = {}) => {
  const { location, timeRange, ...rest } = filters || {}
  const params = { ...rest }

  // Transform location filter
  if (location && location !== 'all') {
    // Map location names to plant codes (matching the database codes)
    const plantCodes = {
      'houston': 'HOUSTON-001',
      'dallas': 'DALLAS-001',
      'austin': 'AUSTIN-001'
    }
    if (plantCodes[location]) {
      params.plant_code = plantCodes[location]
    }
  }
  
  // Transform time range filter
  if (timeRange) {
    // Map time ranges to days parameter
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
  
  return params
}

export const machinesAPI = {
  getAll: (params = {}) => {
    // Accept params directly (e.g., { plant_code: 'HOUSTON-001' })
    // Do NOT transform - params should be passed as-is to the API
    return api.get('/machines', { params })
  },
  getById: (id) => api.get(`/machines/${id}`),
  getSummary: (params = {}) => {
    // Accept params directly - no transformation
    return api.get('/machines/summary', { params })
  },
  getStatusBoard: (params = {}) => {
    // Accept params directly - no transformation
    return api.get('/machines/status-board', { params })
  },
  getStateHistory: (id, limit) => api.get(`/machines/${id}/states`, { params: { limit } }),
  getHeartbeats: (id, hours) => api.get(`/machines/${id}/heartbeats`, { params: { hours } }),
}

export const telemetryAPI = {
  getMachineTelemetry: (machineId, params) => api.get(`/telemetry/machine/${machineId}`, { params }),
  getLatest: (machineId) => api.get(`/telemetry/machine/${machineId}/latest`),
  getAggregates: (params) => api.get('/telemetry/aggregates', { params }),
  getLatestSummary: (params) => api.get('/telemetry/latest/summary', { params }),
  getPaintColorDistribution: (params) => api.get('/telemetry/paint/color-distribution', { params }),
}

export const alertsAPI = {
  getAll: (filters) => {
    // Don't transform filters - pass them directly to the API
    // The alerts API only accepts: plant_id, plant_code, shop_id, severity, status, limit, etc.
    const { timeRange: _timeRange, location, ...params } = filters || {}
    
    // Only include recognized parameters
    if (location && location !== 'all') {
      const plantCodes = {
        'houston': 'HOUSTON-001',
        'dallas': 'DALLAS-001',
        'austin': 'AUSTIN-001'
      }
      if (plantCodes[location]) {
        params.plant_code = plantCodes[location]
      }
    }
    
    return api.get('/alerts', { params })
  },
  getSummary: (filters) => {
    // Don't transform filters - pass them directly to the API
    const { timeRange: _tr, location, ...params } = filters || {}
    
    // Only include recognized parameters
    if (location && location !== 'all') {
      const plantCodes = {
        'houston': 'HOUSTON-001',
        'dallas': 'DALLAS-001',
        'austin': 'AUSTIN-001'
      }
      if (plantCodes[location]) {
        params.plant_code = plantCodes[location]
      }
    }
    
    return api.get('/alerts/summary', { params })
  },
  getById: (id) => api.get(`/alerts/${id}`),
  acknowledge: (id, note) => api.post(`/alerts/${id}/acknowledge`, { note }),
  resolve: (id, note) => api.post(`/alerts/${id}/resolve`, { note }),
  escalate: (id, data) => api.post(`/alerts/${id}/escalate`, data),
  create: (data) => api.post('/alerts', data),
  getMachineHistory: (machineId, days) => api.get(`/alerts/machine/${machineId}/history`, { params: { days } }),
  getEscalations: (id) => api.get(`/alerts/${id}/escalations`),
}

export const kpisAPI = {
  getOEE: (filters) => {
    const params = filters ? transformFilters(filters) : {}
    return api.get('/kpis/oee', { params })
  },
  getProduction: (filters) => {
    const params = filters ? transformFilters(filters) : {}
    return api.get('/kpis/production', { params })
  },
  getDowntime: (filters) => {
    const params = filters ? transformFilters(filters) : {}
    return api.get('/kpis/downtime', { params })
  },
  getEnergy: (filters) => {
    const params = filters ? transformFilters(filters) : {}
    return api.get('/kpis/energy', { params })
  },
  getReliability: (filters) => {
    const params = filters ? transformFilters(filters) : {}
    return api.get('/kpis/reliability', { params })
  },
  getShiftKPIs: (filters) => {
    const params = filters ? transformFilters(filters) : {}
    return api.get('/kpis/shift', { params })
  },
  getDashboardOverview: (params = {}) => {
    // Accept params directly - no transformation
    return api.get('/kpis/dashboard/overview', { params })
  },
}

export const forecastsAPI = {
  getAll: (params) => api.get('/forecasts', { params }),
  getFailureProbability: (params) => api.get('/forecasts/failure-probability', { params }),
  getProductionForecast: (params) => api.get('/forecasts/production-forecast', { params }),
  getEnergyDemand: (params) => api.get('/forecasts/energy-demand', { params }),
  getMachineForecasts: (machineId) => api.get(`/forecasts/machine/${machineId}`),
  getRiskSummary: (params) => api.get('/forecasts/risk-summary', { params }),
}

export const dashboardComponentsAPI = {
  getWorkshopInsights: (workshop, params = {}) => api.get('/dashboard/workshop-insights', {
    params: { workshop, ...params },
  }),
}

export const controlsAPI = {
  sendCommand: (machineId, command) => api.post(`/controls/${machineId}/command`, command),
  sendBulkCommand: (bulkCommand) => api.post('/controls/bulk-command', bulkCommand),
  getHistory: (machineId, limit) => api.get(`/controls/${machineId}/history`, { params: { limit } }),
  getAuditLog: (params) => api.get('/controls/audit-log', { params }),
}

export const tickerAPI = {
  getEvents: (params) => api.get('/ticker/events', { params }),
  getStream: (params) => api.get('/ticker/events/stream', { params }),
  getSummary: (params) => api.get('/ticker/summary', { params }),
  getMachineStates: (params) => api.get('/ticker/machine-states', { params }),
  acknowledge: (eventId) => api.post(`/ticker/${eventId}/acknowledge`),
}

export const dashboardsAPI = {
  getAvailable: (params) => api.get('/dashboards', { params }),
  getCategories: () => api.get('/dashboards/categories'),
  getEmbed: (dashboardId, params) => api.get(`/dashboards/${dashboardId}/embed`, { params }),
  getWorkshop: (shopType) => api.get(`/dashboards/workshop/${shopType}`),
  getByRole: (role) => api.get(`/dashboards/role/${role}`),
}
