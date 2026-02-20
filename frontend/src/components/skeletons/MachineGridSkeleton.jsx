import MachineCardSkeleton from './MachineCardSkeleton'
import TableSkeleton from './TableSkeleton'

/**
 * Skeleton loader for machine grid
 * Shows placeholder cards in grid layout or table skeleton in compact layout
 */

export default function MachineGridSkeleton({ viewMode = 'grid' }) {
  const skeletonCount = 12 // Show 12 skeleton cards

  if (viewMode === 'compact') {
    // Show table skeleton for compact view (9 columns: Status, Code, Name, Type, Location, Workshop, Health, Load, Temp)
    return <TableSkeleton rows={12} columns={9} title={false} />
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: skeletonCount }).map((_, index) => (
        <MachineCardSkeleton key={index} />
      ))}
    </div>
  )
}
