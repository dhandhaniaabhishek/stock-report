import { File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useEffect, useState, type ReactNode } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";

import { clean, parseXlsWorkbook } from "@/data/csv";
import { scanEntriesFromText, stockSelectors } from "@/data/stock-store";
import type { AuditReport, CustomerApproval, EmployeeMessage, GlobalCountReport, GroupSummary, InterStoreTransfer, InventoryItem, Staff, StaffRights, Store } from "@/data/types";
import { useStockStore } from "@/hooks/use-stock-store";

type LoginMode = "admin" | "employee";
type AdminTab = "summary" | "ledger" | "stores" | "staff" | "counts" | "audit" | "transfers" | "approval" | "messages" | "backup";
type EmployeeTab = "stock" | "ledger" | "transfer" | "approval" | "audit" | "count" | "instructions" | "password";
type PickedLedgerFile = { name: string; text: string; arrayBuffer: ArrayBuffer };
type PickedBinaryFile = { name: string; mimeType: string; arrayBuffer: ArrayBuffer };
type StockActions = ReturnType<typeof useStockStore>["actions"];
type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorInstance = { detect: (source: ImageBitmapSource) => Promise<BarcodeDetectorResult[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

const adminTabs: { key: AdminTab; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "ledger", label: "Ledger" },
  { key: "stores", label: "Stores" },
  { key: "staff", label: "Staff" },
  { key: "counts", label: "Counts" },
  { key: "audit", label: "Audit" },
  { key: "transfers", label: "Transfers" },
  { key: "approval", label: "Approval" },
  { key: "messages", label: "Messages" },
  { key: "backup", label: "Backup" }
];

const employeeTabs: { key: EmployeeTab; label: string }[] = [
  { key: "stock", label: "Stock" },
  { key: "ledger", label: "Ledger" },
  { key: "transfer", label: "Transfer" },
  { key: "approval", label: "Approval" },
  { key: "audit", label: "Audit" },
  { key: "count", label: "Count" },
  { key: "instructions", label: "Instructions" },
  { key: "password", label: "Password" }
];

const rightLabels: { key: keyof StaffRights; label: string }[] = [
  { key: "canAudit", label: "Audit" },
  { key: "canGlobalCount", label: "Global Count" },
  { key: "canUploadLedger", label: "Ledger Upload" },
  { key: "canFullStoreAudit", label: "Full Store Audit" },
  { key: "canManageStaff", label: "Manage Staff" },
  { key: "canAdmin", label: "Admin" }
];

const colors = {
  bg: "#f7f7f4",
  ink: "#151515",
  muted: "#686862",
  line: "#d8d8d2",
  surface: "#ffffff",
  soft: "#ecefea",
  accent: "#1d4ed8",
  good: "#0f766e",
  bad: "#b42318",
  warn: "#a16207"
};

export function StockReportScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= 780;
  const { state, actions } = useStockStore();
  const user = stockSelectors.currentUser();
  const adminUser = stockSelectors.isAdmin(user);
  const [notice, setNotice] = useState("");

  if (!user) {
    return <LoginScreen onNotice={setNotice} notice={notice} />;
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 18, paddingBottom: 44, gap: 14 }}
    >
      <Header user={user} isWide={isWide} notice={notice} onNotice={setNotice} />
      {adminUser ? (
        <AdminWorkspace isWide={isWide} onNotice={setNotice} />
      ) : (
        <EmployeeWorkspace isWide={isWide} onNotice={setNotice} />
      )}
    </ScrollView>
  );
}

function LoginScreen({ onNotice, notice }: { onNotice: (value: string) => void; notice: string }) {
  const { actions } = useStockStore();
  const [mode, setMode] = useState<LoginMode>("admin");
  const [empCode, setEmpCode] = useState("admin");
  const [password, setPassword] = useState("admin");

  const submit = () => run(onNotice, () => {
    const user = actions.login(mode, empCode, password);
    onNotice(`Logged in: ${user.name}`);
  });

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setEmpCode(next === "admin" ? "admin" : "");
    setPassword(next === "admin" ? "admin" : "");
    onNotice("");
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 18, paddingBottom: 44, gap: 14 }}
    >
      <View style={{ gap: 6 }}>
        <Text selectable style={{ color: colors.muted, fontSize: 12, textTransform: "uppercase" }}>Stock Ledger</Text>
        <Text selectable style={{ color: colors.ink, fontSize: 34, fontWeight: "800", letterSpacing: 0 }}>Stock Report</Text>
      </View>
      <Panel title={mode === "admin" ? "Admin Login" : "Employee Login"}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip label="Admin" active={mode === "admin"} onPress={() => switchMode("admin")} />
          <Chip label="Employee" active={mode === "employee"} onPress={() => switchMode("employee")} />
        </View>
        <TextInput value={empCode} onChangeText={setEmpCode} placeholder="EMP Code" placeholderTextColor={colors.muted} autoCapitalize="none" style={inputStyle} />
        <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.muted} secureTextEntry style={inputStyle} />
        <ActionButton label="Login" tone="primary" onPress={submit} />
        {notice ? <Notice text={notice} /> : null}
      </Panel>
    </ScrollView>
  );
}

