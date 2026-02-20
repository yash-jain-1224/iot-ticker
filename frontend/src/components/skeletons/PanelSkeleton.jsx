/**
 * Skeleton loader for Panel/Widget components
 * Generic container skeleton for various content types
 */
export default function PanelSkeleton({ height = 'h-64', withHeader = true }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden animate-pulse">
      {withHeader && (
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <div className="h-5 bg-gray-200 rounded w-40 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-56"></div>
            </div>
            <div className="h-8 bg-gray-200 rounded w-24"></div>
          </div>
        </div>
      )}
      <div className={`p-6 ${height}`}>
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-3 h-3 bg-gray-200 rounded-full"></div>
              <div className="flex-1">
                <div className="h-3 bg-gray-200 rounded w-full"></div>
              </div>
              <div className="h-3 bg-gray-200 rounded w-16"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
