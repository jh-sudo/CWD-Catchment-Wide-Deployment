export type Role = "user" | "store_admin" | "system_admin";
export type UserStatus = "active" | "pending";

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  warehouseId?: string;
  active: boolean;
  status: UserStatus;
  createdAt: string;
}

export interface Warehouse {
  id: string;
  name: string;
  location: string;
  contactPerson: string;
  contactNumber: string;
  notes: string;
  active: boolean;
}

export interface Item {
  id: string;
  name: string;
  sku: string;
  description: string;
  category: string;
  unit: string;
  minStockLevel: number;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export interface StockBalance {
  itemId: string;
  warehouseId: string;
  quantity: number;
  lastUpdated: string;
}

export type MovementType = "withdrawal" | "replenishment" | "adjustment" | "transfer";

export interface StockMovement {
  id: string;
  itemId: string;
  warehouseId: string;
  type: MovementType;
  quantity: number;
  balanceAfter: number;
  performedBy: string;
  remarks: string;
  createdAt: string;
}

export interface AlertLog {
  id: string;
  itemId: string;
  warehouseId: string;
  currentStock: number;
  minThreshold: number;
  sentAt: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  whatsappSent: boolean;
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  performedBy: string;
  details: string;
  createdAt: string;
}

export interface WhatsAppConfig {
  enabled: boolean;
  phoneNumbers: string[];
  cooldownMinutes: number;
}

// ── Seed data ────────────────────────────────────────────────────────────────

export const WAREHOUSES: Warehouse[] = [
  { id: "wh-defu",    name: "Defu",         location: "Defu Industrial Park",       contactPerson: "Adli",  contactNumber: "+6592334346", notes: "Main distribution hub. Loading bay on east side.", active: true },
  { id: "wh-jd",      name: "Jalan Dusun",  location: "Jalan Dusun, Bishan",        contactPerson: "Azlan", contactNumber: "+6587255366", notes: "Climate-controlled section for sensitive items.", active: true },
  { id: "wh-kw",      name: "Kallang Way",  location: "Kallang Way Industrial Area",contactPerson: "Adino", contactNumber: "+6596525539", notes: "24-hour access. Security guard on duty.", active: true },
  { id: "wh-sk",      name: "Sungei Kadut", location: "Sungei Kadut Industrial Area",contactPerson: "Suffi", contactNumber: "+6592334296", notes: "Largest capacity. Forklift available.", active: true },
];

export const ITEMS: Item[] = [
  { id: "itm-dm",  name: "Dameasy",                sku: "DME-001", description: "Portable water-filled flood barrier, easy to deploy", category: "Flood Barrier", unit: "unit",  minStockLevel: 20, status: "active", createdAt: "2025-01-10T08:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
  { id: "itm-fs",  name: "Floodsax",               sku: "FSX-002", description: "Self-inflating sandbag, activates on contact with water",category: "Sandbag",       unit: "bag",   minStockLevel: 50, status: "active", createdAt: "2025-01-10T08:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
  { id: "itm-pfb", name: "Portable Flood Barrier",  sku: "PFB-003", description: "Heavy-duty modular flood barrier system",             category: "Flood Barrier", unit: "panel", minStockLevel: 10, status: "active", createdAt: "2025-01-10T08:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
  { id: "itm-fg",  name: "Floodgate",              sku: "FGT-004", description: "Aluminium flood gate for doorways and openings",       category: "Flood Barrier", unit: "set",   minStockLevel: 5,  status: "active", createdAt: "2025-01-10T08:00:00Z", updatedAt: "2026-07-01T00:00:00Z" },
];

export const STOCK_BALANCES: StockBalance[] = [
  // Dameasy
  { itemId: "itm-dm",  warehouseId: "wh-defu", quantity: 45, lastUpdated: "2026-07-15T10:00:00Z" },
  { itemId: "itm-dm",  warehouseId: "wh-jd",   quantity: 18, lastUpdated: "2026-07-15T10:00:00Z" },
  { itemId: "itm-dm",  warehouseId: "wh-kw",   quantity: 32, lastUpdated: "2026-07-14T08:00:00Z" },
  { itemId: "itm-dm",  warehouseId: "wh-sk",   quantity: 60, lastUpdated: "2026-07-14T08:00:00Z" },
  // Floodsax
  { itemId: "itm-fs",  warehouseId: "wh-defu", quantity: 120, lastUpdated: "2026-07-15T10:00:00Z" },
  { itemId: "itm-fs",  warehouseId: "wh-jd",   quantity: 45,  lastUpdated: "2026-07-15T10:00:00Z" },
  { itemId: "itm-fs",  warehouseId: "wh-kw",   quantity: 80,  lastUpdated: "2026-07-14T08:00:00Z" },
  { itemId: "itm-fs",  warehouseId: "wh-sk",   quantity: 200, lastUpdated: "2026-07-14T08:00:00Z" },
  // PFB
  { itemId: "itm-pfb", warehouseId: "wh-defu", quantity: 8,  lastUpdated: "2026-07-15T10:00:00Z" },
  { itemId: "itm-pfb", warehouseId: "wh-jd",   quantity: 15, lastUpdated: "2026-07-15T10:00:00Z" },
  { itemId: "itm-pfb", warehouseId: "wh-kw",   quantity: 3,  lastUpdated: "2026-07-14T08:00:00Z" },
  { itemId: "itm-pfb", warehouseId: "wh-sk",   quantity: 22, lastUpdated: "2026-07-14T08:00:00Z" },
  // Floodgate
  { itemId: "itm-fg",  warehouseId: "wh-defu", quantity: 12, lastUpdated: "2026-07-15T10:00:00Z" },
  { itemId: "itm-fg",  warehouseId: "wh-jd",   quantity: 4,  lastUpdated: "2026-07-15T10:00:00Z" },
  { itemId: "itm-fg",  warehouseId: "wh-kw",   quantity: 9,  lastUpdated: "2026-07-14T08:00:00Z" },
  { itemId: "itm-fg",  warehouseId: "wh-sk",   quantity: 18, lastUpdated: "2026-07-14T08:00:00Z" },
];

export const USERS: User[] = [
  { id: "usr-adli",   name: "Muhammad Adli Hassan", email: "muhammad_adli_hassan@pub.gov.sg", password: "inventory888", role: "system_admin", active: true,  status: "active", createdAt: "2025-01-01T00:00:00Z" },
  { id: "usr-store1", name: "Ahmad Razif",           email: "ahmad@warehouse.gov.sg",          password: "Store@1234",  role: "store_admin",  warehouseId: "wh-defu", active: true, status: "active", createdAt: "2025-01-05T00:00:00Z" },
  { id: "usr-store2", name: "Priya Menon",           email: "priya@warehouse.gov.sg",          password: "Store@1234",  role: "store_admin",  warehouseId: "wh-jd",   active: true, status: "active", createdAt: "2025-01-05T00:00:00Z" },
  { id: "usr-user1",  name: "Tan Wei Liang",         email: "tanwl@ops.gov.sg",                password: "User@1234",   role: "user",         active: true,  status: "active", createdAt: "2025-02-01T00:00:00Z" },
  { id: "usr-user2",  name: "Siti Rahimah",          email: "siti@ops.gov.sg",                 password: "User@1234",   role: "user",         active: true,  status: "active", createdAt: "2025-02-01T00:00:00Z" },
];

export const MOVEMENTS: StockMovement[] = [
  { id: "mv-001", itemId: "itm-dm",  warehouseId: "wh-defu", type: "replenishment", quantity: 20, balanceAfter: 45, performedBy: "Ahmad Razif",   remarks: "Monthly replenishment",      createdAt: "2026-07-10T09:00:00Z" },
  { id: "mv-002", itemId: "itm-fs",  warehouseId: "wh-jd",   type: "withdrawal",    quantity: 10, balanceAfter: 45, performedBy: "Tan Wei Liang",  remarks: "Deployment to Bishan Park",   createdAt: "2026-07-12T14:30:00Z" },
  { id: "mv-003", itemId: "itm-pfb", warehouseId: "wh-kw",   type: "withdrawal",    quantity: 5,  balanceAfter: 3,  performedBy: "Siti Rahimah",   remarks: "Emergency response Kallang",  createdAt: "2026-07-14T07:45:00Z" },
  { id: "mv-004", itemId: "itm-fg",  warehouseId: "wh-jd",   type: "withdrawal",    quantity: 2,  balanceAfter: 4,  performedBy: "Tan Wei Liang",  remarks: "Flood response Marymount",    createdAt: "2026-07-15T11:00:00Z" },
  { id: "mv-005", itemId: "itm-dm",  warehouseId: "wh-kw",   type: "replenishment", quantity: 12, balanceAfter: 32, performedBy: "Ahmad Razif",    remarks: "Transfer from Defu",         createdAt: "2026-07-15T13:00:00Z" },
];

export const ALERT_LOGS: AlertLog[] = [
  { id: "al-001", itemId: "itm-pfb", warehouseId: "wh-kw", currentStock: 3, minThreshold: 10, sentAt: "2026-07-14T07:46:00Z", acknowledged: false, whatsappSent: true },
  { id: "al-002", itemId: "itm-fg",  warehouseId: "wh-jd", currentStock: 4, minThreshold: 5,  sentAt: "2026-07-15T11:01:00Z", acknowledged: false, whatsappSent: true },
  { id: "al-003", itemId: "itm-dm",  warehouseId: "wh-jd", currentStock: 18,minThreshold: 20, sentAt: "2026-07-15T10:01:00Z", acknowledged: true,  acknowledgedAt: "2026-07-15T10:30:00Z", whatsappSent: true },
];

export const WHATSAPP_CONFIG: WhatsAppConfig = {
  enabled: true,
  phoneNumbers: ["+65 9123 4567", "+65 9234 5678"],
  cooldownMinutes: 60,
};
