import { useState, useEffect } from 'react';
import { Filter, MapPin } from 'lucide-react';
import { plantsAPI } from '../services/api';
import { useFilterStore } from '../store/filterStore';
import logger from '../utils/logger'

// Location Badge Component
export function LocationBadge() {
  const { globalLocation } = useFilterStore();
  
  if (!globalLocation || globalLocation === 'all') {
    return null;
  }
  
  const locationLabels = {
    'jamshedpur': 'Houston',
    'pune': 'Austin',
    'sanand': 'Dallas',
  };
  
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
      <MapPin className="w-4 h-4" />
      {locationLabels[globalLocation] || globalLocation}
    </div>
  );
}

export default function GlobalFilters() {
  const [hierarchy, setHierarchy] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const { 
    selectedPlant, 
    selectedShop, 
    selectedLine, 
    setSelectedPlant, 
    setSelectedShop, 
    setSelectedLine,
    clearFilters 
  } = useFilterStore();

  useEffect(() => {
    loadHierarchy();
  }, []);

  const loadHierarchy = async () => {
    try {
      const response = await plantsAPI.getHierarchy();
      // Ensure we get an array - handle both direct array and response.data
      const data = Array.isArray(response) ? response : (response?.data || []);
      setHierarchy(data);
    } catch (error) {
      logger.error('Failed to load hierarchy:', error);
      setHierarchy([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  // Safely access hierarchy with fallback to empty array
  const hierarchyArray = Array.isArray(hierarchy) ? hierarchy : [];
  const selectedPlantData = hierarchyArray.find(p => p.id === parseInt(selectedPlant));
  const selectedShopData = selectedPlantData?.shops?.find(s => s.id === parseInt(selectedShop));

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Filter className="w-5 h-5 text-gray-600" />
        <h3 className="font-semibold text-gray-900">Filters</h3>
      </div>

      {loading ? (
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Plant Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Plant
            </label>
            <select
              value={selectedPlant}
              onChange={(e) => {
                setSelectedPlant(e.target.value);
                setSelectedShop('');
                setSelectedLine('');
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">All Plants</option>
              {hierarchyArray.map((plant) => (
                <option key={plant.id} value={plant.id}>
                  {plant.name} ({plant.code})
                </option>
              ))}
            </select>
          </div>

          {/* Shop Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Shop/Workshop
            </label>
            <select
              value={selectedShop}
              onChange={(e) => {
                setSelectedShop(e.target.value);
                setSelectedLine('');
              }}
              disabled={!selectedPlant}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="">All Shops</option>
              {selectedPlantData?.shops?.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name} ({shop.code})
                </option>
              ))}
            </select>
          </div>

          {/* Line Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Production Line
            </label>
            <select
              value={selectedLine}
              onChange={(e) => setSelectedLine(e.target.value)}
              disabled={!selectedShop}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="">All Lines</option>
              {selectedShopData?.lines?.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name} ({line.code})
                </option>
              ))}
            </select>
          </div>

          {/* Clear Filters Button */}
          {(selectedPlant || selectedShop || selectedLine) && (
            <button
              onClick={clearFilters}
              className="w-full px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Clear All Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
