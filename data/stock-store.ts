import "expo-sqlite/localStorage/install";

import {
  clean,
  csvCell,
  exportAuditCsv,
  exportCountsCsv,
  exportInventoryCsv,
  exportSummaryCsv,
  makeId,
  normaliseItems,
  numeric,
  parseDelimited,
  rowsToInventory,
  rowsToScanEntries
} from "@/data/csv";
import {
  firebaseConfigured,
  loadFirebaseBackup,
  loadFirebaseLive,
  saveFirebaseBackup,
  saveFirebaseLive,
  type FirebaseLogin
} from "@/data/firebase-backup";
import { adminUser, createDemoState, defaultRights, defaultStore, DEFAULT_STORE_ID, DEMO_LEDGER_NAME } from "@/data/seed";
import type {
  AuditLine,
  AuditReport,
  AuditStatus,
  CountStatus,
  CustomerApproval,
  CustomerApprovalStatus,
  EmployeeMessage,
  GlobalCountReport,
  GroupSummary,
  InventoryItem,
  LegacyBackup,
  Staff,
  StaffRights,
  StockLedgerState,
  StockMetrics,
  Store,
  InterStoreTransfer,
  TransferStatus
} from "@/data/types";

const STORAGE_KEY = "simple-stock-ledger-v2";
const BACKUP_KEY = "simple-stock-ledger-v2-backups";
const SIMPLIFIED_KEY = "stock-report-expo-v1";

type Listener = () => void;
type LoginMode = "admin" | "employee";

type StaffInput = {
  id?: string;
  name: string;
  empCode: string;
  password: string;
  role: "admin" | "staff";
  storeId: string;
  departments: string[];
};

type StoreInput = {
  name: string;
  place: string;
  details: string;
};

const listeners = new Set<Listener>();
let snapshot = readInitialState();
installStorageSync();

export function getStockSnapshot(): StockLedgerState {
  return snapshot;
}

export function subscribeStockStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const stockActions = {
  approveCustomerApproval,
  approveCount,
  approveTransfer,
  changePassword,
  clearStoreStock,
  createStore,
  deactivateMessage,
  deleteStaff,
  exportAuditCsvText,
  exportBackupJson,
  exportCountsCsvText,
  exportStockCsvText,
  exportSummaryCsvText,
  firebaseBackupReady,
  importLedgerRows,
  importLedgerText,
  loadDemoLedger,
  login,
  logout,
  markMessageRead,
  restoreBackupJson,
  requestCustomerApproval,
  requestInterStoreTransfer,
  refreshFromStorage,
  removeArticlePhoto,
  restoreCloudBackup,
  restoreCloudLive,
  saveArticlePhoto,
  saveCloudBackup,
  saveCloudLive,
  selectStore,
  selectStoreForAdmin,
  sendMessage,
  settleCustomerApproval,
  submitAudit,
  submitGlobalCount,
  updateStaffApproval,
  updateStaffRight,
  upsertStaff
};

export const stockSelectors = {
  activeStores,
  canStaffScanItem,
  computeMetrics,
  currentState,
  currentInventory,
  currentLedger,
  currentUser,
  employeeStoreIds,
  exportBackups,
  getCurrentStoreId,
  pendingCustomerApprovals,
  pendingTransfers,
  articlePhoto,
  groupSummaries,
  hasRight,
  inventoryForStore,
  isAdmin,
  relevantMessages,
  staffDepartments,
  staffStoreIds,
  storeLabel,
  visibleInventoryForEmployee
};

function login(mode: LoginMode, empCode: string, password: string) {
  syncSnapshotFromStorage(false);
  const user = snapshot.staff.find((staff) => {
    const savedCode = codeKey(staff.empCode || staff.username || staff.phone);
    const savedPassword = clean(staff.password || staff.pin);
    const savedPin = clean(staff.pin);
    return savedCode === codeKey(empCode) && (savedPassword === clean(password) || savedPin === clean(password)) && staff.active !== false;
  });

  if (!user) {
    throw new Error(mode === "admin" ? "Admin login not found." : "EMP Code or password not matching.");
  }

  if (user.approved === false) throw new Error("Login pending admin approval.");
  if (mode === "admin" && !isAdmin(user)) throw new Error("Admin rights required.");
  if (mode === "employee" && isAdmin(user)) throw new Error("Use Admin Login for admin users.");

  const nextStore = mode === "employee" ? employeeStoreIds(user)[0] || DEFAULT_STORE_ID : snapshot.currentStoreId || DEFAULT_STORE_ID;
  commit({
    ...snapshot,
    currentUserId: user.id,
    currentStoreId: nextStore,
    inventory: inventoryForStore(nextStore),
    updatedAt: new Date().toISOString()
  }, { persist: false });

  return user;
}

function logout() {
  commit({ ...snapshot, currentUserId: "", updatedAt: new Date().toISOString() }, { persist: false });
}

function refreshFromStorage() {
  return syncSnapshotFromStorage();
}

function changePassword(oldPassword: string, newPassword: string) {
  const user = currentUser();
  if (!user) throw new Error("Login required.");
  if (!clean(newPassword)) throw new Error("New password required.");
  if (clean(user.password || user.pin) !== clean(oldPassword) && clean(user.pin) !== clean(oldPassword)) {
    throw new Error("Current password not matching.");
  }

  commit({
    ...snapshot,
    staff: snapshot.staff.map((staff) => staff.id === user.id ? { ...staff, password: clean(newPassword), pin: clean(newPassword) } : staff),
    updatedAt: new Date().toISOString()
  });
}

function selectStore(storeId: string) {
  const user = currentUser();
  const allowed = employeeStoreIds(user);
  const nextStoreId = allowed.includes("ALL") || allowed.includes(storeId) ? storeId : allowed[0] || DEFAULT_STORE_ID;
  commit({
    ...snapshot,
    currentStoreId: nextStoreId,
    inventory: inventoryForStore(nextStoreId),
    updatedAt: new Date().toISOString()
  }, { persist: false });
}

function selectStoreForAdmin(storeId: string) {
  const nextFilter = clean(storeId) || "all";
  const current = nextFilter === "all" ? snapshot.currentStoreId : nextFilter;
  commit({
    ...snapshot,
    adminStoreFilter: nextFilter,
    currentStoreId: current,
    inventory: inventoryForStore(current),
    updatedAt: new Date().toISOString()
  }, { persist: false });
}

function createStore(input: StoreInput) {
  const name = clean(input.name);
  const place = clean(input.place);
  const details = clean(input.details);
  if (!name || !place) throw new Error("Store name and place required.");

  let id = slugStore(name, place);
  let suffix = 2;
  while (snapshot.stores.some((store) => store.id === id)) {
    id = `${slugStore(name, place)}-${suffix}`;
    suffix += 1;
  }

  commit({
    ...snapshot,
    stores: [...snapshot.stores, { id, name, place, details, active: true }],
    inventoryByStore: { ...snapshot.inventoryByStore, [id]: [] },
    ledgerByStore: { ...snapshot.ledgerByStore, [id]: { name: "No ledger", date: "" } },
    adminStoreFilter: id,
    currentStoreId: id,
    inventory: [],
    updatedAt: new Date().toISOString()
  });

  return id;
}

