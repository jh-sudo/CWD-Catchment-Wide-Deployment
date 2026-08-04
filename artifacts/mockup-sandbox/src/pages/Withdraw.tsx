import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "../store";
import { ArrowDownToLine, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";

export default function Withdraw() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { items, warehouses, stockBalances, withdraw, currentUser } = useStore();

  const [itemId, setItemId] = useState(params.get("item") ?? "");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [remarks, setRemarks] = useState("");
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedItem = items.find(i => i.id === itemId);
  const availableQty = itemId && warehouseId
    ? stockBalances.find(b => b.itemId === itemId && b.warehouseId === warehouseId)?.quantity ?? 0
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemId || !warehouseId || !quantity) return;
    setLoading(true);
    await new Promise(r => setTimeout(r, 500));
    const r = withdraw(itemId, warehouseId, parseInt(quantity), remarks);
    setResult(r);
    setLoading(false);
    if (r.ok) {
      setQuantity("");
      setRemarks("");
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Withdraw / Indent</h1>
        <p className="text-sm text-slate-500 mt-0.5">Stock is reduced immediately on submission. No approval required.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Item */}
          <div className="space-y-1.5">
            <Label>Item *</Label>
            <Select value={itemId} onValueChange={v => { setItemId(v); setWarehouseId(""); setResult(null); }}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select an item" />
              </SelectTrigger>
              <SelectContent>
                {items.filter(i => i.status === "active").map(item => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} ({item.sku})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Warehouse */}
          <div className="space-y-1.5">
            <Label>Warehouse *</Label>
            <Select value={warehouseId} onValueChange={v => { setWarehouseId(v); setResult(null); }} disabled={!itemId}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder={itemId ? "Select warehouse" : "Select item first"} />
              </SelectTrigger>
              <SelectContent>
                {warehouses.filter(w => w.active).map(wh => {
                  const qty = stockBalances.find(b => b.itemId === itemId && b.warehouseId === wh.id)?.quantity ?? 0;
                  return (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name} — {qty} {selectedItem?.unit ?? "units"} available
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Available stock indicator */}
          {availableQty !== null && (
            <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${availableQty === 0 ? "bg-red-50 text-red-700 border border-red-200" : availableQty <= (selectedItem?.minStockLevel ?? 0) ? "bg-orange-50 text-orange-700 border border-orange-200" : "bg-blue-50 text-blue-700 border border-blue-100"}`}>
              <span className="font-medium">{availableQty} {selectedItem?.unit ?? "units"}</span>
              <span>available at this warehouse</span>
              {availableQty <= (selectedItem?.minStockLevel ?? 0) && availableQty > 0 && (
                <Badge className="ml-auto bg-orange-100 text-orange-700 text-[10px]">Low stock</Badge>
              )}
              {availableQty === 0 && <Badge className="ml-auto bg-red-100 text-red-700 text-[10px]">Out of stock</Badge>}
            </div>
          )}

          {/* Quantity */}
          <div className="space-y-1.5">
            <Label>Quantity *</Label>
            <Input
              type="number" min={1} max={availableQty ?? undefined}
              value={quantity} onChange={e => { setQuantity(e.target.value); setResult(null); }}
              placeholder="Enter quantity" className="h-10" required
            />
          </div>

          {/* Remarks */}
          <div className="space-y-1.5">
            <Label>Remarks / Purpose</Label>
            <Input value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. Emergency deployment to Bishan Park" className="h-10" />
          </div>

          {/* Requested by */}
          <div className="space-y-1.5">
            <Label>Requested by</Label>
            <Input value={currentUser?.name ?? ""} disabled className="h-10 bg-slate-50 text-slate-500" />
          </div>

          {/* Result */}
          {result && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${result.ok ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
              {result.ok ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
              {result.ok ? "Withdrawal recorded successfully. Stock updated." : result.error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="outline" onClick={() => navigate(-1)} className="flex-1">Cancel</Button>
            <Button
              type="submit"
              disabled={loading || !itemId || !warehouseId || !quantity || availableQty === 0}
              className="flex-1 bg-blue-600 hover:bg-blue-700 gap-1.5"
            >
              <ArrowDownToLine className="w-4 h-4" />
              {loading ? "Processing…" : "Confirm Withdrawal"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
