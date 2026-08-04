import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { Search, Package, Plus, ChevronRight, Filter } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

function stockStatus(qty: number, min: number) {
  if (qty === 0) return { label: "Out of stock", cls: "bg-red-100 text-red-700" };
  if (qty <= min) return { label: "Low stock", cls: "bg-orange-100 text-orange-700" };
  if (qty <= min * 1.5) return { label: "Warning", cls: "bg-yellow-100 text-yellow-700" };
  return { label: "Healthy", cls: "bg-green-100 text-green-700" };
}

export default function Inventory() {
  const { items, warehouses, stockBalances, currentUser, getLowStockItems, getTotalStock } = useStore();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const categories = Array.from(new Set(items.map(i => i.category)));
  const canAdmin = currentUser?.role !== "user";

  const filtered = items.filter(item => {
    if (item.status !== "active") return false;
    const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.sku.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === "all" || item.category === categoryFilter;
    if (!matchSearch || !matchCat) return false;
    if (statusFilter === "low") {
      const total = getTotalStock(item.id);
      return total <= item.minStockLevel;
    }
    return true;
  });

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Inventory</h1>
          <p className="text-sm text-slate-500 mt-0.5">{items.filter(i=>i.status==="active").length} active items</p>
        </div>
        {canAdmin && (
          <Button size="sm" onClick={() => navigate("/admin")} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
            <Plus className="w-3.5 h-3.5" />Add Item
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="Search items or SKU…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-40 h-9">
            <Filter className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-36 h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stock</SelectItem>
            <SelectItem value="low">Low stock only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Items grid */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-2 gap-4">
        {filtered.map(item => {
          const total = getTotalStock(item.id);
          const status = stockStatus(total, item.minStockLevel);
          const whStocks = warehouses.map(wh => {
            const bal = stockBalances.find(b => b.itemId === item.id && b.warehouseId === wh.id);
            return { wh, qty: bal?.quantity ?? 0 };
          });
          return (
            <div
              key={item.id}
              onClick={() => navigate(`/inventory/${item.id}`)}
              className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all group"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">{item.name}</h3>
                    <p className="text-xs text-slate-400">{item.sku} · {item.category}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 shrink-0 mt-1 transition-colors" />
              </div>

              <div className="flex items-end justify-between mb-4">
                <div>
                  <p className="text-3xl font-bold text-slate-800">{total}</p>
                  <p className="text-xs text-slate-500">{item.unit}s total · Min: {item.minStockLevel}</p>
                </div>
                <Badge className={status.cls}>{status.label}</Badge>
              </div>

              {/* Per-warehouse bar */}
              <div className="space-y-1.5">
                {whStocks.map(({ wh, qty }) => {
                  const pct = total > 0 ? Math.round((qty / (total || 1)) * 100) : 0;
                  const barColor = qty === 0 ? "bg-red-400" : qty <= item.minStockLevel / warehouses.length ? "bg-orange-400" : "bg-blue-400";
                  return (
                    <div key={wh.id} className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500 w-24 truncate shrink-0">{wh.name}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-slate-700 font-medium w-6 text-right shrink-0">{qty}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No items match your search</p>
        </div>
      )}
    </div>
  );
}
