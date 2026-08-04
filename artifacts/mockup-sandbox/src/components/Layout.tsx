import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { cn } from "../lib/utils";
import {
  LayoutDashboard, Package, Warehouse, ArrowDownToLine,
  Bell, BarChart3, Settings, Users, LogOut, Menu, X, ChevronDown, Truck, ClipboardCheck,
} from "lucide-react";
import { Badge } from "./ui/badge";

const NAV_ITEMS = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard",  roles: ["user","store_admin","system_admin"] },
  { to: "/inventory",  icon: Package,         label: "Inventory",   roles: ["user","store_admin","system_admin"] },
  { to: "/warehouses", icon: Warehouse,       label: "Warehouses",  roles: ["user","store_admin","system_admin"] },
  { to: "/withdraw",   icon: ArrowDownToLine, label: "Withdraw",    roles: ["user","store_admin","system_admin"] },
  { to: "/alerts",     icon: Bell,            label: "Alerts",      roles: ["store_admin","system_admin"] },
  { to: "/reports",    icon: BarChart3,       label: "Reports",     roles: ["store_admin","system_admin"] },
  { to: "/vehicles",   icon: Truck,           label: "Vehicles",    roles: ["user","store_admin","system_admin"] },
  { to: "/checklist",  icon: ClipboardCheck,  label: "Checklist",   roles: ["user","store_admin","system_admin"] },
  { to: "/admin",      icon: Settings,        label: "Stock Mgmt",  roles: ["system_admin"] },
  { to: "/users",      icon: Users,           label: "Users",       roles: ["system_admin"] },
  { to: "/settings",   icon: Settings,        label: "Settings",    roles: ["system_admin"] },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { currentUser, logout, alertLogs } = useStore();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const unackAlerts = alertLogs.filter(a => !a.acknowledged).length;
  const role = currentUser?.role ?? "user";
  const navItems = NAV_ITEMS.filter(n => n.roles.includes(role));

  const handleLogout = () => { logout(); navigate("/"); };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-4 py-5 border-b border-slate-700">
        <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
          <Warehouse className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">Warehouse IMS</p>
          <p className="text-[10px] text-slate-400 truncate">Flood Response System</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) => cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
              isActive
                ? "bg-blue-600 text-white"
                : "text-slate-300 hover:bg-slate-700 hover:text-white"
            )}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="truncate">{label}</span>
            {label === "Alerts" && unackAlerts > 0 && (
              <Badge className="ml-auto bg-red-500 text-white text-[10px] h-4 min-w-4 px-1">{unackAlerts}</Badge>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-slate-700">
        <div className="flex items-center gap-3 px-3 py-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
            {currentUser?.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white truncate">{currentUser?.name}</p>
            <p className="text-[10px] text-slate-400 capitalize truncate">{currentUser?.role.replace("_"," ")}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-700 transition-all"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 shrink-0 bg-slate-800 flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-56 bg-slate-800 flex flex-col z-50">
            <button className="absolute top-4 right-3 text-slate-400 hover:text-white" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-600 hover:text-slate-900">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center">
              <Warehouse className="w-3 h-3 text-white" />
            </div>
            <span className="font-bold text-slate-800 text-sm">Warehouse IMS</span>
          </div>
          {unackAlerts > 0 && (
            <Badge className="ml-auto bg-red-500 text-white text-[10px] h-5 px-1.5">{unackAlerts} alerts</Badge>
          )}
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
