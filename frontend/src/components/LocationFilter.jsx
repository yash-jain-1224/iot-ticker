import { MapPinIcon, ChevronDownIcon } from '@heroicons/react/24/outline';
import { useFilterStore } from '../store/filterStore';
import { useState, useRef, useEffect } from 'react';

const locations = [
  { id: 'all', name: 'All Locations', icon: '🌍' },
  { id: 'jamshedpur', name: 'Houston', icon: '🏭' },
  { id: 'sanand', name: 'Dallas', icon: '🏭' },
  { id: 'pune', name: 'Austin', icon: '🏭' },
];

export default function LocationFilter() {
  const { location, setLocation } = useFilterStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const selectedLocation = locations.find(loc => loc.id === location) || locations[0];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLocationSelect = (locationId) => {
    setLocation(locationId);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
      >
        <MapPinIcon className="w-4 h-4 text-gray-500" />
        <span className="text-sm text-gray-700">{selectedLocation.name}</span>
        <ChevronDownIcon className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => handleLocationSelect(loc.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors ${
                location === loc.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
              }`}
            >
              <span className="text-lg">{loc.icon}</span>
              <span className="text-sm font-medium">{loc.name}</span>
              {location === loc.id && (
                <svg className="w-4 h-4 ml-auto text-blue-600" fill="currentColor" viewBox="0 0 20 20">
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
