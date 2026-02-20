/**
 * Skeleton loader for List Items
 * Used for alerts list, machine list, notification list, etc.
 */
export default function ListItemSkeleton({ count = 8, showAvatar = false }) {
  return (
    <div className="space-y-3">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
          <div className="flex items-start gap-4">
            {showAvatar && (
              <div className="w-10 h-10 bg-gray-200 rounded-full flex-shrink-0"></div>
            )}
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <div className="h-4 bg-gray-200 rounded w-40"></div>
                <div className="h-3 bg-gray-200 rounded w-20"></div>
              </div>
              <div className="h-3 bg-gray-200 rounded w-full"></div>
              <div className="h-3 bg-gray-200 rounded w-3/4"></div>
              <div className="flex items-center gap-2 mt-2">
                <div className="h-6 bg-gray-200 rounded-full w-16"></div>
                <div className="h-6 bg-gray-200 rounded-full w-20"></div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
