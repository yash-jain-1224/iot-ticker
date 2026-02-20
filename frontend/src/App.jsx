import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/authStore'
import MainLayout from './layouts/MainLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import BodyShop from './pages/workshops/BodyShop'
import PaintShop from './pages/workshops/PaintShop'
import FinalAssembly from './pages/workshops/FinalAssembly'
import Utilities from './pages/workshops/Utilities'
import MachineDetail from './pages/MachineDetail'
import Analytics from './pages/Analytics'
import Alerts from './pages/Alerts'
import Reports from './pages/Reports'
import ControlCenter from './pages/ControlCenter'
import Forecasts from './pages/Forecasts'
import AIBIDashboards from './pages/AIBIDashboards'
import MachineDashboard from './pages/MachineDashboard'
import OperatorDashboard from './pages/analytics/OperatorDashboard'
import ManagerDashboard from './pages/analytics/ManagerDashboard'
import LeadershipDashboard from './pages/analytics/LeadershipDashboard'

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? children : <Navigate to="/login" replace />
}

function PublicRoute({ children }) {
  const { isAuthenticated } = useAuthStore()
  return isAuthenticated ? <Navigate to="/" replace /> : children
}

function App() {
  return (
    <>
      {/* Global Toast Notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
            borderRadius: '8px',
            fontSize: '14px',
            padding: '12px 16px',
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: '#10b981',
              secondary: '#fff',
            },
          },
          error: {
            duration: 5000,
            iconTheme: {
              primary: '#ef4444',
              secondary: '#fff',
            },
          },
          loading: {
            iconTheme: {
              primary: '#3b82f6',
              secondary: '#fff',
            },
          },
        }}
      />
      
      <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <MainLayout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/machines" element={<MachineDashboard />} />
                <Route path="/machines/:id" element={<MachineDetail />} />
                <Route path="/control-center" element={<ControlCenter />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/forecasts" element={<Forecasts />} />
                <Route path="/workshops/body-shop" element={<BodyShop />} />
                <Route path="/workshops/paint-shop" element={<PaintShop />} />
                <Route path="/workshops/final-assembly" element={<FinalAssembly />} />
                <Route path="/workshops/utilities" element={<Utilities />} />
                <Route path="/ai-bi-dashboards" element={<AIBIDashboards />} />
                <Route path="/analytics-dashboard/operator" element={<OperatorDashboard />} />
                <Route path="/analytics-dashboard/manager" element={<ManagerDashboard />} />
                <Route path="/analytics-dashboard/leadership" element={<LeadershipDashboard />} />
                <Route path="/reports" element={<Reports />} />
              </Routes>
            </MainLayout>
          </ProtectedRoute>
        }
      />
    </Routes>
    </>
  )
}

export default App
