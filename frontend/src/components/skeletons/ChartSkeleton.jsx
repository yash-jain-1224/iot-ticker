/**
 * Skeleton loader for Chart/Graph components
 * Used for all chart types (Line, Bar, Area, Pie, etc.)
 */
export default function ChartSkeleton({ height = 'h-80', title = true }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-pulse">
      {title && (
        <div className="mb-4">
          <div className="h-5 bg-gray-200 rounded w-40 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-56"></div>
        </div>
      )}
      <div className={`${height} bg-gray-100 rounded-lg flex items-center justify-center`}>
        <div className="space-y-3 w-full px-8">
          {/* Chart bars simulation */}
          <div className="flex items-end justify-between gap-2 h-32">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-gray-200 rounded-t"
                style={{ height: `${Math.random() * 60 + 40}%` }}
              ></div>
            ))}
          </div>
          {/* X-axis labels */}
          <div className="flex justify-between">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-2 bg-gray-200 rounded w-8"></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
