import { normaliseItems } from "@/data/csv";
import type { InventoryItem, Staff, StaffRights, StockLedgerState, Store } from "@/data/types";

export const DEFAULT_STORE_ID = "main-store";
export const DEMO_LEDGER_NAME = "Demo ledger";

export function defaultRights(role: "admin" | "staff"): StaffRights {
  return {
    canAudit: true,
    canGlobalCount: true,
    canUploadLedger: true,
    canFullStoreAudit: role === "admin",
    canManageStaff: role === "admin",
    canAdmin: role === "admin"
  };
}

export function defaultStore(): Store {
  return {
    id: DEFAULT_STORE_ID,
    name: "Main Store",
    place: "",
    details: "Default store",
    active: true
  };
}

export function adminUser(): Staff {
  return {
    id: "admin",
    name: "Admin",
    empCode: "admin",
    username: "admin",
    phone: "9999999999",
    password: "admin",
    pin: "admin",
    role: "admin",
    departments: ["ALL"],
    department: "ALL",
    storeIds: ["ALL"],
    storeId: "ALL",
    approved: true,
    active: true,
    rights: defaultRights("admin")
  };
}

export const demoInventorySeed: Omit<InventoryItem, "baseArticle" | "shadeCode" | "articleSize">[] = [
  {
    article: "1254329JA-2-44",
    description: "MEN'S JACKET-T/N-F/S 44",
    colour: "BROWN",
    year: "AW25",
    group: "MEN JACKET FS",
    size: "44",
    closingStock: 1,
    mrp: 5595
  },
  {
    article: "1254325JA-1-40",
    description: "MEN'S JACKET-T/N-S/L 40",
    colour: "COFFEE BROWN",
    year: "N.A.",
    group: "MEN JACKET SL",
    size: "40",
    closingStock: 1,
    mrp: 4495
  },
  {
    article: "1252791TP-712-38",
    description: "LADY'S SCEAVY TOP-H/N-F/S 38",
    colour: "TEAL",
    year: "AW25",
    group: "LADY SCEAVY TOP FS",
    size: "38",
    closingStock: 1,
    mrp: 1560
  },
  {
    article: "52503226-2-28",
    description: "BOY'S KURTA-B/N-H/S 28",
    colour: "BLACK",
    year: "SS25",
    group: "BOY KURTA HS",
    size: "28",
    closingStock: 1,
    mrp: 995
  },
  {
    article: "1960101027M",
    description: "NON WOVEN CARRY BAG 15X19 MC PRT",
    colour: "N.A.",
    year: "",
    group: "CARRY BAG",
    size: "7M",
    closingStock: 1500,
    mrp: 1500
  }
];

export function createDemoState(): StockLedgerState {
  const now = new Date().toISOString();
  const inventory = normaliseItems(demoInventorySeed);

  return {
    inventory,
    stores: [defaultStore()],
    inventoryByStore: { [DEFAULT_STORE_ID]: inventory },
    ledgerByStore: { [DEFAULT_STORE_ID]: { name: DEMO_LEDGER_NAME, date: now } },
    audits: [],
    globalCounts: [],
    messages: [],
    transfers: [],
    customerApprovals: [],
    articlePhotos: {},
    staff: [adminUser()],
    currentUserId: "",
    currentStoreId: DEFAULT_STORE_ID,
    adminStoreFilter: "all",
    ledgerName: DEMO_LEDGER_NAME,
    ledgerDate: now,
    updatedAt: now
  };
}
