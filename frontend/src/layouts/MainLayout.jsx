import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import TickerBar from '../components/TickerBar'
import {
  HomeIcon,
  CpuChipIcon,
  Cog6ToothIcon,
  BellIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  WrenchScrewdriverIcon,
  BeakerIcon,
  BuildingOffice2Icon,
  BoltIcon,
  XMarkIcon,
  ArrowRightOnRectangleIcon,
} from '@heroicons/react/24/outline'

function MainLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const navigation = [
    { 
      name: 'MAIN', 
      section: true 
    },
    { name: 'Dashboard', href: '/', icon: HomeIcon },
    { name: 'Machines', href: '/machines', icon: CpuChipIcon },
    { name: 'Control Center', href: '/control-center', icon: Cog6ToothIcon },
    { name: 'Alerts', href: '/alerts', icon: BellIcon },
    // { name: 'Analytics', href: '/analytics', icon: ChartBarIcon },
    { name: 'Forecasts', href: '/forecasts', icon: ArrowTrendingUpIcon },
    { 
      name: 'WORKSHOPS', 
      section: true 
    },
    { name: 'Body Shop', href: '/workshops/body-shop', icon: WrenchScrewdriverIcon },
    { name: 'Paint Shop', href: '/workshops/paint-shop', icon: BeakerIcon },
    { name: 'Final Assembly', href: '/workshops/final-assembly', icon: BuildingOffice2Icon },
    { name: 'Utilities', href: '/workshops/utilities', icon: BoltIcon },
    // { 
    //   name: 'AI/BI', 
    //   section: true 
    // },
    // { name: 'AI/BI Dashboards', href: '/ai-bi-dashboards', icon: ChartPieIcon },
    { 
      name: 'ANALYTICS DASHBOARD', 
      section: true 
    },
    { name: 'Operator View', href: '/analytics-dashboard/operator', icon: CpuChipIcon },
    { name: 'Manager View', href: '/analytics-dashboard/manager', icon: ChartBarIcon },
    { name: 'Leadership View', href: '/analytics-dashboard/leadership', icon: BuildingOffice2Icon },
  ]

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white shadow-lg transform transition-transform duration-300 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-3 h-12 px-6 border-b border-gray-200">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
              <CpuChipIcon className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900">Auronix Motors</h1>
              <p className="text-xs text-gray-500">Vehicle Manufacturing</p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden ml-auto text-gray-500 hover:text-gray-700"
            >
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navigation.map((item, index) => (
              <div key={item.name + index}>
                {item.section ? (
                  <div className="px-3 pt-3 pb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    {item.name}
                  </div>
                ) : item.href && item.icon ? (
                  <Link
                    to={item.href}
                    className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                      location.pathname === item.href
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    <span>{item.name}</span>
                  </Link>
                ) : null}
              </div>
            ))}
          </nav>

          {/* User Info */}
          <div className="border-t border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
                {user?.username?.charAt(0).toUpperCase() || 'S'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-gray-900 truncate">
                  {user?.fullName || 'John Doe'}
                </p>
                <p className="text-[11px] text-gray-500 capitalize">{user?.role || 'Admin'}</p>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50 flex-shrink-0"
                title="Logout"
              >
                <ArrowRightOnRectangleIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="fixed inset-0 lg:pl-64 flex flex-col">
        {/* Ticker Bar */}
        <TickerBar />
        
        {/* Top bar */}
        {/* <header className="flex-shrink-0 bg-white shadow-sm border-b border-gray-200">
          <div className="flex items-center justify-between h-16 px-6">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-gray-500 hover:text-gray-700"
            >
              <Bars3Icon className="w-6 h-6" />
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-4">
              <button className="relative p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                <BellIcon className="w-5 h-5" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              </button>
              <button className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                <Cog6ToothIcon className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header> */}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-gray-50">{children}</main>
      </div>
    </div>
  )
}

export default MainLayout
