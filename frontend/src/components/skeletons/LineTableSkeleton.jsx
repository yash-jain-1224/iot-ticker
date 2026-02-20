import PanelSkeleton from './PanelSkeleton'

const rows = Array.from({ length: 8 })

export default function LineTableSkeleton() {
  return (
    <PanelSkeleton className="space-y-4">
      <div className="h-6 w-40 bg-gray-200/70 rounded animate-pulse" />
      <div className="h-10 bg-gray-200/40 rounded animate-pulse" />
      <div className="space-y-2">
        {rows.map((_, index) => (
          <div key={index} className="h-9 bg-gray-200/30 rounded animate-pulse" />
        ))}
      </div>
      <div className="flex items-center justify-between pt-2">
        <div className="h-6 w-32 bg-gray-200/60 rounded animate-pulse" />
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-gray-200/60 rounded animate-pulse" />
          <div className="h-8 w-12 bg-gray-200/60 rounded animate-pulse" />
          <div className="h-8 w-8 bg-gray-200/60 rounded animate-pulse" />
        </div>
      </div>
    </PanelSkeleton>
  )
}
