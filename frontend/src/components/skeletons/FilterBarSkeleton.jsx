/**
 * Skeleton loader for Filter Bar components
 * Used for search, filter, and control sections
 */
export default function FilterBarSkeleton({ filterCount = 3 }) {
  // Use explicit class names for Tailwind JIT
  const gridColsClass = {
    1: 'grid-cols-1',
    2: 'lg:grid-cols-2',
    3: 'lg:grid-cols-3',
    4: 'lg:grid-cols-4',
  }[filterCount] || 'lg:grid-cols-3'

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="space-y-5 animate-pulse">
        {/* Filter header */}
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-gray-200 rounded" />
          <div className="h-5 w-20 bg-gray-200 rounded" />
        </div>

        {/* Filter controls */}
        <div className={`grid grid-cols-1 ${gridColsClass} gap-4`}>
          {[...Array(filterCount)].map((_, i) => (
            <div key={i}>
              <div className="h-4 w-32 bg-gray-200 rounded mb-2" />
              <div className="h-11 w-full bg-gray-200 rounded-lg" />
            </div>
          ))}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-200">
          <div className="flex items-center gap-3">
            <div className="h-4 w-12 bg-gray-200 rounded" />
            <div className="h-9 w-40 bg-gray-200 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  )
}
