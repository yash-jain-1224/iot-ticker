/**
 * Skeleton loader for Table components
 * Used for data tables and grids
 */
export default function TableSkeleton({ rows = 10, columns = 6, title = true }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden animate-pulse">
      {title && (
        <div className="p-6 border-b border-gray-200">
          <div className="h-6 bg-gray-200 rounded w-40"></div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {[...Array(columns)].map((_, i) => (
                <th key={i} className="px-4 py-3 text-left">
                  <div className="h-3 bg-gray-200 rounded w-20"></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {[...Array(rows)].map((_, i) => (
              <tr key={i}>
                {[...Array(columns)].map((_, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-gray-200 rounded w-24"></div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