function Header({ user, isWide, notice, onNotice }: { user: Staff; isWide: boolean; notice: string; onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  const stores = stockSelectors.activeStores();
  const allowedStores = stockSelectors.employeeStoreIds(user);
  const visibleStores = stockSelectors.isAdmin(user) ? stores : stores.filter((store) => allowedStores.includes(store.id));
  const metrics = stockSelectors.computeMetrics(stockSelectors.getCurrentStoreId());

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: isWide ? "row" : "column", gap: 10, alignItems: isWide ? "flex-end" : "stretch" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text selectable style={{ color: colors.muted, fontSize: 12, textTransform: "uppercase" }}>
            {stockSelectors.isAdmin(user) ? "Admin" : "Employee"} | {stockSelectors.staffDepartments(user).join(", ") || "No department"}
          </Text>
          <Text selectable style={{ color: colors.ink, fontSize: 30, fontWeight: "800", letterSpacing: 0 }}>{user.name}</Text>
          <Text selectable style={{ color: colors.muted, fontSize: 13 }}>
            Store: {stockSelectors.storeLabel(stockSelectors.getCurrentStoreId())}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <ActionButton label="Refresh" onPress={() => { actions.refreshFromStorage(); onNotice("Latest store data refreshed."); }} />
          <ActionButton label="Logout" tone="danger" onPress={() => actions.logout()} />
        </View>
      </View>

      {visibleStores.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {visibleStores.map((store) => (
            <Chip
              key={store.id}
              label={storeLabelShort(store)}
              active={store.id === stockSelectors.getCurrentStoreId()}
              onPress={() => actions.selectStore(store.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <MetricCard label="Closing Stock" value={formatNumber(metrics.totalQty)} tone="accent" />
        <MetricCard label="Articles" value={formatNumber(metrics.articleCount)} tone="ink" />
        <MetricCard label="Groups" value={formatNumber(metrics.groupCount)} tone="ink" />
        <MetricCard label="Audit Variance" value={signed(metrics.auditVariance)} tone={metrics.auditVariance === 0 ? "good" : "warn"} />
        <MetricCard label="Stores" value={formatNumber(metrics.stores)} tone="ink" />
        <MetricCard label="Staff" value={formatNumber(metrics.staff)} tone="ink" />
      </View>
      {notice ? <Notice text={notice} /> : null}
    </View>
  );
}

function AdminWorkspace({ isWide, onNotice }: { isWide: boolean; onNotice: (value: string) => void }) {
  const [tab, setTab] = useState<AdminTab>("summary");

  return (
    <View style={{ gap: 14 }}>
      <TabBar tabs={adminTabs} active={tab} onChange={(value) => setTab(value as AdminTab)} />
      {tab === "summary" ? <AdminSummaryTab onNotice={onNotice} /> : null}
      {tab === "ledger" ? <AdminLedgerTab onNotice={onNotice} /> : null}
      {tab === "stores" ? <StoresTab onNotice={onNotice} /> : null}
      {tab === "staff" ? <StaffTab onNotice={onNotice} isWide={isWide} /> : null}
      {tab === "counts" ? <CountsApprovalTab onNotice={onNotice} /> : null}
      {tab === "audit" ? <AdminAuditTab /> : null}
      {tab === "transfers" ? <AdminTransfersTab onNotice={onNotice} /> : null}
      {tab === "approval" ? <AdminCustomerApprovalTab onNotice={onNotice} /> : null}
      {tab === "messages" ? <MessagesAdminTab onNotice={onNotice} isWide={isWide} /> : null}
      {tab === "backup" ? <BackupTab onNotice={onNotice} /> : null}
    </View>
  );
}

function EmployeeWorkspace({ isWide, onNotice }: { isWide: boolean; onNotice: (value: string) => void }) {
  const [tab, setTab] = useState<EmployeeTab>("stock");

  return (
    <View style={{ gap: 14 }}>
      <TabBar tabs={employeeTabs} active={tab} onChange={(value) => setTab(value as EmployeeTab)} />
      {tab === "stock" ? <EmployeeStockTab onNotice={onNotice} /> : null}
      {tab === "ledger" ? <EmployeeLedgerTab onNotice={onNotice} /> : null}
      {tab === "transfer" ? <EmployeeTransferTab onNotice={onNotice} /> : null}
      {tab === "approval" ? <EmployeeCustomerApprovalTab onNotice={onNotice} /> : null}
      {tab === "audit" ? <EmployeeAuditTab onNotice={onNotice} /> : null}
      {tab === "count" ? <EmployeeCountTab onNotice={onNotice} /> : null}
      {tab === "instructions" ? <InstructionsTab /> : null}
      {tab === "password" ? <PasswordTab onNotice={onNotice} /> : null}
    </View>
  );
}

function AdminSummaryTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  const storeId = stockSelectors.getCurrentStoreId();
  const [query, setQuery] = useState("");
  const [articleQuery, setArticleQuery] = useState("");
  const [year, setYear] = useState("all");
  const [sort, setSort] = useState<"qty" | "group" | "articles">("qty");
  const [exportText, setExportText] = useState("");
  const summaries = stockSelectors.groupSummaries(storeId, query, year, sort);
  const years = unique(stockSelectors.inventoryForStore(storeId).map((item) => item.year));
  const articleSuggestionsForAdmin = articleSuggestions(storeId, articleQuery);
  const articleRows = articleQuery.trim()
    ? stockSelectors.inventoryForStore(storeId).filter((item) => articleMatches(item, articleQuery)).slice(0, 40)
    : [];

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Group Wise Quantity">
        <TextInput value={query} onChangeText={setQuery} placeholder="Search group" placeholderTextColor={colors.muted} style={inputStyle} />
        <ArticleInput storeId={storeId} value={articleQuery} onChange={setArticleQuery} suggestions={articleSuggestionsForAdmin} placeholder="Search / scan article no" onNotice={onNotice} />
        <ChipRow label="Year" values={["all", ...years]} selected={year} onChange={setYear} />
        <ChipRow label="Sort" values={["qty", "group", "articles"]} selected={sort} onChange={(value) => setSort(value as "qty" | "group" | "articles")} />
        <ActionButton label="Export Summary" onPress={() => setExportText(actions.exportSummaryCsvText())} />
      </Panel>
      {articleQuery.trim() ? (
        <Panel title={`${formatNumber(articleRows.length)} Article Search Rows`}>
          {articleRows.length ? articleRows.map((item) => <InventoryRow key={`admin-${item.storeId}-${item.article}-${item.size}`} item={item} />) : <EmptyState title="No article found" detail="Type or scan another article number." />}
        </Panel>
      ) : null}
      <Panel title={`${formatNumber(summaries.length)} Summary Rows`}>
        {summaries.length ? summaries.map((summary) => <SummaryRow key={summary.key} summary={summary} />) : <EmptyState title="No stock summary" detail="Upload ledger first." />}
      </Panel>
      {exportText ? <ExportBox value={exportText} /> : null}
    </View>
  );
}

function AdminLedgerTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  const stores = stockSelectors.activeStores();
  const currentStoreId = stockSelectors.getCurrentStoreId();
  const fallbackStoreId = stores[0]?.id || "main-store";
  const [storeId, setStoreId] = useState(currentStoreId || fallbackStoreId);
  const [ledgerName, setLedgerName] = useState("Imported ledger");
  const [ledgerText, setLedgerText] = useState("");
  const [exportText, setExportText] = useState("");

  useEffect(() => {
    setStoreId(currentStoreId || fallbackStoreId);
  }, [currentStoreId, fallbackStoreId]);

  const importText = (text = ledgerText, name = ledgerName) => run(onNotice, () => {
    const rows = actions.importLedgerText(storeId, text, name);
    setLedgerText("");
    onNotice(`${formatNumber(rows)} stock rows imported for ${stockSelectors.storeLabel(storeId)}.`);
  });

  const pickLedger = async () => {
    try {
      const picked = await pickTextFile(["text/*", "text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/json", "*/*"]);
      if (picked) {
        setLedgerName(picked.name);
        run(onNotice, () => {
          const rows = importLedgerFile(actions, storeId, picked);
          setLedgerText("");
          onNotice(`${formatNumber(rows)} stock rows imported for ${stockSelectors.storeLabel(storeId)}.`);
        });
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Ledger file could not be opened.");
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Admin Ledger Upload">
        <ChipRow label="Store" values={stores.map((store) => store.id)} display={(id) => stockSelectors.storeLabel(id)} selected={storeId} onChange={setStoreId} />
        <TextInput value={ledgerName} onChangeText={setLedgerName} placeholder="Ledger name" placeholderTextColor={colors.muted} style={inputStyle} />
        <TextInput value={ledgerText} onChangeText={setLedgerText} placeholder="Paste stock ledger CSV / TSV exported from Excel" placeholderTextColor={colors.muted} multiline numberOfLines={7} textAlignVertical="top" style={[inputStyle, { minHeight: 150 }]} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ActionButton label="Attach Excel / CSV" onPress={pickLedger} />
          <ActionButton label="Import Ledger" tone="primary" onPress={() => importText()} />
          <ActionButton label="Load Demo" onPress={() => { actions.loadDemoLedger(); onNotice("Demo ledger loaded."); }} />
          <ActionButton label="Reset Store Stock" tone="danger" onPress={() => confirm("Reset store stock?", () => { actions.clearStoreStock(storeId); onNotice("Store stock reset."); })} />
          <ActionButton label="Export Stock" onPress={() => setExportText(actions.exportStockCsvText(storeId))} />
        </View>
      </Panel>
      {exportText ? <ExportBox value={exportText} /> : null}
    </View>
  );
}

function StoresTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  const stores = stockSelectors.activeStores();
  const [name, setName] = useState("");
  const [place, setPlace] = useState("");
  const [details, setDetails] = useState("");

  const save = () => run(onNotice, () => {
    actions.createStore({ name, place, details });
    setName("");
    setPlace("");
    setDetails("");
    onNotice("Store created.");
  });

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Create Store">
        <TextInput value={name} onChangeText={setName} placeholder="Store name" placeholderTextColor={colors.muted} style={inputStyle} />
        <TextInput value={place} onChangeText={setPlace} placeholder="Place" placeholderTextColor={colors.muted} style={inputStyle} />
        <TextInput value={details} onChangeText={setDetails} placeholder="Details" placeholderTextColor={colors.muted} style={inputStyle} />
        <ActionButton label="Add Store" tone="primary" onPress={save} />
      </Panel>
      <Panel title="Stores">
        {stores.map((store) => <StoreRow key={store.id} store={store} />)}
      </Panel>
    </View>
  );
}

function StaffTab({ onNotice, isWide }: { onNotice: (value: string) => void; isWide: boolean }) {
  const { actions } = useStockStore();
  const stores = stockSelectors.activeStores();
  const staffList = getStaffList();
  const groups = unique([
    ...stockSelectors.inventoryForStore("all").map((item) => item.group),
    ...staffList.flatMap((person) => person.departments).filter((department) => department !== "ALL")
  ]);
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [empCode, setEmpCode] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "staff">("staff");
  const [storeId, setStoreId] = useState(stores[0]?.id || "main-store");
  const [departments, setDepartments] = useState<string[]>([]);

  const reset = () => {
    setEditingId("");
    setName("");
    setEmpCode("");
    setPassword("");
    setRole("staff");
    setStoreId(stores[0]?.id || "main-store");
    setDepartments([]);
  };

  const save = () => run(onNotice, () => {
    actions.upsertStaff({ id: editingId || undefined, name, empCode, password, role, storeId, departments });
    reset();
    onNotice(editingId ? "Employee updated." : "Employee created.");
  });

  const edit = (person: Staff) => {
    setEditingId(person.id);
    setName(person.name);
    setEmpCode(person.empCode || person.username);
    setPassword(person.password || person.pin);
    setRole(person.role);
    setStoreId(person.storeIds.includes("ALL") ? stores[0]?.id || "main-store" : person.storeIds[0]);
    setDepartments(person.departments.filter((department) => department !== "ALL"));
  };

  return (
    <View style={{ flexDirection: isWide ? "row" : "column", gap: 12, alignItems: "flex-start" }}>
      <Panel title={editingId ? "Edit Employee" : "Create Employee"} style={{ flex: 1, width: isWide ? undefined : "100%" }}>
        <TextInput value={name} onChangeText={setName} placeholder="Employee name" placeholderTextColor={colors.muted} style={inputStyle} />
        <TextInput value={empCode} onChangeText={setEmpCode} placeholder="EMP Code" placeholderTextColor={colors.muted} style={inputStyle} />
        <TextInput value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={colors.muted} style={inputStyle} />
        <ChipRow label="Role" values={["staff", "admin"]} selected={role} onChange={(value) => setRole(value as "admin" | "staff")} />
        {role === "staff" ? <ChipRow label="Store" values={stores.map((store) => store.id)} display={(id) => stockSelectors.storeLabel(id)} selected={storeId} onChange={setStoreId} /> : null}
        {role === "staff" ? <MultiChipRow label="Department Checkbox" values={groups} selected={departments} onToggle={(value) => setDepartments(toggleValue(departments, value))} /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <ActionButton label={editingId ? "Update Employee" : "Create Employee"} tone="primary" onPress={save} />
          {editingId ? <ActionButton label="Cancel" onPress={reset} /> : null}
        </View>
      </Panel>
      <Panel title="Employees" style={{ flex: 1.3, width: isWide ? undefined : "100%" }}>
        {staffList.filter((person) => person.active !== false).map((person) => (
          <StaffRow key={person.id} staff={person} onEdit={() => edit(person)} onNotice={onNotice} />
        ))}
      </Panel>
    </View>
  );
}

function CountsApprovalTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { state, actions } = useStockStore();
  const [status, setStatus] = useState("all");
  const [exportText, setExportText] = useState("");
  const rows = state.globalCounts.filter((report) => status === "all" || report.status === status);

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Global Count Approval">
        <ChipRow label="Status" values={["all", "Submitted", "Approved", "Rejected"]} selected={status} onChange={setStatus} />
        <ActionButton label="Export Counts" onPress={() => setExportText(actions.exportCountsCsvText())} />
      </Panel>
      <Panel title={`${formatNumber(rows.length)} Count Reports`}>
        {rows.length ? rows.map((report) => (
          <CountRow
            key={report.id}
            report={report}
            actions={
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <ActionButton label="Approve" onPress={() => { actions.approveCount(report.id, "Approved"); onNotice("Report approved."); }} />
                <ActionButton label="Reject" tone="danger" onPress={() => { actions.approveCount(report.id, "Rejected"); onNotice("Report rejected."); }} />
              </View>
            }
          />
        )) : <EmptyState title="No reports" detail="Global count submissions appear here." />}
      </Panel>
      {exportText ? <ExportBox value={exportText} /> : null}
    </View>
  );
}

function AdminAuditTab() {
  const { actions } = useStockStore();
  const [group, setGroup] = useState("all");
  const [query, setQuery] = useState("");
  const [exportText, setExportText] = useState("");
  const groups = unique(stockSelectors.inventoryForStore("all").map((item) => item.group));
  const audits = getAudits().filter((audit) => {
    const haystack = [audit.article, audit.group, audit.staffName, audit.status, ...audit.items.flatMap((item) => [item.article, item.description, item.group])].join(" ").toLowerCase();
    return (group === "all" || audit.groups.includes(group) || audit.group === group) && (!query || haystack.includes(query.toLowerCase()));
  });

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Audit Register">
        <ChipRow label="Group" values={["all", ...groups]} selected={group} onChange={setGroup} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search audit" placeholderTextColor={colors.muted} style={inputStyle} />
        <ActionButton label="Export Audit" onPress={() => setExportText(actions.exportAuditCsvText())} />
      </Panel>
      <Panel title={`${formatNumber(audits.length)} Audit Reports`}>
        {audits.length ? audits.map((audit) => <AuditReportRow key={audit.id} audit={audit} />) : <EmptyState title="No audit reports" detail="Submitted employee audits appear here." />}
      </Panel>
      {exportText ? <ExportBox value={exportText} /> : null}
    </View>
  );
}

function AdminTransfersTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { state, actions } = useStockStore();
  const [status, setStatus] = useState("all");
  const rows = state.transfers.filter((transfer) => status === "all" || transfer.status === status);

  return (
    <View style={{ gap: 12 }}>
      <Panel title="InterStore Transfer Approval">
        <ChipRow label="Status" values={["all", "Submitted", "Approved", "Rejected"]} selected={status} onChange={setStatus} />
      </Panel>
      <Panel title={`${formatNumber(rows.length)} Transfer Requests`}>
        {rows.length ? rows.map((transfer) => (
          <TransferRow
            key={transfer.id}
            transfer={transfer}
            actions={transfer.status === "Submitted" ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <ActionButton label="Approve" onPress={() => run(onNotice, () => { actions.approveTransfer(transfer.id, "Approved"); onNotice("Transfer approved and stock moved."); })} />
                <ActionButton label="Reject" tone="danger" onPress={() => run(onNotice, () => { actions.approveTransfer(transfer.id, "Rejected"); onNotice("Transfer rejected."); })} />
              </View>
            ) : undefined}
          />
        )) : <EmptyState title="No transfer requests" detail="Employee transfer requests appear here." />}
      </Panel>
    </View>
  );
}

function AdminCustomerApprovalTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { state, actions } = useStockStore();
  const [status, setStatus] = useState("all");
  const rows = state.customerApprovals.filter((approval) => status === "all" || approval.status === status);

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Customer Approval">
        <ChipRow label="Status" values={["all", "Submitted", "Approved", "Rejected", "Returned", "Sold"]} selected={status} onChange={setStatus} />
      </Panel>
      <Panel title={`${formatNumber(rows.length)} Customer Approval Items`}>
        {rows.length ? rows.map((approval) => (
          <CustomerApprovalRow
            key={approval.id}
            approval={approval}
            actions={
              approval.status === "Submitted" ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <ActionButton label="Approve" onPress={() => run(onNotice, () => { actions.approveCustomerApproval(approval.id, "Approved"); onNotice("Customer approval approved and stock reduced."); })} />
                  <ActionButton label="Reject" tone="danger" onPress={() => run(onNotice, () => { actions.approveCustomerApproval(approval.id, "Rejected"); onNotice("Customer approval rejected."); })} />
                </View>
              ) : approval.status === "Approved" ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <ActionButton label="Returned" onPress={() => run(onNotice, () => { actions.settleCustomerApproval(approval.id, "Returned"); onNotice("Item returned and stock added back."); })} />
                  <ActionButton label="Sold" onPress={() => run(onNotice, () => { actions.settleCustomerApproval(approval.id, "Sold"); onNotice("Approval item marked sold."); })} />
                </View>
              ) : undefined
            }
          />
        )) : <EmptyState title="No customer approval items" detail="Customer approval requests appear here." />}
      </Panel>
    </View>
  );
}

function MessagesAdminTab({ onNotice, isWide }: { onNotice: (value: string) => void; isWide: boolean }) {
  const { state, actions } = useStockStore();
  const stores = stockSelectors.activeStores();
  const groups = unique(stockSelectors.inventoryForStore("all").map((item) => item.group));
  const [storeId, setStoreId] = useState("all");
  const [department, setDepartment] = useState("all");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const send = () => run(onNotice, () => {
    actions.sendMessage({ title, body, storeId, department });
    setTitle("");
    setBody("");
    onNotice("Instruction sent.");
  });

  return (
    <View style={{ flexDirection: isWide ? "row" : "column", gap: 12, alignItems: "flex-start" }}>
      <Panel title="Send Instruction" style={{ flex: 1, width: isWide ? undefined : "100%" }}>
        <ChipRow label="Store" values={["all", ...stores.map((store) => store.id)]} display={(id) => id === "all" ? "All Stores" : stockSelectors.storeLabel(id)} selected={storeId} onChange={setStoreId} />
        <ChipRow label="Department / Group" values={["all", ...groups]} selected={department} onChange={setDepartment} />
        <TextInput value={title} onChangeText={setTitle} placeholder="Message title" placeholderTextColor={colors.muted} style={inputStyle} />
        <TextInput value={body} onChangeText={setBody} placeholder="Instruction" placeholderTextColor={colors.muted} multiline numberOfLines={5} textAlignVertical="top" style={[inputStyle, { minHeight: 120 }]} />
        <ActionButton label="Send Instruction" tone="primary" onPress={send} />
      </Panel>
      <Panel title="Message List" style={{ flex: 1, width: isWide ? undefined : "100%" }}>
        {state.messages.length ? state.messages.map((message) => (
          <MessageRow key={message.id} message={message} onAction={() => { actions.deactivateMessage(message.id); onNotice("Message hidden."); }} actionLabel="Hide" />
        )) : <EmptyState title="No messages" detail="Employee instructions appear here." />}
      </Panel>
    </View>
  );
}

function BackupTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  const [exportText, setExportText] = useState("");
  const [cloudEmail, setCloudEmail] = useState(() => {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("stock-report-firebase-email") || "";
});
const [cloudPassword, setCloudPassword] = useState(() => {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("stock-report-firebase-password") || "";
});
const [cloudBusy, setCloudBusy] = useState<"save" | "restore" | "save-live" | "restore-live" | "">("");
const [autoLiveSync, setAutoLiveSync] = useState(false);
const [autoLiveRestore, setAutoLiveRestore] = useState(false);
const [lastSyncAt, setLastSyncAt] = useState("");
const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "error">("idle");

// Save credentials to localStorage whenever they change
useEffect(() => {
  if (typeof window === "undefined") return;
  localStorage.setItem("stock-report-firebase-email", cloudEmail);
  localStorage.setItem("stock-report-firebase-password", cloudPassword);
}, [cloudEmail, cloudPassword]);

// Auto live sync
useEffect(() => {
  if (!autoLiveSync) return;
  if (!cloudEmail || !cloudPassword) return;

  const timer = setInterval(async () => {
    try {
      await actions.saveCloudLive({ email: cloudEmail, password: cloudPassword });
      console.log("Auto live sync completed");
      setLastSyncAt(new Date().toISOString());
    } catch (error) {
      console.error("Auto live sync failed", error);
    }
  }, 30000); // every 30 seconds

  return () => clearInterval(timer);
}, [autoLiveSync, cloudEmail, cloudPassword]);