function importLedgerText(storeId: string, text: string, ledgerName = "Imported ledger") {
  const rows = parseDelimited(text);
  return importLedgerRows(storeId, rows, ledgerName);
}

function importLedgerRows(storeId: string, rows: string[][], ledgerName = "Imported ledger") {
  const targetStoreId = clean(storeId) || DEFAULT_STORE_ID;
  const inventory = rowsToInventory(rows);
  if (!inventory.length) throw new Error("No stock rows found in the selected ledger.");

  const now = new Date().toISOString();
  const byStore = { ...snapshot.inventoryByStore, [targetStoreId]: inventory };
  const ledgerByStore = { ...snapshot.ledgerByStore, [targetStoreId]: { name: clean(ledgerName) || "Imported ledger", date: now } };

  commit({
    ...snapshot,
    inventoryByStore: byStore,
    ledgerByStore,
    audits: snapshot.audits.filter((audit) => audit.storeId !== targetStoreId),
    currentStoreId: targetStoreId,
    adminStoreFilter: targetStoreId,
    inventory,
    ledgerName: ledgerByStore[targetStoreId].name,
    ledgerDate: now,
    updatedAt: now
  });

  return inventory.length;
}

function requestInterStoreTransfer(input: { fromStoreId: string; toStoreId: string; article: string; qty: number; note: string }) {
  const user = currentUser();
  if (!user) throw new Error("Login required.");
  const fromStoreId = clean(input.fromStoreId) || snapshot.currentStoreId;
  const toStoreId = clean(input.toStoreId);
  const article = clean(input.article);
  const qty = Math.max(1, Math.round(numeric(input.qty)));
  if (!toStoreId || fromStoreId === toStoreId) throw new Error("Select different From and To stores.");
  const item = findStoreItem(fromStoreId, article);
  if (!item) throw new Error("Article not found in From store.");
  if (numeric(item.closingStock) < qty) throw new Error("Transfer quantity is more than available stock.");

  const transfer: InterStoreTransfer = {
    id: makeId("transfer"),
    fromStoreId,
    fromStoreName: storeLabel(fromStoreId),
    toStoreId,
    toStoreName: storeLabel(toStoreId),
    article: item.article,
    description: item.description,
    qty,
    requestedById: user.id,
    requestedByName: user.name,
    status: "Submitted",
    note: clean(input.note),
    createdAt: new Date().toISOString()
  };

  commit({
    ...snapshot,
    transfers: [transfer, ...snapshot.transfers],
    updatedAt: new Date().toISOString()
  });

  return transfer;
}

function approveTransfer(id: string, status: TransferStatus) {
  if (!isAdmin()) throw new Error("Admin rights required.");
  const transfer = snapshot.transfers.find((item) => item.id === id);
  if (!transfer) throw new Error("Transfer request not found.");
  if (transfer.status !== "Submitted") throw new Error("Transfer already processed.");
  const admin = currentUser();
  let inventoryByStore = snapshot.inventoryByStore;

  if (status === "Approved") {
    inventoryByStore = moveStockBetweenStores(inventoryByStore, transfer.fromStoreId, transfer.toStoreId, transfer.article, transfer.qty);
  }

  commit({
    ...snapshot,
    inventoryByStore,
    inventory: inventoryForStoreFrom(inventoryByStore, snapshot.stores, snapshot.currentStoreId),
    transfers: snapshot.transfers.map((item) => item.id === id
      ? { ...item, status, approvedBy: admin?.name || "Admin", approvedAt: new Date().toISOString() }
      : item),
    updatedAt: new Date().toISOString()
  });
}

function requestCustomerApproval(input: { storeId: string; customerName: string; customerPhone: string; article: string; qty: number; note: string }) {
  const user = currentUser();
  if (!user) throw new Error("Login required.");
  const storeId = clean(input.storeId) || snapshot.currentStoreId;
  const article = clean(input.article);
  const qty = Math.max(1, Math.round(numeric(input.qty)));
  const item = findStoreItem(storeId, article);
  if (!item) throw new Error("Article not found in selected store.");
  if (numeric(item.closingStock) < qty) throw new Error("Approval quantity is more than available stock.");
  if (!clean(input.customerName)) throw new Error("Customer name required.");

  const approval: CustomerApproval = {
    id: makeId("approval"),
    storeId,
    storeName: storeLabel(storeId),
    customerName: clean(input.customerName),
    customerPhone: clean(input.customerPhone),
    article: item.article,
    description: item.description,
    colour: item.colour,
    year: item.year,
    group: item.group,
    size: item.size,
    mrp: item.mrp,
    baseArticle: item.baseArticle,
    shadeCode: item.shadeCode,
    articleSize: item.articleSize,
    qty,
    requestedById: user.id,
    requestedByName: user.name,
    status: "Submitted",
    note: clean(input.note),
    createdAt: new Date().toISOString()
  };

  commit({
    ...snapshot,
    customerApprovals: [approval, ...snapshot.customerApprovals],
    updatedAt: new Date().toISOString()
  });

  return approval;
}

function approveCustomerApproval(id: string, status: "Approved" | "Rejected") {
  if (!isAdmin()) throw new Error("Admin rights required.");
  const approval = snapshot.customerApprovals.find((item) => item.id === id);
  if (!approval) throw new Error("Customer approval request not found.");
  if (approval.status !== "Submitted") throw new Error("Approval already processed.");
  const admin = currentUser();
  let inventoryByStore = snapshot.inventoryByStore;

  if (status === "Approved") {
    inventoryByStore = adjustStoreArticleQty(inventoryByStore, approval.storeId, approval.article, -approval.qty);
  }

  commit({
    ...snapshot,
    inventoryByStore,
    inventory: inventoryForStoreFrom(inventoryByStore, snapshot.stores, snapshot.currentStoreId),
    customerApprovals: snapshot.customerApprovals.map((item) => item.id === id
      ? { ...item, status, approvedBy: admin?.name || "Admin", approvedAt: new Date().toISOString() }
      : item),
    updatedAt: new Date().toISOString()
  });
}

function settleCustomerApproval(id: string, status: "Returned" | "Sold") {
  if (!isAdmin()) throw new Error("Admin rights required.");
  const approval = snapshot.customerApprovals.find((item) => item.id === id);
  if (!approval) throw new Error("Customer approval request not found.");
  if (approval.status !== "Approved") throw new Error("Only approved customer items can be settled.");
  let inventoryByStore = snapshot.inventoryByStore;

  if (status === "Returned") {
    inventoryByStore = adjustStoreArticleQty(inventoryByStore, approval.storeId, approval.article, approval.qty);
  }

  commit({
    ...snapshot,
    inventoryByStore,
    inventory: inventoryForStoreFrom(inventoryByStore, snapshot.stores, snapshot.currentStoreId),
    customerApprovals: snapshot.customerApprovals.map((item) => item.id === id
      ? { ...item, status, closedAt: new Date().toISOString() }
      : item),
    updatedAt: new Date().toISOString()
  });
}

