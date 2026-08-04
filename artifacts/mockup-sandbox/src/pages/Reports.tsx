import { useState } from "react";
import { useStore } from "../store";
import { formatDate } from "../lib/utils";
import { Download, BarChart3 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export default function Reports() {
  const { movements, items, warehouses } = useStore();
  const [typeFilter, setTypeFilter] = useState("all");
  const [whFilter, setWhFilter] = useState("all");
  const [itemFilter, setItemFilter] = useState("all");

  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));
  const whMap = Object.fromEntries(warehouses.map(w => [w.id, w]));

  const filtered = movements.filter(mv => {
    if (typeFilter !== "all" && mv.type !== typeFilter) return false;
    if (whFilter !== "all" && mv.warehouseId !== whFilter) return false;
    if (itemFilter !== "all" && mv.itemId !== itemFilter) return false;
    return true;
  });

  const totalWithdrawals = movements.filter(m => m.type === "withdrawal").reduce((s, m) => s + m.quantity, 0);
  const totalReplenishments = movements.filter(m => m.type === "replenishment").reduce((s, m) => s + m.quantity, 0);

  const exportCSV = () => {
    const rows = [
      ["Date","Item","SKU","Warehouse","Type","Quantity","Balance After","Performed By","Remarks"],
      ...filtered.map(mv => [
        formatDate(mv.createdAt),
        itemMap[mv.itemId]?.name ?? mv.itemId,
        itemMap[mv.itemId]?.sku ?? "",
        whMap[mv.warehouseId]?.name ?? mv.warehouseId,
        mv.type, mv.quantity, mv.balanceAfter, mv.performedBy, mv.remarks,
      ])
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `warehouse-movements-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Reports</h1>
          <p className="text-sm text-slate-500 mt-0.5">Full transaction history and audit trail</p>
        </div>
        <Button size="sm" onClick={exportCSV} variant="outline" className="gap-1.5">
          <Download className="w-3.5 h-3.5" />Export CSV
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
          <p className="text-2xl font-bold text-slate-800">{movements.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Total movements</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
          <p className="text-2xl font-bold text-red-600">{totalWithdrawals}</p>
          <p className="text-xs text-slate-500 mt-0.5">Total withdrawn</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm text-center">
          <p className="text-2xl font-bold text-green-600">{totalReplenishments}</p>
          <p className="text-xs text-slate-500 mt-0.5">Total replenished</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Movement type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="withdrawal">Withdrawal</SelectItem>
            <SelectItem value="replenishment">Replenishment</SelectItem>
            <SelectItem value="adjustment">Adjustment</SelectItem>
            <SelectItem value="transfer">Transfer</SelectItem>
          </SelectContent>
        </Select>
        <Select value={whFilter} onValueChange={setWhFilter}>
          <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Warehouse" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All warehouses</SelectItem>
            {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={itemFilter} onValueChange={setItemFilter}>
          <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Item" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            {items.map(i => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-400 self-center">{filtered.length} records</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Item</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">Warehouse</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider text-right">Qty</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider text-right hidden sm:table-cell">Balance</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden md:table-cell">By</th>
                <th className="px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden lg:table-cell">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(mv => (
                <tr key={mv.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDate(mv.createdAt)}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{itemMap[mv.itemId]?.name ?? mv.itemId}</td>
                  <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{whMap[mv.warehouseId]?.name ?? mv.warehouseId}</td>
                  <td className="px-4 py-3">
                    <Badge className={mv.type === "withdrawal" ? "bg-red-100 text-red-700" : mv.type === "replenishment" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>
                      {mv.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    <span className={mv.type === "withdrawal" ? "text-red-600" : "text-green-600"}>
                      {mv.type === "withdrawal" ? "-" : "+"}{mv.quantity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500 hidden sm:table-cell">{mv.balanceAfter}</td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{mv.performedBy}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs max-w-[200px] truncate hidden lg:table-cell">{mv.remarks || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="px-5 py-12 text-center text-slate-400">
              <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No records match your filters.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
