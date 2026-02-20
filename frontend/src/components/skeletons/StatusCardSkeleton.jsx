/**
 * Skeleton loader for Status Card component
 * Used in machine status sections
 */
export default function StatusCardSkeleton({ count = 5 }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-pulse">
      <div className="flex items-center justify-between mb-5">
        <div className="h-6 bg-gray-200 rounded w-40"></div>
        <div className="h-4 bg-gray-200 rounded w-20"></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[...Array(count)].map((_, i) => (
          <div key={i} className="rounded-xl p-5 bg-gray-50">
            <div className="h-10 bg-gray-200 rounded w-16 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-20"></div>
          </div>
        ))}
      </div>
    </div>
  )
}
