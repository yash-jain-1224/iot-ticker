import { Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function Layout() {
  const { user } = useAuthStore();

  return (
    <div className="min-h-screen bg-gray-50">
      {user && (
        <header className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Auronix Motors IoT Platform
                </h1>
                <p className="text-sm text-gray-600">Real-time Manufacturing Intelligence</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-900">{user.fullname}</p>
                  <p className="text-xs text-gray-500 capitalize">{user.role}</p>
                </div>
                <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                  <span className="text-white font-semibold">
                    {user.fullname?.charAt(0).toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>
      )}
      <main>
        <Outlet />
      </main>
    </div>
  );
}