function clearStoreStock(storeId: string) {
  const targetStoreId = clean(storeId) || DEFAULT_STORE_ID;
  commit({
    ...snapshot,
    inventoryByStore: { ...snapshot.inventoryByStore, [targetStoreId]: [] },
    ledgerByStore: { ...snapshot.ledgerByStore, [targetStoreId]: { name: "No ledger", date: "" } },
    audits: snapshot.audits.filter((audit) => audit.storeId !== targetStoreId),
    inventory: snapshot.currentStoreId === targetStoreId ? [] : snapshot.inventory,
    updatedAt: new Date().toISOString()
  });
}

function loadDemoLedger() {
  const demo = createDemoState();
  commit({
    ...snapshot,
    inventoryByStore: { ...snapshot.inventoryByStore, [snapshot.currentStoreId || DEFAULT_STORE_ID]: demo.inventory },
    ledgerByStore: { ...snapshot.ledgerByStore, [snapshot.currentStoreId || DEFAULT_STORE_ID]: { name: DEMO_LEDGER_NAME, date: new Date().toISOString() } },
    inventory: demo.inventory,
    updatedAt: new Date().toISOString()
  });
}

function saveArticlePhoto(article: string, dataUrl: string) {
  const key = clean(article);
  const value = clean(dataUrl);
  if (!key) throw new Error("Article number required.");
  if (!value) throw new Error("Photo not selected.");

  commit({
    ...snapshot,
    articlePhotos: { ...snapshot.articlePhotos, [key]: value },
    updatedAt: new Date().toISOString()
  });
}

function removeArticlePhoto(article: string) {
  const key = clean(article);
  if (!key) throw new Error("Article number required.");
  const nextPhotos = { ...snapshot.articlePhotos };
  delete nextPhotos[key];

  commit({
    ...snapshot,
    articlePhotos: nextPhotos,
    updatedAt: new Date().toISOString()
  });
}

function upsertStaff(input: StaffInput) {
  if (!hasRight("canManageStaff") && !isAdmin()) throw new Error("Staff management rights required.");

  const role = input.role || "staff";
  const empCode = clean(input.empCode);
  const password = clean(input.password);
  const departments = role === "admin" ? ["ALL"] : input.departments.map(clean).filter(Boolean);
  const storeId = role === "admin" ? "ALL" : clean(input.storeId);

  if (!clean(input.name) || !empCode || !password || (role !== "admin" && (!storeId || !departments.length))) {
    throw new Error("Name, EMP Code, password, store and department required.");
  }

  const duplicate = snapshot.staff.find((staff) => staff.id !== input.id && codeKey(staff.empCode || staff.username) === codeKey(empCode) && staff.active !== false);
  if (duplicate) throw new Error("EMP Code already exists.");

  const existing = input.id ? snapshot.staff.find((staff) => staff.id === input.id) : null;
  const base: Staff = existing || {
    id: makeId("staff"),
    name: "",
    empCode: "",
    username: "",
    phone: "",
    password: "",
    pin: "",
    role,
    departments,
    department: departments.join(", "),
    storeIds: [storeId],
    storeId,
    approved: true,
    active: true,
    rights: defaultRights(role)
  };

  const nextStaff: Staff = {
    ...base,
    name: clean(input.name),
    empCode,
    username: empCode,
    phone: empCode,
    password,
    pin: password,
    role,
    departments,
    department: departments.join(", "),
    storeIds: role === "admin" ? ["ALL"] : [storeId],
    storeId,
    approved: role === "admin" ? true : base.approved !== false,
    active: true,
    rights: { ...defaultRights(role), ...(existing?.rights || {}), canAdmin: role === "admin" }
  };

  commit({
    ...snapshot,
    staff: existing ? snapshot.staff.map((staff) => staff.id === existing.id ? nextStaff : staff) : [...snapshot.staff, nextStaff],
    updatedAt: new Date().toISOString()
  });

  return nextStaff.id;
}

function deleteStaff(id: string) {
  if (!hasRight("canManageStaff") && !isAdmin()) {
    throw new Error("Staff management rights required.");
  }

  if (id === "admin") {
    throw new Error("Default admin cannot be deleted.");
  }

  commit({
    ...snapshot,
    staff: snapshot.staff.filter((staff) => staff.id !== id),
    currentUserId: snapshot.currentUserId === id ? "" : snapshot.currentUserId,
    updatedAt: new Date().toISOString()
  });
}

function updateStaffApproval(id: string, approved: boolean) {
  if (!isAdmin()) throw new Error("Admin rights required.");
  commit({
    ...snapshot,
    staff: snapshot.staff.map((staff) => staff.id === id ? { ...staff, approved } : staff),
    updatedAt: new Date().toISOString()
  });
}

function updateStaffRight(id: string, right: keyof StaffRights, value: boolean) {
  if (!isAdmin()) throw new Error("Admin rights required.");
  commit({
    ...snapshot,
    staff: snapshot.staff.map((staff) => {
      if (staff.id !== id) return staff;
      const rights = { ...defaultRights(staff.role), ...staff.rights, [right]: value };
      const role = right === "canAdmin" && value ? "admin" : right === "canAdmin" && !value ? "staff" : staff.role;
      return { ...staff, rights, role };
    }),
    updatedAt: new Date().toISOString()
  });
}

function submitGlobalCount(date: string, group: string, countedQty: number, note: string) {
  const user = currentUser();
  if (!user) throw new Error("Employee login required.");
  if (!hasRight("canGlobalCount", user)) throw new Error("Global count right required.");
  const cleanGroup = clean(group);
  if (!cleanGroup) throw new Error("Department / Group required.");
  const allowedGroups = staffDepartments(user);
  const canCountGroup = isAdmin(user) || allowedGroups.includes("ALL") || allowedGroups.includes(cleanGroup);
  if (!canCountGroup) throw new Error("You can count only your own department group.");

  const ledgerQty = ledgerQtyByGroup(cleanGroup, snapshot.currentStoreId);
  const count = Math.max(0, numeric(countedQty));
  const now = new Date().toISOString();
  const report: GlobalCountReport = {
    id: makeId("count"),
    date: clean(date) || now.slice(0, 10),
    group: cleanGroup,
    storeId: snapshot.currentStoreId,
    storeName: storeLabel(snapshot.currentStoreId),
    ledgerQty,
    countedQty: count,
    variance: count - ledgerQty,
    staffId: user.id,
    staffName: user.name,
    status: "Submitted",
    note: clean(note),
    submittedAt: now
  };

  commit({
    ...snapshot,
    globalCounts: [report, ...snapshot.globalCounts],
    updatedAt: now
  });

  return report;
}

