import { ClockIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useFilterStore } from '../store/filterStore';
import { useState, useRef, useEffect } from 'react';

const timeRanges = [
  { id: '1h', name: 'Last Hour' },
  { id: '24h', name: 'Last 24 Hours' },
  { id: '7d', name: 'Last 7 Days' },
  { id: '30d', name: 'Last 30 Days' },
];

export default function TimeRangeFilter() {
  const { timeRange, setTimeRange } = useFilterStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const selectedRange = timeRanges.find(range => range.id === timeRange) || timeRanges[1];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleRangeSelect = (rangeId) => {
    setTimeRange(rangeId);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <ClockIcon className="w-4 h-4 text-gray-500" />
        <span className="text-sm text-gray-700">{selectedRange.name}</span>
        <ChevronDownIcon className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          {timeRanges.map((range) => (
            <button
              key={range.id}
              onClick={() => handleRangeSelect(range.id)}
              className={`w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors ${
                timeRange === range.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
              }`}
            >
              <span className="text-sm">{range.name}</span>
              {timeRange === range.id && (
                <svg className="w-4 h-4 float-right mt-0.5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
