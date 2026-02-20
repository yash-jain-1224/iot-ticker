import { AlertTriangle, CheckCircle, Clock } from 'lucide-react';

export default function AlertsList({ alerts = [] }) {
  if (alerts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <CheckCircle className="w-12 h-12 mx-auto mb-2 text-gray-400" />
        <p>No active alerts</p>
      </div>
    );
  }

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-200',
      warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      info: 'bg-blue-100 text-blue-800 border-blue-200'
    };
    return colors[severity] || colors.info;
  };

  const getStatusColor = (status) => {
    const colors = {
      active: 'bg-red-100 text-red-800',
      acknowledged: 'bg-yellow-100 text-yellow-800',
      resolved: 'bg-green-100 text-green-800'
    };
    return colors[status] || colors.active;
  };

  return (
    <div className="space-y-3">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={`p-4 rounded-lg border ${getSeverityColor(alert.severity)}`}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-start gap-2 flex-1">
              <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold">{alert.message}</h3>
                {alert.description && (
                  <p className="text-sm mt-1 opacity-90">{alert.description}</p>
                )}
                <div className="flex items-center gap-3 mt-2 text-sm">
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {new Date(alert.triggered_at).toLocaleString()}
                  </span>
                  {alert.machine_code && (
                    <span className="font-medium">Machine: {alert.machine_code}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 items-end ml-4">
              <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(alert.status)}`}>
                {alert.status}
              </span>
              <span className="px-2 py-1 text-xs font-medium rounded bg-white uppercase">
                {alert.severity}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
