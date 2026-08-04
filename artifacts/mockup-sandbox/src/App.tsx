import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useStore } from "./store";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import ItemDetail from "./pages/ItemDetail";
import { WarehouseList, WarehouseDetail } from "./pages/Warehouses";
import Withdraw from "./pages/Withdraw";
import Alerts from "./pages/Alerts";
import Reports from "./pages/Reports";
import Admin from "./pages/Admin";
import Users from "./pages/Users";
import Settings from "./pages/Settings";
import Vehicles from "./pages/Vehicles";
import VehicleChecklist from "./pages/VehicleChecklist";

function ProtectedLayout() {
  const currentUser = useStore(s => s.currentUser);
  if (!currentUser) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function PublicOnly() {
  const currentUser = useStore(s => s.currentUser);
  if (currentUser) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

export default function App() {
  const base = import.meta.env.BASE_URL;

  return (
    <BrowserRouter basename={base}>
      <Routes>
        {/* Public-only routes */}
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<Login />} />
        </Route>

        {/* Protected routes */}
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/inventory/:id" element={<ItemDetail />} />
          <Route path="/warehouses" element={<WarehouseList />} />
          <Route path="/warehouses/:id" element={<WarehouseDetail />} />
          <Route path="/withdraw" element={<Withdraw />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/users" element={<Users />} />
          <Route path="/vehicles" element={<Vehicles />} />
          <Route path="/checklist" element={<VehicleChecklist />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