// Auto live restore
useEffect(() => {
  if (!autoLiveRestore) return;
  if (!cloudEmail || !cloudPassword) return;

  const timer = setInterval(async () => {
    try {
      await actions.restoreCloudLive({ email: cloudEmail, password: cloudPassword });
      console.log("Auto live restore completed");
      setLastSyncAt(new Date().toISOString());
    } catch (error) {
      console.error("Auto live restore failed", error);
    }
  }, 60000); // every 60 seconds, adjust as needed

  return () => clearInterval(timer);
}, [autoLiveRestore, cloudEmail, cloudPassword]);
  const firebaseReady = actions.firebaseBackupReady();
  const backups = stockSelectors.exportBackups();

  const restorePicked = async () => {
    const picked = await pickTextFile(["application/json", "text/*", "*/*"]);
    if (picked) run(onNotice, () => {
      actions.restoreBackupJson(picked.text);
      onNotice("Backup restored.");
    });
  };

  const saveToCloud = async () => {
    if (cloudBusy) return;
    setCloudBusy("save");

    try {
      const at = await actions.saveCloudBackup({ email: cloudEmail, password: cloudPassword });
      onNotice(`Firebase backup saved: ${dateLabel(at)}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Firebase backup failed.");
    } finally {
      setCloudBusy("");
    }
  };

  const restoreFromCloud = async () => {
    if (cloudBusy) return;
    setCloudBusy("restore");

    try {
      const at = await actions.restoreCloudBackup({ email: cloudEmail, password: cloudPassword });
      onNotice(`Firebase backup restored: ${dateLabel(at)}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Firebase restore failed.");
    } finally {
      setCloudBusy("");
    }
  };

  const saveLiveToCloud = async () => {
    if (cloudBusy) return;
    setCloudBusy("save-live");

    try {
      const at = await actions.saveCloudLive({ email: cloudEmail, password: cloudPassword });
      onNotice(`Live data saved: ${dateLabel(at)}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Live save failed.");
    } finally {
      setCloudBusy("");
    }
  };

  const restoreLiveFromCloud = async () => {
    if (cloudBusy) return;
    setCloudBusy("restore-live");

    try {
      const at = await actions.restoreCloudLive({ email: cloudEmail, password: cloudPassword });
      onNotice(`Live data restored: ${dateLabel(at)}.`);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Live restore failed.");
    } finally {
      setCloudBusy("");
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Backup">
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <ActionButton label="Export Backup" tone="primary" onPress={() => setExportText(actions.exportBackupJson())} />
          <ActionButton label="Restore Backup" onPress={restorePicked} />
        </View>
      </Panel>

      <Panel title="Firebase Cloud Backup">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Badge label={firebaseReady ? "Configured" : "Not Configured"} tone={firebaseReady ? "good" : "warn"} />
          <Text selectable style={rowSub}>{firebaseReady ? "Cloud backup is ready." : "Add Firebase values in .env first."}</Text>
        </View>

        <TextInput value={cloudEmail} onChangeText={setCloudEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Firebase email" placeholderTextColor={colors.muted} style={inputStyle} />
        <TextInput value={cloudPassword} onChangeText={setCloudPassword} secureTextEntry placeholder="Firebase password" placeholderTextColor={colors.muted} style={inputStyle} />

        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <ActionButton label={cloudBusy === "save" ? "Saving..." : "Save Backup"} tone="primary" onPress={saveToCloud} />
          <ActionButton label={cloudBusy === "restore" ? "Restoring..." : "Restore Backup"} onPress={restoreFromCloud} />
          <ActionButton label={cloudBusy === "save-live" ? "Saving..." : "Save Live Data"} tone="primary" onPress={saveLiveToCloud} />
          <ActionButton label={cloudBusy === "restore-live" ? "Restoring..." : "Restore Live Data"} onPress={restoreLiveFromCloud} />
<ActionButton
  label={autoLiveSync ? "Auto Live Sync: ON" : "Auto Live Sync: OFF"}
  onPress={() => setAutoLiveSync(!autoLiveSync)}
/>

<ActionButton
  label={autoLiveRestore ? "Auto Restore Live: ON" : "Auto Restore Live: OFF"}
  onPress={() => setAutoLiveRestore(!autoLiveRestore)}
/>
        </View>
      </Panel>

      <Panel title="Saved Backup List">
        {backups.length ? backups.map((backup, index) => (
          <View key={`${backup.at}-${index}`} style={rowStyle}>
            <View style={{ flex: 1 }}>
              <Text selectable style={rowTitle}>{dateLabel(backup.at)}</Text>
              <Text selectable style={rowSub}>{backup.source || "app"}</Text>
            </View>
            <Badge label="Saved" tone="good" />
          </View>
        )) : <EmptyState title="No backup saved" detail="Use Export Backup to keep a file copy outside browser storage." />}
      </Panel>

      {exportText ? <ExportBox value={exportText} /> : null}
    </View>
  );
}

function EmployeeStockTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [year, setYear] = useState("all");
  const groups = unique(stockSelectors.currentInventory().map((item) => item.group));
  const years = unique(stockSelectors.currentInventory().map((item) => item.year));
  const items = stockSelectors.visibleInventoryForEmployee(search, group, year).slice(0, 120);
  const suggestions = search.trim()
    ? unique(stockSelectors.currentInventory()
      .filter((item) => item.article.toLowerCase().includes(search.trim().toLowerCase()))
      .map((item) => item.article))
      .slice(0, 10)
    : [];
  const savePhoto = async (article: string) => {
    try {
      const dataUrl = await pickArticlePhoto();
      if (!dataUrl) return;
      run(onNotice, () => {
        actions.saveArticlePhoto(article, dataUrl);
        onNotice(`Photo saved for ${article}.`);
      });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Photo upload failed.");
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Stock">
        <ArticleInput storeId={stockSelectors.getCurrentStoreId()} value={search} onChange={setSearch} suggestions={suggestions} placeholder="Search / scan article no, description, colour" onNotice={onNotice} />
        <ChipRow label="Group" values={["all", ...groups]} selected={group} onChange={setGroup} />
        <ChipRow label="Year Filter" values={["all", ...years]} selected={year} onChange={setYear} />
      </Panel>
      <Panel title={`${formatNumber(items.length)} Stock Rows`}>
        {items.length ? items.map((item) => (
          <InventoryRow
            key={`${item.storeId}-${item.article}-${item.size}`}
            item={item}
            photo={stockSelectors.articlePhoto(item.article)}
            onPhoto={() => savePhoto(item.article)}
            onRemovePhoto={() => {
              actions.removeArticlePhoto(item.article);
              onNotice(`Photo removed for ${item.article}.`);
            }}
          />
        )) : <EmptyState title="No stock found" detail="Upload ledger or clear filters." />}
      </Panel>
    </View>
  );
}

function EmployeeLedgerTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  const user = stockSelectors.currentUser();
  const storeId = stockSelectors.getCurrentStoreId();
  const [ledgerName, setLedgerName] = useState("Employee ledger");
  const [ledgerText, setLedgerText] = useState("");
  const canUpload = stockSelectors.hasRight("canUploadLedger", user);

  const importText = (text = ledgerText, name = ledgerName) => run(onNotice, () => {
    const count = actions.importLedgerText(storeId, text, name);
    setLedgerText("");
    onNotice(`${formatNumber(count)} stock rows imported.`);
  });

  const pickLedger = async () => {
    try {
      const picked = await pickTextFile(["text/*", "text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "*/*"]);
      if (picked) {
        setLedgerName(picked.name);
        run(onNotice, () => {
          const count = importLedgerFile(actions, storeId, picked);
          setLedgerText("");
          onNotice(`${formatNumber(count)} stock rows imported.`);
        });
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Ledger file could not be opened.");
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Upload Ledger">
        {canUpload ? (
          <>
            <TextInput value={ledgerName} onChangeText={setLedgerName} placeholder="Ledger name" placeholderTextColor={colors.muted} style={inputStyle} />
            <TextInput value={ledgerText} onChangeText={setLedgerText} placeholder="Paste stock ledger CSV / TSV exported from Excel" placeholderTextColor={colors.muted} multiline numberOfLines={7} textAlignVertical="top" style={[inputStyle, { minHeight: 150 }]} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <ActionButton label="Attach Excel / CSV" onPress={pickLedger} />
              <ActionButton label="Import Ledger" tone="primary" onPress={() => importText()} />
              <ActionButton label="Load Demo" onPress={() => { actions.loadDemoLedger(); onNotice("Demo ledger loaded."); }} />
            </View>
          </>
        ) : <EmptyState title="Ledger upload locked" detail="Admin must enable ledger upload rights." />}
      </Panel>
    </View>
  );
}

function EmployeeTransferTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { state, actions } = useStockStore();
  const stores = stockSelectors.activeStores();
  const allowedStores = stockSelectors.employeeStoreIds();
  const fromStores = stores.filter((store) => allowedStores.includes(store.id));
  const [fromStoreId, setFromStoreId] = useState(stockSelectors.getCurrentStoreId());
  const [toStoreId, setToStoreId] = useState(stores.find((store) => store.id !== fromStoreId)?.id || "");
  const [article, setArticle] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const suggestions = articleSuggestions(fromStoreId, article);
  const selectedItem = findArticleItem(fromStoreId, article);
  const rows = state.transfers.filter((transfer) => transfer.requestedById === stockSelectors.currentUser()?.id || transfer.fromStoreId === fromStoreId || transfer.toStoreId === fromStoreId);

  const submit = () => run(onNotice, () => {
    const transfer = actions.requestInterStoreTransfer({ fromStoreId, toStoreId, article, qty: Number(qty), note });
    setArticle("");
    setQty("");
    setNote("");
    onNotice(`Transfer submitted for admin approval: ${transfer.article}.`);
  });

  return (
    <View style={{ gap: 12 }}>
      <Panel title="InterStore Transfer">
        <ChipRow label="From Store Code" values={fromStores.map((store) => store.id)} display={(id) => `${id} | ${stockSelectors.storeLabel(id)}`} selected={fromStoreId} onChange={setFromStoreId} />
        <ChipRow label="To Store Code" values={stores.filter((store) => store.id !== fromStoreId).map((store) => store.id)} display={(id) => `${id} | ${stockSelectors.storeLabel(id)}`} selected={toStoreId} onChange={setToStoreId} />
        <ArticleInput storeId={fromStoreId} value={article} onChange={setArticle} suggestions={suggestions} placeholder="Scan / type article no" onNotice={onNotice} />
        {selectedItem ? <ProductDetailBox item={selectedItem} /> : null}
        <TextInput value={qty} onChangeText={setQty} placeholder="Transfer qty" placeholderTextColor={colors.muted} keyboardType="numeric" style={inputStyle} />
        <TextInput value={note} onChangeText={setNote} placeholder="Note" placeholderTextColor={colors.muted} style={inputStyle} />
        <ActionButton label="Submit Transfer" tone="primary" onPress={submit} />
      </Panel>
      <Panel title="Transfer Register">
        {rows.length ? rows.map((transfer) => <TransferRow key={transfer.id} transfer={transfer} />) : <EmptyState title="No transfer requests" detail="Submitted transfers appear here." />}
      </Panel>
    </View>
  );
}

function EmployeeCustomerApprovalTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { state, actions } = useStockStore();
  const storeId = stockSelectors.getCurrentStoreId();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [article, setArticle] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const suggestions = articleSuggestions(storeId, article);
  const selectedItem = findArticleItem(storeId, article);
  const rows = state.customerApprovals.filter((approval) => approval.requestedById === stockSelectors.currentUser()?.id || approval.storeId === storeId);

  const submit = () => run(onNotice, () => {
    const approval = actions.requestCustomerApproval({ storeId, customerName, customerPhone, article, qty: Number(qty), note });
    setCustomerName("");
    setCustomerPhone("");
    setArticle("");
    setQty("");
    setNote("");
    onNotice(`Customer approval submitted for admin approval: ${approval.article}.`);
  });

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Customer Approval">
        <ArticleInput storeId={storeId} value={article} onChange={setArticle} suggestions={suggestions} placeholder="Scan / type article no" onNotice={onNotice} />
        {selectedItem ? <ProductDetailBox item={selectedItem} /> : null}
        <TextInput value={customerName} onChangeText={setCustomerName} placeholder="Customer name" placeholderTextColor={colors.muted} style={inputStyle} />
        <TextInput value={customerPhone} onChangeText={setCustomerPhone} placeholder="Mobile no" placeholderTextColor={colors.muted} keyboardType="phone-pad" style={inputStyle} />
        <TextInput value={qty} onChangeText={setQty} placeholder="Qty under approval" placeholderTextColor={colors.muted} keyboardType="numeric" style={inputStyle} />
        <TextInput value={note} onChangeText={setNote} placeholder="Other details" placeholderTextColor={colors.muted} style={inputStyle} />
        <ActionButton label="Submit Customer Approval" tone="primary" onPress={submit} />
      </Panel>
      <Panel title="Approval Register">
        {rows.length ? rows.map((approval) => <CustomerApprovalRow key={approval.id} approval={approval} />) : <EmptyState title="No customer approval items" detail="Items given under approval appear here." />}
      </Panel>
    </View>
  );
}

function EmployeeAuditTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  const user = stockSelectors.currentUser();
  const [article, setArticle] = useState("");
  const [qty, setQty] = useState("");
  const [fullStore, setFullStore] = useState(false);
  const [scanText, setScanText] = useState("");
  const canFull = stockSelectors.hasRight("canFullStoreAudit", user);
  const audits = getAudits().filter((audit) => audit.staffName === user?.name || audit.storeId === stockSelectors.getCurrentStoreId()).slice(0, 40);
  const suggestions = articleSuggestions(stockSelectors.getCurrentStoreId(), article);
  const selectedItem = findArticleItem(stockSelectors.getCurrentStoreId(), article);

  const submitManual = () => run(onNotice, () => {
    const report = actions.submitAudit([{ article, qty: Number(qty) }], fullStore && canFull);
    setArticle("");
    setQty("");
    onNotice(`Audit submitted: ${signed(report.variance)} variance.`);
  });

  const submitScanText = () => run(onNotice, () => {
    const entries = scanEntriesFromText(scanText);
    const report = actions.submitAudit(entries, fullStore && canFull);
    setScanText("");
    onNotice(`Audit report submitted: ${formatNumber(report.items.length)} articles.`);
  });

  const pickScan = async () => {
    const picked = await pickTextFile(["text/*", "text/csv", "*/*"]);
    if (picked) run(onNotice, () => {
      const report = actions.submitAudit(scanEntriesFromText(picked.text), fullStore && canFull);
      onNotice(`Audit report submitted: ${formatNumber(report.items.length)} articles.`);
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Audit Scan">
        <ArticleInput storeId={stockSelectors.getCurrentStoreId()} value={article} onChange={setArticle} suggestions={suggestions} placeholder="Scan / type article no" onNotice={onNotice} />
        {selectedItem ? <ProductDetailBox item={selectedItem} /> : null}
        <TextInput value={qty} onChangeText={setQty} placeholder="Manual qty" placeholderTextColor={colors.muted} keyboardType="numeric" style={inputStyle} />
        {canFull ? <Chip label="Full Store Audit" active={fullStore} onPress={() => setFullStore(!fullStore)} /> : null}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <ActionButton label="Submit Audit Report" tone="primary" onPress={submitManual} />
          <ActionButton label="Upload Scan CSV" onPress={pickScan} />
        </View>
        <TextInput value={scanText} onChangeText={setScanText} placeholder="Paste scan CSV: Scan Article, Counted Qty" placeholderTextColor={colors.muted} multiline numberOfLines={5} textAlignVertical="top" style={[inputStyle, { minHeight: 110 }]} />
        <ActionButton label="Submit Pasted Scan" onPress={submitScanText} />
      </Panel>
      <Panel title="Audit List">
        {audits.length ? audits.map((audit) => <AuditReportRow key={audit.id} audit={audit} />) : <EmptyState title="No counts saved" detail="Audit reports appear here." />}
      </Panel>
    </View>
  );
}

function EmployeeCountTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { state, actions } = useStockStore();
  const user = stockSelectors.currentUser();
  const allowedGroups = stockSelectors.staffDepartments(user);
  const canAll = stockSelectors.isAdmin(user) || allowedGroups.includes("ALL");
  const stockGroups = unique(stockSelectors.currentInventory().map((item) => item.group));
  const groups = canAll ? stockGroups : unique([...allowedGroups, ...stockGroups.filter((item) => allowedGroups.includes(item))]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [group, setGroup] = useState(groups[0] || "");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const selectedGroup = groups.includes(group) ? group : groups[0] || "";
  const reports = state.globalCounts.filter((report) => report.staffId === user?.id || (report.storeId === stockSelectors.getCurrentStoreId() && (canAll || allowedGroups.includes(report.group))));

  const submit = () => run(onNotice, () => {
    const report = actions.submitGlobalCount(date, selectedGroup, Number(qty), note);
    setQty("");
    setNote("");
    onNotice(`Global count submitted: ${signed(report.variance)} variance.`);
  });

  return (
    <View style={{ gap: 12 }}>
      <Panel title="Global Count">
        {groups.length ? (
          <>
            <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={inputStyle} />
            <ChipRow label="Your Department / Group" values={groups} selected={selectedGroup} onChange={setGroup} />
            <TextInput value={qty} onChangeText={setQty} placeholder="Manual physical qty" placeholderTextColor={colors.muted} keyboardType="numeric" style={inputStyle} />
            <TextInput value={note} onChangeText={setNote} placeholder="Note" placeholderTextColor={colors.muted} style={inputStyle} />
            <ActionButton label="Submit To Admin" tone="primary" onPress={submit} />
          </>
        ) : <EmptyState title="No department group allotted" detail="Admin must allot department groups to this employee." />}
      </Panel>
      <Panel title="Count Reports">
        {reports.length ? reports.map((report) => <CountRow key={report.id} report={report} />) : <EmptyState title="No count report" detail="Submit department-wise physical count." />}
      </Panel>
    </View>
  );
}

function InstructionsTab() {
  const { actions } = useStockStore();
  const user = stockSelectors.currentUser();
  const messages = stockSelectors.relevantMessages(user);

  return (
    <Panel title="Instructions">
      {messages.length ? messages.map((message) => (
        <MessageRow key={message.id} message={message} onAction={() => actions.markMessageRead(message.id)} actionLabel={(message.readBy || []).includes(user?.id || "") ? "Read" : "Mark Read"} />
      )) : <EmptyState title="No messages" detail="Admin instructions appear here." />}
    </Panel>
  );
}

function PasswordTab({ onNotice }: { onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const submit = () => run(onNotice, () => {
    actions.changePassword(oldPassword, newPassword);
    setOldPassword("");
    setNewPassword("");
    onNotice("Password updated.");
  });

  return (
    <Panel title="Change Password">
      <TextInput value={oldPassword} onChangeText={setOldPassword} placeholder="Current password" placeholderTextColor={colors.muted} secureTextEntry style={inputStyle} />
      <TextInput value={newPassword} onChangeText={setNewPassword} placeholder="New password" placeholderTextColor={colors.muted} secureTextEntry style={inputStyle} />
      <ActionButton label="Update Password" tone="primary" onPress={submit} />
    </Panel>
  );
}

function LedgerMappingPanel() {
  const rows = [
    ["D", "Article No"],
    ["F", "Description"],
    ["I", "Colour"],
    ["T", "Year"],
    ["U", "Group"],
    ["V", "Size"],
    ["AG", "Closing Stock"],
    ["AJ", "MRP"]
  ];

  return (
    <Panel title="Ledger Columns">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {rows.map(([letter, label]) => (
          <View key={letter} style={{ width: 150, borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 10, gap: 4 }}>
            <Text selectable style={{ color: colors.ink, fontWeight: "800" }}>{letter}</Text>
            <Text selectable style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
          </View>
        ))}
      </View>
    </Panel>
  );
}

function StaffRow({ staff, onEdit, onNotice }: { staff: Staff; onEdit: () => void; onNotice: (value: string) => void }) {
  const { actions } = useStockStore();
  return (
    <View style={[rowStyle, { alignItems: "stretch", flexDirection: "column" }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text selectable style={rowTitle}>{staff.name}</Text>
          <Text selectable style={rowSub}>EMP {staff.empCode} | {staff.role} | {stockSelectors.storeLabel(staff.storeId)} | {staff.departments.join(", ")}</Text>
        </View>
        <Badge label={staff.approved === false ? "Pending" : "Approved"} tone={staff.approved === false ? "warn" : "good"} />
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <ActionButton label="Edit" onPress={onEdit} />
        <ActionButton label={staff.approved === false ? "Approve" : "Pending"} onPress={() => actions.updateStaffApproval(staff.id, staff.approved === false)} />
        {staff.id !== "admin" ? <ActionButton label="Delete" tone="danger" onPress={() => confirm("Delete employee?", () => { actions.deleteStaff(staff.id); onNotice("Employee deleted."); })} /> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {rightLabels.map((right) => (
          <Chip
            key={`${staff.id}-${right.key}`}
            label={right.label}
            active={!!staff.rights?.[right.key]}
            onPress={() => actions.updateStaffRight(staff.id, right.key, !staff.rights?.[right.key])}
          />
        ))}
      </View>
    </View>
  );
}

function StoreRow({ store }: { store: Store }) {
  const inventory = stockSelectors.inventoryForStore(store.id);
  const ledger = stockSelectors.currentLedger(store.id);
  const staff = getStaffList().filter((person) => stockSelectors.staffStoreIds(person).includes(store.id));
  return (
    <View style={rowStyle}>
      <View style={{ flex: 1 }}>
        <Text selectable style={rowTitle}>{store.name}</Text>
        <Text selectable style={rowSub}>{store.place || "No place"} | {formatNumber(inventory.length)} rows | {formatNumber(staff.length)} staff | {ledger.name}</Text>
        {store.details ? <Text selectable style={rowSub}>{store.details}</Text> : null}
      </View>
      <Badge label={store.active ? "Active" : "Inactive"} tone={store.active ? "good" : "warn"} />
    </View>
  );
}

function InventoryRow({
  item,
  photo,
  onPhoto,
  onRemovePhoto
}: {
  item: InventoryItem;
  photo?: string;
  onPhoto?: () => void;
  onRemovePhoto?: () => void;
}) {
  return (
    <View style={rowStyle}>
      <View style={{ width: 74, height: 74, borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: "#fafaf8", overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
        {photo ? (
          <Image source={{ uri: photo }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <Text selectable numberOfLines={2} style={{ color: colors.muted, fontSize: 11, fontWeight: "800", textAlign: "center", padding: 6 }}>
            {item.baseArticle || item.article}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text selectable style={rowTitle}>{item.article}</Text>
        <Text selectable style={rowSub}>{item.description}</Text>
        <Text selectable style={rowSub}>
          {[`Style ${item.baseArticle || item.article}`, item.shadeCode ? `Shade ${item.shadeCode}` : "", item.group, item.year, item.colour, `Size ${item.size || item.articleSize}`].filter(Boolean).join(" | ")}
        </Text>
        <Text selectable style={rowSub}>Search Code: {searchCode(item)}</Text>
      </View>
      <View style={{ alignItems: "flex-end", minWidth: 102, gap: 6 }}>
        <Text selectable style={{ color: item.closingStock <= 1 ? colors.warn : colors.good, fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{formatNumber(item.closingStock)}</Text>
        <Text selectable style={rowSub}>Rs {formatNumber(item.mrp)}</Text>
        {onPhoto ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
            <SmallButton label={photo ? "Change" : "Camera"} onPress={onPhoto} />
            {photo && onRemovePhoto ? <SmallButton label="Remove" tone="danger" onPress={onRemovePhoto} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ProductDetailBox({ item }: { item: InventoryItem }) {
  return (
    <View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: "#fafaf8", padding: 10, gap: 6 }}>
      <Text selectable style={rowTitle}>{item.article}</Text>
      <Text selectable style={rowSub}>{item.description || "No description"}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        <Badge label={`Style ${item.baseArticle || item.article}`} tone="ink" />
        {item.shadeCode ? <Badge label={`Shade ${item.shadeCode}`} tone="accent" /> : null}
        <Badge label={`Size ${item.size || item.articleSize || "N.A."}`} tone="ink" />
        <Badge label={item.colour || "N.A."} tone="ink" />
        <Badge label={item.group || "N.A."} tone="ink" />
        {item.year ? <Badge label={item.year} tone="ink" /> : null}
        <Badge label={`Stock ${formatNumber(item.closingStock)}`} tone="good" />
        <Badge label={`MRP ${formatNumber(item.mrp)}`} tone="ink" />
      </View>
      <Text selectable style={rowSub}>Search Code: {searchCode(item)}</Text>
    </View>
  );
}

function SummaryRow({ summary }: { summary: GroupSummary }) {
  return (
    <View style={rowStyle}>
      <View style={{ flex: 1 }}>
        <Text selectable style={rowTitle}>{summary.group}</Text>
        <Text selectable style={rowSub}>{summary.storeName} | {formatNumber(summary.articles)} articles | {formatNumber(summary.shades)} shades | {formatNumber(summary.sizes)} sizes</Text>
      </View>
      <Badge label={formatNumber(summary.qty)} tone="good" />
    </View>
  );
}

function CountRow({ report, actions }: { report: GlobalCountReport; actions?: ReactNode }) {
  return (
    <View style={[rowStyle, { alignItems: "stretch", flexDirection: "column" }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text selectable style={rowTitle}>{report.group}</Text>
          <Text selectable style={rowSub}>{report.date} | {report.storeName} | {report.staffName}</Text>
        </View>
        <Badge label={report.status} tone={report.status === "Approved" ? "good" : report.status === "Rejected" ? "bad" : "warn"} />
      </View>
      <VarianceLine ledger={report.ledgerQty} counted={report.countedQty} variance={report.variance} />
      {report.note ? <Text selectable style={rowSub}>{report.note}</Text> : null}
      {actions}
    </View>
  );
}

function AuditReportRow({ audit }: { audit: AuditReport }) {
  return (
    <View style={[rowStyle, { flexDirection: "column", alignItems: "stretch" }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text selectable style={rowTitle}>{audit.article}</Text>
          <Text selectable style={rowSub}>{audit.storeName} | {audit.staffName} | {audit.scope} | {dateLabel(audit.submittedAt)}</Text>
        </View>
        <Badge label={audit.status} tone={audit.status === "match" ? "good" : audit.status === "short" ? "bad" : "warn"} />
      </View>
      <VarianceLine ledger={audit.ledgerQty} counted={audit.countedQty} variance={audit.variance} />
      {audit.items.slice(0, 4).map((item) => (
        <Text key={item.id} selectable style={rowSub}>{item.article} | {item.group} | Ledger {formatNumber(item.ledgerQty)} | Counted {formatNumber(item.countedQty)} | Diff {signed(item.variance)}</Text>
      ))}
      {audit.items.length > 4 ? <Text selectable style={rowSub}>+{formatNumber(audit.items.length - 4)} more lines</Text> : null}
    </View>
  );
}

function MessageRow({ message, onAction, actionLabel }: { message: EmployeeMessage; onAction: () => void; actionLabel: string }) {
  const user = stockSelectors.currentUser();
  const read = (message.readBy || []).includes(user?.id || "");
  return (
    <View style={[rowStyle, { flexDirection: "column", alignItems: "stretch" }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text selectable style={rowTitle}>{message.title}</Text>
          <Text selectable style={rowSub}>{message.department === "all" ? "All departments" : message.department} | {dateLabel(message.createdAt)}</Text>
        </View>
        <Badge label={read ? "Read" : "New"} tone={read ? "good" : "warn"} />
      </View>
      <Text selectable style={{ color: colors.ink, fontSize: 14, lineHeight: 20 }}>{message.body}</Text>
      <ActionButton label={actionLabel} onPress={onAction} />
    </View>
  );
}

function TransferRow({ transfer, actions }: { transfer: InterStoreTransfer; actions?: ReactNode }) {
  return (
    <View style={[rowStyle, { flexDirection: "column", alignItems: "stretch" }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text selectable style={rowTitle}>{transfer.article}</Text>
          <Text selectable style={rowSub}>{transfer.description}</Text>
          <Text selectable style={rowSub}>
            From {transfer.fromStoreId} | To {transfer.toStoreId} | Qty {formatNumber(transfer.qty)} | {transfer.requestedByName}
          </Text>
        </View>
        <Badge label={transfer.status} tone={transfer.status === "Approved" ? "good" : transfer.status === "Rejected" ? "bad" : "warn"} />
      </View>
      {transfer.note ? <Text selectable style={rowSub}>{transfer.note}</Text> : null}
      {actions}
    </View>
  );
}

function CustomerApprovalRow({ approval, actions }: { approval: CustomerApproval; actions?: ReactNode }) {
  return (
    <View style={[rowStyle, { flexDirection: "column", alignItems: "stretch" }]}>
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Text selectable style={rowTitle}>{approval.customerName} | {approval.article}</Text>
          <Text selectable style={rowSub}>{approval.description}</Text>
          <Text selectable style={rowSub}>
            Store {approval.storeId} | Qty {formatNumber(approval.qty)} | {approval.customerPhone || "No phone"} | {approval.requestedByName}
          </Text>
          <Text selectable style={rowSub}>
            {[`Style ${approval.baseArticle || approval.article}`, approval.shadeCode ? `Shade ${approval.shadeCode}` : "", approval.group, approval.year, approval.colour, `Size ${approval.size || approval.articleSize}`, `MRP ${formatNumber(approval.mrp)}`].filter(Boolean).join(" | ")}
          </Text>
          <Text selectable style={rowSub}>Search Code: {searchCode(approval)}</Text>
        </View>
        <Badge label={approval.status} tone={approval.status === "Approved" || approval.status === "Returned" || approval.status === "Sold" ? "good" : approval.status === "Rejected" ? "bad" : "warn"} />
      </View>
      {approval.note ? <Text selectable style={rowSub}>{approval.note}</Text> : null}
      {actions}
    </View>
  );
}

function ArticleInput({
  storeId,
  value,
  onChange,
  suggestions,
  placeholder,
  onNotice
}: {
  storeId: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder: string;
  onNotice?: (value: string) => void;
}) {
  const [scannerOpen, setScannerOpen] = useState(false);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "stretch" }}>
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} autoCapitalize="characters" returnKeyType="done" style={[inputStyle, { flex: 1 }]} />
        <ActionButton label="Scan" onPress={() => setScannerOpen(true)} />
      </View>
      {value.trim() && suggestions.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {suggestions.map((article) => (
            <Chip key={`${storeId}-${article}`} label={article} active={value === article} onPress={() => onChange(article)} />
          ))}
        </View>
      ) : null}
      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onNotice={onNotice}
        onScanned={(code) => {
          onChange(code);
          setScannerOpen(false);
          if (onNotice) onNotice(`Scanned ${code}.`);
        }}
      />
    </View>
  );
}

function VarianceLine({ ledger, counted, variance }: { ledger: number; counted: number; variance: number }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Badge label={`Ledger ${formatNumber(ledger)}`} tone="ink" />
      <Badge label={`Physical ${formatNumber(counted)}`} tone="accent" />
      <Badge label={`Variance ${signed(variance)}`} tone={variance === 0 ? "good" : variance < 0 ? "bad" : "warn"} />
    </View>
  );
}

function BarcodeScannerModal({
  visible,
  onScanned,
  onClose,
  onNotice
}: {
  visible: boolean;
  onScanned: (code: string) => void;
  onClose: () => void;
  onNotice?: (value: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (visible) setLocked(false);
  }, [visible]);

  const handleScan = (result: BarcodeScanningResult) => {
    const code = clean(result.raw || result.data);
    if (!code || locked) return;
    setLocked(true);
    onScanned(code);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#0b0b0b" }}>
        {permission?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["code128", "code39", "code93", "ean13", "ean8", "upc_a", "upc_e", "qr"] }}
            onBarcodeScanned={locked ? undefined : handleScan}
            onMountError={() => {
              if (onNotice) onNotice("Camera could not start. Use scanner keyboard or type article no.");
              onClose();
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 22, gap: 12 }}>
            <Text selectable style={{ color: colors.surface, fontSize: 20, fontWeight: "800", textAlign: "center" }}>Camera Permission</Text>
            <Text selectable style={{ color: "#d8d8d2", fontSize: 14, lineHeight: 20, textAlign: "center" }}>
              Camera access is needed for barcode scanning.
            </Text>
            <ActionButton label="Allow Camera" tone="primary" onPress={() => requestPermission()} />
          </View>
        )}
        <View style={{ position: "absolute", left: 18, right: 18, bottom: 28, gap: 12 }}>
          <View style={{ borderWidth: 2, borderColor: colors.surface, borderRadius: 6, height: 130, opacity: 0.9 }} />
          <View style={{ flexDirection: "row", gap: 8, justifyContent: "center" }}>
            <ActionButton label="Close Scanner" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Panel({ title, children, style }: { title: string; children: ReactNode; style?: object }) {
  return (
    <View style={[panelStyle, style]}>
      <Text selectable style={{ color: colors.ink, fontSize: 17, fontWeight: "800" }}>{title}</Text>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

function TabBar<T extends string>({ tabs, active, onChange }: { tabs: { key: T; label: string }[]; active: T; onChange: (value: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {tabs.map((tab) => <TabButton key={tab.key} label={tab.label} active={active === tab.key} onPress={() => onChange(tab.key)} />)}
    </ScrollView>
  );
}

function ChipRow({ label, values, selected, onChange, display }: { label: string; values: string[]; selected: string; onChange: (value: string) => void; display?: (value: string) => string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 12, textTransform: "uppercase" }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {values.map((value) => <Chip key={`${label}-${value}`} label={display ? display(value) : labelValue(value)} active={selected === value} onPress={() => onChange(value)} />)}
      </ScrollView>
    </View>
  );
}

function MultiChipRow({ label, values, selected, onToggle }: { label: string; values: string[]; selected: string[]; onToggle: (value: string) => void }) {
  const allSelected = values.length > 0 && selected.includes("ALL");
  return (
    <View style={{ gap: 6 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 12, textTransform: "uppercase" }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {values.length ? <CheckboxPill label="All Groups" active={allSelected} onPress={() => onToggle("ALL")} /> : null}
        {values.map((value) => (
          <CheckboxPill
            key={`${label}-${value}`}
            label={value}
            active={allSelected || selected.includes(value)}
            onPress={() => onToggle(value)}
          />
        ))}
      </View>
    </View>
  );
}

function CheckboxPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      minHeight: 38,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: active ? colors.accent : colors.line,
      backgroundColor: active ? "#eaf1ff" : pressed ? colors.soft : colors.surface,
      alignItems: "center",
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 10
    })}>
      <View style={{
        width: 16,
        height: 16,
        borderRadius: 3,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.muted,
        backgroundColor: active ? colors.accent : colors.surface,
        alignItems: "center",
        justifyContent: "center"
      }}>
        {active ? <Text selectable style={{ color: colors.surface, fontSize: 11, fontWeight: "900" }}>✓</Text> : null}
      </View>
      <Text selectable style={{ color: active ? colors.accent : colors.ink, fontSize: 13, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      minHeight: 38,
      minWidth: 72,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: active ? colors.accent : colors.line,
      backgroundColor: active ? "#eaf1ff" : pressed ? colors.soft : colors.surface,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12
    })}>
      <Text selectable style={{ color: active ? colors.accent : colors.ink, fontSize: 13, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      minHeight: 42,
      minWidth: 92,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: active ? colors.ink : colors.line,
      backgroundColor: active ? colors.ink : pressed ? colors.soft : colors.surface,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12
    })}>
      <Text selectable style={{ color: active ? colors.surface : colors.ink, fontSize: 14, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({ label, onPress, tone = "default" }: { label: string; onPress: () => void; tone?: "default" | "primary" | "danger" }) {
  const bg = tone === "primary" ? colors.ink : tone === "danger" ? "#fff0f0" : colors.surface;
  const border = tone === "danger" ? "#efb3b3" : tone === "primary" ? colors.ink : colors.line;
  const text = tone === "primary" ? colors.surface : tone === "danger" ? colors.bad : colors.ink;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      minHeight: 42,
      borderWidth: 1,
      borderColor: border,
      borderRadius: 6,
      backgroundColor: pressed && tone !== "primary" ? colors.soft : bg,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 14
    })}>
      <Text selectable style={{ color: text, fontSize: 14, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}

function SmallButton({ label, onPress, tone = "default" }: { label: string; onPress: () => void; tone?: "default" | "danger" }) {
  const border = tone === "danger" ? "#efb3b3" : colors.line;
  const text = tone === "danger" ? colors.bad : colors.ink;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      minHeight: 30,
      borderWidth: 1,
      borderColor: border,
      borderRadius: 6,
      backgroundColor: pressed ? colors.soft : colors.surface,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 8
    })}>
      <Text selectable style={{ color: text, fontSize: 11, fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: "accent" | "good" | "warn" | "ink" }) {
  const color = tone === "accent" ? colors.accent : tone === "good" ? colors.good : tone === "warn" ? colors.warn : colors.ink;
  return (
    <View style={{ flexGrow: 1, flexBasis: 140, minHeight: 92, borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: colors.surface, padding: 12, gap: 8 }}>
      <Text selectable style={{ color: colors.muted, fontSize: 12, textTransform: "uppercase" }}>{label}</Text>
      <Text selectable style={{ color, fontSize: 23, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{value}</Text>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: "accent" | "good" | "warn" | "bad" | "ink" }) {
  const color = tone === "accent" ? colors.accent : tone === "good" ? colors.good : tone === "bad" ? colors.bad : tone === "warn" ? colors.warn : colors.ink;
  return (
    <View style={{ borderWidth: 1, borderColor: color, borderRadius: 6, paddingHorizontal: 8, minHeight: 28, alignItems: "center", justifyContent: "center" }}>
      <Text selectable style={{ color, fontSize: 12, fontWeight: "800" }}>{label}</Text>
    </View>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <View style={{ borderColor: colors.line, borderWidth: 1, backgroundColor: "#f1f8f5", borderRadius: 6, padding: 10 }}>
      <Text selectable style={{ color: text.toLowerCase().includes("required") || text.toLowerCase().includes("not") ? colors.bad : colors.good, fontSize: 13, fontWeight: "700" }}>{text}</Text>
    </View>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={{ minHeight: 84, borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: "#fafaf8", padding: 14, justifyContent: "center", gap: 4 }}>
      <Text selectable style={rowTitle}>{title}</Text>
      <Text selectable style={rowSub}>{detail}</Text>
    </View>
  );
}

function ExportBox({ value }: { value: string }) {
  return (
    <Panel title="Export">
      <TextInput value={value} onChangeText={() => undefined} editable={false} multiline numberOfLines={8} textAlignVertical="top" style={[inputStyle, { minHeight: 160, color: colors.ink }]} />
    </Panel>
  );
}

async function pickTextFile(types: string[]): Promise<PickedLedgerFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const webFile = asset.file as { text?: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> } | undefined;
  const shouldReadText = isTextLedgerFile(asset.name);

  if (webFile?.arrayBuffer) {
    return {
      name: asset.name,
      text: shouldReadText && webFile.text ? await webFile.text() : "",
      arrayBuffer: await webFile.arrayBuffer()
    };
  }

  const file = new File(asset.uri);
  const arrayBuffer = await file.arrayBuffer();
  const text = shouldReadText ? file.textSync() : "";
  return { name: asset.name, text, arrayBuffer };
}

async function pickBinaryFile(types: string[]): Promise<PickedBinaryFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const webFile = asset.file as { arrayBuffer?: () => Promise<ArrayBuffer>; type?: string } | undefined;

  if (webFile?.arrayBuffer) {
    return {
      name: asset.name,
      mimeType: asset.mimeType || webFile.type || mimeFromName(asset.name),
      arrayBuffer: await webFile.arrayBuffer()
    };
  }

  const file = new File(asset.uri);
  return {
    name: asset.name,
    mimeType: asset.mimeType || mimeFromName(asset.name),
    arrayBuffer: await file.arrayBuffer()
  };
}

async function pickArticlePhoto() {
  if (canUseWebPhotoInput()) return pickWebCameraPhoto();
  const picked = await pickBinaryFile(["image/*"]);
  return picked ? arrayBufferToDataUrl(picked.arrayBuffer, picked.mimeType) : null;
}

async function scanBarcodeWithCamera() {
  if (!canUseWebPhotoInput()) {
    throw new Error("Camera barcode scan needs the web preview camera. A USB/Bluetooth barcode scanner can type into this field.");
  }

  const detector = createBarcodeDetector();
  if (!detector) {
    throw new Error("This browser does not support camera barcode detection. Use a barcode scanner keyboard or type the article no.");
  }

  const file = await pickWebImageFile("image/*", true);
  if (!file) return null;
  const source = await imageSourceFromFile(file);
  const matches = await detector.detect(source);
  if ("close" in source && typeof source.close === "function") source.close();
  return clean(matches[0]?.rawValue);
}

function canUseWebPhotoInput() {
  return typeof document !== "undefined" && typeof window !== "undefined" && typeof FileReader !== "undefined";
}

function createBarcodeDetector() {
  if (typeof window === "undefined") return null;
  const BarcodeDetectorCtor = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!BarcodeDetectorCtor) return null;

  return new BarcodeDetectorCtor({
    formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code"]
  });
}

function pickWebCameraPhoto(): Promise<string | null> {
  return pickWebImageFile("image/*", true).then((file) => file ? resizeWebPhoto(file) : null);
}

function pickWebImageFile(accept: string, capture: boolean): Promise<globalThis.File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", "environment");
    input.style.display = "none";

    const cleanup = () => {
      input.remove();
    };

    input.addEventListener("cancel", () => {
      cleanup();
      resolve(null);
    });

    input.addEventListener("change", async () => {
      try {
        const file = input.files?.[0];
        cleanup();
        resolve(file || null);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    document.body.appendChild(input);
    input.click();
  });
}

function resizeWebPhoto(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Photo could not be opened."));
    reader.onload = () => {
      const rawDataUrl = String(reader.result || "");
      const image = new window.Image();
      image.onerror = () => resolve(rawDataUrl);
      image.onload = () => {
        const maxSide = 900;
        const scale = Math.min(1, maxSide / image.width, maxSide / image.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          resolve(rawDataUrl);
          return;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  });
}

async function imageSourceFromFile(file: globalThis.File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Barcode image could not be opened."));
    reader.onload = () => {
      const image = new window.Image();
      image.onerror = () => reject(new Error("Barcode image could not be opened."));
      image.onload = () => resolve(image);
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}

function importLedgerFile(actions: StockActions, storeId: string, picked: PickedLedgerFile) {
  const name = picked.name.toLowerCase();

  if (name.endsWith(".xlsx")) {
    throw new Error("Please save Excel as .xls or CSV before attaching. .xlsx cannot be read by this app yet.");
  }

  if (name.endsWith(".xls") || isOldExcelWorkbook(picked.arrayBuffer)) {
    return actions.importLedgerRows(storeId, parseXlsWorkbook(picked.arrayBuffer), picked.name);
  }

  return actions.importLedgerText(storeId, picked.text, picked.name);
}

function isOldExcelWorkbook(arrayBuffer: ArrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer, 0, Math.min(8, arrayBuffer.byteLength));
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return signature.every((byte, index) => bytes[index] === byte);
}

function isTextLedgerFile(name: string) {
  const lower = name.toLowerCase();
  return !lower.endsWith(".xls") && !lower.endsWith(".xlsx");
}

function arrayBufferToDataUrl(arrayBuffer: ArrayBuffer, mimeType: string) {
  return `data:${mimeType || "image/jpeg"};base64,${bytesToBase64(new Uint8Array(arrayBuffer))}`;
}

function bytesToBase64(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  let index = 0;

  for (; index + 2 < bytes.length; index += 3) {
    output += alphabet[bytes[index] >> 2];
    output += alphabet[((bytes[index] & 3) << 4) | (bytes[index + 1] >> 4)];
    output += alphabet[((bytes[index + 1] & 15) << 2) | (bytes[index + 2] >> 6)];
    output += alphabet[bytes[index + 2] & 63];
  }

  if (index < bytes.length) {
    output += alphabet[bytes[index] >> 2];
    if (index + 1 < bytes.length) {
      output += alphabet[((bytes[index] & 3) << 4) | (bytes[index + 1] >> 4)];
      output += alphabet[(bytes[index + 1] & 15) << 2];
      output += "=";
    } else {
      output += alphabet[(bytes[index] & 3) << 4];
      output += "==";
    }
  }

  return output;
}

function mimeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

function run(onNotice: (value: string) => void, action: () => void) {
  try {
    action();
  } catch (error) {
    onNotice(error instanceof Error ? error.message : "Action failed.");
  }
}

function confirm(title: string, action: () => void) {
  Alert.alert(title, "", [
    { text: "Cancel", style: "cancel" },
    { text: "OK", style: "destructive", onPress: action }
  ]);
}

function getStaffList(): Staff[] {
  return stockSelectors.currentState().staff;
}

function getAudits(): AuditReport[] {
  return stockSelectors.currentState().audits;
}

function toggleValue(values: string[], value: string) {
  if (value === "ALL") return values.includes("ALL") ? [] : ["ALL"];
  const baseValues = values.filter((item) => item !== "ALL");
  if (values.includes("ALL")) return [value];
  return baseValues.includes(value) ? baseValues.filter((item) => item !== value) : [...baseValues, value];
}

function articleSuggestions(storeId: string, query: string) {
  const needle = clean(query).toLowerCase();
  if (!needle) return [];
  return unique(stockSelectors.inventoryForStore(storeId)
    .filter((item) => articleMatches(item, query))
    .map((item) => item.article))
    .slice(0, 10);
}

function articleMatches(item: InventoryItem, query: string) {
  const needle = clean(query).toLowerCase();
  if (!needle) return true;
  return [
    item.article,
    item.baseArticle,
    item.shadeCode,
    item.articleSize,
    item.description,
    item.colour,
    item.year,
    item.group,
    item.size,
    searchCode(item)
  ].join(" ").toLowerCase().includes(needle);
}

function findArticleItem(storeId: string, query: string) {
  const needle = clean(query).toLowerCase();
  if (!needle) return null;
  const rows = stockSelectors.inventoryForStore(storeId);
  return rows.find((item) => item.article.toLowerCase() === needle)
    || rows.find((item) => item.baseArticle.toLowerCase() === needle)
    || rows.find((item) => articleMatches(item, query))
    || null;
}

function searchCode(item: Pick<InventoryItem, "article" | "baseArticle" | "shadeCode" | "articleSize" | "size">) {
  return [item.baseArticle || item.article, item.shadeCode, item.articleSize || item.size].filter(Boolean).join("-");
}

function unique(values: unknown[]) {
  return Array.from(new Set(values.map((value) => clean(value)).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

function labelValue(value: string) {
  if (value === "all") return "All";
  if (value === "qty") return "Qty";
  if (value === "articles") return "Articles";
  return value || "Blank";
}

function storeLabelShort(store: Store) {
  return [store.name, store.place].filter(Boolean).join(" - ");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
}

function signed(value: number) {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function dateLabel(value: string) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const panelStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 6,
  backgroundColor: colors.surface,
  padding: 14,
  gap: 12
};

const rowStyle = {
  minHeight: 72,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 6,
  backgroundColor: colors.surface,
  padding: 12,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 12
};

const rowTitle = {
  color: colors.ink,
  fontSize: 14,
  fontWeight: "800" as const
};

const rowSub = {
  color: colors.muted,
  fontSize: 12,
  lineHeight: 18
};

const inputStyle = {
  minHeight: 44,
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 6,
  backgroundColor: colors.surface,
  color: colors.ink,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 15
};
