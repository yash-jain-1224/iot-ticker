import { useState, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { machinesAPI, telemetryAPI, alertsAPI, forecastsAPI, controlsAPI } from '../services/api'
import { 
  useTelemetryWebSocket, 
  useMachineStateWebSocket, 
  useMachineAlertsWebSocket,
  useMachineForecastsWebSocket 
} from '../hooks/useWebSocket'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'
import ConfirmationModal from '../components/ConfirmationModal'
import clsx from 'clsx'
import {
  ArrowLeftIcon,
  CpuChipIcon,
  BoltIcon,
  ClockIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  WrenchScrewdriverIcon,
  PlayIcon,
  StopIcon,
  ArrowPathIcon,
  SignalIcon,
} from '@heroicons/react/24/outline'
import { AlertCardSkeleton, ForecastCardSkeleton } from '../components/skeletons'
import logger from '../utils/logger'

const statusColors = {
  online: 'bg-green-500',
  offline: 'bg-gray-400',
  idle: 'bg-yellow-500',
  fault: 'bg-red-500',
  maintenance: 'bg-purple-500',
}

// Helper function to safely format dates
const formatDate = (dateString) => {
  if (!dateString) return 'N/A'
  try {
    const date = new Date(dateString)
    if (isNaN(date.getTime())) return 'Invalid Date'
    return date.toLocaleString()
  } catch (error) {
    return 'Invalid Date'
  }
}

// Helper function to get alert severity badge colors
const getSeverityColors = (severity) => {
  const colors = {
    critical: {
      bg: 'bg-red-50',
      border: 'border-red-500',
      badge: 'bg-red-200 text-red-800',
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-500',
      badge: 'bg-red-200 text-red-800',
    },
    warning: {
      bg: 'bg-orange-50',
      border: 'border-orange-500',
      badge: 'bg-orange-200 text-orange-800',
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-500',
      badge: 'bg-blue-200 text-blue-800',
    },
    low: {
      bg: 'bg-green-50',
      border: 'border-green-500',
      badge: 'bg-green-200 text-green-800',
    },
  }
  return colors[severity?.toLowerCase()] || colors.info
}

export default function MachineDetail() {
  const { id: machineId } = useParams()
  const { user } = useAuthStore()
  const [machine, setMachine] = useState(null)
  const [telemetry, setTelemetry] = useState([])
  const [_latestTelemetry, setLatestTelemetry] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [forecasts, setForecasts] = useState([])
  const [controlHistory, setControlHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [sendingCommand, setSendingCommand] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  
  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    command: null,
    params: {},
    title: '',
    message: '',
    type: 'warning',
  })
  
  // Initialize activeTab from URL parameter (default to 'overview')
  const validTabs = ['overview', 'telemetry', 'alerts', 'forecasts', 'controls']
  const tabFromUrl = searchParams.get('tab')
  const initialTab = validTabs.includes(tabFromUrl) ? tabFromUrl : 'overview'
  const [activeTab, setActiveTab] = useState(initialTab)

  // Real-time WebSocket connections
  const { telemetry: liveTelemetry, history: telemetryHistory, isConnected: telemetryConnected } = useTelemetryWebSocket(machineId)
  const { machineState: liveMachineState, isConnected: stateConnected, timestamp: stateTimestamp } = useMachineStateWebSocket(machineId)
  const { alerts: liveAlerts, isConnected: alertsConnected } = useMachineAlertsWebSocket(machineId)
  const { forecasts: liveForecasts, isConnected: forecastsConnected } = useMachineForecastsWebSocket(machineId)

  // Combined connection status
  const isLiveConnected = telemetryConnected || stateConnected || alertsConnected || forecastsConnected

  useEffect(() => {
    fetchMachineData()
  }, [machineId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update with live telemetry
  useEffect(() => {
    if (liveTelemetry) {
      setLatestTelemetry(liveTelemetry)
    }
  }, [liveTelemetry])

  // Update telemetry history from WebSocket
  useEffect(() => {
    if (telemetryHistory && telemetryHistory.length > 0) {
      setTelemetry(telemetryHistory)
    }
  }, [telemetryHistory])

  // Update machine state from WebSocket
  useEffect(() => {
    if (liveMachineState && machine) {
      setMachine(prev => ({
        ...prev,
        current_state: {
          status: liveMachineState.status,
          health_score: liveMachineState.health_score,
          fault_code: liveMachineState.fault_code,
          fault_message: liveMachineState.fault_message,
          current_load: liveMachineState.current_load,
          temperature: liveMachineState.temperature,
          vibration: liveMachineState.vibration,
          power_consumption: liveMachineState.power_consumption,
          current_cycle: liveMachineState.current_cycle,
          cycle_count: liveMachineState.cycle_count,
        }
      }))
    }
  }, [liveMachineState]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update alerts from WebSocket
  useEffect(() => {
    if (liveAlerts && liveAlerts.length >= 0) {
      setAlerts(liveAlerts)
    }
  }, [liveAlerts])

  // Update forecasts from WebSocket
  useEffect(() => {    
    if (liveForecasts && liveForecasts.length >= 0) {
      setForecasts(liveForecasts)
    }
  }, [liveForecasts, forecastsConnected, machineId])

  const fetchMachineData = async () => {
    try {
      setLoading(true)
      const [machineRes, telemetryRes, alertsRes, forecastsRes, historyRes] = await Promise.all([
        machinesAPI.getById(machineId),
        telemetryAPI.getMachineTelemetry(machineId, { hours: 24 }),
        alertsAPI.getMachineHistory(machineId, 7),
        forecastsAPI.getMachineForecasts(machineId),
        controlsAPI.getHistory(machineId, 20),
      ])

      setMachine(machineRes.data)
      setTelemetry(telemetryRes.data || [])
      setLatestTelemetry(telemetryRes.data?.[0] || null)
      setAlerts(alertsRes.data || [])
      setForecasts(forecastsRes.data || [])
      setControlHistory(historyRes.data || [])
    } catch (error) {
      logger.error('Error fetching machine data:', error)
      toast.error('Failed to load machine data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Handle tab change with URL persistence
  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setSearchParams({ tab }, { replace: true })
  }

  // Open confirmation modal
  const openConfirmModal = (command, params = {}) => {
    // Define modal content based on command type
    const modalConfig = {
      start: {
        title: 'Start Machine',
        message: `Are you sure you want to start ${machine?.name || 'this machine'}? This will begin machine operations.`,
        type: 'info',
      },
      stop: {
        title: 'Stop Machine',
        message: `Are you sure you want to stop ${machine?.name || 'this machine'}? This will halt all machine operations.`,
        type: 'warning',
      },
      emergency_stop: {
        title: 'Emergency Stop',
        message: `⚠️ EMERGENCY STOP: This will immediately halt ${machine?.name || 'this machine'}. Use only in emergency situations. Are you absolutely sure?`,
        type: 'danger',
      },
      reset_alarm: {
        title: 'Reset Alarm',
        message: `Are you sure you want to reset the alarm for ${machine?.name || 'this machine'}?`,
        type: 'warning',
      },
      acknowledge: {
        title: 'Acknowledge Alert',
        message: `Acknowledge the current alert for ${machine?.name || 'this machine'}?`,
        type: 'info',
      },
      maintenance: {
        title: 'Enter Maintenance Mode',
        message: `Are you sure you want to put ${machine?.name || 'this machine'} into maintenance mode? This will take the machine offline for maintenance.`,
        type: 'warning',
      },
    }

    const config = modalConfig[command] || {
      title: 'Confirm Action',
      message: `Are you sure you want to execute this command on ${machine?.name || 'this machine'}?`,
      type: 'warning',
    }

    setConfirmModal({
      isOpen: true,
      command,
      params,
      ...config,
    })
  }

  // Close confirmation modal
  const closeConfirmModal = () => {
    if (!sendingCommand) {
      setConfirmModal({
        isOpen: false,
        command: null,
        params: {},
        title: '',
        message: '',
        type: 'warning',
      })
    }
  }

  // Execute command after confirmation
  const executeCommand = async () => {
    const { command, params } = confirmModal
    await sendCommand(command, params)
    closeConfirmModal()
  }

  const sendCommand = async (command, params = {}) => {
    if (!canControl) {
      toast.error('You do not have permission to control machines')
      return
    }

    try {
      setSendingCommand(true)
      
      // Show loading toast
      const loadingToast = toast.loading(`Sending ${command.replace(/_/g, ' ')} command...`)
      
      await controlsAPI.sendCommand(machineId, { 
        action: command, 
        parameters: params 
      })
      
      // Dismiss loading toast and show success
      toast.dismiss(loadingToast)
      toast.success(`Command "${command.replace(/_/g, ' ')}" sent successfully!`)
      
      // Refresh data
      await fetchMachineData()
    } catch (error) {
      logger.error('Error sending command:', error)
      
      // Extract error message from response
      const errorMessage = error.response?.data?.detail || 
                          error.response?.data?.message || 
                          error.message || 
                          'Failed to send command'
      
      toast.error(errorMessage)
    } finally {
      setSendingCommand(false)
    }
  }

  // Check if user can control machines
  const canControl = ['operator', 'supervisor', 'manager', 'admin'].includes(user?.role)

  if (loading) {
    return <MachineDetailSkeleton />
  }

  if (!machine) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Machine not found</p>
        <Link to="/machines" className="mt-4 text-auronix-blue hover:underline">
          Back to machines
        </Link>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={closeConfirmModal}
        onConfirm={executeCommand}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
        confirmText={
          confirmModal.command === 'emergency_stop' ? 'Emergency Stop' :
          confirmModal.command === 'stop' ? 'Stop Machine' :
          confirmModal.command === 'start' ? 'Start Machine' :
          'Confirm'
        }
        isLoading={sendingCommand}
      />
      
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/machines"
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <span className={clsx('w-4 h-4 rounded-full', statusColors[machine.current_state?.status || 'offline'])} />
              <h1 className="text-2xl font-bold text-gray-900">
                {machine.code} – {machine.name}
              </h1>
              <span className={clsx(
                'px-3 py-1 rounded-full text-sm font-medium capitalize',
                machine.current_state?.status === 'online' && 'bg-green-100 text-green-700',
                machine.current_state?.status === 'offline' && 'bg-gray-100 text-gray-700',
                machine.current_state?.status === 'idle' && 'bg-yellow-100 text-yellow-700',
                machine.current_state?.status === 'fault' && 'bg-red-100 text-red-700',
                machine.current_state?.status === 'maintenance' && 'bg-purple-100 text-purple-700',
              )}>
                {machine.current_state?.status || 'unknown'}
              </span>
            </div>
            <p className="text-gray-600 mt-1">
              <span className="capitalize">{machine.machine_type?.replace(/_/g, ' ') || 'N/A'}</span>
              {machine.manufacturer && <> | {machine.manufacturer}</>}
              {machine.model && <> - {machine.model}</>}
            </p>
          </div>
        </div>

        {/* Live status and control buttons */}
        <div className="flex items-center gap-3">
          {/* Live connection status */}
          <div className="flex items-center gap-2 text-sm">
            <div className={clsx(
              "flex items-center gap-1.5 px-2 py-1 rounded-full",
              isLiveConnected ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
            )}>
              <SignalIcon className="w-4 h-4" />
              <span className="font-medium">{isLiveConnected ? 'Live' : 'Connecting...'}</span>
            </div>
            {stateTimestamp && (
              <div className="flex items-center gap-1.5 text-gray-500">
                <ClockIcon className="w-4 h-4" />
                <span>{new Date(stateTimestamp).toLocaleTimeString()}</span>
              </div>
            )}
          </div>

          {/* Control buttons */}
          {canControl && machine.is_controllable && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => openConfirmModal('start')}
                disabled={sendingCommand || machine.current_state?.status === 'online'}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all',
                  sendingCommand || machine.current_state?.status === 'online'
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm hover:shadow-md'
                )}
                title={machine.current_state?.status === 'online' ? 'Machine is already running' : 'Start machine'}
              >
                <PlayIcon className="w-4 h-4" />
                Start
              </button>
              <button
                onClick={() => openConfirmModal('stop')}
                disabled={sendingCommand || machine.current_state?.status === 'offline'}
                className={clsx(
                  'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all',
                  sendingCommand || machine.current_state?.status === 'offline'
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-red-600 text-white hover:bg-red-700 shadow-sm hover:shadow-md'
                )}
                title={machine.current_state?.status === 'offline' ? 'Machine is already stopped' : 'Stop machine'}
              >
                <StopIcon className="w-4 h-4" />
                Stop
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6">
          {['overview', 'telemetry', 'alerts', 'forecasts', 'controls'].map(tab => (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={clsx(
                'py-3 px-1 border-b-2 text-sm font-semibold transition-colors capitalize',
                activeTab === tab
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Machine info */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Machine Info</h3>
            {!machine ? (
              <div className="space-y-3 animate-pulse">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-4 w-24 bg-gray-200 rounded" />
                    <div className="h-4 w-32 bg-gray-200 rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-gray-600">Code</dt>
                <dd className="font-medium text-gray-900">{machine.code}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Type</dt>
                <dd className="font-medium text-gray-900 capitalize">{machine.machine_type?.replace(/_/g, ' ') || 'N/A'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Manufacturer</dt>
                <dd className="font-medium text-gray-900">{machine.manufacturer || 'N/A'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Model</dt>
                <dd className="font-medium text-gray-900">{machine.model || 'N/A'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Serial Number</dt>
                <dd className="font-medium text-gray-900">{machine.serial_number || 'N/A'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Install Date</dt>
                <dd className="font-medium text-gray-900">
                  {machine.installation_date ? new Date(machine.installation_date).toLocaleDateString() : 'N/A'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Last Heartbeat</dt>
                <dd className="font-medium text-gray-900">
                  {machine.last_heartbeat ? new Date(machine.last_heartbeat).toLocaleString() : 'N/A'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-600">Controllable</dt>
                <dd className="font-medium">
                  <span className={clsx(
                    'px-2 py-0.5 text-xs font-medium rounded-full',
                    machine.is_controllable ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  )}>
                    {machine.is_controllable ? 'Yes' : 'No'}
                  </span>
                </dd>
              </div>
            </dl>
            )}
          </div>

          {/* Live telemetry */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Current State</h3>
            {!machine?.current_state ? (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <TelemetryCardSkeleton />
                  <TelemetryCardSkeleton />
                  <TelemetryCardSkeleton />
                  <TelemetryCardSkeleton />
                </div>
                <div className="mt-4 pt-4 border-t space-y-2 animate-pulse">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="flex justify-between">
                      <div className="h-4 w-24 bg-gray-200 rounded" />
                      <div className="h-4 w-16 bg-gray-200 rounded" />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
              <TelemetryCard
                icon={BoltIcon}
                label="Load"
                value={machine.current_state?.current_load}
                unit="%"
                color="blue"
              />
              <TelemetryCard
                icon={ExclamationTriangleIcon}
                label="Temperature"
                value={machine.current_state?.temperature}
                unit="°C"
                color={machine.current_state?.temperature > 80 ? 'red' : 'yellow'}
              />
              <TelemetryCard
                icon={ChartBarIcon}
                label="Vibration"
                value={machine.current_state?.vibration}
                unit="mm/s"
                color="green"
              />
              <TelemetryCard
                icon={ClockIcon}
                label="Power"
                value={machine.current_state?.power_consumption}
                unit="kW"
                color="purple"
              />
            </div>
            {/* Additional state info */}
            <div className="mt-4 pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Current Cycle</span>
                <span className="font-medium text-gray-900">{machine.current_state?.current_cycle || 0}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Cycle Count</span>
                <span className="font-medium text-gray-900">{machine.current_state?.cycle_count || 0}</span>
              </div>
              {machine.current_state?.fault_code && (
                <div className="pt-2 border-t">
                  <p className="text-sm text-gray-500">Fault Code</p>
                  <p className="font-medium text-red-600">{machine.current_state.fault_code}</p>
                  {machine.current_state.fault_message && (
                    <p className="text-sm text-gray-600 mt-1">{machine.current_state.fault_message}</p>
                  )}
                </div>
              )}
            </div>
            </>
            )}
          </div>

          {/* Health & Predictions */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Health & Predictions</h3>
            {!forecasts ? (
              <div className="space-y-4 animate-pulse">
                {[...Array(3)].map((_, i) => (
                  <div key={i}>
                    <div className="flex justify-between mb-1">
                      <div className="h-4 w-24 bg-gray-200 rounded" />
                      <div className="h-4 w-16 bg-gray-200 rounded" />
                    </div>
                    <div className="h-3 bg-gray-200 rounded-full" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
              {/* Health score */}
              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Health Score</span>
                  <span className="font-medium text-gray-900">{machine.current_state?.health_score?.toFixed(1) || 0}%</span>
                </div>
                <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full transition-all',
                      (machine.current_state?.health_score || 0) >= 80 ? 'bg-green-500' :
                      (machine.current_state?.health_score || 0) >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                    )}
                    style={{ width: `${machine.current_state?.health_score || 0}%` }}
                  />
                </div>
              </div>

              {/* Failure probability from forecasts */}
              {forecasts.length > 0 && (() => {
                const failureForecast = forecasts.find(f => f.forecast_type === 'failure_probability')
                if (failureForecast) {
                  return (
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">Failure Risk</span>
                        <span className={clsx(
                          'font-medium',
                          failureForecast.prediction_value > 50 ? 'text-red-600' :
                          failureForecast.prediction_value > 25 ? 'text-yellow-600' : 'text-green-600'
                        )}>
                          {failureForecast.prediction_value?.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={clsx(
                            'h-full rounded-full transition-all',
                            failureForecast.prediction_value > 50 ? 'bg-red-500' :
                            failureForecast.prediction_value > 25 ? 'bg-yellow-500' : 'bg-green-500'
                          )}
                          style={{ width: `${failureForecast.prediction_value}%` }}
                        />
                      </div>
                    </div>
                  )
                }
              })()}

              {/* Predicted maintenance date */}
              {forecasts.length > 0 && (() => {
                const maintenanceForecast = forecasts.find(f => f.forecast_type === 'predictive_maintenance')
                if (maintenanceForecast?.prediction_value) {
                  return (
                    <div className="pt-4 border-t">
                      <p className="text-sm text-gray-600">Predicted Maintenance</p>
                      <p className="font-semibold text-gray-900">
                        {new Date(maintenanceForecast.prediction_value).toLocaleDateString()}
                      </p>
                      {maintenanceForecast.explanation && (
                        <p className="text-sm text-gray-600 mt-1">{maintenanceForecast.explanation}</p>
                      )}
                    </div>
                  )
                }
              })()}

              {/* State recorded time */}
              {machine.current_state?.recorded_at && (
                <div className="pt-4 border-t text-xs text-gray-500">
                  Last updated: {new Date(machine.current_state.recorded_at).toLocaleString()}
                </div>
              )}
            </div>
            )}
          </div>

          {/* Recent alerts */}
          <div className="lg:col-span-3 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Alerts</h3>
            {!alerts ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <AlertCardSkeleton key={i} />
                ))}
              </div>
            ) : alerts.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No recent alerts</p>
            ) : (
              <div className="space-y-3">
                {alerts.slice(0, 5).map(alert => {
                  const severityColors = getSeverityColors(alert.severity)
                  
                  // Determine status badge based on alert.status field
                  const getStatusBadge = () => {
                    const status = alert.status?.toLowerCase()
                    if (status === 'active') {
                      return { text: 'Active', color: 'text-red-600', bg: 'bg-red-500' }
                    } else if (status === 'acknowledged') {
                      return { text: 'Acknowledged', color: 'text-yellow-600', bg: 'bg-yellow-500' }
                    } else if (status === 'resolved') {
                      return { text: 'Resolved', color: 'text-green-600', bg: 'bg-green-500' }
                    } else {
                      return { text: 'Inactive', color: 'text-gray-500', bg: 'bg-gray-400' }
                    }
                  }
                  
                  const statusBadge = getStatusBadge()
                  
                  return (
                    <div
                      key={alert.id}
                      className={clsx(
                        'p-4 rounded-lg border-l-4',
                        severityColors.bg,
                        severityColors.border
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={clsx(
                            'px-2 py-0.5 text-xs font-medium rounded-full capitalize',
                            severityColors.badge
                          )}>
                            {alert.severity || 'info'}
                          </span>
                          <span className="font-medium text-gray-900">{alert.title || alert.alert_type}</span>
                        </div>
                        <span className="text-sm text-gray-500">
                          {formatDate(alert.triggered_at || alert.created_at)}
                        </span>
                      </div>
                      {alert.description && (
                        <p className="text-sm text-gray-600 mt-2">{alert.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs">
                        <span className={clsx('flex items-center gap-1 font-medium', statusBadge.color)}>
                          <span className={clsx('w-2 h-2 rounded-full', statusBadge.bg)}></span>
                          {statusBadge.text}
                        </span>
                        {alert.duration_minutes != null && (
                          <span className="text-gray-600">
                            Duration: {alert.duration_minutes >= 60 
                              ? `${(alert.duration_minutes / 60).toFixed(1)} hours`
                              : `${alert.duration_minutes.toFixed(0)} minutes`
                            }
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'telemetry' && (
        <TelemetryTab machineId={machineId} telemetry={telemetry} />
      )}

      {activeTab === 'alerts' && (
        <AlertsTab alerts={alerts} />
      )}

      {activeTab === 'forecasts' && (
        <ForecastsTab forecasts={forecasts} machine={machine} />
      )}

      {activeTab === 'controls' && (
        <ControlsTab
          controlHistory={controlHistory}
          canControl={canControl}
          onSendCommand={openConfirmModal}
          sendingCommand={sendingCommand}
        />
      )}
    </div>
  )
}

// Helper components
function TelemetryCard({ icon: Icon, label, value, unit, color }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
  }

  return (
    <div className={clsx('p-4 rounded-lg', colorClasses[color] || colorClasses.blue)}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-xs font-medium opacity-75">{label}</p>
      <p className="text-xl font-bold">
        {value != null ? value.toFixed(1) : '--'}
        <span className="text-sm font-normal ml-1">{unit}</span>
      </p>
    </div>
  )
}

function TelemetryTab({ machineId: _machineId, telemetry }) {
  const [timeRange, setTimeRange] = useState('24h')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [filteredTelemetry, setFilteredTelemetry] = useState([])

  // Time range options
  const timeRangeOptions = [
    { value: '24h', label: 'Last 24 Hours', hours: 24 },
    { value: '7d', label: '7 Days', hours: 168 },
    { value: '14d', label: '14 Days', hours: 336 },
    { value: '30d', label: '30 Days', hours: 720 },
  ]

  // Filter telemetry based on time range - NO LOADING STATE
  useEffect(() => {
    const selectedRange = timeRangeOptions.find(opt => opt.value === timeRange)
    if (selectedRange && telemetry.length > 0) {
      const cutoffTime = new Date()
      cutoffTime.setHours(cutoffTime.getHours() - selectedRange.hours)
      
      const filtered = telemetry.filter(t => {
        const timestamp = new Date(t.timestamp)
        return timestamp >= cutoffTime
      })
      setFilteredTelemetry(filtered)
    } else {
      setFilteredTelemetry(telemetry || [])
    }
  }, [timeRange, telemetry]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset to first page when time range changes
  useEffect(() => {
    setPage(0)
  }, [timeRange])

  // Get quality badge styling
  const getQualityBadge = (quality) => {
    const qualityLower = quality?.toLowerCase()
    const badges = {
      good: { bg: 'bg-green-100', text: 'text-green-700', label: 'Good' },
      fair: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Fair' },
      poor: { bg: 'bg-red-100', text: 'text-red-700', label: 'Poor' },
      bad: { bg: 'bg-red-100', text: 'text-red-700', label: 'Bad' },
      excellent: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Excellent' },
      uncertain: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Uncertain' },
      questionable: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Questionable' },
      invalid: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Invalid' },
      unknown: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Unknown' },
    }
    return badges[qualityLower] || badges.unknown
  }

  // Pagination calculations
  const totalPages = Math.ceil(filteredTelemetry.length / rowsPerPage)
  const startIndex = page * rowsPerPage
  const endIndex = startIndex + rowsPerPage
  const paginatedData = filteredTelemetry.slice(startIndex, endIndex)

  const handleChangePage = (newPage) => {
    setPage(newPage)
  }

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10))
    setPage(0)
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      {/* Header with time range filter */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">Telemetry History</h3>
        
        {/* Time Range Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Time Range:</span>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {timeRangeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setTimeRange(option.value)}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                  timeRange === option.value
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredTelemetry.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No telemetry data available for selected time range</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sensor Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginatedData.map((t, idx) => {
                  const qualityBadge = getQualityBadge(t.quality)
                  return (
                    <tr key={startIndex + idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {new Date(t.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-700 capitalize">
                        {t.sensor_type?.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {typeof t.value === 'number' ? t.value.toFixed(2) : t.value}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{t.unit || '--'}</td>
                      <td className="px-4 py-3">
                        <span className={clsx(
                          'px-2 py-0.5 text-xs font-medium rounded-full',
                          qualityBadge.bg,
                          qualityBadge.text
                        )}>
                          {qualityBadge.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Rows per page:</span>
              <select
                value={rowsPerPage}
                onChange={handleChangeRowsPerPage}
                className="px-3 py-1.5 text-sm text-gray-900 font-medium bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer hover:border-gray-400 transition-colors"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                {startIndex + 1}-{Math.min(endIndex, filteredTelemetry.length)} of {filteredTelemetry.length}
              </span>
              
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleChangePage(0)}
                  disabled={page === 0}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors',
                    page === 0
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                  title="First page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>
                
                <button
                  onClick={() => handleChangePage(page - 1)}
                  disabled={page === 0}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors',
                    page === 0
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                  title="Previous page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <span className="px-3 py-1 text-sm font-medium text-gray-700">
                  {page + 1} / {totalPages || 1}
                </span>

                <button
                  onClick={() => handleChangePage(page + 1)}
                  disabled={page >= totalPages - 1}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors',
                    page >= totalPages - 1
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                  title="Next page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <button
                  onClick={() => handleChangePage(totalPages - 1)}
                  disabled={page >= totalPages - 1}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors',
                    page >= totalPages - 1
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                  title="Last page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function AlertsTab({ alerts }) {
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Simulate loading for smooth transitions
    if (alerts) {
      setTimeout(() => setIsLoading(false), 200)
    }
  }, [alerts])

  if (isLoading || !alerts) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Alert History</h3>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <AlertCardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Alert History</h3>
      {alerts.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No alerts in the past 7 days</p>
      ) : (
        <div className="space-y-4">
          {alerts.map(alert => {
            const severityColors = getSeverityColors(alert.severity)
            
            // Determine status badge color based on status field
            const getStatusBadge = (status) => {
              const badges = {
                active: { bg: 'bg-red-100', text: 'text-red-700' },
                acknowledged: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
                resolved: { bg: 'bg-green-100', text: 'text-green-700' },
                inactive: { bg: 'bg-gray-100', text: 'text-gray-700' },
              }
              return badges[status?.toLowerCase()] || badges.inactive
            }
            
            const statusBadge = getStatusBadge(alert.status)
            
            return (
              <div
                key={alert.id}
                className={clsx(
                  'p-4 rounded-lg border-l-4',
                  severityColors.bg,
                  severityColors.border
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={clsx(
                        'px-2 py-0.5 text-xs font-medium rounded-full capitalize',
                        severityColors.badge
                      )}>
                        {alert.severity || 'info'}
                      </span>
                      <span className="text-xs text-gray-500 uppercase">{alert.alert_type}</span>
                      <span className={clsx(
                        'px-2 py-0.5 text-xs font-medium rounded-full capitalize',
                        statusBadge.bg,
                        statusBadge.text
                      )}>
                        {alert.status || 'unknown'}
                      </span>
                    </div>
                    <h4 className="font-medium text-gray-900">{alert.title}</h4>
                    {alert.description && (
                      <p className="text-sm text-gray-600 mt-1">{alert.description}</p>
                    )}
                    
                    {/* Threshold info */}
                    {(alert.threshold_value != null || alert.actual_value != null) && (
                      <div className="flex gap-4 mt-2 text-xs text-gray-600">
                        {alert.threshold_value != null && (
                          <span>Threshold: {alert.threshold_value}</span>
                        )}
                        {alert.actual_value != null && (
                          <span>Actual: {alert.actual_value}</span>
                        )}
                      </div>
                    )}

                    {/* Date info */}
                    <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-600">
                      {alert.triggered_at && (
                        <div>
                          <span className="font-medium">Triggered:</span>{' '}
                          {formatDate(alert.triggered_at)}
                        </div>
                      )}
                      {alert.acknowledged_at && (
                        <div>
                          <span className="font-medium">Acknowledged:</span>{' '}
                          {alert.acknowledged_by && `${alert.acknowledged_by} on `}
                          {formatDate(alert.acknowledged_at)}
                        </div>
                      )}
                      {alert.resolved_at && (
                        <div>
                          <span className="font-medium">Resolved:</span>{' '}
                          {alert.resolved_by && `${alert.resolved_by} on `}
                          {formatDate(alert.resolved_at)}
                        </div>
                      )}
                    </div>

                    {/* Duration */}
                    {alert.duration_minutes != null && (
                      <div className="text-xs text-gray-600 mt-2">
                        <span className="font-medium">Duration:</span>{' '}
                        {alert.duration_minutes >= 60 
                          ? `${(alert.duration_minutes / 60).toFixed(1)} hours`
                          : `${alert.duration_minutes.toFixed(0)} minutes`
                        }
                      </div>
                    )}

                    {/* Resolution note */}
                    {alert.resolution_note && (
                      <div className="mt-2 p-2 bg-gray-100 rounded text-xs text-gray-700">
                        <span className="font-medium">Resolution:</span> {alert.resolution_note}
                      </div>
                    )}
                  </div>
                  
                  <div className="text-right ml-4">
                    {alert.triggered_at && (
                      <p className="text-sm text-gray-500">
                        {formatDate(alert.triggered_at)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ForecastsTab({ forecasts, machine: _machine }) {
  const [isLoading, setIsLoading] = useState(true)
  const failureForecast = forecasts?.find(f => f.forecast_type === 'failure_probability')
  const maintenanceForecast = forecasts?.find(f => f.forecast_type === 'predictive_maintenance')

  useEffect(() => {
    // Simulate loading for smooth transitions
    if (forecasts !== undefined) {
      setTimeout(() => setIsLoading(false), 200)
    }
  }, [forecasts])

  if (isLoading || forecasts === undefined) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">Predictive Maintenance</h3>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <ForecastCardSkeleton key={i} />
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">All Forecasts</h3>
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="p-4 bg-gray-50 rounded-xl animate-pulse">
                <div className="h-5 w-32 bg-gray-200 rounded mb-3" />
                <div className="space-y-2">
                  <div className="h-4 w-full bg-gray-200 rounded" />
                  <div className="h-4 w-3/4 bg-gray-200 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">Predictive Maintenance</h3>
        {!forecasts || forecasts.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No forecast data available</p>
        ) : (
          <div className="space-y-4">
            {failureForecast && (
              <div className="p-5 bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                <p className="text-sm font-medium text-gray-600 mb-1">Failure Probability</p>
                <p className={clsx(
                  'text-4xl font-bold mt-2 mb-3',
                  (failureForecast.prediction_value || 0) > 50 ? 'text-red-600' :
                  (failureForecast.prediction_value || 0) > 25 ? 'text-yellow-600' : 'text-green-600'
                )}>
                  {failureForecast.prediction_value?.toFixed(1) || 0}%
                </p>
                {failureForecast.risk_level && (
                  <span className={clsx(
                    'inline-block px-3 py-1 text-xs font-semibold rounded-full capitalize',
                    failureForecast.risk_level === 'critical' && 'bg-red-100 text-red-700 ring-1 ring-red-200',
                    failureForecast.risk_level === 'high' && 'bg-orange-100 text-orange-700 ring-1 ring-orange-200',
                    failureForecast.risk_level === 'medium' && 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200',
                    failureForecast.risk_level === 'low' && 'bg-green-100 text-green-700 ring-1 ring-green-200',
                  )}>
                    {failureForecast.risk_level} risk
                  </span>
                )}
                {failureForecast.explanation && (
                  <p className="text-xs text-gray-600 mt-3 leading-relaxed">{failureForecast.explanation}</p>
                )}
              </div>
            )}

            {maintenanceForecast && (
              <div className="p-5 bg-gradient-to-br from-blue-50 to-blue-100/50 rounded-xl border border-blue-200 shadow-sm hover:shadow-md transition-shadow">
                <p className="text-sm font-medium text-gray-600 mb-1">Predicted Next Maintenance</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {maintenanceForecast.prediction_value 
                    ? new Date(maintenanceForecast.prediction_value).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        year: 'numeric' 
                      })
                    : 'Not scheduled'
                  }
                </p>
                {maintenanceForecast.explanation && (
                  <p className="text-sm text-gray-700 mt-3 leading-relaxed">{maintenanceForecast.explanation}</p>
                )}
              </div>
            )}

            {forecasts.filter(f => f.confidence_score != null).length > 0 && (
              <div className="p-5 bg-gradient-to-br from-purple-50 to-purple-100/50 rounded-xl border border-purple-200 shadow-sm hover:shadow-md transition-shadow">
                <p className="text-sm font-medium text-gray-600 mb-1">Average Confidence</p>
                <p className="text-3xl font-bold text-purple-600 mt-2">
                  {(forecasts.reduce((sum, f) => sum + (f.confidence_score || 0), 0) / forecasts.filter(f => f.confidence_score != null).length).toFixed(1)}%
                </p>
                <p className="text-xs text-gray-600 mt-2">Based on {forecasts.filter(f => f.confidence_score != null).length} forecast(s)</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">All Forecasts</h3>
        {!forecasts || forecasts.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No forecast data available</p>
        ) : (
          <div className="space-y-3">
            {forecasts.map((forecast, idx) => (
              <div key={idx} className="p-4 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:shadow-md transition-all">
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-semibold text-gray-900 capitalize text-base">
                    {forecast.forecast_type?.replace(/_/g, ' ')}
                  </h4>
                  {forecast.risk_level && (
                    <span className={clsx(
                      'px-2.5 py-1 text-xs font-semibold rounded-full capitalize shrink-0 ml-2',
                      forecast.risk_level === 'critical' && 'bg-red-100 text-red-700 ring-1 ring-red-200',
                      forecast.risk_level === 'high' && 'bg-orange-100 text-orange-700 ring-1 ring-orange-200',
                      forecast.risk_level === 'medium' && 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-200',
                      forecast.risk_level === 'low' && 'bg-green-100 text-green-700 ring-1 ring-green-200',
                    )}>
                      {forecast.risk_level}
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {forecast.prediction_value != null && (
                    <div className="text-sm">
                      <span className="font-medium text-gray-600">Value:</span>{' '}
                      <span className="text-gray-900 font-semibold">
                        {typeof forecast.prediction_value === 'number' 
                          ? forecast.prediction_value.toFixed(2)
                          : forecast.prediction_value}
                        {forecast.prediction_unit && ` ${forecast.prediction_unit}`}
                      </span>
                    </div>
                  )}

                  {forecast.confidence_score != null && (
                    <div className="text-sm">
                      <span className="font-medium text-gray-600">Confidence:</span>{' '}
                      <span className="text-gray-900 font-semibold">{forecast.confidence_score.toFixed(1)}%</span>
                    </div>
                  )}

                  {forecast.explanation && (
                    <p className="text-xs text-gray-600 mt-2 leading-relaxed pt-2 border-t border-gray-100">
                      {forecast.explanation}
                    </p>
                  )}

                  {forecast.generated_at && (
                    <div className="text-xs text-gray-400 mt-2 pt-2 border-t border-gray-100">
                      <span className="font-medium">Generated:</span> {new Date(forecast.generated_at).toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ControlsTab({ controlHistory, canControl, onSendCommand, sendingCommand }) {
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Simulate loading for smooth transitions
    if (controlHistory !== undefined) {
      setTimeout(() => setIsLoading(false), 200)
    }
  }, [controlHistory])

  // Pagination calculations
  const totalPages = Math.ceil(controlHistory.length / rowsPerPage)
  const startIndex = page * rowsPerPage
  const endIndex = startIndex + rowsPerPage
  const paginatedHistory = controlHistory.slice(startIndex, endIndex)

  const handleChangePage = (newPage) => {
    setPage(newPage)
  }

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10))
    setPage(0)
  }

  if (isLoading || controlHistory === undefined) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {canControl && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
            <div className="space-y-3 animate-pulse">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-11 bg-gray-200 rounded-lg" />
              ))}
            </div>
          </div>
        )}
        <div className={clsx(
          'bg-white rounded-xl shadow-sm border border-gray-100 p-6',
          canControl ? 'lg:col-span-2' : 'lg:col-span-3'
        )}>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Command History</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  {['Time', 'Action', 'User', 'Status', 'Duration'].map((header, i) => (
                    <th key={i} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...Array(5)].map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-200 rounded w-32" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-200 rounded w-24" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-200 rounded w-20" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-5 w-16 bg-gray-200 rounded-full" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 bg-gray-200 rounded w-12" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Quick actions */}
      {canControl && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <button
              onClick={() => onSendCommand('reset_alarm')}
              disabled={sendingCommand}
              className={clsx(
                "w-full px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2",
                sendingCommand 
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300"
              )}
            >
              <ArrowPathIcon className="w-4 h-4" />
              Reset Alarm
            </button>
            <button
              onClick={() => onSendCommand('acknowledge')}
              disabled={sendingCommand}
              className={clsx(
                "w-full px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2",
                sendingCommand 
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300"
              )}
            >
              <WrenchScrewdriverIcon className="w-4 h-4" />
              Acknowledge
            </button>
            <button
              onClick={() => onSendCommand('maintenance')}
              disabled={sendingCommand}
              className={clsx(
                "w-full px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2",
                sendingCommand 
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-purple-100 text-purple-700 hover:bg-purple-200 border border-purple-300"
              )}
            >
              <CpuChipIcon className="w-4 h-4" />
              Enter Maintenance Mode
            </button>
            <button
              onClick={() => onSendCommand('emergency_stop')}
              disabled={sendingCommand}
              className={clsx(
                "w-full px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2",
                sendingCommand 
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                  : "bg-red-600 text-white hover:bg-red-700 shadow-sm hover:shadow-md"
              )}
            >
              <StopIcon className="w-4 h-4" />
              Emergency Stop
            </button>
          </div>
        </div>
      )}

      {/* Control history */}
      <div className={clsx(
        'bg-white rounded-xl shadow-sm border border-gray-100 p-6',
        canControl ? 'lg:col-span-2' : 'lg:col-span-3'
      )}>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Command History</h3>
        {controlHistory.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No commands sent</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedHistory.map((cmd) => (
                    <tr key={cmd.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {new Date(cmd.requested_at || cmd.timestamp).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <span className="text-sm font-medium text-gray-900 capitalize">
                            {cmd.action?.replace(/_/g, ' ') || cmd.command?.replace(/_/g, ' ')}
                          </span>
                          {(cmd.reason || cmd.description || cmd.notes) && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {cmd.reason || cmd.description || cmd.notes}
                            </p>
                          )}
                          {!cmd.reason && !cmd.description && !cmd.notes && (
                            <p className="text-xs text-gray-500 mt-0.5">Manual command from UI</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {cmd.user_name || `User #${cmd.user_id}` || 'System'}
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <span className={clsx(
                            'px-2 py-0.5 text-xs font-medium rounded-full',
                            cmd.status === 'success' && 'bg-green-100 text-green-700',
                            cmd.status === 'failed' && 'bg-red-100 text-red-700',
                            cmd.status === 'pending' && 'bg-yellow-100 text-yellow-700',
                            cmd.status === 'rejected' && 'bg-gray-100 text-gray-700',
                          )}>
                            {cmd.status}
                          </span>
                          {cmd.error_message && (
                            <p className="text-xs text-red-600 mt-1">{cmd.error_message}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {cmd.duration_ms != null ? `${cmd.duration_ms}ms` : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Rows per page:</span>
                <select
                  value={rowsPerPage}
                  onChange={handleChangeRowsPerPage}
                  className="px-3 py-1.5 text-sm text-gray-900 font-medium bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 cursor-pointer hover:border-gray-400 transition-colors"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600">
                  {startIndex + 1}-{Math.min(endIndex, controlHistory.length)} of {controlHistory.length}
                </span>
                
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleChangePage(0)}
                    disabled={page === 0}
                    className={clsx(
                      'p-1.5 rounded-md transition-colors',
                      page === 0
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-600 hover:bg-gray-100'
                    )}
                    title="First page"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                  </button>
                  
                  <button
                    onClick={() => handleChangePage(page - 1)}
                    disabled={page === 0}
                    className={clsx(
                      'p-1.5 rounded-md transition-colors',
                      page === 0
                        ? 'text-gray-300 cursor-not-allowed'
                        : 'text-gray-600 hover:bg-gray-100'
                  )}
                  title="Previous page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <span className="px-3 py-1 text-sm font-medium text-gray-700">
                  {page + 1} / {totalPages || 1}
                </span>

                <button
                  onClick={() => handleChangePage(page + 1)}
                  disabled={page >= totalPages - 1}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors',
                    page >= totalPages - 1
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                  title="Next page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <button
                  onClick={() => handleChangePage(totalPages - 1)}
                  disabled={page >= totalPages - 1}
                  className={clsx(
                    'p-1.5 rounded-md transition-colors',
                    page >= totalPages - 1
                      ? 'text-gray-300 cursor-not-allowed'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                  title="Last page"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

// Skeleton Loader Components
function MachineDetailSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gray-200 rounded-lg" />
          <div>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-gray-200 rounded-full" />
              <div className="h-8 w-64 bg-gray-200 rounded" />
              <div className="h-6 w-20 bg-gray-200 rounded-full" />
            </div>
            <div className="h-4 w-96 bg-gray-200 rounded mt-2" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-10 w-24 bg-gray-200 rounded-lg" />
          <div className="h-10 w-24 bg-gray-200 rounded-lg" />
        </div>
      </div>

      {/* Tabs Skeleton */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-10 w-24 bg-gray-200 rounded" />
          ))}
        </div>
      </div>

      {/* Content Skeleton - Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <div className="lg:col-span-3">
          <CardSkeleton />
        </div>
      </div>
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 animate-pulse">
      <div className="h-6 w-32 bg-gray-200 rounded mb-4" />
      <div className="space-y-3">
        <div className="h-4 w-full bg-gray-200 rounded" />
        <div className="h-4 w-5/6 bg-gray-200 rounded" />
        <div className="h-4 w-4/6 bg-gray-200 rounded" />
        <div className="h-4 w-full bg-gray-200 rounded" />
        <div className="h-4 w-3/4 bg-gray-200 rounded" />
      </div>
    </div>
  )
}

function TelemetryCardSkeleton() {
  return (
    <div className="p-4 rounded-lg bg-gray-100 animate-pulse">
      <div className="w-5 h-5 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-16 bg-gray-200 rounded mb-2" />
      <div className="h-6 w-20 bg-gray-200 rounded" />
    </div>
  )
}
