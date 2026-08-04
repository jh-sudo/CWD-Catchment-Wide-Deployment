import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { formatDate } from "../lib/utils";
import {
  Package, Warehouse, AlertTriangle, ArrowDownToLine, TrendingDown,
  Plus, ClipboardList, ChevronRight,
} from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";

function StockStatusBadge({ qty, min }: { qty: number; min: number }) {
  if (qty === 0) return <Badge className="bg-red-100 text-red-700 text-[10px]">Out of stock</Badge>;
  if (qty <= min) return <Badge className="bg-orange-100 text-orange-700 text-[10px]">Low stock</Badge>;
  if (qty <= min * 1.5) return <Badge className="bg-yellow-100 text-yellow-700 text-[10px]">Warning</Badge>;
  return <Badge className="bg-green-100 text-green-700 text-[10px]">Healthy</Badge>;
}

export default function Dashboard() {
  const { items, warehouses, movements, stockBalances, getLowStockItems, getTotalStock, alertLogs } = useStore();
  const navigate = useNavigate();
  const lowStock = getLowStockItems();
  const unackAlerts = alertLogs.filter(a => !a.acknowledged).length;
  const recentMovements = movements.slice(0, 8);

  const warehouseMap = Object.fromEntries(warehouses.map(w => [w.id, w]));
  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));

  const summaryCards = [
    { label: "Total Items",      value: items.filter(i=>i.status==="active").length, icon: Package,          color: "bg-blue-50 text-blue-600",   iconBg: "bg-blue-100" },
    { label: "Low Stock",        value: lowStock.length,                              icon: TrendingDown,     color: "bg-orange-50 text-orange-600", iconBg: "bg-orange-100" },
    { label: "Active Warehouses",value: warehouses.filter(w=>w.active).length,        icon: Warehouse,        color: "bg-green-50 text-green-600",  iconBg: "bg-green-100" },
    { label: "Active Alerts",    value: unackAlerts,                                  icon: AlertTriangle,    color: "bg-red-50 text-red-600",      iconBg: "bg-red-100" },
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Flood Response Inventory Overview</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/inventory")} className="hidden sm:flex gap-1.5">
            <ClipboardList className="w-3.5 h-3.5" />Inventory
          </Button>
          <Button size="sm" onClick={() => navigate("/withdraw")} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
            <ArrowDownToLine className="w-3.5 h-3.5" />Withdraw
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summaryCards.map(({ label, value, icon: Icon, color, iconBg }) => (
          <div key={label} className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center mb-3`}>
              <Icon className={`w-4.5 h-4.5 ${color.split(" ")[1]}`} />
            </div>
            <p className="text-2xl font-bold text-slate-800">{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Low stock alert banner */}
      {lowStock.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-orange-800 text-sm">{lowStock.length} low-stock situation{lowStock.length > 1 ? "s" : ""} detected</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {lowStock.slice(0,4).map(({ item, warehouseId, qty }) => (
                <span key={`${item.id}-${warehouseId}`} className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                  {item.name} @ {warehouseMap[warehouseId]?.name} ({qty} left)
                </span>
              ))}
              {lowStock.length > 4 && <span className="text-xs text-orange-600">+{lowStock.length - 4} more</span>}
            </div>
          </div>
          <Button size="sm" variant="outline" className="border-orange-300 text-orange-700 hover:bg-orange-100 shrink-0" onClick={() => navigate("/alerts")}>
            View
          </Button>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Inventory summary */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Item Stock Summary</h2>
            <button onClick={() => navigate("/inventory")} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              View all <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {items.filter(i => i.status === "active").map(item => {
              const total = getTotalStock(item.id);
              return (
                <div key={item.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/inventory/${item.id}`)}>
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500">{item.sku} · Min: {item.minStockLevel} {item.unit}s</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-800">{total}</p>
                    <StockStatusBadge qty={total} min={item.minStockLevel} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Warehouse stock */}
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Warehouse Overview</h2>
            <button onClick={() => navigate("/warehouses")} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
              View all <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-50">
            {warehouses.filter(w => w.active).map(wh => {
              const totalItems = items.reduce((s, item) => {
                const bal = stockBalances.find(b => b.itemId === item.id && b.warehouseId === wh.id);
                return s + (bal?.quantity ?? 0);
              }, 0);
              const lowCount = lowStock.filter(l => l.warehouseId === wh.id).length;
              return (
                <div key={wh.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/warehouses/${wh.id}`)}>
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                    <Warehouse className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800">{wh.name}</p>
                    <p className="text-xs text-slate-500 truncate">{wh.location}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-800">{totalItems} units</p>
                    {lowCount > 0 ? (
                      <Badge className="bg-orange-100 text-orange-700 text-[10px]">{lowCount} low</Badge>
                    ) : (
                      <Badge className="bg-green-100 text-green-700 text-[10px]">OK</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent movements */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Recent Stock Movements</h2>
          <button onClick={() => navigate("/reports")} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
            View all <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Item</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">Warehouse</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Type</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider text-right">Qty</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden md:table-cell">By</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden lg:table-cell">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recentMovements.map(mv => (
                <tr key={mv.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{itemMap[mv.itemId]?.name ?? mv.itemId}</td>
                  <td className="px-5 py-3 text-slate-600 hidden sm:table-cell">{warehouseMap[mv.warehouseId]?.name ?? mv.warehouseId}</td>
                  <td className="px-5 py-3">
                    <Badge className={mv.type === "withdrawal" ? "bg-red-100 text-red-700" : mv.type === "replenishment" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
                      {mv.type}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-800">{mv.type === "withdrawal" ? "-" : "+"}{mv.quantity}</td>
                  <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{mv.performedBy}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs hidden lg:table-cell">{formatDate(mv.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentMovements.length === 0 && (
            <div className="px-5 py-10 text-center text-slate-400 text-sm">No movements recorded yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
