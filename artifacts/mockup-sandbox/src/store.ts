import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  User, Warehouse, Item, StockBalance, StockMovement,
  AlertLog, AuditLog, WhatsAppConfig, MovementType,
} from "./lib/data";
import {
  WAREHOUSES, ITEMS, STOCK_BALANCES, USERS, MOVEMENTS,
  ALERT_LOGS, WHATSAPP_CONFIG,
} from "./lib/data";
import { randomUUID } from "./lib/utils";

interface AppState {
  currentUser: User | null;
  users: User[];
  warehouses: Warehouse[];
  items: Item[];
  stockBalances: StockBalance[];
  movements: StockMovement[];
  alertLogs: AlertLog[];
  auditLogs: AuditLog[];
  whatsappConfig: WhatsAppConfig;

  // Auth
  login: (email: string, password: string) => boolean;
  logout: () => void;
  register: (email: string, password: string, name: string) => { ok: boolean; error?: string };
  approveUser: (id: string) => void;
  rejectUser: (id: string) => void;

  // Withdrawals
  withdraw: (itemId: string, warehouseId: string, quantity: number, remarks: string) => { ok: boolean; error?: string };

  // Stock management
  adjustStock: (itemId: string, warehouseId: string, quantity: number, type: MovementType, remarks: string) => void;

  // Item CRUD
  addItem: (item: Omit<Item, "id" | "createdAt" | "updatedAt">) => void;
  updateItem: (id: string, updates: Partial<Item>) => void;
  deleteItem: (id: string) => void;

  // Warehouse CRUD
  addWarehouse: (w: Omit<Warehouse, "id">) => void;
  updateWarehouse: (id: string, updates: Partial<Warehouse>) => void;

  // User CRUD
  addUser: (u: Omit<User, "id" | "createdAt">) => void;
  updateUser: (id: string, updates: Partial<User>) => void;
  deleteUser: (id: string) => void;

  // Alerts
  acknowledgeAlert: (id: string) => void;

  // WhatsApp config
  updateWhatsAppConfig: (cfg: Partial<WhatsAppConfig>) => void;

  // Helpers
  getStock: (itemId: string, warehouseId: string) => number;
  getTotalStock: (itemId: string) => number;
  getLowStockItems: () => { item: Item; warehouseId: string; qty: number; min: number }[];
  checkAndFireAlerts: (itemId: string, warehouseId: string, qty: number) => void;
}

