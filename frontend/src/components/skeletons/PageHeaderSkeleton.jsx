/**
 * Skeleton loader for page header
 * Used while loading page title and metadata
 */

export default function PageHeaderSkeleton() {
  return (
    <div className="flex items-center justify-between animate-pulse">
      <div>
        {/* Title */}
        <div className="h-8 w-40 bg-gray-200 rounded"></div>
        {/* Subtitle */}
        <div className="h-4 w-64 bg-gray-200 rounded mt-2"></div>
      </div>
      <div className="flex items-center gap-3">
        {/* Location filter placeholder */}
        <div className="h-10 w-48 bg-gray-200 rounded-lg"></div>
        {/* Live indicator placeholder */}
        <div className="h-5 w-12 bg-gray-200 rounded"></div>
        {/* Refresh button placeholder */}
        <div className="h-10 w-24 bg-gray-200 rounded-lg"></div>
      </div>
    </div>
  )
}
