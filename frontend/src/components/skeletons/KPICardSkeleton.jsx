/**
 * Skeleton loader for KPI Card component
 * Matches the layout and structure of KPICard.jsx
 */
export default function KPICardSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          {/* Title skeleton */}
          <div className="h-4 bg-gray-200 rounded w-20 mb-3"></div>
          {/* Value skeleton */}
          <div className="h-8 bg-gray-200 rounded w-24 mb-2"></div>
          {/* Change indicator skeleton */}
          <div className="h-3 bg-gray-200 rounded w-32"></div>
        </div>
        {/* Icon skeleton */}
        <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
      </div>
      {/* Link skeleton */}
      <div className="h-3 bg-gray-200 rounded w-24 mt-4"></div>
    </div>
  )
}
