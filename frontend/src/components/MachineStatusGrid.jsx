import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle, Clock, Settings } from 'lucide-react';

export default function MachineStatusGrid({ machines = [], title = 'Machines', compact = false }) {
  const navigate = useNavigate();

  if (machines.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No machines available</p>
      </div>
    );
  }

  const getStatusColor = (status) => {
    const colors = {
      online: 'bg-green-500',
      offline: 'bg-gray-400',
      idle: 'bg-yellow-500',
      fault: 'bg-red-500',
      maintenance: 'bg-blue-500'
    };
    return colors[status] || colors.offline;
  };

  const getStatusCardStyles = (status) => {
    const styles = {
      online: 'border-l-4 border-l-green-500 bg-gradient-to-br from-green-50/50 to-white hover:from-green-50 hover:shadow-green-100',
      offline: 'border-l-4 border-l-gray-400 bg-gradient-to-br from-gray-50/50 to-white hover:from-gray-50 hover:shadow-gray-100',
      idle: 'border-l-4 border-l-yellow-500 bg-gradient-to-br from-yellow-50/50 to-white hover:from-yellow-50 hover:shadow-yellow-100',
      fault: 'border-l-4 border-l-red-500 bg-gradient-to-br from-red-50/50 to-white hover:from-red-50 hover:shadow-red-100',
      maintenance: 'border-l-4 border-l-blue-500 bg-gradient-to-br from-blue-50/50 to-white hover:from-blue-50 hover:shadow-blue-100'
    };
    return styles[status] || styles.offline;
  };

  const getStatusBadgeStyles = (status) => {
    const styles = {
      online: 'bg-green-100 text-green-700 ring-1 ring-green-600/20',
      offline: 'bg-gray-100 text-gray-700 ring-1 ring-gray-600/20',
      idle: 'bg-yellow-100 text-yellow-700 ring-1 ring-yellow-600/20',
      fault: 'bg-red-100 text-red-700 ring-1 ring-red-600/20',
      maintenance: 'bg-blue-100 text-blue-700 ring-1 ring-blue-600/20'
    };
    return styles[status] || styles.offline;
  };

  const getStatusIcon = (status) => {
    const icons = {
      online: <CheckCircle className="w-5 h-5" />,
      offline: <Activity className="w-5 h-5 opacity-50" />,
      idle: <Clock className="w-5 h-5" />,
      fault: <AlertTriangle className="w-5 h-5" />,
      maintenance: <Settings className="w-5 h-5" />
    };
    return icons[status] || icons.offline;
  };

  // Compact Table View
  if (compact) {
    return (
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  Status
                </th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  Code
                </th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  Machine Name
                </th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  Type
                </th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  Location
                </th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  Workshop
                </th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  Health
                </th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  Load
                </th>
                <th scope="col" className="px-6 py-3.5 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">
                  Temp
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {machines.map((machine) => (
                <tr
                  key={machine.machine_id || machine.id}
                  onClick={() => navigate(`/machines/${machine.machine_id || machine.id}`)}
                  className="hover:bg-blue-50 cursor-pointer transition-colors duration-150"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(machine.status)}`} />
                      <span className="text-sm font-medium text-gray-900 capitalize">
                        {machine.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {machine.machine_code || machine.code}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-gray-900">
                      {machine.machine_name || machine.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-600">
                      {machine.machine_type || machine.type || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-600">
                      {machine.plant_name || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-600">
                      {machine.shop_name || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2.5 min-w-[140px]">
                      {machine.health_score !== null && machine.health_score !== undefined ? (
                        <>
                          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                machine.health_score >= 80
                                  ? 'bg-green-500'
                                  : machine.health_score >= 50
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${Math.round(machine.health_score)}%` }}
                            />
                          </div>
                          <span className="text-sm font-semibold text-gray-900 min-w-[3rem] text-right">
                            {Math.round(machine.health_score)}%
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-gray-400">N/A</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-semibold text-gray-900">
                      {machine.current_load !== null && machine.current_load !== undefined
                        ? `${Math.round(machine.current_load)}%`
                        : 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-600">
                      {machine.temperature !== null && machine.temperature !== undefined
                        ? `${Math.round(machine.temperature)}°C`
                        : 'N/A'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Grid View (default)
  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {machines.map((machine) => (
          <div
            key={machine.machine_id || machine.id}
            onClick={() => navigate(`/machines/${machine.machine_id || machine.id}`)}
            className={`rounded-lg border border-gray-200 p-4 hover:shadow-lg transition-all duration-200 cursor-pointer group ${getStatusCardStyles(machine.status)}`}
          >
            {/* Status Indicator */}
            <div className="flex items-start justify-between mb-3">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${getStatusBadgeStyles(machine.status)}`}>
                <div className={`w-2 h-2 rounded-full ${getStatusColor(machine.status)} animate-pulse`} />
                {machine.status}
              </span>
              <div className={`${machine.status === 'online' ? 'text-green-600' : 
                               machine.status === 'fault' ? 'text-red-600' : 
                               machine.status === 'idle' ? 'text-yellow-600' :
                               machine.status === 'maintenance' ? 'text-blue-600' :
                               'text-gray-400'}`}>
                {getStatusIcon(machine.status)}
              </div>
            </div>

            {/* Machine Info */}
            <div className="mb-3">
              <h4 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors mb-1">
                {machine.machine_name || machine.name}
              </h4>
              <p className="text-sm text-gray-600">{machine.machine_code || machine.code}</p>
              <p className="text-xs text-gray-500 mt-1">{machine.machine_type || machine.type}</p>
            </div>

            {/* Metrics */}
            <div className="space-y-3 pb-3 border-b border-gray-100">
              <div>
                <p className="text-xs text-gray-500 mb-1.5">Health</p>
                {machine.health_score !== null && machine.health_score !== undefined ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          machine.health_score >= 80
                            ? 'bg-green-500'
                            : machine.health_score >= 50
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.round(machine.health_score)}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold text-gray-900 min-w-[3rem] text-right">
                      {Math.round(machine.health_score)}%
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-gray-400">N/A</span>
                )}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Load</p>
                <p className="text-sm font-semibold text-gray-900">
                  {machine.current_load !== null && machine.current_load !== undefined 
                    ? `${Math.round(machine.current_load)}%` 
                    : 'N/A'}
                </p>
              </div>
            </div>

            {/* Location and Workshop */}
            <div className="pt-3 space-y-2">
              <div className="flex items-center text-xs">
                <span className="text-gray-500 font-medium w-20">Location:</span>
                <span className="text-gray-900 font-medium">
                  {machine.plant_name || 'N/A'}
                </span>
              </div>
              <div className="flex items-center text-xs">
                <span className="text-gray-500 font-medium w-20">Workshop:</span>
                <span className="text-gray-700">
                  {machine.shop_name || 'N/A'}
                </span>
              </div>
            </div>

            {/* Fault Indicator */}
            {machine.fault_code && (
              <div className="mt-3 pt-3 border-t border-red-100">
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="text-xs font-medium">{machine.fault_code}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
