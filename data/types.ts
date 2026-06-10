export type Role = "admin" | "staff";

export type AuditStatus = "match" | "excess" | "short";

export type CountStatus = "Submitted" | "Approved" | "Rejected";
export type TransferStatus = "Submitted" | "Approved" | "Rejected";
export type CustomerApprovalStatus = "Submitted" | "Approved" | "Rejected" | "Returned" | "Sold";

export type StaffRights = {
  canAudit: boolean;
  canGlobalCount: boolean;
  canUploadLedger: boolean;
  canFullStoreAudit: boolean;
  canManageStaff: boolean;
  canAdmin: boolean;
};

export type Store = {
  id: string;
  name: string;
  place: string;
  details: string;
  active: boolean;
};

export type InventoryItem = {
  id?: string;
  article: string;
  description: string;
  colour: string;
  year: string;
  group: string;
  size: string;
  closingStock: number;
  mrp: number;
  baseArticle: string;
  shadeCode: string;
  articleSize: string;
  updatedAt?: string;
  storeId?: string;
  storeName?: string;
};

export type Staff = {
  id: string;
  name: string;
  empCode: string;
  username: string;
  phone: string;
  password: string;
  pin: string;
  role: Role;
  departments: string[];
  department: string;
  storeIds: string[];
  storeId: string;
  approved: boolean;
  active: boolean;
  rights: StaffRights;
};

export type AuditLine = {
  id: string;
  reportId?: string;
  article: string;
  description: string;
  group: string;
  storeId: string;
  storeName: string;
  ledgerQty: number;
  countedQty: number;
  variance: number;
  status: AuditStatus;
  staffName: string;
  staffDepartment: string;
  countedAt: string;
};

export type AuditReport = {
  id: string;
  type: "auditReport";
  article: string;
  description: string;
  group: string;
  groups: string[];
  storeId: string;
  storeName: string;
  ledgerQty: number;
  countedQty: number;
  variance: number;
  status: AuditStatus;
  staffName: string;
  staffDepartment: string;
  scope: "Department" | "Full Store";
  scopeDepartments: string[];
  diffArticleCount: number;
  countedAt: string;
  submittedAt: string;
  submittedToAdmin: boolean;
  items: AuditLine[];
};

export type GlobalCountReport = {
  id: string;
  date: string;
  group: string;
  storeId: string;
  storeName: string;
  ledgerQty: number;
  countedQty: number;
  variance: number;
  staffId: string;
  staffName: string;
  status: CountStatus;
  note: string;
  submittedAt: string;
  approvedBy?: string;
  approvedAt?: string;
};

export type EmployeeMessage = {
  id: string;
  title: string;
  body: string;
  storeId: string;
  department: string;
  createdAt: string;
  createdBy: string;
  active: boolean;
  readBy: string[];
};

export type InterStoreTransfer = {
  id: string;
  fromStoreId: string;
  fromStoreName: string;
  toStoreId: string;
  toStoreName: string;
  article: string;
  description: string;
  qty: number;
  requestedById: string;
  requestedByName: string;
  status: TransferStatus;
  note: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
};

export type CustomerApproval = {
  id: string;
  storeId: string;
  storeName: string;
  customerName: string;
  customerPhone: string;
  article: string;
  description: string;
  colour: string;
  year: string;
  group: string;
  size: string;
  mrp: number;
  baseArticle: string;
  shadeCode: string;
  articleSize: string;
  qty: number;
  requestedById: string;
  requestedByName: string;
  status: CustomerApprovalStatus;
  note: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  closedAt?: string;
};

export type LegacyBackup = {
  at: string;
  source: string;
  data: Partial<StockLedgerState>;
};

export type StockLedgerState = {
  inventory: InventoryItem[];
  stores: Store[];
  inventoryByStore: Record<string, InventoryItem[]>;
  ledgerByStore: Record<string, { name: string; date: string }>;
  audits: AuditReport[];
  globalCounts: GlobalCountReport[];
  messages: EmployeeMessage[];
  transfers: InterStoreTransfer[];
  customerApprovals: CustomerApproval[];
  articlePhotos: Record<string, string>;
  staff: Staff[];
  currentUserId: string;
  currentStoreId: string;
  adminStoreFilter: string;
  ledgerName: string;
  ledgerDate: string;
  updatedAt: string;
};

export type GroupSummary = {
  key: string;
  storeName: string;
  group: string;
  qty: number;
  articles: number;
  shades: number;
  sizes: number;
};

export type StockMetrics = {
  totalQty: number;
  articleCount: number;
  groupCount: number;
  auditVariance: number;
  stores: number;
  staff: number;
  submittedCounts: number;
};
