/**
 * Skeleton loader for Machine Card components
 * Used in machine grids and machine dashboard
 */
export default function MachineCardSkeleton({ count = 12, viewMode = 'grid' }) {
  if (viewMode === 'compact') {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left">
                  <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="h-3 w-24 bg-gray-200 rounded animate-pulse" />
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="h-3 w-28 bg-gray-200 rounded animate-pulse" />
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
                </th>
                <th className="px-4 py-3 text-left">
                  <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {[...Array(count)].map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 animate-pulse">
                      <div className="w-2.5 h-2.5 bg-gray-200 rounded-full" />
                      <div className="h-5 w-16 bg-gray-200 rounded-full" />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-16 bg-gray-200 rounded animate-pulse" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 animate-pulse">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="h-5 bg-gray-200 rounded w-24 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-32"></div>
            </div>
            <div className="w-3 h-3 bg-gray-200 rounded-full"></div>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between">
              <div className="h-3 bg-gray-200 rounded w-16"></div>
              <div className="h-3 bg-gray-200 rounded w-12"></div>
            </div>
            <div className="flex justify-between">
              <div className="h-3 bg-gray-200 rounded w-20"></div>
              <div className="h-3 bg-gray-200 rounded w-16"></div>
            </div>
            <div className="flex justify-between">
              <div className="h-3 bg-gray-200 rounded w-14"></div>
              <div className="h-3 bg-gray-200 rounded w-10"></div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="h-3 bg-gray-200 rounded w-full mb-2"></div>
            <div className="h-2 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      ))}
    </div>
  )
}
