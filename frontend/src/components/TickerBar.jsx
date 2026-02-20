import { useEffect, useState } from 'react'
import { useTickerWebSocket } from '../hooks/useWebSocket'
import { useFilterStore } from '../store/filterStore'

export default function TickerBar() {
  const { plantId, shopType } = useFilterStore()
  const { events } = useTickerWebSocket(plantId, shopType)
  const [displayEvents, setDisplayEvents] = useState([])
  const [hasLoadedData, setHasLoadedData] = useState(false)

  useEffect(() => {
    if (events && events.length > 0) {
      // Take the most recent events for the ticker
      setDisplayEvents(events.slice(0, 20))
      setHasLoadedData(true)
    }
  }, [events])

  const getSeverityBg = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
      case 'error':
        return 'bg-red-500'
      case 'warning':
        return 'bg-yellow-500'
      case 'info':
        return 'bg-blue-500'
      default:
        return 'bg-gray-500'
    }
  }

  const getEventCardBg = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'critical':
      case 'error':
        return 'bg-red-950/40'
      case 'warning':
        return 'bg-yellow-950/40'
      case 'info':
        return 'bg-blue-950/40'
      default:
        return 'bg-[#2a2a2a]'
    }
  }

  const formatTimeAgo = (timestamp) => {
    const now = new Date()
    const time = new Date(timestamp)
    const diffInMinutes = Math.floor((now - time) / (1000 * 60))
    
    if (diffInMinutes < 1) return 'just now'
    if (diffInMinutes < 60) return `about ${diffInMinutes} minutes ago`
    
    const diffInHours = Math.floor(diffInMinutes / 60)
    if (diffInHours < 24) return `about ${diffInHours} ${diffInHours === 1 ? 'hour' : 'hours'} ago`
    
    const diffInDays = Math.floor(diffInHours / 24)
    return `about ${diffInDays} ${diffInDays === 1 ? 'day' : 'days'} ago`
  }

  return (
    <div className="bg-[#1a1a1a] border-b border-gray-900 overflow-hidden">
      <div className="flex items-center h-11">
        {/* Live Indicator */}
        <div className="flex-shrink-0 flex items-center gap-2 px-4 h-full">
          <div className="w-2 h-2 rounded-full bg-red-500"></div>
          <span className="text-[11px] font-semibold tracking-wide text-white uppercase">Live</span>
        </div>

        {/* Scrolling Events */}
        <div className="flex-1 overflow-hidden">
          {!hasLoadedData ? (
            <div className="px-4 py-3 text-sm text-gray-500">Connecting to live feed...</div>
          ) : (
            <div className="flex items-center gap-3 animate-scroll py-2 px-3">
              {displayEvents.map((event, index) => (
                <div 
                  key={`${event.id}-${index}`} 
                  className={`flex items-center gap-2.5 px-4 py-1.5 rounded-full flex-shrink-0 ${getEventCardBg(event.severity)}`}
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getSeverityBg(event.severity)}`}></div>
                  <span className="text-xs font-semibold text-white whitespace-nowrap">{event.machine_code}</span>
                  <span className="text-sm font-medium text-white whitespace-nowrap">{event.title}</span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{formatTimeAgo(event.timestamp)}</span>
                </div>
              ))}
              {/* Duplicate for seamless loop */}
              {displayEvents.map((event, index) => (
                <div 
                  key={`dup-${event.id}-${index}`} 
                  className={`flex items-center gap-2.5 px-4 py-1.5 rounded-full flex-shrink-0 ${getEventCardBg(event.severity)}`}
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getSeverityBg(event.severity)}`}></div>
                  <span className="text-xs font-semibold text-white whitespace-nowrap">{event.machine_code}</span>
                  <span className="text-sm font-medium text-white whitespace-nowrap">{event.title}</span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{formatTimeAgo(event.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
