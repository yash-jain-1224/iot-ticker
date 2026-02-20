# IoT Manufacturing Frontend

Complete frontend application for the IoT Manufacturing Platform.

## 📁 Project Structure

```
frontend/
├── public/              # Static assets
├── src/
│   ├── layouts/        # Layout components
│   │   └── MainLayout.jsx
│   ├── pages/          # Page components
│   │   ├── workshops/  # Workshop-specific pages
│   │   │   ├── BodyShop.jsx      ✅ Fully implemented with correct API mapping
│   │   │   ├── PaintShop.jsx
│   │   │   ├── FinalAssembly.jsx
│   │   │   └── Utilities.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Login.jsx
│   │   ├── MachineDetails.jsx
│   │   ├── Analytics.jsx
│   │   ├── Alerts.jsx
│   │   └── Reports.jsx
│   ├── services/       # API services
│   │   └── api.js      # Axios configuration and API endpoints
│   ├── store/          # State management
│   │   └── authStore.js # Zustand auth store
│   ├── App.jsx         # Main app component
│   ├── main.jsx        # App entry point
│   └── index.css       # Global styles
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
└── postcss.config.js
```

## 🎯 Body Shop Page - Correct Data Mapping

The Body Shop page has been implemented with **correct API data mapping** according to the actual API responses:

### API Calls Used
1. **`kpisAPI.getDashboardOverview({ shop_type: 'body_shop' })`**
   - Provides OEE, production, downtime, and energy KPIs

2. **`machinesAPI.getStatusBoard({ shop_type: 'body_shop' })`**
   - Returns machine list with nested objects (plant, shop, line)
   - Includes status, health_score, current_cycle, fault_code, etc.

### Data Transformations

#### 1. Weld Quality Calculation
```javascript
const weldQuality = machines.reduce((sum, m) => 
  sum + (m.health_score || 0), 0) / machines.length
```

#### 2. Machine Status Counts
```javascript
const statusCounts = {
  total: machines.length,
  online: machines.filter(m => m.status === 'online').length,
  offline: machines.filter(m => m.status === 'offline').length,
  idle: machines.filter(m => m.status === 'idle').length,
  fault: machines.filter(m => m.status === 'fault').length,
  maintenance: machines.filter(m => m.status === 'maintenance').length,
}
```

#### 3. Production Lines (Derived from Machines)
```javascript
// Group machines by line
const productionLines = machines.reduce((acc, machine) => {
  const lineName = machine.line?.name || 'Unknown Line'
  // ... grouping logic
}, {})
```

#### 4. Welding Robots (Filtered by Type)
```javascript
const weldingRobots = machines
  .filter(m => m.machine_type === 'welding_robot')
  .map(robot => ({ ... }))
```

#### 5. Active Alerts (From Faulted Machines)
```javascript
const activeAlerts = machines
  .filter(m => m.status === 'fault' || m.fault_code)
  .map(machine => ({ ... }))
```

### Correct Field Mappings
| Display | API Field | Notes |
|---------|-----------|-------|
| Plant Name | `machine.plant?.name` | Nested object |
| Shop Name | `machine.shop?.name` | Nested object |
| Line Name | `machine.line?.name` | Nested object |
| Machine Code | `machine.machine_code` | Direct field |
| Status | `machine.status` | Direct field |
| Health Score | `machine.health_score` | Direct field |
| Load | `machine.current_load` | Direct field |
| Cycle Count | `machine.current_cycle` | Direct field |
| Temperature | N/A | Not available in API |

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Installation

```bash
cd frontend
npm install
```

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Build for Production

```bash
npm run build
```

### Environment Variables

Create a `.env` file:

```env
VITE_API_URL=http://localhost:8000
```

## 📦 Key Dependencies

- **React 18** - UI library
- **React Router** - Routing
- **TanStack Query** (React Query) - Data fetching & caching
- **Zustand** - State management
- **Axios** - HTTP client
- **Tailwind CSS** - Styling
- **Lucide React** - Icons
- **Vite** - Build tool

## 🔐 Authentication

The app uses JWT authentication with Zustand for state persistence:

- Login page at `/login`
- Protected routes redirect to login if not authenticated
- Token stored in localStorage
- Auto-logout on 401 responses

### Demo Credentials
```
Username: admin
Password: admin123
```

## 📊 Features Implemented

### ✅ Fully Implemented
- **Login/Authentication**
- **Dashboard** - Overview of all workshops
- **Body Shop** - Complete with correct API mapping:
  - KPI Cards (OEE, Production, Weld Quality, Downtime)
  - Machine Status Summary (6 status types)
  - Production Lines (derived from machine data)
  - Welding Robots (filtered by machine type)
  - Active Alerts (from faulted machines)
  - Machines Table (all machines with correct field mapping)
- **Machine Details** - Individual machine view
- **Alerts** - System alerts listing

### 🚧 Placeholder Pages
- Paint Shop
- Final Assembly
- Utilities
- Analytics
- Reports

## 🎨 UI Components

All components use Tailwind CSS with:
- Responsive design (mobile, tablet, desktop)
- Status-based color coding
- Loading states
- Error handling
- Empty states

## 📝 Notes

### Body Shop Implementation
- ✅ Uses correct API endpoints
- ✅ Properly maps nested object fields
- ✅ Derives production lines from machine data
- ✅ Filters welding robots by machine type
- ✅ Calculates weld quality from health scores
- ✅ Shows all machine status categories

### Known Limitations
- Temperature field not available in API (shows '-')
- Production targets are estimated (machine_count * 100)
- Weld quality is derived from average health score

## 🔧 Troubleshooting

### CORS Issues
Make sure the backend is configured to allow requests from `http://localhost:3000`

### API Connection
Check that `VITE_API_URL` is set correctly in `.env`

### Build Errors
Try deleting `node_modules` and running `npm install` again

## 📚 Additional Documentation

See the project root for:
- `BODYSHOP_DATA_MAPPING_FIXES.md` - Complete API mapping documentation
- `BODYSHOP_IMPLEMENTATION_SUMMARY.md` - Implementation details

---

**Last Updated:** December 25, 2025  
**Status:** ✅ Frontend Restored with Correct API Mapping
