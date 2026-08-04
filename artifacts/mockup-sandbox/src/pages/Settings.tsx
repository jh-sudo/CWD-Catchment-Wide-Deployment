import { useState } from "react";
import { useStore } from "../store";
import { MessageCircle, Plus, Trash2, Save, Warehouse as WarehouseIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import type { Warehouse } from "../lib/data";

export default function Settings() {
  const { whatsappConfig, updateWhatsAppConfig, warehouses, addWarehouse, updateWarehouse, currentUser } = useStore();
  const [newPhone, setNewPhone] = useState("");
  const [waSaved, setWaSaved] = useState(false);
  const [editWh, setEditWh] = useState<Warehouse | null>(null);
  const [newWh, setNewWh] = useState({ name: "", location: "", contactPerson: "", contactNumber: "", notes: "", active: true });
  const [showWhForm, setShowWhForm] = useState(false);

  if (currentUser?.role !== "system_admin") {
    return <div className="p-6 text-slate-500">Access denied. System administrators only.</div>;
  }

  const addPhone = () => {
    if (newPhone && !whatsappConfig.phoneNumbers.includes(newPhone)) {
      updateWhatsAppConfig({ phoneNumbers: [...whatsappConfig.phoneNumbers, newPhone] });
      setNewPhone("");
    }
  };

  const removePhone = (p: string) => {
    updateWhatsAppConfig({ phoneNumbers: whatsappConfig.phoneNumbers.filter(n => n !== p) });
  };

  const saveWaSettings = () => {
    setWaSaved(true);
    setTimeout(() => setWaSaved(false), 2000);
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-slate-800">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">System configuration and alert settings</p>
      </div>

      {/* WhatsApp config */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center">
            <MessageCircle className="w-4.5 h-4.5 text-green-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800">WhatsApp Alerts</h2>
            <p className="text-xs text-slate-400">Auto-alert when stock falls below threshold</p>
          </div>
        </div>

        <div className="flex items-center justify-between py-3 border-t border-slate-100">
          <div>
            <p className="text-sm font-medium text-slate-700">Enable WhatsApp alerts</p>
            <p className="text-xs text-slate-400">Send automated messages on low stock</p>
          </div>
          <Switch checked={whatsappConfig.enabled} onCheckedChange={v => updateWhatsAppConfig({ enabled: v })} />
        </div>

        <div className="space-y-2">
          <Label className="text-sm">Alert recipients</Label>
          <div className="space-y-2">
            {whatsappConfig.phoneNumbers.map(p => (
              <div key={p} className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                <span className="text-sm text-slate-700 flex-1">{p}</span>
                <button onClick={() => removePhone(p)} className="text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={newPhone} onChange={e=>setNewPhone(e.target.value)} placeholder="+65 9123 4567" className="h-9 flex-1" />
            <Button size="sm" type="button" onClick={addPhone} variant="outline" className="gap-1"><Plus className="w-3.5 h-3.5" />Add</Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Alert cooldown (minutes)</Label>
          <Input
            type="number" min={1} max={1440}
            value={whatsappConfig.cooldownMinutes}
            onChange={e => updateWhatsAppConfig({ cooldownMinutes: parseInt(e.target.value) || 60 })}
            className="h-9 w-40"
          />
          <p className="text-xs text-slate-400">Prevents duplicate alerts within this period. Resets when stock is replenished.</p>
        </div>

        <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
          <p className="text-xs font-medium text-slate-600 mb-1.5">Sample alert message</p>
          <p className="text-xs text-slate-500 font-mono leading-relaxed">
            🚨 LOW STOCK ALERT<br/>
            Item: Floodsax (FSX-002)<br/>
            Warehouse: Kallang Way<br/>
            Current: 3 bags | Minimum: 50 bags<br/>
            Time: 16 Jul 2026, 11:45 AM<br/>
            — Warehouse IMS
          </p>
        </div>

        <Button size="sm" onClick={saveWaSettings} className={waSaved ? "bg-green-600" : "bg-blue-600 hover:bg-blue-700"}>
          <Save className="w-3.5 h-3.5 mr-1.5" />{waSaved ? "Saved!" : "Save Settings"}
        </Button>
      </div>

      {/* Warehouse management */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <WarehouseIcon className="w-4.5 h-4.5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800">Warehouses</h2>
              <p className="text-xs text-slate-400">Manage warehouse locations</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowWhForm(!showWhForm)} className="gap-1">
            <Plus className="w-3.5 h-3.5" />Add
          </Button>
        </div>

        {showWhForm && (
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              {(["name","location","contactPerson","contactNumber"] as const).map(field => (
                <div key={field} className="space-y-1">
                  <Label className="text-xs capitalize">{field.replace(/([A-Z])/g," $1")}</Label>
                  <Input value={newWh[field]} onChange={e=>setNewWh({...newWh,[field]:e.target.value})} className="h-8 text-sm" />
                </div>
              ))}
            </div>
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={newWh.notes} onChange={e=>setNewWh({...newWh,notes:e.target.value})} className="h-8 text-sm" /></div>
            <div className="flex gap-2">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => { addWarehouse(newWh); setShowWhForm(false); setNewWh({ name:"",location:"",contactPerson:"",contactNumber:"",notes:"",active:true }); }}>Add Warehouse</Button>
              <Button size="sm" variant="outline" onClick={() => setShowWhForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {warehouses.map(wh => (
            <div key={wh.id} className="py-3">
              {editWh?.id === wh.id ? (
                <div className="space-y-2">
                  <div className="grid sm:grid-cols-2 gap-2">
                    {(["name","location","contactPerson","contactNumber"] as const).map(field => (
                      <div key={field} className="space-y-0.5">
                        <Label className="text-[10px] text-slate-400 capitalize">{field.replace(/([A-Z])/g," $1")}</Label>
                        <Input value={(editWh as any)[field]} onChange={e=>setEditWh({...editWh,[field]:e.target.value} as any)} className="h-7 text-xs" />
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700" onClick={() => { updateWarehouse(wh.id, editWh); setEditWh(null); }}>Save</Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditWh(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800">{wh.name}</p>
                    <p className="text-xs text-slate-400 truncate">{wh.location} · {wh.contactPerson} · {wh.contactNumber}</p>
                  </div>
                  <button onClick={() => setEditWh(wh)} className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
