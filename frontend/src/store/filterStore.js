import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useFilterStore = create(
  persist(
    (set) => ({
      // Location filters
      location: 'all', // 'all', 'houston', 'dallas', 'austin'
      plantId: null,
      shopType: null,
      
      // Time filters
      timeRange: '24h', // '24h', '7d', '30d', 'custom'
      dateRange: null,
      
      // Workshop filters
      workshop: null, // 'body-shop', 'paint-shop', 'final-assembly', 'utilities'
      
      // Machine filters
      machineStatus: null, // 'online', 'idle', 'fault', 'maintenance'
      machineId: null,
      
      // Actions
      setLocation: (location) => set({ location }),
      setPlantId: (plantId) => set({ plantId }),
      setShopType: (shopType) => set({ shopType }),
      setTimeRange: (timeRange) => set({ timeRange }),
      setDateRange: (dateRange) => set({ dateRange }),
      setWorkshop: (workshop) => set({ workshop }),
      setMachineStatus: (machineStatus) => set({ machineStatus }),
      setMachineId: (machineId) => set({ machineId }),
      
      clearFilters: () => set({ 
        location: 'all',
        plantId: null, 
        shopType: null, 
        timeRange: '24h',
        dateRange: null,
        workshop: null,
        machineStatus: null,
        machineId: null,
      }),
    }),
    {
      name: 'filter-storage', // localStorage key
    }
  )
)
