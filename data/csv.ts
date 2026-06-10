import type { AuditReport, GlobalCountReport, GroupSummary, InventoryItem } from "@/data/types";

type ColumnKey = "article" | "description" | "colour" | "year" | "group" | "size" | "closingStock" | "mrp";

type LedgerColumn = {
  index: number;
  label: string;
  aliases: string[];
};

export const LEDGER_COLUMNS: Record<ColumnKey, LedgerColumn> = {
  article: { index: 3, label: "Article No", aliases: ["article", "articleno", "artcode", "sku", "barcode", "scanarticle"] },
  description: { index: 5, label: "Description", aliases: ["description", "itemdescription", "product"] },
  colour: { index: 8, label: "Colour", aliases: ["colour", "color", "colors", "shade"] },
  year: { index: 19, label: "Year", aliases: ["year", "artyr", "season"] },
  group: { index: 20, label: "Group", aliases: ["group1", "group", "department", "category"] },
  size: { index: 21, label: "Size", aliases: ["size"] },
  closingStock: { index: 32, label: "Closing Stock", aliases: ["closingstock", "closingstk", "closingstockqty", "stock", "qty", "quantity"] },
  mrp: { index: 33, label: "MRP", aliases: ["mrpperunit", "mrp", "price", "rate", "mrptotal"] }
};

export function parseDelimited(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => clean(value))) rows.push(row);
  return rows;
}

export function rowsToInventory(rows: string[][]): InventoryItem[] {
  const hasStockLedgerColumns = rows.some((row) => row.length > LEDGER_COLUMNS.mrp.index && clean(row[LEDGER_COLUMNS.article.index]));
  const headerRow = rows.find((row) => row.some((value) => LEDGER_COLUMNS.article.aliases.includes(headerValue(value))));
  const headerMap = !hasStockLedgerColumns && headerRow ? buildHeaderMap(headerRow) : {};

  const items = rows
    .filter((row) => row !== headerRow)
    .map((row) => rowToItem(row, headerMap))
    .filter((item): item is InventoryItem => Boolean(item));

  return normaliseItems(items);
}

export function parseXlsWorkbook(arrayBuffer: ArrayBuffer): string[][] {
  const bytes = new Uint8Array(arrayBuffer);
  const ole = parseOle(bytes);
  const stream = ole.stream("Workbook") || ole.stream("Book");
  if (!stream) throw new Error("Workbook stream not found");
  return parseBiffRows(stream);
}

export function normaliseItems(items: Partial<InventoryItem>[]): InventoryItem[] {
  const map = new Map<string, InventoryItem>();
  const now = new Date().toISOString();

  items.forEach((item) => {
    const article = clean(item.article);
    if (!article || isHeaderArticle(article)) return;

    const split = splitArticleNumber(article);
    const cleaned: InventoryItem = {
      id: item.id || makeId("item"),
      article,
      description: clean(item.description),
      colour: clean(item.colour),
      year: clean(item.year),
      group: clean(item.group),
      size: clean(item.size),
      closingStock: numeric(item.closingStock),
      mrp: numeric(item.mrp),
      baseArticle: clean(item.baseArticle) || split.baseArticle,
      shadeCode: clean(item.shadeCode) || split.shadeCode,
      articleSize: clean(item.articleSize) || split.articleSize,
      updatedAt: item.updatedAt || now
    };

    const key = [
      cleaned.article,
      cleaned.description,
      cleaned.colour,
      cleaned.year,
      cleaned.group,
      cleaned.size,
      cleaned.mrp
    ].join("|").toLowerCase();

    if (!map.has(key)) {
      map.set(key, cleaned);
      return;
    }

    const existing = map.get(key)!;
    existing.closingStock += cleaned.closingStock;
    existing.updatedAt = now;
  });

  return Array.from(map.values()).sort((a, b) =>
    a.article.localeCompare(b.article, undefined, { numeric: true, sensitivity: "base" })
  );
}

