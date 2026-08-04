import { useState, useRef, useEffect } from "react";
import { useStore } from "../store";
import { Plus, Trash2, CheckCircle2, XCircle, Clock, ChevronDown } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import type { Role } from "../lib/data";

const ROLE_LABELS: Record<Role, string> = {
  user: "General User",
  store_admin: "Store Admin",
  system_admin: "System Admin",
};

const ROLE_COLORS: Record<Role, string> = {
  user: "bg-slate-100 text-slate-600",
  store_admin: "bg-blue-100 text-blue-700",
  system_admin: "bg-purple-100 text-purple-700",
};

const EDITABLE_ROLES: Role[] = ["user", "store_admin"];

function InlineRoleEditor({ userId, role, onSave }: { userId: string; role: Role; onSave: (role: Role) => void }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setEditing(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editing]);

  if (role === "system_admin") {
    return (
      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[role]}`}>
        {ROLE_LABELS[role]}
      </span>
    );
  }

  if (editing) {
    return (
      <div ref={ref} className="relative z-20">
        <select
          autoFocus
          value={role}
          onChange={e => { onSave(e.target.value as Role); setEditing(false); }}
          onBlur={() => setEditing(false)}
          className="text-xs border border-blue-400 rounded-lg px-2 py-1 bg-white shadow-md outline-none cursor-pointer"
        >
          {EDITABLE_ROLES.map(r => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to change role"
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium transition-opacity hover:opacity-75 ${ROLE_COLORS[role]}`}
    >
      {ROLE_LABELS[role]}
      <ChevronDown className="w-3 h-3 opacity-60" />
    </button>
  );
}

export default function Users() {
  const { users, warehouses, addUser, updateUser, deleteUser, approveUser, rejectUser, currentUser } = useStore();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "user" as Role, warehouseId: "" });

  if (currentUser?.role !== "system_admin") {
    return <div className="p-6 text-slate-500">Access denied. System administrators only.</div>;
  }

  const pendingUsers = users.filter(u => u.status === "pending");
  const activeUsers  = users.filter(u => u.status !== "pending");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    addUser({ ...form, active: true, status: "active" });
    setShowForm(false);
    setForm({ name: "", email: "", password: "", role: "user", warehouseId: "" });
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-800">User Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeUsers.filter(u => u.active).length} active
            {pendingUsers.length > 0 && ` · ${pendingUsers.length} pending approval`}
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm(!showForm)} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
          <Plus className="w-3.5 h-3.5" />Add User
        </Button>
      </div>

      {/* ── Pending Approval Panel ── */}
      {pendingUsers.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-amber-200 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <span className="font-semibold text-amber-800 text-sm">
              Pending Approval ({pendingUsers.length})
            </span>
          </div>
          <div className="divide-y divide-amber-100">
            {pendingUsers.map(user => (
              <div key={user.id} className="px-5 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-amber-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {user.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm truncate">{user.name}</p>
                  <p className="text-xs text-slate-500 truncate">{user.email}</p>
                </div>
                <p className="text-xs text-slate-400 hidden sm:block shrink-0">
                  {new Date(user.createdAt).toLocaleDateString()}
                </p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => approveUser(user.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => { if (confirm(`Reject and remove ${user.name}'s account?`)) rejectUser(user.id); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 text-slate-600 hover:text-red-600 text-xs font-medium transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add User Form ── */}
      {showForm && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
          <h2 className="font-semibold text-slate-800 mb-4">New User</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label className="text-xs">Full Name *</Label><Input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="h-9" required /></div>
              <div className="space-y-1.5"><Label className="text-xs">Email *</Label><Input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} className="h-9" required /></div>
              <div className="space-y-1.5"><Label className="text-xs">Password *</Label><Input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} className="h-9" required /></div>
              <div className="space-y-1.5">
                <Label className="text-xs">Role</Label>
                <Select value={form.role} onValueChange={v=>setForm({...form,role:v as Role})}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">General User</SelectItem>
                    <SelectItem value="store_admin">Store Admin</SelectItem>
                    <SelectItem value="system_admin">System Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.role === "store_admin" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Assigned Warehouse</Label>
                  <Select value={form.warehouseId} onValueChange={v=>setForm({...form,warehouseId:v})}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>{warehouses.map(w=><SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="bg-blue-600 hover:bg-blue-700">Create User</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {/* ── Active / All Users Table ── */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-left">
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">User</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden sm:table-cell">Email</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Role</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider hidden md:table-cell">Warehouse</th>
                <th className="px-5 py-3 text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {activeUsers.map(user => {
                const wh = warehouses.find(w => w.id === user.warehouseId);
                return (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {user.name.charAt(0)}
                        </div>
                        <span className="font-medium text-slate-800">{user.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-500 hidden sm:table-cell">{user.email}</td>
                    <td className="px-5 py-3">
                      <InlineRoleEditor
                        userId={user.id}
                        role={user.role}
                        onSave={role => updateUser(user.id, { role })}
                      />
                    </td>
                    <td className="px-5 py-3 text-slate-500 hidden md:table-cell">{wh?.name ?? "—"}</td>
                    <td className="px-5 py-3">
                      <button
                        onClick={() => updateUser(user.id, { active: !user.active, status: user.active ? "pending" : "active" })}
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${user.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}
                      >
                        {user.active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="px-5 py-3">
                      {user.id !== currentUser?.id && (
                        <button onClick={() => { if (confirm(`Delete ${user.name}?`)) deleteUser(user.id); }}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