function approveCount(id: string, status: CountStatus) {
  if (!isAdmin()) throw new Error("Admin rights required.");
  const user = currentUser();
  commit({
    ...snapshot,
    globalCounts: snapshot.globalCounts.map((report) => report.id === id
      ? { ...report, status, approvedBy: user?.name || "Admin", approvedAt: new Date().toISOString() }
      : report),
    updatedAt: new Date().toISOString()
  });
}

function submitAudit(entries: { article: string; qty: number }[], fullStore: boolean) {
  const user = currentUser();
  if (!user) throw new Error("Employee login required.");
  if (!hasRight("canAudit", user)) throw new Error("Audit right required.");
  if (!entries.length) throw new Error("Scan article or enter manual quantity.");

  const lines = entries.map((entry) => buildAuditLine(entry.article, entry.qty, user, fullStore)).filter((line): line is AuditLine => Boolean(line));
  if (!lines.length) throw new Error("No allowed scan to submit.");

  const now = new Date().toISOString();
  const ledgerQty = lines.reduce((sum, line) => sum + line.ledgerQty, 0);
  const countedQty = lines.reduce((sum, line) => sum + line.countedQty, 0);
  const variance = countedQty - ledgerQty;
  const groups = unique(lines.map((line) => line.group));
  const scope = fullStore && hasRight("canFullStoreAudit", user) ? "Full Store" : "Department";
  const id = makeId("audit");
  const report: AuditReport = {
    id,
    type: "auditReport",
    article: scope === "Full Store" ? "Full Store Audit Report" : `${staffDepartmentLabel(user)} Audit Report`,
    description: `${lines.length.toLocaleString("en-IN")} article lines`,
    group: groups.length === 1 ? groups[0] : scope,
    groups,
    storeId: snapshot.currentStoreId,
    storeName: storeLabel(snapshot.currentStoreId),
    ledgerQty,
    countedQty,
    variance,
    status: auditStatus(variance),
    staffName: user.name,
    staffDepartment: staffDepartmentLabel(user),
    scope,
    scopeDepartments: scope === "Full Store" ? unique(currentInventory(snapshot.currentStoreId).map((item) => item.group)) : staffDepartments(user),
    diffArticleCount: lines.filter((line) => line.variance !== 0).length,
    countedAt: now,
    submittedAt: now,
    submittedToAdmin: true,
    items: lines.map((line) => ({ ...line, reportId: id }))
  };

  commit({
    ...snapshot,
    audits: [report, ...snapshot.audits],
    updatedAt: now
  });

  return report;
}

function sendMessage(input: { title: string; body: string; storeId: string; department: string }) {
  if (!isAdmin()) throw new Error("Admin rights required.");
  if (!clean(input.title) || !clean(input.body)) throw new Error("Message title and instruction required.");
  const user = currentUser();
  const message: EmployeeMessage = {
    id: makeId("msg"),
    title: clean(input.title),
    body: clean(input.body),
    storeId: clean(input.storeId) || "all",
    department: clean(input.department) || "all",
    createdAt: new Date().toISOString(),
    createdBy: user?.name || "Admin",
    active: true,
    readBy: []
  };

  commit({
    ...snapshot,
    messages: [message, ...snapshot.messages],
    updatedAt: new Date().toISOString()
  });
}

function markMessageRead(id: string) {
  const user = currentUser();
  if (!user) return;
  commit({
    ...snapshot,
    messages: snapshot.messages.map((message) => message.id === id
      ? { ...message, readBy: Array.from(new Set([...(message.readBy || []), user.id])) }
      : message),
    updatedAt: new Date().toISOString()
  });
}

function deactivateMessage(id: string) {
  if (!isAdmin()) throw new Error("Admin rights required.");
  commit({
    ...snapshot,
    messages: snapshot.messages.map((message) => message.id === id ? { ...message, active: false } : message),
    updatedAt: new Date().toISOString()
  });
}

function restoreBackupJson(text: string) {
  const parsed = JSON.parse(text);
  const data = parsed.data || parsed;
  if (!data || !Array.isArray(data.staff)) throw new Error("Backup file not valid.");
  const sessionId = snapshot.currentUserId;
  commit(normaliseState({ ...data, currentUserId: sessionId }));
}

function exportBackupJson() {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    app: "stock-ledger",
    data: { ...snapshot, currentUserId: "" },
    backups: exportBackups()
  }, null, 2);
}

function firebaseBackupReady() {
  return firebaseConfigured();
}

async function saveCloudBackup(login: FirebaseLogin) {
  const latest = snapshot;
const payload = await saveFirebaseBackup(compactStateForStorage(latest), login);
  return payload.exportedAt;
}

async function restoreCloudBackup(login: FirebaseLogin) {
  const payload = await loadFirebaseBackup(login);
  if (!payload.data || !Array.isArray(payload.data.staff)) throw new Error("Firebase backup is not valid.");

  const sessionId = snapshot.currentUserId;
  commit(normaliseState({ ...payload.data, currentUserId: sessionId }));
  return payload.exportedAt;
}

async function saveCloudLive(login: FirebaseLogin) {
  const latest = snapshot;
  await saveFirebaseLive(compactStateForStorage(latest), login);
  return new Date().toISOString();
}

async function restoreCloudLive(login: FirebaseLogin) {
  const payload = await loadFirebaseLive(login);
  if (!payload.data) {
    throw new Error("No valid Firebase live data found.");
  }

  const sessionId = snapshot.currentUserId;
  commit(normaliseState({ ...payload.data, currentUserId: sessionId }));
  return payload.updatedAt || new Date().toISOString();
}

function exportStockCsvText(storeId = snapshot.adminStoreFilter || snapshot.currentStoreId) {
  return exportInventoryCsv(inventoryForStore(storeId));
}

function exportSummaryCsvText() {
  return exportSummaryCsv(groupSummaries(snapshot.adminStoreFilter || "all"));
}

function exportCountsCsvText() {
  return exportCountsCsv(snapshot.globalCounts.filter((report) => storeRecordMatches(report, snapshot.adminStoreFilter || "all")));
}

function exportAuditCsvText() {
  return exportAuditCsv(snapshot.audits.filter((audit) => storeRecordMatches(audit, snapshot.adminStoreFilter || "all")));
}

export function scanEntriesFromText(text: string) {
  return rowsToScanEntries(parseDelimited(text));
}

function buildAuditLine(article: string, countedQty: number, staff: Staff, fullStore: boolean): AuditLine | null {
  const matches = currentInventory(snapshot.currentStoreId).filter((item) => item.article.toLowerCase() === clean(article).toLowerCase());
  if (!matches.length) return null;
  if (!matches.some((item) => canStaffScanItem(item, staff, fullStore))) return null;
  const ledgerQty = matches.reduce((sum, item) => sum + numeric(item.closingStock), 0);
  const counted = Math.max(0, numeric(countedQty));
  const variance = counted - ledgerQty;
  return {
    id: makeId("line"),
    article: matches[0].article,
    description: matches[0].description,
    group: matches[0].group,
    storeId: snapshot.currentStoreId,
    storeName: storeLabel(snapshot.currentStoreId),
    ledgerQty,
    countedQty: counted,
    variance,
    status: auditStatus(variance),
    staffName: staff.name,
    staffDepartment: staffDepartmentLabel(staff),
    countedAt: new Date().toISOString()
  };
}

