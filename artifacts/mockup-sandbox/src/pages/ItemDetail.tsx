import { useParams, useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { formatDate } from "../lib/utils";
import { ArrowLeft, Package, Warehouse, ArrowDownToLine } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

export default function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { items, warehouses, stockBalances, movements, getTotalStock } = useStore();
  const item = items.find(i => i.id === id);
  if (!item) return <div className="p-6 text-slate-500">Item not found.</div>;

  const total = getTotalStock(item.id);
  const itemMovements = movements.filter(m => m.itemId === item.id).slice(0, 20);
  const wh = Object.fromEntries(warehouses.map(w => [w.id, w]));

  const whStocks = warehouses.map(warehouse => {
    const bal = stockBalances.find(b => b.itemId === item.id && b.warehouseId === warehouse.id);
    return { warehouse, qty: bal?.quantity ?? 0 };
  });

  const statusColor = total === 0 ? "bg-red-100 text-red-700" : total <= item.minStockLevel ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700";
  const statusLabel = total === 0 ? "Out of stock" : total <= item.minStockLevel ? "Low stock" : "Healthy";

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-700 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-800">{item.name}</h1>
          <p className="text-sm text-slate-500">{item.sku}</p>
        </div>
        <Button size="sm" onClick={() => navigate(`/withdraw?item=${item.id}`)} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
          <ArrowDownToLine className="w-3.5 h-3.5" />Withdraw
        </Button>
      </div>

      {/* Overview */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
          <p className="text-xs text-slate-500 mb-1">Total Stock</p>
          <p className="text-3xl font-bold text-slate-800">{total}</p>
          <p className="text-xs text-slate-400 mt-0.5">{item.unit}s across all warehouses</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
          <p className="text-xs text-slate-500 mb-1">Minimum Threshold</p>
          <p className="text-3xl font-bold text-slate-800">{item.minStockLevel}</p>
          <p className="text-xs text-slate-400 mt-0.5">{item.unit}s minimum required</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
          <p className="text-xs text-slate-500 mb-1">Status</p>
          <Badge className={`${statusColor} text-sm font-semibold px-3 py-1 mt-1`}>{statusLabel}</Badge>
          <p className="text-xs text-slate-400 mt-2">Category: {item.category}</p>
        </div>
      </div>

      {/* Stock by warehouse */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Stock by Warehouse</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
          {whStocks.map(({ warehouse, qty }) => {
            const pct = total > 0 ? (qty / total) * 100 : 0;
            const isLow = qty <= item.minStockLevel / warehouses.length;
            return (
              <div key={warehouse.id} className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                    <Warehouse className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-800 text-sm">{warehouse.name}</p>
                    <p className="text-xs text-slate-400">{warehouse.contactPerson}</p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-xl font-bold text-slate-800">{qty}</p>
                    <Badge className={isLow && qty <= item.minStockLevel ? "bg-orange-100 text-orange-700 text-[10px]" : "bg-slate-100 text-slate-600 text-[10px]"}>
                      {Math.round(pct)}% of total
                    </Badge>
                  </div>
                </div>
                <div className="bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${qty === 0 ? "bg-red-400" : isLow ? "bg-orange-400" : "bg-blue-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Description */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        <h2 className="font-semibold text-slate-800 mb-2">Details</h2>
        <p className="text-sm text-slate-600">{item.description}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100">
          <div><p className="text-xs text-slate-400">Unit</p><p className="text-sm font-medium text-slate-700 mt-0.5">{item.unit}</p></div>
          <div><p className="text-xs text-slate-400">Category</p><p className="text-sm font-medium text-slate-700 mt-0.5">{item.category}</p></div>
          <div><p className="text-xs text-slate-400">SKU</p><p className="text-sm font-medium text-slate-700 mt-0.5">{item.sku}</p></div>
          <div><p className="text-xs text-slate-400">Updated</p><p className="text-sm font-medium text-slate-700 mt-0.5">{formatDate(item.updatedAt)}</p></div>
        </div>
      </div>

      {/* Movement history */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Movement History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Type</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Warehouse</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider text-right">Qty</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider text-right hidden sm:table-cell">Balance</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden md:table-cell">By</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden lg:table-cell">Remarks</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden xl:table-cell">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {itemMovements.map(mv => (
                <tr key={mv.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Badge className={mv.type === "withdrawal" ? "bg-red-100 text-red-700" : mv.type === "replenishment" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
                      {mv.type}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{wh[mv.warehouseId]?.name}</td>
                  <td className="px-5 py-3 text-right font-semibold">{mv.type === "withdrawal" ? <span className="text-red-600">-{mv.quantity}</span> : <span className="text-green-600">+{mv.quantity}</span>}</td>
                  <td className="px-5 py-3 text-right text-slate-500 hidden sm:table-cell">{mv.balanceAfter}</td>
                  <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{mv.performedBy}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs hidden lg:table-cell max-w-[200px] truncate">{mv.remarks || "—"}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs hidden xl:table-cell">{formatDate(mv.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {itemMovements.length === 0 && (
            <div className="px-5 py-10 text-center text-slate-400 text-sm">No movements recorded yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
