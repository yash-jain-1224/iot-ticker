import { useState } from 'react'
import { useDashboardData } from '../../hooks/useDashboardData'
import {
  BuildingOffice2Icon,
  ChartBarIcon,
  BoltIcon,
  CurrencyDollarIcon,
  GlobeAltIcon,
  ExclamationTriangleIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  ArrowPathIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'
import { useFilterStore } from '../../store/filterStore'
import TimeRangeFilter from '../../components/TimeRangeFilter'
import KPICard from '../../components/KPICard'

const formatNumber = (value, decimals = 1) => {
  if (value == null || Number.isNaN(Number(value))) {
    return '—'
  }
  if (decimals == null) {
    return Number(value).toLocaleString()
  }
  return Number(value).toFixed(decimals)
}

const formatCurrency = (value) => {
  if (value == null || Number.isNaN(Number(value))) {
    return '—'
  }
  return `₹${Number(value).toLocaleString()}`
}

const formatCurrencyMaybe = (value) => {
  if (value == null || Number.isNaN(Number(value))) {
    return null
  }
  return `₹${Number(value).toLocaleString()}`
}

const formatPercentMaybe = (value, decimals = 1) => {
  if (value == null || Number.isNaN(Number(value))) {
    return null
  }
  return `${Number(value).toFixed(decimals)}%`
}

const formatPercentChange = (value) => {
  if (value == null || Number.isNaN(Number(value))) {
    return null
  }
  const numeric = Number(value)
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : ''
  return `${sign}${Math.abs(numeric).toFixed(1)}%`
}

const calcPercentOf = (value, base) => {
  if (value == null || base == null) {
    return 0
  }
  const numericValue = Number(value)
  const numericBase = Number(base)
  if (Number.isNaN(numericValue) || Number.isNaN(numericBase) || numericBase === 0) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round((numericValue / numericBase) * 100)))
}

const formatVarianceText = (variance, unit = '', decimals = 1) => {
  if (variance == null || Number.isNaN(Number(variance))) {
    return '—'
  }
  const numeric = Number(variance)
  const sign = numeric > 0 ? '+' : numeric < 0 ? '-' : ''
  const magnitude = decimals == null ? Math.abs(numeric).toLocaleString() : Math.abs(numeric).toFixed(decimals)
  const trimmedUnit = unit?.toString().trim()
  const unitText = trimmedUnit ? (trimmedUnit.startsWith('%') ? trimmedUnit : ` ${trimmedUnit}`) : ''
  return `${sign}${magnitude}${unitText}`
}