function currentUser() {
  return snapshot.staff.find((staff) => staff.id === snapshot.currentUserId && staff.active !== false) || null;
}

function currentState() {
  return snapshot;
}

function getCurrentStoreId() {
  return snapshot.currentStoreId;
}

function isAdmin(user = currentUser()) {
  return !!user && (user.role === "admin" || !!user.rights?.canAdmin);
}

function hasRight(right: keyof StaffRights, user = currentUser()) {
  if (!user || user.approved === false || user.active === false) return false;
  if (isAdmin(user)) return true;
  return !!user.rights?.[right];
}

function activeStores() {
  return snapshot.stores.filter((store) => store.active !== false);
}

function currentLedger(storeId = snapshot.currentStoreId) {
  return snapshot.ledgerByStore[storeId] || { name: "No ledger", date: "" };
}

function currentInventory(storeId = snapshot.currentStoreId) {
  return inventoryForStore(storeId);
}

function inventoryForStore(storeId = "all", state = snapshot): InventoryItem[] {
  if (storeId === "all") {
    return Object.entries(state.inventoryByStore || {}).flatMap(([id, items]) =>
      (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        storeId: id,
        storeName: storeLabel(id, state)
      }))
    );
  }

  return (state.inventoryByStore[storeId] || []).map((item) => ({
    ...item,
    storeId,
    storeName: storeLabel(storeId, state)
  }));
}

function visibleInventoryForEmployee(query: string, group: string, year: string) {
  const user = currentUser();
  const allowedGroups = staffDepartments(user);
  const canAll = isAdmin(user) || allowedGroups.includes("ALL");
  const needle = clean(query).toLowerCase();

  return currentInventory(snapshot.currentStoreId)
    .filter((item) => canAll || !allowedGroups.length || allowedGroups.includes(item.group))
    .filter((item) => group === "all" || item.group === group)
    .filter((item) => year === "all" || item.year === year)
    .filter((item) => {
      if (!needle) return true;
      return [item.article, item.baseArticle, item.shadeCode, item.articleSize, item.description, item.colour, item.year, item.group, item.size].join(" ").toLowerCase().includes(needle);
    });
}

function groupSummaries(storeId = "all", query = "", year = "all", sort: "qty" | "group" | "articles" = "qty"): GroupSummary[] {
  const totals = new Map<string, { storeName: string; group: string; qty: number; articles: Set<string>; shades: Set<string>; sizes: Set<string> }>();
  const needle = clean(query).toLowerCase();

  inventoryForStore(storeId).forEach((item) => {
    if (year !== "all" && item.year !== year) return;
    if (needle && !clean(item.group).toLowerCase().includes(needle)) return;
    const group = item.group || "N.A.";
    const key = storeId === "all" ? `${item.storeId}|${group}` : group;
    if (!totals.has(key)) {
      totals.set(key, { storeName: item.storeName || storeLabel(item.storeId || DEFAULT_STORE_ID), group, qty: 0, articles: new Set(), shades: new Set(), sizes: new Set() });
    }
    const total = totals.get(key)!;
    total.qty += numeric(item.closingStock);
    total.articles.add(item.baseArticle || item.article);
    if (item.shadeCode) total.shades.add(item.shadeCode);
    if (item.size) total.sizes.add(item.size);
  });

  const rows = Array.from(totals.entries()).map(([key, total]) => ({
    key,
    storeName: total.storeName,
    group: total.group,
    qty: total.qty,
    articles: total.articles.size,
    shades: total.shades.size,
    sizes: total.sizes.size
  }));

  if (sort === "group") rows.sort((a, b) => a.group.localeCompare(b.group) || a.storeName.localeCompare(b.storeName));
  else if (sort === "articles") rows.sort((a, b) => b.articles - a.articles);
  else rows.sort((a, b) => b.qty - a.qty);
  return rows;
}

function relevantMessages(user = currentUser()) {
  if (!user) return [];
  const departments = staffDepartments(user).map((department) => department.toLowerCase());
  const allDepartments = departments.includes("all");
  return snapshot.messages.filter((message) => {
    const storeOk = message.storeId === "all" || (message.storeId || DEFAULT_STORE_ID) === snapshot.currentStoreId;
    const department = clean(message.department || "all").toLowerCase();
    const deptOk = department === "all" || allDepartments || departments.includes(department);
    return message.active !== false && storeOk && deptOk;
  });
}

function pendingTransfers() {
  return snapshot.transfers.filter((transfer) => transfer.status === "Submitted");
}

function pendingCustomerApprovals() {
  return snapshot.customerApprovals.filter((approval) => approval.status === "Submitted");
}

function articlePhoto(article: string) {
  return snapshot.articlePhotos[clean(article)] || "";
}

function computeMetrics(storeId = snapshot.adminStoreFilter || snapshot.currentStoreId): StockMetrics {
  const inventory = inventoryForStore(storeId);
  const totalQty = inventory.reduce((sum, item) => sum + numeric(item.closingStock), 0);
  return {
    totalQty,
    articleCount: inventory.length,
    groupCount: unique(inventory.map((item) => item.group)).length,
    auditVariance: snapshot.audits.filter((audit) => storeRecordMatches(audit, storeId)).reduce((sum, audit) => sum + audit.variance, 0),
    stores: activeStores().length,
    staff: snapshot.staff.filter((staff) => staff.active !== false && !isAdmin(staff)).length,
    submittedCounts: snapshot.globalCounts.filter((report) => report.status === "Submitted" && storeRecordMatches(report, storeId)).length
  };
}

function canStaffScanItem(item: InventoryItem, staff: Staff | null = currentUser(), fullStore = false) {
  if (!staff) return false;
  const stores = staffStoreIds(staff);
  const storeAllowed = !stores.length || stores.includes("ALL") || stores.includes(snapshot.currentStoreId);
  if (!storeAllowed) return false;
  if (fullStore && hasRight("canFullStoreAudit", staff)) return true;
  const departments = staffDepartments(staff).map((department) => department.toLowerCase());
  return !departments.length || departments.includes("all") || departments.includes(clean(item.group).toLowerCase());
}

function staffDepartments(staff: Staff | null | undefined) {
  if (!staff) return [];
  if (Array.isArray(staff.departments)) return unique(staff.departments);
  return unique(clean(staff.department).split(","));
}

function staffDepartmentLabel(staff: Staff | null | undefined) {
  const departments = staffDepartments(staff);
  return departments.length ? departments.join(", ") : "No department";
}

