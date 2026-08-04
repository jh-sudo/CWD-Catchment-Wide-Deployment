import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../store";
import { Warehouse as WarehouseIcon, Phone, User, ChevronRight, ArrowLeft, Package } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

function waLink(number: string) {
  return `https://wa.me/${number.replace(/[^0-9]/g, "")}`;
}

const WA_ICON = (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current" xmlns="http://www.w3.org/2000/svg">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

export function WarehouseList() {
  const { warehouses, getLowStockItems } = useStore();
  const navigate = useNavigate();
  const lowStock = getLowStockItems();

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Warehouses</h1>
        <p className="text-sm text-slate-500 mt-0.5">{warehouses.filter(w=>w.active).length} active locations</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {warehouses.filter(w => w.active).map(wh => {
          const low = lowStock.filter(l => l.warehouseId === wh.id).length;
          return (
            <div
              key={wh.id}
              onClick={() => navigate(`/warehouses/${wh.id}`)}
              className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 cursor-pointer hover:shadow-md hover:border-blue-200 transition-all group"
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                    <WarehouseIcon className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">{wh.name}</h3>
                    <p className="text-xs text-slate-400 truncate max-w-[200px]">{wh.location}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {low > 0 && <Badge className="bg-orange-100 text-orange-700 text-[10px]">{low} low</Badge>}
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
                </div>
              </div>
              <div className="space-y-1.5 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  {wh.contactPerson}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    {wh.contactNumber}
                  </div>
                  <a
                    href={waLink(wh.contactNumber)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1 text-[11px] font-medium text-white bg-[#25D366] hover:bg-[#1ebe5d] px-2 py-0.5 rounded-full transition-colors shrink-0"
                  >
                    {WA_ICON}
                    WhatsApp
                  </a>
                </div>
              </div>
              {wh.notes && <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100 line-clamp-2">{wh.notes}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WarehouseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { warehouses, items, stockBalances, movements } = useStore();
  const wh = warehouses.find(w => w.id === id);
  if (!wh) return <div className="p-6 text-slate-500">Warehouse not found.</div>;

  const stocks = items.filter(i => i.status === "active").map(item => {
    const bal = stockBalances.find(b => b.itemId === item.id && b.warehouseId === wh.id);
    return { item, qty: bal?.quantity ?? 0 };
  });
  const recentMovements = movements.filter(m => m.warehouseId === wh.id).slice(0, 10);
  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-slate-400 hover:text-slate-700">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-800">{wh.name}</h1>
          <p className="text-sm text-slate-500">{wh.location}</p>
        </div>
      </div>

      {/* Info card */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
        <h2 className="font-semibold text-slate-800 mb-3">Warehouse Information</h2>
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-400">Contact Person</p>
            <p className="font-medium text-slate-700 mt-0.5">{wh.contactPerson}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Contact Number</p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="font-medium text-slate-700">{wh.contactNumber}</p>
              <a
                href={waLink(wh.contactNumber)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] font-medium text-white bg-[#25D366] hover:bg-[#1ebe5d] px-2 py-0.5 rounded-full transition-colors"
              >
                {WA_ICON}
                WhatsApp
              </a>
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400">Status</p>
            <Badge className="mt-0.5 bg-green-100 text-green-700">Active</Badge>
          </div>
        </div>
        {wh.notes && <p className="text-sm text-slate-500 mt-3 pt-3 border-t border-slate-100">{wh.notes}</p>}
      </div>

      {/* Stock levels */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Current Stock Levels</h2>
        </div>
        <div className="divide-y divide-slate-50">
          {stocks.map(({ item, qty }) => {
            const isLow = qty <= item.minStockLevel;
            return (
              <div key={item.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/inventory/${item.id}`)}>
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <Package className="w-4 h-4 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm">{item.name}</p>
                  <p className="text-xs text-slate-400">{item.sku} · Min: {item.minStockLevel}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-800">{qty}</p>
                  <Badge className={isLow ? "bg-orange-100 text-orange-700 text-[10px]" : "bg-green-100 text-green-700 text-[10px]"}>
                    {isLow ? "Low" : "OK"}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent movements */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Recent Movements</h2>
        </div>
        <div className="divide-y divide-slate-50">
          {recentMovements.map(mv => (
            <div key={mv.id} className="flex items-center gap-4 px-5 py-3.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{itemMap[mv.itemId]?.name ?? mv.itemId}</p>
                <p className="text-xs text-slate-400">{mv.performedBy} · {new Date(mv.createdAt).toLocaleDateString("en-SG")}</p>
              </div>
              <Badge className={mv.type === "withdrawal" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}>
                {mv.type === "withdrawal" ? `-${mv.quantity}` : `+${mv.quantity}`}
              </Badge>
            </div>
          ))}
          {recentMovements.length === 0 && (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">No movements recorded.</div>
          )}
        </div>
      </div>
    </div>
  );
}
