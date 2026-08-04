import { useStore } from "../store";
import { formatDate } from "../lib/utils";
import { Bell, CheckCircle, AlertTriangle, MessageCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

export default function Alerts() {
  const { alertLogs, items, warehouses, acknowledgeAlert } = useStore();
  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));
  const whMap = Object.fromEntries(warehouses.map(w => [w.id, w]));

  const unack = alertLogs.filter(a => !a.acknowledged);
  const ack = alertLogs.filter(a => a.acknowledged);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Alerts</h1>
          <p className="text-sm text-slate-500 mt-0.5">{unack.length} unacknowledged alert{unack.length !== 1 ? "s" : ""}</p>
        </div>
        {unack.length > 0 && (
          <Badge className="bg-red-500 text-white text-sm px-3 py-1">{unack.length} active</Badge>
        )}
      </div>

      {/* Active alerts */}
      {unack.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">Active Alerts</h2>
          {unack.map(alert => {
            const item = itemMap[alert.itemId];
            const wh = whMap[alert.warehouseId];
            return (
              <div key={alert.id} className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-semibold text-orange-800">{item?.name ?? alert.itemId}</p>
                      <Badge className="bg-orange-200 text-orange-800 text-[10px]">{wh?.name ?? alert.warehouseId}</Badge>
                      {alert.whatsappSent && (
                        <Badge className="bg-green-100 text-green-700 text-[10px] flex items-center gap-0.5">
                          <MessageCircle className="w-2.5 h-2.5" />WhatsApp sent
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-orange-700">
                      Current stock: <strong>{alert.currentStock}</strong> · Minimum threshold: <strong>{alert.minThreshold}</strong>
                    </p>
                    <p className="text-xs text-orange-500 mt-1">{formatDate(alert.sentAt)}</p>
                    <div className="mt-2 p-2.5 bg-orange-100 rounded-lg text-xs text-orange-700 font-mono">
                      🚨 LOW STOCK ALERT | {item?.name} @ {wh?.name}<br />
                      Current: {alert.currentStock} · Min threshold: {alert.minThreshold}<br />
                      Time: {formatDate(alert.sentAt)}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => acknowledgeAlert(alert.id)}
                    className="shrink-0 bg-orange-600 hover:bg-orange-700 gap-1"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />Acknowledge
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Acknowledged alerts */}
      {ack.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">Acknowledged</h2>
          {ack.map(alert => {
            const item = itemMap[alert.itemId];
            const wh = whMap[alert.warehouseId];
            return (
              <div key={alert.id} className="bg-white border border-slate-100 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-medium text-slate-600">{item?.name ?? alert.itemId}</p>
                      <Badge className="bg-slate-100 text-slate-500 text-[10px]">{wh?.name ?? alert.warehouseId}</Badge>
                    </div>
                    <p className="text-sm text-slate-500">Stock was {alert.currentStock} (min: {alert.minThreshold})</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Alerted {formatDate(alert.sentAt)}
                      {alert.acknowledgedAt && ` · Acknowledged ${formatDate(alert.acknowledgedAt)}`}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {alertLogs.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No alerts yet</p>
          <p className="text-sm mt-1">Alerts fire automatically when stock falls below the minimum threshold.</p>
        </div>
      )}
    </div>
  );
}
