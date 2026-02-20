import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useWebSocket } from './useWebSocket'
import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Custom hook for dashboard data with hybrid REST API + WebSocket approach
 *
 * Strategy:
 * 1. Initial load: Use REST API (fast, cacheable, reliable)
 * 2. Real-time updates: Use WebSocket (live, efficient)
 * 3. Merge WebSocket updates with REST data
 */
export function useDashboardData(dashboardType, apiParams = {}, wsParams = {}) {
  const [mergedData, setMergedData] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [apiDataLoaded, setApiDataLoaded] = useState(false)

  const apiEndpoint = dashboardType === 'manager'
    ? '/api/analytics/manager'
    : '/api/analytics/leadership'

  const wsEndpoint = dashboardType === 'manager'
    ? '/manager-dashboard'
    : '/leadership-dashboard'

  // Step 1: Load initial data via REST API
  const {
    data: apiResponse,
    isLoading: apiLoading,
    isError: apiError,
    error: apiErrorObj,
    refetch,
  } = useQuery({
    queryKey: [dashboardType, 'dashboard', ...Object.values(apiParams)],
    queryFn: async () => {
      const response = await axios.get(`${API_BASE_URL}${apiEndpoint}`, { params: apiParams })
      return response.data
    },
    staleTime: 60_000,
  })

  useEffect(() => {
    if (apiResponse && !apiDataLoaded) {
      setMergedData(apiResponse?.data || apiResponse)
      if (apiResponse?.timestamp) setLastUpdated(new Date(apiResponse.timestamp))
      setApiDataLoaded(true)
    }
  }, [apiResponse, dashboardType, apiDataLoaded])

  // Step 2: Subscribe to WebSocket updates (only after initial load)
  const {
    data: wsData,
    isConnected,
    error: wsError,
  } = useWebSocket(wsEndpoint, wsParams, { enabled: apiDataLoaded })

  // Step 3: Merge WebSocket updates with existing data
  useEffect(() => {
    if (!wsData || !apiDataLoaded) return

    if (wsData.timestamp) setLastUpdated(new Date(wsData.timestamp))

    if (wsData.type === 'initial') {
      if (!mergedData && wsData.data) setMergedData(wsData.data)
    } else if (wsData.type === 'update' && wsData.data) {
      setMergedData(prevData => mergeDeep(prevData, wsData.data))
    }
  }, [wsData, dashboardType]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data: mergedData,
    isLoading: apiLoading && !mergedData,
    isError: apiError,
    error: apiErrorObj,
    refetch,
    isConnected,
    wsError,
    lastUpdated,
    dataSource: mergedData ? (isConnected ? 'api+ws' : 'api') : null,
  }
}

/**
 * Deep merge two objects (helper function)
 * @param {object} target - Target object
 * @param {object} source - Source object to merge
 * @returns {object} Merged object
 */
function mergeDeep(target, source) {
  if (!source) return target
  if (!target) return source

  const output = { ...target }

  for (const key in source) {
    if (source[key] instanceof Object && key in target) {
      // Recursively merge objects
      output[key] = mergeDeep(target[key], source[key])
    } else if (Array.isArray(source[key])) {
      // For arrays, replace entirely (don't merge)
      output[key] = source[key]
    } else {
      // For primitives, replace
      output[key] = source[key]
    }
  }

  return output
}
