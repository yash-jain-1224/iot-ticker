/**
 * Skeleton loader for Alert Cards section
 * Used in alerts summary display
 */
export default function AlertCardSkeleton({ count = 4 }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-pulse">
      <div className="flex items-center justify-between mb-5">
        <div className="h-6 bg-gray-200 rounded w-32"></div>
        <div className="h-4 bg-gray-200 rounded w-20"></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[...Array(count)].map((_, i) => (
          <div key={i} className="rounded-lg p-4 bg-gray-50">
            <div className="h-8 bg-gray-200 rounded w-12 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-16"></div>
          </div>
        ))}
      </div>
    </div>
  )
}