export function exportInventoryCsv(items: InventoryItem[]): string {
  const rows = [
    ["Article No", "Search Code", "Style No", "Shade", "Description", "Colour", "Year", "Group", "Size", "Closing Stock", "MRP"],
    ...items.map((item) => [
      item.article,
      [item.baseArticle || item.article, item.shadeCode, item.articleSize || item.size].filter(Boolean).join("-"),
      item.baseArticle,
      item.shadeCode,
      item.description,
      item.colour,
      item.year,
      item.group,
      item.size,
      item.closingStock,
      item.mrp
    ])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function exportAuditCsv(audits: AuditReport[]): string {
  const rows = [
    ["Store", "Report", "Scope", "Article", "Description", "Group", "Ledger Qty", "Counted Qty", "Variance", "Status", "Staff", "Department", "Counted At"],
    ...audits.flatMap((audit) => audit.items.map((item) => [
      audit.storeName,
      audit.article,
      audit.scope,
      item.article,
      item.description,
      item.group,
      item.ledgerQty,
      item.countedQty,
      item.variance,
      item.status || audit.status,
      audit.staffName || item.staffName,
      audit.staffDepartment || item.staffDepartment,
      audit.submittedAt || item.countedAt
    ]))
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function exportSummaryCsv(summaries: GroupSummary[]): string {
  const rows = [
    ["Store", "Group", "Qty", "Articles", "Shades", "Sizes"],
    ...summaries.map((summary) => [
      summary.storeName,
      summary.group,
      summary.qty,
      summary.articles,
      summary.shades,
      summary.sizes
    ])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function exportCountsCsv(reports: GlobalCountReport[]): string {
  const rows = [
    ["Store", "Date", "Group", "Ledger Qty", "Physical Qty", "Variance", "Staff", "Status", "Note"],
    ...reports.map((report) => [
      report.storeName,
      report.date,
      report.group,
      report.ledgerQty,
      report.countedQty,
      report.variance,
      report.staffName,
      report.status,
      report.note
    ])
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function rowsToScanEntries(rows: string[][]): { article: string; qty: number }[] {
  if (!rows.length) return [];
  const header = rows[0].map((cell) => clean(cell).toLowerCase().replace(/[^a-z0-9_]/g, ""));
  const articleAliases = ["scan", "scancode", "barcode", "article", "articleno", "articlecode", "artcode", "art_code", "sku"];
  const qtyAliases = ["scanqty", "countedqty", "countqty", "qty", "quantity", "count"];
  const articleIndex = header.findIndex((cell) => articleAliases.includes(cell));
  const qtyIndex = header.findIndex((cell) => qtyAliases.includes(cell));
  const entries: { article: string; qty: number }[] = [];

  rows.forEach((row, index) => {
    if (!row.length) return;
    if (index === 0 && articleIndex >= 0) return;
    const article = articleIndex >= 0 ? clean(row[articleIndex]) : firstScanCell(row);
    if (!article || /article|barcode|scan|total/i.test(article)) return;
    const qty = qtyIndex >= 0 ? Math.max(0, numeric(row[qtyIndex])) : 1;
    if (qty) entries.push({ article, qty });
  });

  return entries;
}

export function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function numeric(value: unknown): number {
  const parsed = Number(clean(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function rowToItem(row: string[], headerMap: Partial<Record<ColumnKey, number>>): InventoryItem | null {
  const read = (key: ColumnKey) => {
    const headerIndex = headerMap[key];
    const fixedIndex = LEDGER_COLUMNS[key].index;
    return row[typeof headerIndex === "number" ? headerIndex : fixedIndex] ?? "";
  };

  const article = clean(read("article"));
  if (!article || isHeaderArticle(article)) return null;
  if (isSummaryRow(row, article)) return null;

  const split = splitArticleNumber(article);
  const now = new Date().toISOString();

  return {
    id: makeId("item"),
    article,
    description: clean(read("description")),
    colour: clean(read("colour")),
    year: clean(read("year")),
    group: clean(read("group")),
    size: clean(read("size")),
    closingStock: numeric(read("closingStock")),
    mrp: numeric(read("mrp")),
    baseArticle: split.baseArticle,
    shadeCode: split.shadeCode,
    articleSize: split.articleSize,
    updatedAt: now
  };
}

function buildHeaderMap(row: string[]): Partial<Record<ColumnKey, number>> {
  const values = row.map(headerValue);
  return (Object.keys(LEDGER_COLUMNS) as ColumnKey[]).reduce<Partial<Record<ColumnKey, number>>>((map, key) => {
    const index = LEDGER_COLUMNS[key].aliases.reduce((found, alias) => {
      if (found >= 0) return found;
      return values.findIndex((value) => value === alias);
    }, -1);
    if (index >= 0) map[key] = index;
    return map;
  }, {});
}

function splitArticleNumber(article: string) {
  const parts = clean(article).split("-").map(clean).filter(Boolean);

  if (parts.length >= 3) {
    return {
      baseArticle: parts[0],
      shadeCode: parts[1],
      articleSize: parts.slice(2).join("-")
    };
  }

  return {
    baseArticle: parts[0] || article,
    shadeCode: parts[1] || "",
    articleSize: parts[2] || ""
  };
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => clean(line)) || "";
  const comma = (firstLine.match(/,/g) || []).length;
  const tab = (firstLine.match(/\t/g) || []).length;
  const semicolon = (firstLine.match(/;/g) || []).length;
  if (tab > comma && tab >= semicolon) return "\t";
  if (semicolon > comma) return ";";
  return ",";
}

function headerValue(value: unknown): string {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isHeaderArticle(value: unknown): boolean {
  return LEDGER_COLUMNS.article.aliases.includes(headerValue(value));
}

function isSummaryRow(row: string[], article: string): boolean {
  const values = [
    article,
    row[0],
    row[1],
    row[2],
    row[LEDGER_COLUMNS.group.index]
  ].map(clean);

  return values.some((value) => /^(group\s*)?total\b|^grand\s*total\b/i.test(value));
}

export function csvCell(value: unknown): string {
  const text = clean(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function firstScanCell(row: string[]): string {
  return clean(row.find((cell) => {
    const value = clean(cell);
    return value && !/article|barcode|scan|total|qty|quantity/i.test(value);
  }));
}

function parseOle(bytes: Uint8Array) {
  const view = dataView(bytes);
  const signature = "d0cf11e0a1b11ae1";
  const actual = Array.from(bytes.slice(0, 8)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== signature) throw new Error("Selected file is not an old Excel .xls workbook");

  const sectorSize = 1 << view.getUint16(30, true);
  const miniSectorSize = 1 << view.getUint16(32, true);
  const firstDirSector = readSid(view, 48);
  const miniCutoff = view.getUint32(56, true);
  const firstMiniFatSector = readSid(view, 60);
  const numMiniFatSectors = view.getUint32(64, true);
  const firstDifatSector = readSid(view, 68);
  const numDifatSectors = view.getUint32(72, true);
  const difat: number[] = [];

  for (let i = 0; i < 109; i += 1) {
    const sid = readSid(view, 76 + i * 4);
    if (sid >= 0) difat.push(sid);
  }

  let nextDifat = firstDifatSector;
  for (let d = 0; d < numDifatSectors && nextDifat >= 0; d += 1) {
    const offset = sectorOffset(nextDifat, sectorSize);
    for (let i = 0; i < sectorSize / 4 - 1; i += 1) {
      const sid = readSid(view, offset + i * 4);
      if (sid >= 0) difat.push(sid);
    }
    nextDifat = readSid(view, offset + sectorSize - 4);
  }

  const fat: number[] = [];
  difat.forEach((sid) => {
    const offset = sectorOffset(sid, sectorSize);
    for (let i = 0; i < sectorSize / 4; i += 1) fat.push(readSid(view, offset + i * 4));
  });

  const chain = (startSid: number) => {
    const chunks: Uint8Array[] = [];
    let sid = startSid;
    let guard = 0;
    while (sid >= 0 && guard < fat.length + 4) {
      const offset = sectorOffset(sid, sectorSize);
      chunks.push(bytes.slice(offset, offset + sectorSize));
      sid = fat[sid];
      guard += 1;
    }
    return concatBytes(chunks);
  };

  const dirStream = chain(firstDirSector);
  const dirs: { name: string; type: number; startSid: number; size: number }[] = [];
  for (let offset = 0; offset + 128 <= dirStream.length; offset += 128) {
    const entry = dirStream.slice(offset, offset + 128);
    const entryView = dataView(entry);
    const nameLength = entryView.getUint16(64, true);
    if (!nameLength) continue;
    dirs.push({
      name: decodeUtf16(entry.slice(0, Math.max(0, nameLength - 2))),
      type: entry[66],
      startSid: readSid(entryView, 116),
      size: entryView.getUint32(120, true)
    });
  }

  const root = dirs.find((dir) => dir.type === 5);
  const miniFat: number[] = [];
  if (numMiniFatSectors && firstMiniFatSector >= 0) {
    const miniFatStream = chain(firstMiniFatSector);
    const miniFatView = dataView(miniFatStream);
    for (let i = 0; i + 4 <= miniFatStream.length; i += 4) miniFat.push(readSid(miniFatView, i));
  }

  const miniStream = root && root.startSid >= 0 ? chain(root.startSid) : new Uint8Array();
  const miniChain = (startMiniSid: number) => {
    const chunks: Uint8Array[] = [];
    let sid = startMiniSid;
    let guard = 0;
    while (sid >= 0 && guard < miniFat.length + 4) {
      const offset = sid * miniSectorSize;
      chunks.push(miniStream.slice(offset, offset + miniSectorSize));
      sid = miniFat[sid];
      guard += 1;
    }
    return concatBytes(chunks);
  };

  return {
    stream(name: string) {
      const dir = dirs.find((item) => item.name === name);
      if (!dir) return null;
      const data = dir.size < miniCutoff && dir.type === 2 ? miniChain(dir.startSid) : chain(dir.startSid);
      return data.slice(0, dir.size);
    }
  };
}

function parseBiffRows(stream: Uint8Array): string[][] {
  const view = dataView(stream);
  const sharedStrings: string[] = [];
  const sheets: { offset: number; name: string }[] = [];
  let offset = 0;

  while (offset + 4 <= stream.length) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    const dataStart = offset + 4;
    const dataEnd = dataStart + length;
    if (type === 0x0085) sheets.push(parseBoundSheet(stream.slice(dataStart, dataEnd)));
    if (type === 0x00fc) {
      const segments = [stream.slice(dataStart, dataEnd)];
      let next = dataEnd;
      while (next + 4 <= stream.length && view.getUint16(next, true) === 0x003c) {
        const contLength = view.getUint16(next + 2, true);
        segments.push(stream.slice(next + 4, next + 4 + contLength));
        next += 4 + contLength;
      }
      sharedStrings.splice(0, sharedStrings.length, ...parseSst(segments));
    }
    offset = dataEnd;
    if (sheets.length && type === 0x0809 && offset > sheets[0].offset) break;
  }

  const rows: string[][] = [];
  offset = sheets[0]?.offset || 0;
  let pendingFormula: { row: number; col: number } | null = null;

  while (offset + 4 <= stream.length) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    const dataStart = offset + 4;
    const data = stream.slice(dataStart, dataStart + length);
    if (type === 0x000a) break;

    if (type === 0x00fd) {
      const dv = dataView(data);
      setCell(rows, dv.getUint16(0, true), dv.getUint16(2, true), sharedStrings[dv.getUint32(6, true)] || "");
    } else if (type === 0x0203) {
      const dv = dataView(data);
      setCell(rows, dv.getUint16(0, true), dv.getUint16(2, true), dv.getFloat64(6, true));
    } else if (type === 0x027e) {
      const dv = dataView(data);
      setCell(rows, dv.getUint16(0, true), dv.getUint16(2, true), decodeRk(dv.getUint32(6, true)));
    } else if (type === 0x00bd) {
      const dv = dataView(data);
      const row = dv.getUint16(0, true);
      const firstCol = dv.getUint16(2, true);
      const lastCol = dv.getUint16(data.length - 2, true);
      for (let col = firstCol; col <= lastCol; col += 1) {
        const itemOffset = 4 + (col - firstCol) * 6;
        setCell(rows, row, col, decodeRk(dv.getUint32(itemOffset + 2, true)));
      }
    } else if (type === 0x0204) {
      const dv = dataView(data);
      setCell(rows, dv.getUint16(0, true), dv.getUint16(2, true), readInlineString(data, 6));
    } else if (type === 0x0205) {
      const dv = dataView(data);
      setCell(rows, dv.getUint16(0, true), dv.getUint16(2, true), dv.getUint8(6) ? "TRUE" : "FALSE");
    } else if (type === 0x0006) {
      const dv = dataView(data);
      const row = dv.getUint16(0, true);
      const col = dv.getUint16(2, true);
      const marker = dv.getUint16(6, true);
      if (marker === 0xffff) pendingFormula = { row, col };
      else setCell(rows, row, col, dv.getFloat64(6, true));
    } else if (type === 0x0207 && pendingFormula) {
      setCell(rows, pendingFormula.row, pendingFormula.col, readInlineString(data, 0));
      pendingFormula = null;
    }
    offset += 4 + length;
  }

  return rows;
}

function parseBoundSheet(data: Uint8Array) {
  const dv = dataView(data);
  const offset = dv.getUint32(0, true);
  const nameLen = dv.getUint8(6);
  const flags = dv.getUint8(7);
  const highByte = flags & 1;
  let name = "";
  let pos = 8;
  for (let i = 0; i < nameLen; i += 1) {
    name += String.fromCharCode(highByte ? dv.getUint16(pos + i * 2, true) : dv.getUint8(pos + i));
  }
  return { offset, name };
}

function parseSst(segments: Uint8Array[]) {
  const reader = new SegmentReader(segments);
  reader.u32();
  const uniqueCount = reader.u32();
  const strings: string[] = [];
  for (let i = 0; i < uniqueCount && !reader.done(); i += 1) strings.push(reader.string());
  return strings;
}

class SegmentReader {
  private segment = 0;
  private pos = 0;

  constructor(private segments: Uint8Array[]) {}

  current() {
    return this.segments[this.segment] || new Uint8Array();
  }

  done() {
    return this.segment >= this.segments.length;
  }

  ensure() {
    while (!this.done() && this.pos >= this.current().length) {
      this.segment += 1;
      this.pos = 0;
    }
  }

  byte() {
    this.ensure();
    if (this.done()) return 0;
    return this.current()[this.pos++];
  }

  u16() {
    const a = this.byte();
    const b = this.byte();
    return a | (b << 8);
  }

  u32() {
    return this.u16() | (this.u16() << 16);
  }

  string() {
    const length = this.u16();
    let flags = this.byte();
    const rich = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    let highByte = flags & 1;
    let text = "";
    for (let i = 0; i < length; i += 1) {
      if (this.pos >= this.current().length) {
        this.segment += 1;
        this.pos = 0;
        if (this.done()) break;
        flags = this.byte();
        highByte = flags & 1;
      }
      if (highByte) {
        const lo = this.byte();
        const hi = this.byte();
        text += String.fromCharCode(lo | (hi << 8));
      } else {
        text += String.fromCharCode(this.byte());
      }
    }
    for (let i = 0; i < rich * 4; i += 1) this.byte();
    for (let i = 0; i < ext; i += 1) this.byte();
    return text;
  }
}

function readInlineString(data: Uint8Array, offset: number) {
  const dv = dataView(data);
  if (offset + 3 > data.length) return "";
  const length = dv.getUint16(offset, true);
  const flags = dv.getUint8(offset + 2);
  let pos = offset + 3;
  if (flags & 0x08) pos += 2;
  if (flags & 0x04) pos += 4;
  let text = "";
  for (let i = 0; i < length && pos < data.length; i += 1) {
    if (flags & 1) {
      text += String.fromCharCode(dv.getUint16(pos, true));
      pos += 2;
    } else {
      text += String.fromCharCode(dv.getUint8(pos));
      pos += 1;
    }
  }
  return text;
}

function decodeRk(rk: number) {
  const divided = rk & 1;
  const isInteger = rk & 2;
  let value: number;
  if (isInteger) {
    value = rk >> 2;
  } else {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(4, rk & 0xfffffffc, true);
    value = view.getFloat64(0, true);
  }
  return divided ? value / 100 : value;
}

function setCell(rows: string[][], row: number, col: number, value: unknown) {
  if (!rows[row]) rows[row] = [];
  rows[row][col] = clean(value);
}

function readSid(view: DataView, offset: number) {
  const value = view.getUint32(offset, true);
  return value >= 0xfffffffa ? -1 : value;
}

function sectorOffset(sid: number, sectorSize: number) {
  return (sid + 1) * sectorSize;
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function dataView(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeUtf16(bytes: Uint8Array) {
  let text = "";
  const view = dataView(bytes);
  for (let i = 0; i + 1 < bytes.length; i += 2) text += String.fromCharCode(view.getUint16(i, true));
  return text;
}