function LeadershipDashboard() {
  const { timeRange } = useFilterStore()
  const [selectedView, setSelectedView] = useState('comparison')

  // Fetch leadership view data with hybrid API + WebSocket approach
  const {
    data: leadershipData,
    isLoading,
    isError,
    error,
    refetch,
    isConnected,
    lastUpdated,
    dataSource,
  } = useDashboardData(
    'leadership',
    // API params
    {
      time_range: timeRange,
    },
    // WebSocket params
    {
      time_range: timeRange,
    }
  )

  // Provide default empty object if data is null
  const safeLeadershipData = leadershipData || {}
  
  // Extract data from API response
  const kpis = safeLeadershipData.kpis || {}
  const plants = Array.isArray(safeLeadershipData.plants) ? safeLeadershipData.plants : []
  const comparison = safeLeadershipData.comparison || {}
  const costAnalysis = safeLeadershipData.cost_analysis || {}
  const sustainabilityData = safeLeadershipData.sustainability || {}
  const riskData = safeLeadershipData.risk || {}
  const shopPerformance = safeLeadershipData.shop_performance || {}
  const energyByPlant = Array.isArray(safeLeadershipData.energy_by_plant) ? safeLeadershipData.energy_by_plant : []

  // Shop performance data
  const bodyShopOee = Array.isArray(shopPerformance.body_shop_oee) ? shopPerformance.body_shop_oee : []
  const energyPerVehicle = Array.isArray(shopPerformance.energy_per_vehicle) ? shopPerformance.energy_per_vehicle : []

  // Comparison data
  const oeeTrend = Array.isArray(comparison.oee_trend) ? comparison.oee_trend : []
  const productionVolume = Array.isArray(comparison.production_volume)
    ? comparison.production_volume.map((item) => ({
        plant: item.plant || 'Unknown',
        target: Number(item.target || 0),
        actual: Number(item.actual || 0),
      }))
    : []

  const costBreakdown = Array.isArray(comparison.cost_breakdown)
    ? comparison.cost_breakdown.map((item) => ({
        name: item.category || item.name,
        value: Number(item.value || item.amount || 0),
        percentage: item.percentage,
        color: item.color,
      }))
    : []

  const plantPerformance = Array.isArray(comparison.plant_performance) ? comparison.plant_performance : []
  const networkEnergyTrend = Array.isArray(comparison.network_energy_trend) ? comparison.network_energy_trend : []
  const costPerVehicleTrend = Array.isArray(comparison.cost_per_vehicle_trend) ? comparison.cost_per_vehicle_trend : []

  // Cost analysis data
  const costSummary = costAnalysis.summary || {}
  const costTargetAchievement = costSummary.target?.achievement
  const costYtdTrend = costSummary.ytd?.trend

  const costDistribution = Array.isArray(costAnalysis.distribution)
    ? costAnalysis.distribution.map((item) => ({
        category: item.category || item.name,
        amount: Number(item.amount || item.value || 0),
        percentage: item.percentage,
        color: item.color,
      }))
    : costBreakdown

  const optimizationPotential = Array.isArray(costAnalysis.optimization_potential) ? costAnalysis.optimization_potential : []
  const roiAnalysis = Array.isArray(costAnalysis.roi_analysis) ? costAnalysis.roi_analysis : []

  // Sustainability data
  const sustainabilitySummary = sustainabilityData.summary || {}
  const _sustainabilityInitiatives = Array.isArray(sustainabilityData.initiatives) ? sustainabilityData.initiatives : []
  const energyConsumptionSeries = Array.isArray(sustainabilityData.energy_consumption) ? sustainabilityData.energy_consumption : []
  const co2ByPlant = Array.isArray(sustainabilityData.co2_by_plant) ? sustainabilityData.co2_by_plant : []
  const renewableProgress = Array.isArray(sustainabilityData.renewable_progress) ? sustainabilityData.renewable_progress : []
  const sustainabilityScore = Array.isArray(sustainabilityData.score_breakdown) ? sustainabilityData.score_breakdown : []
  const waterUsage = Array.isArray(sustainabilityData.water_usage) ? sustainabilityData.water_usage : []
  const wasteManagement = Array.isArray(sustainabilityData.waste_management) ? sustainabilityData.waste_management : []

  // Risk data
  const riskCards = Array.isArray(riskData.cards) ? riskData.cards : []
  const riskHighlights = Array.isArray(riskData.highlights) ? riskData.highlights : []
  const riskTrend = riskData.trend || null

  const riskMetrics = [
    { key: 'downtime', label: 'Downtime Risk', color: 'text-orange-600' },
    { key: 'quality', label: 'Quality Risk', color: 'text-yellow-600' },
    { key: 'energy', label: 'Energy Risk', color: 'text-red-600' },
  ]

  const optimizationThemes = [
    {
      container: 'p-4 rounded-lg bg-green-50 border border-green-200',
      iconClass: 'w-6 h-6 text-green-600 flex-shrink-0',
      Icon: BoltIcon,
    },
    {
      container: 'p-4 rounded-lg bg-blue-50 border border-blue-200',
      iconClass: 'w-6 h-6 text-blue-600 flex-shrink-0',
      Icon: ArrowTrendingDownIcon,
    },
    {
      container: 'p-4 rounded-lg bg-purple-50 border border-purple-200',
      iconClass: 'w-6 h-6 text-purple-600 flex-shrink-0',
      Icon: ChartBarIcon,
    },
    {
      container: 'p-4 rounded-lg bg-indigo-50 border border-indigo-200',
      iconClass: 'w-6 h-6 text-indigo-600 flex-shrink-0',
      Icon: BuildingOffice2Icon,
    },
    {
      container: 'p-4 rounded-lg bg-orange-50 border border-orange-200',
      iconClass: 'w-6 h-6 text-orange-600 flex-shrink-0',
      Icon: GlobeAltIcon,
    },
  ]

  const hasRiskTrend = Boolean(
    riskTrend?.current || riskTrend?.previous || riskTrend?.target
  )
  const _hasRiskAnalytics = riskCards.length || riskHighlights.length || hasRiskTrend

  const views = [
    { id: 'comparison', name: 'Plant Comparison', icon: BuildingOffice2Icon },
    { id: 'cost', name: 'Cost Analysis', icon: CurrencyDollarIcon },
    { id: 'sustainability', name: 'Sustainability', icon: GlobeAltIcon },
    { id: 'risk', name: 'Risk Indicators', icon: ExclamationTriangleIcon },
  ]

  // Chart colors
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
              <BuildingOffice2Icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Leadership View</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Strategic insights, cross-plant analytics & risk management
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <TimeRangeFilter />
          {/* Connection Status Badge */}
          {isConnected ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              <span className="text-xs font-medium text-green-700">Live</span>
            </div>
          ) : dataSource === 'api' ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              <span className="text-xs font-medium text-yellow-700">Connecting...</span>
            </div>
          ) : null}
          <div className="text-xs text-gray-500">
            Updated {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
          </div>
        </div>
      </div>

      {/* View Selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-3 overflow-x-auto">
          {views.map((view) => {
            const Icon = view.icon
            return (
              <button
                key={view.id}
                onClick={() => setSelectedView(view.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap ${
                  selectedView === view.id
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                    : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {view.name}
              </button>
            )
          })}
        </div>
      </div>

      {isError ? (
        <div className="flex items-center justify-center py-12">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-6 max-w-lg text-center">
            <h2 className="text-lg font-semibold">Failed to load leadership analytics</h2>
            <p className="text-sm text-red-600 mt-2">
              {error?.response?.data?.message || error?.message || 'An unexpected error occurred while fetching leadership data.'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
            >
              Retry
            </button>
          </div>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <ArrowPathIcon className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-sm text-gray-500">Loading leadership analytics...</p>
          </div>
        </div>
      ) : (
        <>
          {/* Executive KPI Summary */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Enterprise Performance Overview
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                title="Network OEE"
                value={formatNumber(kpis.network_oee, 1)}
                unit="%"
                change={formatPercentChange(kpis.network_oee_change)}
                changeType={kpis.network_oee_change_type || (kpis.network_oee_change == null ? 'neutral' : kpis.network_oee_change > 0 ? 'positive' : 'negative')}
                icon={ChartBarIcon}
                iconBg="bg-green-100"
                iconColor="text-green-600"
              />
              <KPICard
                title="Total Production"
                value={formatNumber(kpis.total_production, null)}
                unit="units"
                change={formatPercentChange(kpis.total_production_change)}
                changeType={kpis.total_production_change_type || (kpis.total_production_change == null ? 'neutral' : kpis.total_production_change >= 0 ? 'positive' : 'negative')}
                icon={ArrowTrendingUpIcon}
                iconBg="bg-blue-100"
                iconColor="text-blue-600"
              />
              <KPICard
                title="Cost per Vehicle"
                value={formatNumber(kpis.cost_per_vehicle, null)}
                unit="₹"
                change={formatVarianceText(kpis.cost_per_vehicle_change, '₹', null)}
                changeType={kpis.cost_per_vehicle_change_type || (kpis.cost_per_vehicle_change == null ? 'neutral' : kpis.cost_per_vehicle_change <= 0 ? 'positive' : 'negative')}
                icon={CurrencyDollarIcon}
                iconBg="bg-purple-100"
                iconColor="text-purple-600"
              />
              <KPICard
                title="Energy Intensity"
                value={formatNumber(kpis.energy_intensity, 1)}
                unit="kWh/unit"
                change={formatVarianceText(kpis.energy_intensity_change, '', 1)}
                changeType={kpis.energy_intensity_change_type || (kpis.energy_intensity_change == null ? 'neutral' : kpis.energy_intensity_change <= 0 ? 'positive' : 'negative')}
                icon={BoltIcon}
                iconBg="bg-yellow-100"
                iconColor="text-yellow-600"
              />
            </div>
          </div>

          {selectedView === 'comparison' && (
            <>
              {/* Plant-to-Plant Comparison */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Cross-Plant Performance Comparison
                </h2>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Plant
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            OEE
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Quality Index
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Production
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Downtime
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Energy/Unit
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Cost/Unit
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                            Ranking
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {plants.map((plant) => (
                          <tr key={plant.name} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <BuildingOffice2Icon className="w-5 h-5 text-gray-400" />
                                <span className="text-sm font-semibold text-gray-900">{plant.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-gray-900">{plant.oee}%</span>
                                {plant.trend === 'up' && (
                                  <ArrowTrendingUpIcon className="w-4 h-4 text-green-600" />
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700">{plant.quality}%</td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {plant.production.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-sm text-orange-600">{plant.downtime} min</td>
                            <td className="px-4 py-3 text-sm text-gray-700">{plant.energy} kWh</td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              ₹{plant.cost.toLocaleString()}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                                  plant.rank === 1
                                    ? 'bg-green-100 text-green-800'
                                    : plant.rank === 2
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-gray-100 text-gray-800'
                                }`}
                              >
                                {plant.rank}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Shop-wise Comparison Across Plants */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Shop Performance by Plant
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Body Shop OEE Comparison</h3>
                    <div className="space-y-3">
                      {bodyShopOee.map((item) => (
                        <div key={item.plant}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-700">{item.plant}</span>
                            <span className="text-sm font-bold text-gray-900">{formatNumber(item.oee, 1)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={`${item.color || 'bg-green-500'} h-2 rounded-full`}
                              style={{ width: `${calcPercentOf(item.oee, 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Energy per Vehicle Comparison</h3>
                    <div className="space-y-3">
                      {energyPerVehicle.map((item) => (
                        <div key={item.plant}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-gray-700">
                              {item.plant}
                              {item.best && (
                                <span className="ml-2 text-xs font-semibold text-green-600">Best</span>
                              )}
                            </span>
                            <span className="text-sm font-bold text-gray-900">{formatNumber(item.energy, 1)} kWh</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={`${item.color || 'bg-blue-500'} h-2 rounded-full`}
                              style={{ width: `${calcPercentOf(item.energy, 50)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Strategic Performance Charts */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Strategic Analytics & Comparisons
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Multi-Plant OEE Trend */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Multi-Plant OEE Trend (30 Days)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={oeeTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="week" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} domain={[75, 90]} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="pune"
                          stroke="#10b981"
                          strokeWidth={2}
                          name="Austin"
                          dot={{ fill: '#10b981', r: 4 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="sanand"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          name="Dallas"
                          dot={{ fill: '#3b82f6', r: 4 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="jamshedpur"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          name="Houston"
                          dot={{ fill: '#f59e0b', r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Production Volume by Plant */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Production Volume Comparison</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={productionVolume}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="plant" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Bar dataKey="target" fill="#94a3b8" name="Target" radius={[8, 8, 0, 0]} />
                        <Bar dataKey="actual" fill="#3b82f6" name="Actual" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Cost Breakdown by Category */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Network Cost Breakdown</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={costBreakdown}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          outerRadius={90}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {costBreakdown.map((entry, index) => (
                            <Cell key={`cell-${entry.name}-${index}`} fill={entry.color || COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Multi-Metric Plant Comparison Radar */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Plant Performance Profile</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <RadarChart data={plantPerformance}>
                        <PolarGrid stroke="#e5e7eb" />
                        <PolarAngleAxis dataKey="metric" stroke="#6b7280" fontSize={11} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} stroke="#6b7280" fontSize={10} />
                        <Radar
                          name="Austin"
                          dataKey="pune"
                          stroke="#10b981"
                          fill="#10b981"
                          fillOpacity={0.2}
                        />
                        <Radar
                          name="Dallas"
                          dataKey="sanand"
                          stroke="#3b82f6"
                          fill="#3b82f6"
                          fillOpacity={0.2}
                        />
                        <Radar
                          name="Houston"
                          dataKey="jamshedpur"
                          stroke="#f59e0b"
                          fill="#f59e0b"
                          fillOpacity={0.2}
                        />
                        <Legend />
                        <Tooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Energy Consumption Trend */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Network Energy Consumption (30 Days)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={networkEnergyTrend}>
                        <defs>
                          <linearGradient id="colorTotalEnergy" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="week" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="total"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          fill="url(#colorTotalEnergy)"
                          name="Total Energy (kWh)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Cost per Vehicle Trend */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Cost per Vehicle Trend</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={costPerVehicleTrend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="week" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Bar dataKey="cost" fill="#8b5cf6" name="Actual Cost (₹)" radius={[8, 8, 0, 0]} />
                        <Line
                          type="monotone"
                          dataKey="target"
                          stroke="#ef4444"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          name="Target (₹)"
                          dot={{ fill: '#ef4444', r: 4 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}

          {selectedView === 'cost' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Cost per Vehicle Breakdown</h2>
                {costDistribution.length ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="space-y-4">
                      {costDistribution.map((item) => {
                        const barWidth = item.percentage != null ? `${item.percentage}%` : '0%'
                        const amountText = formatCurrencyMaybe(item.amount)
                        const percentText = formatPercentMaybe(item.percentage)
                        return (
                          <div key={item.category}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-gray-700">{item.category}</span>
                              <span className="text-sm font-bold text-gray-900">
                                {amountText ?? '—'}
                                {percentText ? ` (${percentText})` : ''}
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className={`${item.color || 'bg-indigo-500'} h-2 rounded-full`}
                                style={{ width: barWidth }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
                    No cost component data available for the selected period.
                  </div>
                )}
              </div>

              {(costSummary.current?.value || costSummary.target?.value || costSummary.ytd?.value) && (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="font-semibold text-gray-900 mb-4">Cost Trend Summary</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">This Month</span>
                        <ArrowTrendingDownIcon className="w-5 h-5 text-green-600" />
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {formatCurrency(costSummary.current?.value)}
                      </div>
                      <div className="text-xs text-green-600 mt-1">
                        {costSummary.current?.change != null
                          ? `${formatVarianceText(costSummary.current.change, '₹', null)} vs last month`
                          : 'No comparison available'}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">Target</span>
                        <span className="text-xs font-semibold text-blue-600">
                          {costTargetAchievement != null
                            ? `${(costTargetAchievement * 100).toFixed(0)}% achieved`
                            : 'Target achievement unavailable'}
                        </span>
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {formatCurrency(costSummary.target?.value)}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {costTargetAchievement != null ? 'Annual savings tracking active' : 'No target benchmark provided'}
                      </div>
                    </div>
                    <div className="p-4 rounded-lg bg-purple-50 border border-purple-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">YTD Average</span>
                      </div>
                      <div className="text-2xl font-bold text-gray-900">
                        {formatCurrency(costSummary.ytd?.value)}
                      </div>
                      <div className="text-xs text-gray-600 mt-1">
                        {costYtdTrend
                          ? costYtdTrend === 'down'
                            ? 'Trending downward'
                            : costYtdTrend === 'up'
                              ? 'Trending upward'
                              : `Trend: ${costYtdTrend}`
                          : 'Trend data unavailable'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Cost Optimization Opportunities</h2>
                {optimizationPotential.length ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      {optimizationPotential.map((item, index) => {
                        const theme = optimizationThemes[index % optimizationThemes.length]
                        const IconComponent = theme.Icon
                        return (
                          <div key={`${item.initiative}-${index}`} className={theme.container}>
                            <div className="flex items-start gap-3">
                              <IconComponent className={theme.iconClass} />
                              <div className="flex-1">
                                <h4 className="text-sm font-semibold text-gray-900 mb-1">{item.initiative}</h4>
                                <p className="text-sm text-gray-700 mb-2">
                                  Potential savings: <strong>{formatCurrency(item.potential)}</strong>
                                </p>
                                <p className="text-xs text-gray-600 capitalize">Status: {item.status || 'unspecified'}</p>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-900 mb-4">Potential Savings</h3>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart layout="vertical" data={optimizationPotential}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis type="number" stroke="#6b7280" fontSize={12} />
                          <YAxis type="category" dataKey="initiative" stroke="#6b7280" fontSize={12} width={160} />
                          <Tooltip
                            formatter={(value) => formatCurrency(value)}
                            contentStyle={{
                              backgroundColor: '#fff',
                              border: '1px solid #e5e7eb',
                              borderRadius: '8px',
                            }}
                          />
                          <Legend />
                          <Bar dataKey="potential" fill="#3b82f6" name="Potential Savings" radius={[0, 8, 8, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-600">
                    No optimization initiatives available for the selected period.
                  </div>
                )}
              </div>

              {roiAnalysis.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">ROI Analysis</h2>
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={roiAnalysis}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="period" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          formatter={(value, name) =>
                            name === 'ROI (%)' || name === 'roi'
                              ? [`${formatNumber(value, 1)}%`, 'ROI']
                              : [formatCurrency(value), name === 'savings' ? 'Savings' : 'Investment']
                          }
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Bar dataKey="investment" fill="#8b5cf6" name="Investment" radius={[8, 8, 0, 0]} />
                        <Bar dataKey="savings" fill="#10b981" name="Savings" radius={[8, 8, 0, 0]} />
                        <Line
                          type="monotone"
                          dataKey="roi"
                          stroke="#ef4444"
                          strokeWidth={2}
                          name="ROI (%)"
                          dot={{ fill: '#ef4444', r: 4 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedView === 'sustainability' && (
            <>
              {/* Energy & Sustainability */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Energy & Sustainability Metrics
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-yellow-100 flex items-center justify-center">
                        <BoltIcon className="w-6 h-6 text-yellow-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Total Energy</h3>
                        <p className="text-xs text-gray-500">All plants</p>
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-gray-900 mb-1">
                      {formatNumber(sustainabilitySummary.total_energy, null)}
                    </div>
                    <div className="text-sm text-gray-600">kWh today</div>
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      {(sustainabilitySummary.energy_change ?? 0) <= 0 ? (
                        <ArrowTrendingDownIcon className="w-4 h-4 text-green-600" />
                      ) : (
                        <ArrowTrendingUpIcon className="w-4 h-4 text-red-600" />
                      )}
                      <span
                        className={`font-medium ${
                          (sustainabilitySummary.energy_change ?? 0) <= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {formatPercentChange(sustainabilitySummary.energy_change)} vs yesterday
                      </span>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                        <GlobeAltIcon className="w-6 h-6 text-green-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">CO₂ Emissions</h3>
                        <p className="text-xs text-gray-500">Carbon footprint</p>
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-gray-900 mb-1">
                      {formatNumber(sustainabilitySummary.co2, 1)}
                    </div>
                    <div className="text-sm text-gray-600">tons today</div>
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      {(sustainabilitySummary.co2_change ?? 0) <= 0 ? (
                        <ArrowTrendingDownIcon className="w-4 h-4 text-green-600" />
                      ) : (
                        <ArrowTrendingUpIcon className="w-4 h-4 text-red-600" />
                      )}
                      <span
                        className={`font-medium ${
                          (sustainabilitySummary.co2_change ?? 0) <= 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {formatPercentChange(sustainabilitySummary.co2_change)} vs target
                      </span>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                        <ChartBarIcon className="w-6 h-6 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Efficiency Score</h3>
                        <p className="text-xs text-gray-500">Sustainability index</p>
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-gray-900 mb-1">
                      {formatNumber(sustainabilitySummary.efficiency_score, 1)}
                    </div>
                    <div className="text-sm text-gray-600">out of 100</div>
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <ArrowTrendingUpIcon className="w-4 h-4 text-green-600" />
                      <span className="text-green-600 font-medium">
                        {formatNumber(sustainabilitySummary.efficiency_change, 1)} points this month
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Plant Energy Comparison */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Energy Consumption by Plant
                </h2>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="space-y-4">
                    {energyByPlant.map((plant) => (
                      <div key={plant.plant} className="p-4 rounded-lg border border-gray-200">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <BuildingOffice2Icon className="w-5 h-5 text-gray-400" />
                            <h3 className="font-semibold text-gray-900">{plant.plant}</h3>
                          </div>
                          {plant.trend === 'down' && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-green-100 text-green-800 text-xs font-medium">
                              <ArrowTrendingDownIcon className="w-3 h-3" />
                              Improving
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-4 gap-4">
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Total Energy</div>
                            <div className="text-sm font-semibold text-gray-900">
                              {formatNumber(plant.energy, null)} kWh
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Per Unit</div>
                            <div className="text-sm font-semibold text-gray-900">{formatNumber(plant.per_unit ?? plant.perUnit, 1)} kWh</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500 mb-1">CO₂ Emissions</div>
                            <div className="text-sm font-semibold text-gray-900">{formatNumber(plant.co2, 2)} tons</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Efficiency</div>
                            <div className="text-sm font-semibold text-green-600">{formatNumber(plant.efficiency, 0)}%</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sustainability Initiatives */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Sustainability Initiatives</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Solar Integration Program</h3>
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Target: 30% renewable</span>
                        <span className="font-semibold text-gray-900">Current: 18%</span>
                      </div>
                      <div className="w-full bg-white rounded-full h-2">
                        <div className="bg-green-500 h-2 rounded-full" style={{ width: '60%' }} />
                      </div>
                    </div>
                    <p className="text-xs text-gray-600">
                      Projected annual savings: ₹42M | CO₂ reduction: 1,250 tons/year
                    </p>
                  </div>

                  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-xl border border-blue-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Water Conservation Program</h3>
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-700">Target: 25% reduction</span>
                        <span className="font-semibold text-gray-900">Achieved: 19%</span>
                      </div>
                      <div className="w-full bg-white rounded-full h-2">
                        <div className="bg-blue-500 h-2 rounded-full" style={{ width: '76%' }} />
                      </div>
                    </div>
                    <p className="text-xs text-gray-600">
                      Water saved: 12.5M liters/month | Cost savings: ₹8.5M/year
                    </p>
                  </div>
                </div>
              </div>

              {/* Sustainability Charts */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Sustainability Analytics & Environmental Impact
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Energy Consumption Trend */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Energy Consumption Trend (30 Days)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={energyConsumptionSeries}>
                        <defs>
                          <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorRenewable" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="day" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="total"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          fill="url(#colorTotal)"
                          name="Total Energy (kWh)"
                        />
                        <Area
                          type="monotone"
                          dataKey="renewable"
                          stroke="#10b981"
                          strokeWidth={2}
                          fill="url(#colorRenewable)"
                          name="Renewable (kWh)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* CO2 Emissions by Plant */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">CO₂ Emissions by Plant (Today)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={co2ByPlant}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="plant" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Bar dataKey="emissions" fill="#ef4444" name="Actual (tons)" radius={[8, 8, 0, 0]} />
                        <Bar dataKey="target" fill="#10b981" name="Target (tons)" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Renewable Energy Progress */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Renewable Energy Adoption (12 Months)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={renewableProgress}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} domain={[0, 30]} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="percentage"
                          stroke="#10b981"
                          strokeWidth={3}
                          name="Renewable %"
                          dot={{ fill: '#10b981', r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Sustainability Score by Category */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Sustainability Score Breakdown</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <RadarChart data={sustainabilityScore}>
                        <PolarGrid stroke="#e5e7eb" />
                        <PolarAngleAxis dataKey="metric" stroke="#6b7280" fontSize={11} />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} stroke="#6b7280" fontSize={10} />
                        <Radar
                          name="Score"
                          dataKey="score"
                          stroke="#10b981"
                          fill="#10b981"
                          fillOpacity={0.3}
                        />
                        <Tooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Water Usage Trend */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Water Usage (30 Days)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={waterUsage}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="week" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Legend />
                        <Bar dataKey="usage" fill="#3b82f6" name="Usage (kL)" radius={[8, 8, 0, 0]} />
                        <Line
                          type="monotone"
                          dataKey="target"
                          stroke="#ef4444"
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          name="Target (kL)"
                          dot={{ fill: '#ef4444', r: 4 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Waste Management */}
                  <div className="bg-white rounded-xl border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-4">Waste Management (Monthly)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={wasteManagement}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="type" stroke="#6b7280" fontSize={12} />
                        <YAxis stroke="#6b7280" fontSize={12} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#fff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '8px',
                          }}
                        />
                        <Bar dataKey="amount" fill="#10b981" name="Amount (tons)" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </>
          )}

          {selectedView === 'risk' && (
            <>
              {/* Predictive Risk Indicators */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Predictive Risk Indicators</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {riskCards.map((card) => {
                    const severityColor =
                      card.category === 'energy'
                        ? 'text-red-600'
                        : card.category === 'downtime'
                        ? 'text-orange-600'
                        : 'text-yellow-600'
                    const barColor =
                      card.category === 'energy'
                        ? 'bg-red-500'
                        : card.category === 'downtime'
                          ? 'bg-orange-500'
                          : 'bg-yellow-500'
                    const Icon = card.category === 'energy' ? BoltIcon : ExclamationTriangleIcon
                    return (
                      <div key={card.title} className="bg-white rounded-xl border border-gray-200 p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold text-gray-900">{card.title}</h3>
                          <Icon className={`w-6 h-6 ${severityColor}`} />
                        </div>
                        <div className="text-4xl font-bold text-gray-900 mb-2">{formatNumber(card.score, 1)}</div>
                        <div className="text-sm text-gray-600 mb-4">{card.description}</div>
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                          <div className={`${barColor} h-2 rounded-full`} style={{ width: `${calcPercentOf(card.score, 10)}%` }} />
                        </div>
                        <div className="text-xs text-gray-600">{card.details}</div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Detailed Risk Analysis */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Risk Analysis & Mitigation</h2>
                <div className="space-y-4">
                  {riskHighlights.map((item, index) => {
                    const severityColor =
                      item.severity === 'critical'
                        ? 'border-red-200'
                        : item.severity === 'high'
                          ? 'border-orange-200'
                          : 'border-yellow-200'
                    const bgColor =
                      item.severity === 'critical'
                        ? 'bg-red-100'
                        : item.severity === 'high'
                          ? 'bg-orange-100'
                          : 'bg-yellow-100'
                    const Icon = item.severity === 'critical' ? ExclamationTriangleIcon : item.severity === 'high' ? ClockIcon : ChartBarIcon
                    const textColor =
                      item.severity === 'critical'
                        ? 'text-red-600'
                        : item.severity === 'high'
                          ? 'text-orange-600'
                          : 'text-yellow-600'
                    
                    // Ensure nested arrays are safe
                    const details = Array.isArray(item.details) ? item.details : []
                    const actions = Array.isArray(item.actions) ? item.actions : []
                    
                    return (
                      <div key={`${item.title}-${index}`} className={`bg-white rounded-xl border ${severityColor} p-5`}>
                        <div className="flex items-start gap-4">
                          <div className={`w-12 h-12 rounded-xl ${bgColor} flex items-center justify-center flex-shrink-0`}>
                            <Icon className={`w-6 h-6 ${textColor}`} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <h3 className="font-semibold text-gray-900">{item.title}</h3>
                              <span className={`px-3 py-1 rounded-full ${bgColor} ${textColor} text-xs font-semibold`}>
                                Probability: {((item.probability || 0) * 100).toFixed(0)}%
                              </span>
                            </div>
                            <p className="text-sm text-gray-700 mb-3">
                              <strong>Impact:</strong> {formatCurrency(item.impact || 0)} potential impact
                            </p>
                            {details.length > 0 && (
                              <div className={`${bgColor.replace('100', '50')} rounded-lg p-3 mb-3`}>
                                <div className="text-xs font-semibold text-gray-900 mb-1">Key Factors:</div>
                                <ul className="text-xs text-gray-700 space-y-1 ml-4 list-disc">
                                  {details.map((detail, detailIdx) => (
                                    <li key={`${detail}-${detailIdx}`}>{detail}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {actions.length > 0 && (
                              <div className="flex items-center gap-3 flex-wrap">
                                {actions.map((action, actionIdx) => (
                                  <button
                                    key={`${action}-${actionIdx}`}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium ${
                                      actionIdx === 0
                                        ? `${textColor.replace('text', 'bg')} text-white hover:opacity-90`
                                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                                    }`}
                                  >
                                    {action}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Risk Trend Comparison */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Risk Trend Analysis</h2>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">This Week</h4>
                      <div className="space-y-2">
                        {riskMetrics.map((metric) => (
                          <div key={`current-${metric.key}`} className="flex items-center justify-between text-sm">
                            <span className="text-gray-600">{metric.label}</span>
                            <span className={`font-semibold ${metric.color}`}>
                              {formatNumber(riskTrend?.current?.[metric.key], 1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Last Week</h4>
                      <div className="space-y-2">
                        {riskMetrics.map((metric) => (
                          <div key={`previous-${metric.key}`} className="flex items-center justify-between text-sm">
                            <span className="text-gray-600">{metric.label}</span>
                            <span className="font-semibold text-gray-500">
                              {formatNumber(riskTrend?.previous?.[metric.key], 1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">Target</h4>
                      <div className="space-y-2">
                        {riskMetrics.map((metric) => (
                          <div key={`target-${metric.key}`} className="flex items-center justify-between text-sm">
                            <span className="text-gray-600">{metric.label}</span>
                            <span className="font-semibold text-green-600">
                              {formatNumber(riskTrend?.target?.[metric.key], 1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Strategic Drill-Down */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Strategic Drill-Down</h2>
            <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl border border-indigo-200 p-6">
              <div className="mb-4">
                <h3 className="font-semibold text-gray-900 mb-2">Cross-Plant Analysis</h3>
                <p className="text-sm text-gray-700">
                  Compare performance across locations: <strong>Austin</strong> vs <strong>Dallas</strong> →{' '}
                  <strong>Body Shop</strong> → Energy per vehicle
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button className="px-4 py-3 bg-white rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all text-left">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        Austin vs Dallas: Body Shop Energy
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Comparative efficiency analysis</div>
                    </div>
                    <svg
                      className="w-5 h-5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </button>
                <button className="px-4 py-3 bg-white rounded-lg border border-gray-200 hover:border-indigo-300 hover:shadow-md transition-all text-left">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        All Plants: Cost Breakdown Deep-Dive
                      </div>
                      <div className="text-xs text-gray-500 mt-1">Identify optimization opportunities</div>
                    </div>
                    <svg
                      className="w-5 h-5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default LeadershipDashboard