function audit(logs: AuditLog[], action: string, entity: string, entityId: string, performedBy: string, details: string): AuditLog[] {
  return [{ id: randomUUID(), action, entity, entityId, performedBy, details, createdAt: new Date().toISOString() }, ...logs];
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      currentUser: null,
      users: USERS,
      warehouses: WAREHOUSES,
      items: ITEMS,
      stockBalances: STOCK_BALANCES,
      movements: MOVEMENTS,
      alertLogs: ALERT_LOGS,
      auditLogs: [],
      whatsappConfig: WHATSAPP_CONFIG,

      login: (email, password) => {
        // Email comparison is case-insensitive; password is case-sensitive
        const emailLower = email.trim().toLowerCase();
        const user = get().users.find(
          u => u.email.toLowerCase() === emailLower && u.password === password && u.active
        );
        if (user) { set({ currentUser: user }); return true; }
        return false;
      },

      logout: () => set({ currentUser: null }),

      register: (email, password, name) => {
        const emailLower = email.trim().toLowerCase();
        const existing = get().users.find(u => u.email.toLowerCase() === emailLower);
        if (existing) return { ok: false, error: "An account with this email already exists." };
        if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
        const newUser = {
          id: randomUUID(),
          name: name.trim(),
          email: email.trim(),
          password,
          role: "user" as const,
          active: false,
          status: "pending" as const,
          createdAt: new Date().toISOString(),
        };
        set(s => ({ users: [...s.users, newUser] }));
        return { ok: true };
      },

      approveUser: (id) => {
        set(s => ({
          users: s.users.map(u => u.id === id ? { ...u, active: true, status: "active" as const } : u),
        }));
      },

      rejectUser: (id) => {
        set(s => ({ users: s.users.filter(u => u.id !== id) }));
      },

      getStock: (itemId, warehouseId) => {
        const bal = get().stockBalances.find(b => b.itemId === itemId && b.warehouseId === warehouseId);
        return bal?.quantity ?? 0;
      },

      getTotalStock: (itemId) =>
        get().stockBalances.filter(b => b.itemId === itemId).reduce((s, b) => s + b.quantity, 0),

      getLowStockItems: () => {
        const { items, stockBalances } = get();
        const result: { item: Item; warehouseId: string; qty: number; min: number }[] = [];
        for (const item of items.filter(i => i.status === "active")) {
          for (const bal of stockBalances.filter(b => b.itemId === item.id)) {
            if (bal.quantity <= item.minStockLevel) {
              result.push({ item, warehouseId: bal.warehouseId, qty: bal.quantity, min: item.minStockLevel });
            }
          }
        }
        return result;
      },

      checkAndFireAlerts: (itemId, warehouseId, qty) => {
        const { items, alertLogs, whatsappConfig } = get();
        const item = items.find(i => i.id === itemId);
        if (!item || qty > item.minStockLevel) return;

        const cooldownMs = whatsappConfig.cooldownMinutes * 60 * 1000;
        const recent = alertLogs.find(a =>
          a.itemId === itemId && a.warehouseId === warehouseId &&
          !a.acknowledged && (Date.now() - new Date(a.sentAt).getTime()) < cooldownMs
        );
        if (recent) return;

        const newAlert: AlertLog = {
          id: randomUUID(), itemId, warehouseId,
          currentStock: qty, minThreshold: item.minStockLevel,
          sentAt: new Date().toISOString(), acknowledged: false,
          whatsappSent: whatsappConfig.enabled,
        };
        set(s => ({ alertLogs: [newAlert, ...s.alertLogs] }));
      },

      withdraw: (itemId, warehouseId, quantity, remarks) => {
        const { stockBalances, currentUser, movements, auditLogs } = get();
        const balIdx = stockBalances.findIndex(b => b.itemId === itemId && b.warehouseId === warehouseId);
        if (balIdx === -1) return { ok: false, error: "No stock record found." };
        const current = stockBalances[balIdx].quantity;
        if (quantity > current) return { ok: false, error: `Only ${current} units available.` };
        if (quantity <= 0) return { ok: false, error: "Quantity must be greater than 0." };

        const newQty = current - quantity;
        const now = new Date().toISOString();
        const updatedBals = stockBalances.map((b, i) =>
          i === balIdx ? { ...b, quantity: newQty, lastUpdated: now } : b
        );
        const mv: StockMovement = {
          id: randomUUID(), itemId, warehouseId, type: "withdrawal",
          quantity, balanceAfter: newQty,
          performedBy: currentUser?.name ?? "Unknown", remarks, createdAt: now,
        };
        set(s => ({
          stockBalances: updatedBals,
          movements: [mv, ...s.movements],
          auditLogs: audit(auditLogs, "WITHDRAWAL", "StockBalance", `${itemId}/${warehouseId}`, currentUser?.name ?? "Unknown", `Withdrew ${quantity} units. Remarks: ${remarks}`),
        }));
        get().checkAndFireAlerts(itemId, warehouseId, newQty);
        return { ok: true };
      },

      adjustStock: (itemId, warehouseId, quantity, type, remarks) => {
        const { stockBalances, currentUser, auditLogs } = get();
        const now = new Date().toISOString();
        const balIdx = stockBalances.findIndex(b => b.itemId === itemId && b.warehouseId === warehouseId);
        let newQty: number;
        let updatedBals: StockBalance[];

        if (balIdx === -1) {
          newQty = Math.max(0, quantity);
          updatedBals = [...stockBalances, { itemId, warehouseId, quantity: newQty, lastUpdated: now }];
        } else {
          const current = stockBalances[balIdx].quantity;
          newQty = type === "adjustment" ? Math.max(0, quantity) : Math.max(0, current + quantity);
          updatedBals = stockBalances.map((b, i) => i === balIdx ? { ...b, quantity: newQty, lastUpdated: now } : b);
        }

        const mv: StockMovement = {
          id: randomUUID(), itemId, warehouseId, type,
          quantity: Math.abs(quantity), balanceAfter: newQty,
          performedBy: currentUser?.name ?? "Unknown", remarks, createdAt: now,
        };
        set(s => ({
          stockBalances: updatedBals,
          movements: [mv, ...s.movements],
          auditLogs: audit(auditLogs, type.toUpperCase(), "StockBalance", `${itemId}/${warehouseId}`, currentUser?.name ?? "Unknown", `${type} ${quantity} units. New balance: ${newQty}. ${remarks}`),
        }));
        get().checkAndFireAlerts(itemId, warehouseId, newQty);
      },

      addItem: (item) => {
        const now = new Date().toISOString();
        const newItem: Item = { ...item, id: randomUUID(), createdAt: now, updatedAt: now };
        set(s => ({ items: [...s.items, newItem], auditLogs: audit(s.auditLogs, "ADD_ITEM", "Item", newItem.id, s.currentUser?.name ?? "System", `Added item: ${newItem.name}`) }));
      },

      updateItem: (id, updates) => {
        set(s => ({
          items: s.items.map(i => i.id === id ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i),
          auditLogs: audit(s.auditLogs, "UPDATE_ITEM", "Item", id, s.currentUser?.name ?? "System", `Updated: ${JSON.stringify(updates)}`),
        }));
      },

      deleteItem: (id) => {
        set(s => ({
          items: s.items.filter(i => i.id !== id),
          auditLogs: audit(s.auditLogs, "DELETE_ITEM", "Item", id, s.currentUser?.name ?? "System", "Item deleted"),
        }));
      },

      addWarehouse: (w) => {
        const newWh: Warehouse = { ...w, id: randomUUID() };
        set(s => ({ warehouses: [...s.warehouses, newWh], auditLogs: audit(s.auditLogs, "ADD_WAREHOUSE", "Warehouse", newWh.id, s.currentUser?.name ?? "System", `Added warehouse: ${newWh.name}`) }));
      },

      updateWarehouse: (id, updates) => {
        set(s => ({
          warehouses: s.warehouses.map(w => w.id === id ? { ...w, ...updates } : w),
          auditLogs: audit(s.auditLogs, "UPDATE_WAREHOUSE", "Warehouse", id, s.currentUser?.name ?? "System", `Updated: ${JSON.stringify(updates)}`),
        }));
      },

      addUser: (u) => {
        const newUser: User = { ...u, id: randomUUID(), createdAt: new Date().toISOString() };
        set(s => ({ users: [...s.users, newUser] }));
      },

      updateUser: (id, updates) => {
        set(s => ({ users: s.users.map(u => u.id === id ? { ...u, ...updates } : u) }));
      },

      deleteUser: (id) => {
        set(s => ({ users: s.users.filter(u => u.id !== id) }));
      },

      acknowledgeAlert: (id) => {
        set(s => ({
          alertLogs: s.alertLogs.map(a => a.id === id ? { ...a, acknowledged: true, acknowledgedAt: new Date().toISOString() } : a),
        }));
      },

      updateWhatsAppConfig: (cfg) => {
        set(s => ({ whatsappConfig: { ...s.whatsappConfig, ...cfg } }));
      },
    }),
    { name: "warehouse-ims-v3" }
  )
);
