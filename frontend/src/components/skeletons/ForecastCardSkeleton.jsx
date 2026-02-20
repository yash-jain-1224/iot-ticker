/**
 * Skeleton loader for forecast cards
 * Used in the forecasts tab to show loading state
 */

export default function ForecastCardSkeleton() {
  return (
    <div className="p-5 bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl border border-gray-200 shadow-sm animate-pulse">
      {/* Title */}
      <div className="h-4 w-32 bg-gray-200 rounded mb-3" />
      
      {/* Value */}
      <div className="h-8 w-24 bg-gray-200 rounded mb-3" />
      
      {/* Badge */}
      <div className="h-5 w-20 bg-gray-200 rounded-full mb-3" />
      
      {/* Description */}
      <div className="space-y-2">
        <div className="h-3 w-full bg-gray-200 rounded" />
        <div className="h-3 w-4/5 bg-gray-200 rounded" />
      </div>
    </div>
  )
}