function staffStoreIds(staff: Staff | null | undefined) {
  if (!staff) return [];
  if (staff.role === "admin" || staff.rights?.canAdmin) return ["ALL"];
  if (Array.isArray(staff.storeIds)) return staff.storeIds.map(clean).filter(Boolean);
  const storeId = clean(staff.storeId);
  return storeId ? [storeId] : [DEFAULT_STORE_ID];
}

function employeeStoreIds(user: Staff | null = currentUser()) {
  const ids = staffStoreIds(user);
  if (ids.includes("ALL")) return activeStores().map((store) => store.id);
  return ids.filter((id) => activeStores().some((store) => store.id === id));
}

function storeLabel(storeId: string | undefined, state = snapshot) {
  const store = (state.stores || []).find((item) => item.id === storeId);
  if (!store) return "Store";
  return [store.name, store.place].filter(Boolean).join(" - ");
}

function exportBackups(): LegacyBackup[] {
  const saved = readJson(BACKUP_KEY);
  return Array.isArray(saved) ? saved as LegacyBackup[] : [];
}

function ledgerQtyByGroup(group: string, storeId = snapshot.currentStoreId) {
  return currentInventory(storeId).filter((item) => item.group === group).reduce((sum, item) => sum + numeric(item.closingStock), 0);
}

function storeRecordMatches(record: { storeId?: string }, storeId = "all") {
  return storeId === "all" || (record.storeId || DEFAULT_STORE_ID) === storeId;
}

function commit(nextState: StockLedgerState, options: { persist?: boolean } = {}) {
  const shouldPersist = options.persist !== false;
  snapshot = normaliseState(nextState);
  if (shouldPersist && hasLocalStorage()) {
    persistSnapshot();
  }
  listeners.forEach((listener) => listener());
}

function installStorageSync() {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) syncSnapshotFromStorage();
  });
  window.addEventListener("focus", () => syncSnapshotFromStorage());
}

function syncSnapshotFromStorage(notify = true) {
  const saved = readJson(STORAGE_KEY);
  if (!saved || typeof saved !== "object") return false;

  const currentUserId = snapshot.currentUserId;
  const currentStoreId = snapshot.currentStoreId;
  const adminStoreFilter = snapshot.adminStoreFilter;
  snapshot = normaliseState({
    ...(saved as Partial<StockLedgerState>),
    currentUserId,
    currentStoreId,
    adminStoreFilter
  });

  const user = currentUser();
  if (user && !isAdmin(user)) {
    const allowedStores = employeeStoreIds(user);
    if (!allowedStores.includes(snapshot.currentStoreId)) {
      const nextStoreId = allowedStores[0] || DEFAULT_STORE_ID;
      snapshot = normaliseState({ ...snapshot, currentStoreId: nextStoreId });
    }
  }

  if (notify) listeners.forEach((listener) => listener());
  return true;
}

function readInitialState(): StockLedgerState {
  const saved = readJson(STORAGE_KEY);
  if (saved) return normaliseState(saved);

  const simplified = readJson(SIMPLIFIED_KEY);
  if (simplified && typeof simplified === "object") return simplifiedToLegacyState(simplified as Record<string, unknown>);

  return createDemoState();
}

function simplifiedToLegacyState(value: Record<string, unknown>): StockLedgerState {
  const fallback = createDemoState();
  const inventory = normaliseItems(Array.isArray(value.inventory) ? value.inventory as InventoryItem[] : fallback.inventory);
  const now = new Date().toISOString();
  return normaliseState({
    ...fallback,
    inventory,
    inventoryByStore: { [DEFAULT_STORE_ID]: inventory },
    ledgerByStore: { [DEFAULT_STORE_ID]: { name: clean(value.ledgerName) || DEMO_LEDGER_NAME, date: clean(value.ledgerDate) || now } },
    ledgerName: clean(value.ledgerName) || DEMO_LEDGER_NAME,
    ledgerDate: clean(value.ledgerDate) || now,
    updatedAt: clean(value.updatedAt) || now
  });
}

function normaliseState(value: Partial<StockLedgerState>): StockLedgerState {
  const fallback = createDemoState();
  const stores = normaliseStores(value.stores);
  const storeIds = stores.map((store) => store.id);
  const inventoryByStore = normaliseInventoryByStore(value.inventoryByStore, value.inventory, storeIds);
  const currentStoreId = storeIds.includes(clean(value.currentStoreId)) ? clean(value.currentStoreId) : storeIds[0] || DEFAULT_STORE_ID;
  const ledgerByStore = normaliseLedgerByStore(value.ledgerByStore, storeIds);
  const staff = normaliseStaff(value.staff);
  const currentLedgerValue = ledgerByStore[currentStoreId] || { name: "No ledger", date: "" };

  return {
    inventory: inventoryForStoreFrom(inventoryByStore, stores, currentStoreId),
    stores,
    inventoryByStore,
    ledgerByStore,
    audits: Array.isArray(value.audits) ? value.audits.map(normaliseAuditReport) : [],
    globalCounts: Array.isArray(value.globalCounts) ? value.globalCounts.map(normaliseCountReport) : [],
    messages: Array.isArray(value.messages) ? value.messages.map(normaliseMessage) : [],
    transfers: Array.isArray(value.transfers) ? value.transfers.map(normaliseTransfer) : [],
    customerApprovals: Array.isArray(value.customerApprovals) ? value.customerApprovals.map(normaliseCustomerApproval) : [],
    articlePhotos: normaliseArticlePhotos(value.articlePhotos),
    staff,
    currentUserId: clean(value.currentUserId),
    currentStoreId,
    adminStoreFilter: clean(value.adminStoreFilter) || "all",
    ledgerName: clean(value.ledgerName) || currentLedgerValue.name || fallback.ledgerName,
    ledgerDate: clean(value.ledgerDate) || currentLedgerValue.date || fallback.ledgerDate,
    updatedAt: clean(value.updatedAt) || new Date().toISOString()
  };
}

function normaliseStores(stores: unknown): Store[] {
  if (!Array.isArray(stores) || !stores.length) return [defaultStore()];
  return stores.map((storeLike) => {
    const store = storeLike as Partial<Store>;
    return {
      id: clean(store.id) || makeId("store"),
      name: clean(store.name) || "Store",
      place: clean(store.place),
      details: clean(store.details),
      active: store.active !== false
    };
  });
}

function normaliseInventoryByStore(byStore: unknown, inventory: unknown, storeIds: string[]) {
  const next: Record<string, InventoryItem[]> = {};
  if (byStore && typeof byStore === "object") {
    Object.entries(byStore as Record<string, unknown>).forEach(([storeId, items]) => {
      next[clean(storeId) || DEFAULT_STORE_ID] = normaliseItems(Array.isArray(items) ? items as InventoryItem[] : []);
    });
  }
  if (!Object.keys(next).length && Array.isArray(inventory)) {
    next[storeIds[0] || DEFAULT_STORE_ID] = normaliseItems(inventory as InventoryItem[]);
  }
  storeIds.forEach((storeId) => {
    if (!next[storeId]) next[storeId] = [];
  });
  return next;
}

