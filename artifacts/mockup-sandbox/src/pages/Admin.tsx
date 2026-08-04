import { useState } from "react";
import { useStore } from "../store";
import { formatDate } from "../lib/utils";
import { Plus, Pencil, Trash2, Check, X, Package } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import type { Item, MovementType } from "../lib/data";

function StockAdjustPanel() {
  const { items, warehouses, stockBalances, adjustStock, currentUser } = useStore();
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [qty, setQty] = useState("");
  const [type, setType] = useState<MovementType>("replenishment");
  const [remarks, setRemarks] = useState("");
  const [done, setDone] = useState(false);

  const currentQty = itemId && warehouseId
    ? stockBalances.find(b => b.itemId === itemId && b.warehouseId === warehouseId)?.quantity ?? 0
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemId || !warehouseId || !qty) return;
    const n = parseInt(qty);
    adjustStock(itemId, warehouseId, n, type, remarks);
    setDone(true);
    setTimeout(() => setDone(false), 2000);
    setQty(""); setRemarks("");
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
      <h2 className="font-semibold text-slate-800 mb-4">Stock Adjustment</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Item</Label>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select item" /></SelectTrigger>
              <SelectContent>{items.filter(i=>i.status==="active").map(i=><SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select warehouse" /></SelectTrigger>
              <SelectContent>{warehouses.filter(w=>w.active).map(w=><SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {currentQty !== null && (
          <p className="text-sm text-slate-500">Current stock: <strong className="text-slate-800">{currentQty}</strong></p>
        )}
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={v => setType(v as MovementType)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="replenishment">Replenishment (+)</SelectItem>
                <SelectItem value="adjustment">Set absolute value</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <Input type="number" min={0} value={qty} onChange={e=>setQty(e.target.value)} className="h-9" required />
          </div>
          <div className="space-y-1.5">
            <Label>Remarks</Label>
            <Input value={remarks} onChange={e=>setRemarks(e.target.value)} placeholder="Optional" className="h-9" />
          </div>
        </div>
        <Button type="submit" size="sm" className={`gap-1.5 ${done ? "bg-green-600" : "bg-blue-600 hover:bg-blue-700"}`}>
          {done ? <><Check className="w-3.5 h-3.5" />Done!</> : "Apply Adjustment"}
        </Button>
      </form>
    </div>
  );
}

function ItemForm({ item, onDone }: { item?: Item; onDone: () => void }) {
  const { addItem, updateItem } = useStore();
  const [form, setForm] = useState({
    name: item?.name ?? "",
    sku: item?.sku ?? "",
    description: item?.description ?? "",
    category: item?.category ?? "Flood Barrier",
    unit: item?.unit ?? "unit",
    minStockLevel: item?.minStockLevel ?? 10,
    status: item?.status ?? "active" as "active"|"inactive",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (item) updateItem(item.id, form);
    else addItem(form);
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="h-8 text-sm" required /></div>
        <div className="space-y-1"><Label className="text-xs">SKU *</Label><Input value={form.sku} onChange={e=>setForm({...form,sku:e.target.value})} className="h-8 text-sm" required /></div>
        <div className="space-y-1"><Label className="text-xs">Category</Label><Input value={form.category} onChange={e=>setForm({...form,category:e.target.value})} className="h-8 text-sm" /></div>
        <div className="space-y-1"><Label className="text-xs">Unit</Label><Input value={form.unit} onChange={e=>setForm({...form,unit:e.target.value})} className="h-8 text-sm" /></div>
        <div className="space-y-1"><Label className="text-xs">Min Stock Level</Label><Input type="number" min={0} value={form.minStockLevel} onChange={e=>setForm({...form,minStockLevel:parseInt(e.target.value)||0})} className="h-8 text-sm" /></div>
        <div className="space-y-1"><Label className="text-xs">Status</Label>
          <Select value={form.status} onValueChange={v=>setForm({...form,status:v as any})}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1"><Label className="text-xs">Description</Label><Input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="h-8 text-sm" /></div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-700">{item ? "Save" : "Add Item"}</Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

export default function Admin() {
  const { items, warehouses, stockBalances, deleteItem, currentUser } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Item | undefined>();

  if (!currentUser || currentUser.role !== "system_admin") {
    return <div className="p-6 text-slate-500">Access denied. System administrators only.</div>;
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Stock Management</h1>
        <p className="text-sm text-slate-500 mt-0.5">Add, edit, and adjust inventory items.</p>
      </div>

      <StockAdjustPanel />

      {/* Items table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Items</h2>
          <Button size="sm" onClick={() => { setShowForm(!showForm); setEditItem(undefined); }} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
            <Plus className="w-3.5 h-3.5" />New Item
          </Button>
        </div>

        {(showForm && !editItem) && (
          <div className="p-4 border-b border-slate-100">
            <ItemForm onDone={() => setShowForm(false)} />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Item</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">SKU</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider text-right">Min Stock</th>
                {warehouses.filter(w=>w.active).map(wh => (
                  <th key={wh.id} className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider text-right hidden lg:table-cell">{wh.name}</th>
                ))}
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map(item => (
                <>
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-slate-400 shrink-0" />
                        <div>
                          <p className="font-medium text-slate-800">{item.name}</p>
                          <p className="text-xs text-slate-400">{item.category} · {item.unit}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-500 hidden sm:table-cell">{item.sku}</td>
                    <td className="px-5 py-3 text-right font-medium text-slate-700">{item.minStockLevel}</td>
                    {warehouses.filter(w=>w.active).map(wh => {
                      const bal = stockBalances.find(b => b.itemId === item.id && b.warehouseId === wh.id);
                      const qty = bal?.quantity ?? 0;
                      return (
                        <td key={wh.id} className="px-5 py-3 text-right hidden lg:table-cell">
                          <span className={qty <= item.minStockLevel / 4 ? "text-red-600 font-semibold" : qty <= item.minStockLevel ? "text-orange-600 font-semibold" : "text-slate-700"}>{qty}</span>
                        </td>
                      );
                    })}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => { setEditItem(item); setShowForm(false); }} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {currentUser?.role === "system_admin" && (
                          <button onClick={() => { if (confirm(`Delete ${item.name}?`)) deleteItem(item.id); }} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {editItem?.id === item.id && (
                    <tr>
                      <td colSpan={10} className="px-5 py-3 bg-blue-50 border-b border-blue-100">
                        <ItemForm item={editItem} onDone={() => setEditItem(undefined)} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
