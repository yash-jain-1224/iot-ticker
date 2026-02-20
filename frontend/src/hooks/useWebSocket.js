import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAuthStore } from '../store/authStore'

const WS_URL = import.meta.env.VITE_API_URL?.replace('http', 'ws') || 'ws://localhost:8000'

/**
 * Custom hook for WebSocket connection with auto-reconnect
 * @param {string} endpoint - WebSocket endpoint path
 * @param {object} params - Query parameters for the WebSocket connection
 * @param {object} options - Additional options (e.g., { enabled: boolean })
 */
function useWebSocket(endpoint, params = {}, options = {}) {
  const { enabled = true } = options
  const [data, setData] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState(null)
  const wsRef = useRef(null)
  const reconnectTimeoutRef = useRef(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectDelayRef = useRef(3000)
  const connectionStateRef = useRef('disconnected')
  const maxReconnectAttempts = 5
  const maxReconnectDelay = 30000
  const shouldReconnectRef = useRef(true)

  const { token } = useAuthStore()

  const paramsString = useMemo(() => JSON.stringify(params), [params])

  const cleanup = useCallback(() => {
    // Clear reconnection timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    // Close WebSocket if open
    if (wsRef.current) {
      const ws = wsRef.current
      ws.onopen = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close(1000, 'Component unmounting')
        } catch { /* ignore */ }
      }

      wsRef.current = null
    }

    setIsConnected(false)
    connectionStateRef.current = 'disconnected'
  }, [])

  const connect = useCallback((force = false) => {
    // Prevent multiple connections (unless forced)
    if (!force && (connectionStateRef.current === 'connecting' || connectionStateRef.current === 'connected')) {
      return
    }

    // Cleanup existing connection first
    cleanup()
    connectionStateRef.current = 'connecting'

    try {
      // Build query params from memoized string
      const parsedParams = JSON.parse(paramsString)
      const queryParams = new URLSearchParams()
      if (token) queryParams.append('token', token)
      Object.entries(parsedParams).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== 'undefined') {
          queryParams.append(key, value)
        }
      })

      // Fix WebSocket URL - backend expects /ws not /api/ws
      const wsUrl = `${WS_URL}/ws${endpoint}?${queryParams.toString()}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setIsConnected(true)
        connectionStateRef.current = 'connected'
        setError(null)
        reconnectAttemptsRef.current = 0
        reconnectDelayRef.current = 3000 // Reset delay on successful connection
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)

          // Handle server-requested reconnect
          if (message.type === 'reconnect') {
            ws.close(1000, 'Server requested reconnect')
            return
          }

          // Handle ping
          if (message.type === 'ping') {
            // Respond with pong
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'pong' }))
            }
            return
          }

          setData(message)
        } catch { /* ignore malformed messages */ }
      }

      ws.onerror = () => {
        setError('WebSocket connection error')
        connectionStateRef.current = 'disconnected'
      }

      ws.onclose = (event) => {
        setIsConnected(false)
        connectionStateRef.current = 'disconnected'
        wsRef.current = null

        // Auto-reconnect logic (only if not a normal closure)
        if (shouldReconnectRef.current && event.code !== 1000) {
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            reconnectAttemptsRef.current += 1
            const delay = Math.min(reconnectDelayRef.current, maxReconnectDelay)

            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectDelayRef.current *= 1.5 // Exponential backoff
              connect()
            }, delay)
          } else {
            setError('Failed to connect after multiple attempts')
          }
        }
      }
    } catch (err) {
      setError(err.message)
      connectionStateRef.current = 'disconnected'
    }
  }, [endpoint, token, paramsString, cleanup])

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false
    cleanup()
  }, [cleanup])

  // Effect for initial connection and cleanup
  useEffect(() => {
    // Only connect if enabled
    if (!enabled) {
      return
    }

    shouldReconnectRef.current = true
    // Force reconnect when params change
    connect(true)

    // CRITICAL: Cleanup on unmount
    return () => {
      shouldReconnectRef.current = false
      cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, token, paramsString, enabled]) // Only reconnect when these change

  return { data, isConnected, error, reconnect: connect, disconnect }
}

// Export as both default and named export
export default useWebSocket
export { useWebSocket }

/**
 * Hook for machine states WebSocket
 */
export function useMachineStatesWebSocket(plantId = null, shopType = null, plantCode = null) {
  const params = {}
  if (plantId) params.plant_id = plantId
  if (plantCode) params.plant_code = plantCode
  if (shopType) params.shop_type = shopType

  const { data, isConnected, error } = useWebSocket('/machines', params)

  return {
    machines: data?.machines || [],
    timestamp: data?.timestamp,
    isConnected,
    error,
  }
}

/**
 * Hook for telemetry WebSocket for a specific machine
 */
export function useTelemetryWebSocket(machineId) {
  const { data, isConnected, error } = useWebSocket(`/telemetry/${machineId}`)

  const [telemetry, setTelemetry] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    if (data) {
      if (data.type === 'initial' && data.history) {
        setHistory(data.history)
        if (data.history.length > 0) {
          setTelemetry(data.history[0])
        }
      } else if (data.type === 'telemetry' && data.data) {
        setTelemetry(data.data)
        setHistory(prev => [data.data, ...prev].slice(0, 50))
      }
    }
  }, [data])

  return { telemetry, history, isConnected, error }
}

/**
 * Hook for shop telemetry WebSocket (environmental conditions, color distribution)
 */
export function useShopTelemetryWebSocket(plantId = null, plantCode = null, shopType = null) {
  const params = {}
  if (plantId) params.plant_id = plantId
  if (plantCode) params.plant_code = plantCode
  if (shopType) params.shop_type = shopType

  const { data, isConnected, error } = useWebSocket('/telemetry', params)

  const [environmentalConditions, setEnvironmentalConditions] = useState(null)
  const [colorDistribution, setColorDistribution] = useState(null)

  useEffect(() => {
    if (data?.type === 'update') {
      if (data.environmental_conditions) setEnvironmentalConditions(data.environmental_conditions)
      if (data.color_distribution) setColorDistribution(data.color_distribution)
    }
  }, [data])

  return {
    environmentalConditions,
    colorDistribution,
    isConnected,
    error,
    timestamp: data?.timestamp,
  }
}

/**
 * Hook for alerts WebSocket
 */
export function useAlertsWebSocket(plantId = null, plantCode = null, shopId = null, shopType = null, days = null) {
  const params = {}
  if (plantId) params.plant_id = plantId
  if (plantCode) params.plant_code = plantCode
  if (shopId) params.shop_id = shopId
  if (shopType) params.shop_type = shopType
  if (days) params.days = days

  const { data, isConnected, error } = useWebSocket('/alerts', params)

  const [alerts, setAlerts] = useState([])
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    if (data) {
      if (data.type === 'initial' || data.type === 'update') {
        if (data.alerts) setAlerts(data.alerts)
        if (data.summary) setSummary(data.summary)
      } else if (data.type === 'alert_update' && data.alert) {
        setAlerts(prevAlerts => {
          const alertIndex = prevAlerts.findIndex(a => a.id === data.alert.id)
          if (alertIndex !== -1) {
            const newAlerts = [...prevAlerts]
            newAlerts[alertIndex] = { ...newAlerts[alertIndex], ...data.alert }
            return newAlerts
          }
          return [data.alert, ...prevAlerts]
        })
        setSummary(prev => prev)
      }
    }
  }, [data])

  return { alerts, summary, isConnected, error, timestamp: data?.timestamp }
}

/**
 * Hook for ticker events WebSocket
 */
export function useTickerWebSocket(plantId = null, shopType = null) {
  const params = {}
  if (plantId) params.plant_id = plantId
  if (shopType) params.shop_type = shopType

  const { data, isConnected, error } = useWebSocket('/ticker', params)

  const [events, setEvents] = useState([])

  useEffect(() => {
    if (data) {
      if (data.type === 'initial' && data.events) {
        setEvents(data.events)
      } else if (data.type === 'update' && data.events) {
        setEvents(prev => [...data.events, ...prev].slice(0, 100))
      }
    }
  }, [data])

  return { events, isConnected, error }
}

/**
 * Hook for forecasts WebSocket
 */
export function useForecastsWebSocket(plantId = null, plantCode = null, shopType = null, shopId = null, horizon = '7d') {
  const params = {}
  if (plantId) params.plant_id = plantId
  if (plantCode) params.plant_code = plantCode
  if (shopType) params.shop_type = shopType
  if (shopId) params.shop_id = shopId
  if (horizon) params.horizon = horizon

  const { data, isConnected, error } = useWebSocket('/forecasts', params)

  const [riskSummary, setRiskSummary] = useState(null)
  const [failureProbabilities, setFailureProbabilities] = useState([])
  const [productionForecast, setProductionForecast] = useState(null)
  const [energyDemand, setEnergyDemand] = useState(null)

  useEffect(() => {
    if (data && (data.type === 'initial' || data.type === 'update')) {
      if (data.risk_summary) {
        setRiskSummary({
          summary: data.risk_summary,
          total_forecasts: Object.values(data.risk_summary).reduce((sum, val) => sum + val, 0),
          critical_items: data.critical_items || [],
        })
      }
      if (data.failure_probabilities) setFailureProbabilities(data.failure_probabilities)
      if (data.production_forecast) {
        setProductionForecast(Array.isArray(data.production_forecast) && data.production_forecast.length > 0 ? data.production_forecast : null)
      }
      if (data.energy_demand) {
        setEnergyDemand(Array.isArray(data.energy_demand) && data.energy_demand.length > 0 ? data.energy_demand : null)
      }
    }
  }, [data])

  return { riskSummary, failureProbabilities, productionForecast, energyDemand, isConnected, error, timestamp: data?.timestamp }
}

/**
 * Hook for single machine state WebSocket
 */
export function useMachineStateWebSocket(machineId) {
  const { data, isConnected, error } = useWebSocket('/machines', { machine_id: machineId })

  const [machineState, setMachineState] = useState(null)

  useEffect(() => {
    if (data?.machines) {
      const machine = data.machines.find(m => m.machine_id === parseInt(machineId))
      if (machine) setMachineState(machine)
    }
  }, [data, machineId])

  return { machineState, isConnected, error, timestamp: data?.timestamp }
}

/**
 * Hook for machine alerts WebSocket
 */
export function useMachineAlertsWebSocket(machineId) {
  const { data, isConnected, error } = useWebSocket('/alerts', {})

  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    if (data) {
      if (data.type === 'initial' || data.type === 'update') {
        if (data.alerts) {
          setAlerts(data.alerts.filter(a => a.machine_id === parseInt(machineId)))
        }
      } else if (data.type === 'alert_update' && data.alert?.machine_id === parseInt(machineId)) {
        setAlerts(prevAlerts => {
          const alertIndex = prevAlerts.findIndex(a => a.id === data.alert.id)
          if (alertIndex !== -1) {
            const newAlerts = [...prevAlerts]
            newAlerts[alertIndex] = { ...newAlerts[alertIndex], ...data.alert }
            return newAlerts
          }
          return [data.alert, ...prevAlerts]
        })
      }
    }
  }, [data, machineId])

  return { alerts, isConnected, error }
}

/**
 * Hook for machine forecasts WebSocket
 */
export function useMachineForecastsWebSocket(machineId) {
  const { data, isConnected, error } = useWebSocket('/forecasts', {})

  const [forecasts, setForecasts] = useState([])

  useEffect(() => {
    if (data && (data.type === 'initial' || data.type === 'update') && data.failure_probabilities) {
      const machineForecasts = data.failure_probabilities
        .filter(f => f.machine_id === parseInt(machineId))
        .map(f => ({
          forecast_type: 'failure_probability',
          prediction_value: f.failure_probability * 100,
          confidence_score: f.confidence * 100,
          risk_level: f.risk_level,
          prediction_horizon: f.prediction_horizon,
          valid_until: f.valid_until,
          recommendations: f.recommendations,
          explanation: f.explanation,
          machine_id: f.machine_id,
        }))
      setForecasts(machineForecasts)
    }
  }, [data, machineId])

  return { forecasts, isConnected, error }
}

/**
 * Hook for workshop insights WebSocket
 */
export function useWorkshopInsightsWebSocket(shopType = null, plantId = null, plantCode = null) {
  const params = {}
  if (shopType) params.shop_type = shopType
  if (plantId) params.plant_id = plantId
  if (plantCode) params.plant_code = plantCode

  const { data, isConnected, error } = useWebSocket('/workshop-insights', params)

  const [productionPipeline, setProductionPipeline] = useState([])
  const [assemblyStations, setAssemblyStations] = useState([])
  const [qualityMetrics, setQualityMetrics] = useState(null)
  const [torqueTools, setTorqueTools] = useState([])
  const [powerDistribution, setPowerDistribution] = useState(null)
  const [waterTreatment, setWaterTreatment] = useState(null)
  const [wasteManagement, setWasteManagement] = useState(null)
  const [hvacSystems, setHvacSystems] = useState([])
  const [utilityOEE, setUtilityOEE] = useState(null)
  const [machineStatusCounts, setMachineStatusCounts] = useState(null)

  useEffect(() => {
    if (data && (data.type === 'update' || data.type === 'initial')) {
      if (data.production_pipeline) setProductionPipeline(data.production_pipeline)
      if (data.assembly_stations) setAssemblyStations(data.assembly_stations)
      if (data.quality_metrics) setQualityMetrics(data.quality_metrics)
      if (data.torque_tools) setTorqueTools(data.torque_tools)
      if (data.power_distribution) setPowerDistribution(data.power_distribution)
      if (data.water_treatment) setWaterTreatment(data.water_treatment)
      if (data.waste_management) setWasteManagement(data.waste_management)
      if (data.hvac_systems) setHvacSystems(data.hvac_systems)
      if (data.utility_oee) setUtilityOEE(data.utility_oee)
      if (data.machine_status_counts) setMachineStatusCounts(data.machine_status_counts)
    }
  }, [data])

  return {
    productionPipeline, assemblyStations, qualityMetrics, torqueTools,
    powerDistribution, waterTreatment, wasteManagement, hvacSystems,
    utilityOEE, machineStatusCounts, isConnected, error, timestamp: data?.timestamp,
  }
}

/**
 * Hook for KPIs WebSocket
 */
export function useKpisWebSocket(plantId = null, plantCode = null, shopType = null) {
  const params = {}
  if (plantId) params.plant_id = plantId
  if (plantCode) params.plant_code = plantCode
  if (shopType) params.shop_type = shopType

  const { data, isConnected, error } = useWebSocket('/kpis', params)

  const [kpis, setKpis] = useState(null)
  const [machinesSummary, setMachinesSummary] = useState(null)
  const [alertsSummary, setAlertsSummary] = useState(null)

  useEffect(() => {
    if (data?.type === 'update') {
      if (data.kpis) setKpis(data.kpis)
      if (data.machines) setMachinesSummary(data.machines)
      if (data.alerts) setAlertsSummary(data.alerts)
    }
  }, [data])

  return { kpis, machinesSummary, alertsSummary, isConnected, error, timestamp: data?.timestamp }
}