function normaliseLedgerByStore(value: unknown, storeIds: string[]) {
  const next: Record<string, { name: string; date: string }> = {};
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, { name?: string; date?: string }>).forEach(([storeId, ledger]) => {
      next[storeId] = { name: clean(ledger?.name) || "Stock ledger", date: clean(ledger?.date) };
    });
  }
  storeIds.forEach((storeId) => {
    if (!next[storeId]) next[storeId] = { name: "No ledger", date: "" };
  });
  return next;
}

function normaliseStaff(staffList: unknown): Staff[] {
  const source = Array.isArray(staffList) && staffList.length ? staffList : [adminUser()];
  const normalised = source.map((staffLike) => {
    const staff = staffLike as Partial<Staff>;
    const role = staff.role || (staff.username === "admin" ? "admin" : "staff");
    const departments = Array.isArray(staff.departments) ? unique(staff.departments) : unique(clean(staff.department).split(","));
    const empCode = clean(staff.empCode || staff.username || staff.phone || (role === "admin" ? "admin" : ""));
    const storeIds = role === "admin" || staff.rights?.canAdmin
      ? ["ALL"]
      : Array.isArray(staff.storeIds) && staff.storeIds.length
        ? staff.storeIds.map(clean).filter(Boolean)
        : [clean(staff.storeId) || DEFAULT_STORE_ID];

    return {
      id: clean(staff.id) || makeId("staff"),
      name: clean(staff.name) || (role === "admin" ? "Admin" : "Employee"),
      empCode,
      username: empCode,
      phone: clean(staff.phone) || empCode,
      password: clean(staff.password || staff.pin) || "1234",
      pin: clean(staff.pin || staff.password) || "1234",
      role,
      departments: departments.length ? departments : role === "admin" ? ["ALL"] : [],
      department: departments.length ? departments.join(", ") : role === "admin" ? "ALL" : "",
      storeIds,
      storeId: storeIds[0] || DEFAULT_STORE_ID,
      approved: staff.approved !== false || role === "admin",
      active: staff.active !== false,
      rights: { ...defaultRights(role), ...(staff.rights || {}) }
    };
  });

  if (!normalised.some((staff) => staff.username === "admin" || staff.empCode === "admin")) {
    normalised.unshift(adminUser());
  }
  return normalised;
}

function normaliseAuditReport(value: Partial<AuditReport>): AuditReport {
  const now = new Date().toISOString();
  const items = Array.isArray(value.items) && value.items.length ? value.items.map(normaliseAuditLine) : [normaliseAuditLine(value as Partial<AuditLine>)];
  const ledgerQty = numeric(value.ledgerQty) || items.reduce((sum, item) => sum + item.ledgerQty, 0);
  const countedQty = numeric(value.countedQty) || items.reduce((sum, item) => sum + item.countedQty, 0);
  const variance = Number.isFinite(Number(value.variance)) ? numeric(value.variance) : countedQty - ledgerQty;
  const groups = value.groups?.length ? value.groups.map(clean).filter(Boolean) : unique(items.map((item) => item.group));
  return {
    id: clean(value.id) || makeId("audit"),
    type: "auditReport",
    article: clean(value.article) || "Audit Report",
    description: clean(value.description) || `${items.length} article lines`,
    group: clean(value.group) || groups[0] || "Department",
    groups,
    storeId: clean(value.storeId) || DEFAULT_STORE_ID,
    storeName: clean(value.storeName) || "Store",
    ledgerQty,
    countedQty,
    variance,
    status: auditStatus(variance),
    staffName: clean(value.staffName) || "Staff",
    staffDepartment: clean(value.staffDepartment),
    scope: value.scope === "Full Store" ? "Full Store" : "Department",
    scopeDepartments: Array.isArray(value.scopeDepartments) ? value.scopeDepartments.map(clean).filter(Boolean) : groups,
    diffArticleCount: numeric(value.diffArticleCount) || items.filter((item) => item.variance !== 0).length,
    countedAt: clean(value.countedAt) || now,
    submittedAt: clean(value.submittedAt) || clean(value.countedAt) || now,
    submittedToAdmin: value.submittedToAdmin !== false,
    items
  };
}

function normaliseAuditLine(value: Partial<AuditLine>): AuditLine {
  const ledgerQty = numeric(value.ledgerQty);
  const countedQty = numeric(value.countedQty);
  const variance = Number.isFinite(Number(value.variance)) ? numeric(value.variance) : countedQty - ledgerQty;
  return {
    id: clean(value.id) || makeId("line"),
    reportId: clean(value.reportId),
    article: clean(value.article),
    description: clean(value.description),
    group: clean(value.group),
    storeId: clean(value.storeId) || DEFAULT_STORE_ID,
    storeName: clean(value.storeName) || "Store",
    ledgerQty,
    countedQty,
    variance,
    status: auditStatus(variance),
    staffName: clean(value.staffName),
    staffDepartment: clean(value.staffDepartment),
    countedAt: clean(value.countedAt) || new Date().toISOString()
  };
}

function normaliseCountReport(value: Partial<GlobalCountReport>): GlobalCountReport {
  const ledgerQty = numeric(value.ledgerQty);
  const countedQty = numeric(value.countedQty);
  return {
    id: clean(value.id) || makeId("count"),
    date: clean(value.date) || new Date().toISOString().slice(0, 10),
    group: clean(value.group),
    storeId: clean(value.storeId) || DEFAULT_STORE_ID,
    storeName: clean(value.storeName) || "Store",
    ledgerQty,
    countedQty,
    variance: Number.isFinite(Number(value.variance)) ? numeric(value.variance) : countedQty - ledgerQty,
    staffId: clean(value.staffId),
    staffName: clean(value.staffName),
    status: value.status === "Approved" || value.status === "Rejected" ? value.status : "Submitted",
    note: clean(value.note),
    submittedAt: clean(value.submittedAt) || new Date().toISOString(),
    approvedBy: clean(value.approvedBy),
    approvedAt: clean(value.approvedAt)
  };
}

function normaliseMessage(value: Partial<EmployeeMessage>): EmployeeMessage {
  return {
    id: clean(value.id) || makeId("msg"),
    title: clean(value.title),
    body: clean(value.body),
    storeId: clean(value.storeId) || "all",
    department: clean(value.department) || "all",
    createdAt: clean(value.createdAt) || new Date().toISOString(),
    createdBy: clean(value.createdBy) || "Admin",
    active: value.active !== false,
    readBy: Array.isArray(value.readBy) ? value.readBy.map(clean).filter(Boolean) : []
  };
}

function normaliseTransfer(value: Partial<InterStoreTransfer>): InterStoreTransfer {
  return {
    id: clean(value.id) || makeId("transfer"),
    fromStoreId: clean(value.fromStoreId) || DEFAULT_STORE_ID,
    fromStoreName: clean(value.fromStoreName) || storeLabel(clean(value.fromStoreId) || DEFAULT_STORE_ID),
    toStoreId: clean(value.toStoreId) || DEFAULT_STORE_ID,
    toStoreName: clean(value.toStoreName) || storeLabel(clean(value.toStoreId) || DEFAULT_STORE_ID),
    article: clean(value.article),
    description: clean(value.description),
    qty: Math.max(1, numeric(value.qty)),
    requestedById: clean(value.requestedById),
    requestedByName: clean(value.requestedByName) || "Staff",
    status: value.status === "Approved" || value.status === "Rejected" ? value.status : "Submitted",
    note: clean(value.note),
    createdAt: clean(value.createdAt) || new Date().toISOString(),
    approvedBy: clean(value.approvedBy),
    approvedAt: clean(value.approvedAt)
  };
}

function normaliseCustomerApproval(value: Partial<CustomerApproval>): CustomerApproval {
  const statuses: CustomerApprovalStatus[] = ["Submitted", "Approved", "Rejected", "Returned", "Sold"];
  return {
    id: clean(value.id) || makeId("approval"),
    storeId: clean(value.storeId) || DEFAULT_STORE_ID,
    storeName: clean(value.storeName) || storeLabel(clean(value.storeId) || DEFAULT_STORE_ID),
    customerName: clean(value.customerName),
    customerPhone: clean(value.customerPhone),
    article: clean(value.article),
    description: clean(value.description),
    colour: clean(value.colour),
    year: clean(value.year),
    group: clean(value.group),
    size: clean(value.size),
    mrp: numeric(value.mrp),
    baseArticle: clean(value.baseArticle),
    shadeCode: clean(value.shadeCode),
    articleSize: clean(value.articleSize),
    qty: Math.max(1, numeric(value.qty)),
    requestedById: clean(value.requestedById),
    requestedByName: clean(value.requestedByName) || "Staff",
    status: statuses.includes(value.status as CustomerApprovalStatus) ? value.status as CustomerApprovalStatus : "Submitted",
    note: clean(value.note),
    createdAt: clean(value.createdAt) || new Date().toISOString(),
    approvedBy: clean(value.approvedBy),
    approvedAt: clean(value.approvedAt),
    closedAt: clean(value.closedAt)
  };
}

function normaliseArticlePhotos(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((photos, [article, dataUrl]) => {
    const key = clean(article);
    const url = clean(dataUrl);
    if (key && url) photos[key] = url;
    return photos;
  }, {});
}

function persistSnapshot() {
  const saved = compactStateForStorage(snapshot);
  try {
    localStorage.removeItem(BACKUP_KEY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    try {
      localStorage.removeItem(BACKUP_KEY);
      localStorage.removeItem(SIMPLIFIED_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      throw error;
    }
  }
}

function compactStateForStorage(state: StockLedgerState): Partial<StockLedgerState> {
  const inventoryByStore = Object.entries(state.inventoryByStore || {}).reduce<Record<string, InventoryItem[]>>((byStore, [storeId, items]) => {
    byStore[storeId] = (items || []).map(compactInventoryItem);
    return byStore;
  }, {});

  return {
    stores: state.stores,
    inventoryByStore,
    ledgerByStore: state.ledgerByStore,
    audits: state.audits,
    globalCounts: state.globalCounts,
    messages: state.messages,
    transfers: state.transfers,
    customerApprovals: state.customerApprovals,
    articlePhotos: state.articlePhotos,
    staff: state.staff,
    currentUserId: "",
    currentStoreId: state.currentStoreId,
    adminStoreFilter: state.adminStoreFilter,
    ledgerName: state.ledgerName,
    ledgerDate: state.ledgerDate,
    updatedAt: state.updatedAt
  };
}

function compactInventoryItem(item: InventoryItem): InventoryItem {
  return {
    article: item.article,
    description: item.description,
    colour: item.colour,
    year: item.year,
    group: item.group,
    size: item.size,
    closingStock: item.closingStock,
    mrp: item.mrp,
    baseArticle: item.baseArticle,
    shadeCode: item.shadeCode,
    articleSize: item.articleSize
  };
}

function findStoreItem(storeId: string, article: string) {
  return (snapshot.inventoryByStore[storeId] || []).find((item) => item.article.toLowerCase() === clean(article).toLowerCase()) || null;
}

function moveStockBetweenStores(byStore: Record<string, InventoryItem[]>, fromStoreId: string, toStoreId: string, article: string, qty: number) {
  const source = findStoreItem(fromStoreId, article);
  if (!source) throw new Error("Article not found in From store.");
  const afterFrom = adjustStoreArticleQty(byStore, fromStoreId, article, -qty);
  return upsertStoreArticleQty(afterFrom, toStoreId, source, qty);
}

function adjustStoreArticleQty(byStore: Record<string, InventoryItem[]>, storeId: string, article: string, delta: number) {
  let found = false;
  const items = (byStore[storeId] || []).map((item) => {
    if (found || item.article.toLowerCase() !== clean(article).toLowerCase()) return item;
    const nextQty = numeric(item.closingStock) + delta;
    if (nextQty < 0) throw new Error("Quantity is more than available stock.");
    found = true;
    return { ...item, closingStock: nextQty, updatedAt: new Date().toISOString() };
  });
  if (!found) throw new Error("Article not found in selected store.");
  return { ...byStore, [storeId]: items };
}

function upsertStoreArticleQty(byStore: Record<string, InventoryItem[]>, storeId: string, template: InventoryItem, qty: number) {
  let found = false;
  const items = (byStore[storeId] || []).map((item) => {
    if (found || item.article.toLowerCase() !== template.article.toLowerCase()) return item;
    found = true;
    return { ...item, closingStock: numeric(item.closingStock) + qty, updatedAt: new Date().toISOString() };
  });
  if (!found) {
    items.push({ ...template, id: makeId("item"), closingStock: qty, storeId, storeName: storeLabel(storeId), updatedAt: new Date().toISOString() });
  }
  return { ...byStore, [storeId]: normaliseItems(items) };
}

function inventoryForStoreFrom(byStore: Record<string, InventoryItem[]>, stores: Store[], storeId: string) {
  return (byStore[storeId] || []).map((item) => ({
    ...item,
    storeId,
    storeName: stores.find((store) => store.id === storeId)?.name || "Store"
  }));
}

function readJson(key: string): unknown | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function codeKey(value: unknown) {
  return clean(value).toLowerCase().replace(/\s+/g, "");
}

function slugStore(name: string, place: string) {
  const raw = `${name}-${place}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return raw || makeId("store");
}

function auditStatus(variance: number): AuditStatus {
  if (variance < 0) return "short";
  if (variance > 0) return "excess";
  return "match";
}

function unique(values: unknown[]) {
  return Array.from(new Set(values.map(clean).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

export function rowsToCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
