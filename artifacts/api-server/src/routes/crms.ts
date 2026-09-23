import { randomUUID } from "crypto";
import { Router } from "express";
import ExcelJS from "exceljs";
import { eq, ne, and, inArray, notInArray } from "drizzle-orm";
import {
  db,
  crmsCasesTable,
  crmsCommentsTable,
  type CrmsCase as CrmsCaseRow,
  type CrmsComment as CrmsCommentRow,
} from "@workspace/db";
import { requireManager, requireCrew } from "./auth";
import { sendToManagers, sendToCrewVehicle } from "./push";

const router = Router();

// ── Data model ───────────────────────────────────────────────────────────────
// API-facing shapes — mirror the DB row shapes but preserve the exact
// original field name `updateProvidedToFP` (capital FP), which the schema's
// column property is `updateProvidedToFp` (regular camelCase). The frontend
// depends on the original casing, so responses are mapped explicitly rather
// than spreading DB rows directly.
export interface CrmsComment {
  commentId: string;
  vehicleId: string;
  unitCode: string;
  text: string;
  createdAt: Date;
}

export interface CrmsCase {
  id: string;
  caseNumber: string;
  isWog: boolean;
  fpName: string;
  fpContact: string;
  address: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  locationName: string;
  details: string;
  status: "TO_BE_ASSIGNED" | "TEAM_ACKNOWLEDGE_OTW" | "FP_UPDATED" | "ASSISTANCE_PROVIDED" | "RESOLVED";
  assignedVehicleId: string | null;
  assignedUnitCode: string | null;
  comments: CrmsComment[];
  receivedAt: Date;
  acknowledgedAt: Date | null;
  fpUpdatedAt: Date | null;
  assistanceProvidedAt: Date | null;
  resolvedAt: Date | null;
  floodAssessment: string | null;
  updateProvidedToFP: string | null;
  reportedBy: string;
}

function toApiComment(row: CrmsCommentRow): CrmsComment {
  return {
    commentId: row.commentId,
    vehicleId: row.vehicleId,
    unitCode: row.unitCode,
    text: row.text,
    createdAt: row.createdAt,
  };
}

function toApiCase(row: CrmsCaseRow, comments: CrmsCommentRow[]): CrmsCase {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    isWog: row.isWog,
    fpName: row.fpName,
    fpContact: row.fpContact,
    address: row.address,
    postalCode: row.postalCode,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    locationName: row.locationName,
    details: row.details,
    status: row.status as CrmsCase["status"],
    // Nullable columns absent from a fresh insert-value object (as opposed
    // to a real SELECT row) come through as `undefined`, which
    // JSON.stringify drops entirely — normalize to `null` so the response
    // shape is identical whether toApiCase is fed a DB row or an insert
    // payload (see the ingest endpoint below).
    assignedVehicleId: row.assignedVehicleId ?? null,
    assignedUnitCode: row.assignedUnitCode ?? null,
    comments: comments.filter((c) => c.caseId === row.id).map(toApiComment),
    receivedAt: row.receivedAt,
    acknowledgedAt: row.acknowledgedAt ?? null,
    fpUpdatedAt: row.fpUpdatedAt ?? null,
    assistanceProvidedAt: row.assistanceProvidedAt ?? null,
    resolvedAt: row.resolvedAt ?? null,
    floodAssessment: row.floodAssessment ?? null,
    updateProvidedToFP: row.updateProvidedToFp ?? null,
    reportedBy: row.reportedBy,
  };
}

async function loadAllCases(): Promise<CrmsCase[]> {
  const [rows, comments] = await Promise.all([
    db.select().from(crmsCasesTable),
    db.select().from(crmsCommentsTable),
  ]);
  return rows.map((r) => toApiCase(r, comments));
}

async function loadCase(id: string): Promise<CrmsCase | undefined> {
  const [row] = await db.select().from(crmsCasesTable).where(eq(crmsCasesTable.id, id));
  if (!row) return undefined;
  const comments = await db.select().from(crmsCommentsTable).where(eq(crmsCommentsTable.caseId, id));
  return toApiCase(row, comments);
}

// ── Parsing ────────────────────────────────────────────────────────────────────
interface ParsedRaw {
  caseNumber: string;
  isWog: boolean;
  fpName: string;
  fpContact: string;
  address: string;
  postalCode: string;
  details: string;
  reportedBy: string;
}

// ── Format 1: [WOG ]CRMS: NUMBER FP: NAME, CONTACT Add: ADDRESS Details: TEXT ──
function parseCrmsFormat1(text: string): ParsedRaw[] {
  const results: ParsedRaw[] = [];

  // Split into individual case blocks (separated by blank lines or "From " lines)
  const blocks = text.split(/(?=\bFrom\s+\S+@\S+)/i).map(b => b.trim()).filter(b => b);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map(l => l.trim());

    let reportedBy = "";
    let caseLine = "";

    for (const line of lines) {
      if (/^From\s+\S+@\S+/i.test(line)) {
        reportedBy = line.replace(/^From\s+/i, "").trim();
      } else if (/(?:WOG\s+)?CRMS:\s*\d+/i.test(line)) {
        caseLine = line;
      }
    }

    if (!caseLine) continue;

    const isWog = /^WOG\s+CRMS/i.test(caseLine);

    const caseNumMatch = caseLine.match(/CRMS:\s*(\d+)/i);
    if (!caseNumMatch) continue;
    const caseNumber = caseNumMatch[1];

    // FP: NAME, CONTACT  (contact is digits/spaces, 8+ chars)
    const fpMatch = caseLine.match(/FP:\s*(.+?),\s*([\d\s\-\+]{8,}?)\s+Add:/i);
    const fpName = fpMatch?.[1]?.trim() ?? "";
    const fpContact = (fpMatch?.[2] ?? "").replace(/\s+/g, "").trim();

    // Add: ADDRESS  Details: ...
    const addMatch = caseLine.match(/Add:\s*(.+?)\s+Details:/is);
    const address = addMatch?.[1]?.trim() ?? "";

    const detailsMatch = caseLine.match(/Details:\s*(.+)$/is);
    const details = detailsMatch?.[1]?.trim() ?? "";

    // Extract 6-digit postal code from address — handle both 229835 and S229835 formats
    const postalMatch = address.match(/\bS?(\d{6})\b/i);
    const postalCode = postalMatch?.[1] ?? "";

    results.push({ caseNumber, isWog, fpName, fpContact, address, postalCode, details, reportedBy });
  }

  return results;
}

// ── Format 2: Case ID: NUMBER ( Priority ) C&W - IssueType  ADDRESS  IssueDesc ──
//   [body text paragraphs]
//   [context] Request PUB To Attend Customer: NAME.  Contact: (M) MOBILE (H) ... (O) ...
function parseCrmsFormat2(text: string): ParsedRaw[] {
  const results: ParsedRaw[] = [];

  // Split blocks by dashed separators (3+ dashes on their own line) OR on "Case ID:" boundaries
  const rawBlocks = text.split(/\n-{3,}\n?/).map(b => b.trim()).filter(b => b);

  // Further split any block that contains multiple "Case ID:" headers
  const blocks: string[] = [];
  for (const rb of rawBlocks) {
    const subBlocks = rb.split(/(?=\bCase ID:\s*\d+)/i).map(b => b.trim()).filter(b => b);
    blocks.push(...subBlocks);
  }

  for (const block of blocks) {
    const caseIdMatch = block.match(/Case ID:\s*(\d+)/i);
    if (!caseIdMatch) continue;
    const caseNumber = caseIdMatch[1];

    // First meaningful line: "Case ID: N ( Priority ) C&W - IssueType  ADDRESS  IssueDesc"
    const firstLine = block.split(/\r?\n/).find(l => /Case ID:/i.test(l)) ?? "";

    // Extract everything after "C&W - "
    const cwMatch = firstLine.match(/C&W\s*-\s*(.+)$/i);
    if (!cwMatch) continue;
    const afterCW = cwMatch[1].trim();

    // Split by 2+ spaces: [issueType, address, issueDesc, ...]
    const parts = afterCW.split(/\s{2,}/);
    const issueType  = parts[0]?.trim() ?? "";
    const addressRaw = parts[1]?.trim() ?? "";
    const issueDesc  = parts.slice(2).join("  ").trim();

    // Extract 6-digit postal code from address (skip placeholder 000000/00000)
    const postalMatch = addressRaw.match(/\b(\d{6})\b/);
    const postalCode  = postalMatch?.[1] && !/^0+$/.test(postalMatch[1]) ? postalMatch[1] : "";

    // Body text = everything after first line, before "Request PUB To Attend"
    const afterFirst = block.replace(/^.*\n/, ""); // drop first line
    const beforeRequest = afterFirst.split(/\bRequest PUB To Attend\b/i)[0].trim();

    // Combine issue description + body for details field
    const details = [issueType, issueDesc, beforeRequest]
      .map(s => s.trim()).filter(Boolean).join(" | ");

    // Customer name: "Customer:  NAME."
    const customerMatch = block.match(/Customer:\s+(.+?)\.\s*(?:Contact:|$)/i);
    const fpName = customerMatch?.[1]?.trim() ?? "";

    // Contact: first non-empty phone from (M), (H), (O)
    const contactBlock = block.match(/Contact:\s*([\s\S]*?)(?:\n|$)/i)?.[1] ?? "";
    const phoneMatch = contactBlock.match(/\([MHO]\)\s*([\d\s]{6,})/i);
    const fpContact = phoneMatch?.[1]?.replace(/\s+/g, "").trim() ?? "";

    results.push({
      caseNumber,
      isWog: false,
      fpName,
      fpContact,
      address: addressRaw,
      postalCode,
      details,
      reportedBy: "C&W CRMS",
    });
  }

  return results;
}

function parseCrmsText(text: string): ParsedRaw[] {
  // Detect which format(s) are present and run the appropriate parser(s)
  const hasCaseId = /\bCase ID:\s*\d+/i.test(text);
  const hasCrmsColon = /(?:WOG\s+)?CRMS:\s*\d+/i.test(text);

  if (hasCaseId && !hasCrmsColon) return parseCrmsFormat2(text);
  if (!hasCaseId && hasCrmsColon) return parseCrmsFormat1(text);

  // Mixed or ambiguous — run both and deduplicate by case number
  const combined = [...parseCrmsFormat1(text), ...parseCrmsFormat2(text)];
  const seen = new Set<string>();
  return combined.filter(r => {
    if (seen.has(r.caseNumber)) return false;
    seen.add(r.caseNumber);
    return true;
  });
}

// ── Geocoding via OneMap ───────────────────────────────────────────────────────
const NEA_UA = "Mozilla/5.0 (compatible; SG-FloodTracker/1.0)";

interface GeoResult { lat: number; lng: number; name: string; }

async function geocodePostal(postal: string): Promise<GeoResult | null> {
  if (!/^\d{6}$/.test(postal)) return null;
  try {
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${postal}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const r = await fetch(url, { headers: { "User-Agent": NEA_UA } });
    if (!r.ok) return null;
    const json = await r.json() as { results?: Array<{ LATITUDE: string; LONGITUDE: string; ADDRESS: string }> };
    const first = json.results?.[0];
    if (!first) return null;
    return { lat: parseFloat(first.LATITUDE), lng: parseFloat(first.LONGITUDE), name: first.ADDRESS };
  } catch { return null; }
}

async function geocodeAddress(addr: string): Promise<GeoResult | null> {
  if (!addr) return null;
  // Trim trailing location notes from address (after last known postal-style segment)
  const clean = addr.split(",").slice(0, 3).join(",").trim();
  try {
    const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(clean)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const r = await fetch(url, { headers: { "User-Agent": NEA_UA } });
    if (!r.ok) return null;
    const json = await r.json() as { results?: Array<{ LATITUDE: string; LONGITUDE: string; ADDRESS: string }> };
    const first = json.results?.[0];
    if (!first) return null;
    return { lat: parseFloat(first.LATITUDE), lng: parseFloat(first.LONGITUDE), name: first.ADDRESS };
  } catch { return null; }
}

async function geocodeCase(raw: ParsedRaw): Promise<GeoResult | null> {
  if (raw.postalCode) {
    const r = await geocodePostal(raw.postalCode);
    if (r) return r;
  }
  return geocodeAddress(raw.address);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/crms/ingest — parse raw SMS text, geocode, save, return cases
router.post("/crms/ingest", requireManager, async (req, res) => {
  const { text } = req.body as { text?: string };
  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "text is required" }); return;
  }

  const parsed = parseCrmsText(text);
  if (!parsed.length) {
    res.status(422).json({ error: "No CRMS cases found — check the message format" }); return;
  }

  const existingCaseNumbers = new Set(
    (await db.select({ caseNumber: crmsCasesTable.caseNumber }).from(crmsCasesTable)).map((c) => c.caseNumber),
  );

  const now = new Date();
  const newRows: (typeof crmsCasesTable.$inferInsert)[] = [];
  const skipped: string[] = [];

  for (const raw of parsed) {
    // Skip duplicates by case number
    if (existingCaseNumbers.has(raw.caseNumber)) {
      skipped.push(raw.caseNumber);
      continue;
    }

    const geo = await geocodeCase(raw);

    newRows.push({
      id: randomUUID(),
      caseNumber: raw.caseNumber,
      isWog: raw.isWog,
      fpName: raw.fpName,
      fpContact: raw.fpContact,
      address: raw.address,
      postalCode: raw.postalCode,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      locationName: geo?.name ?? raw.address,
      details: raw.details,
      status: "TO_BE_ASSIGNED",
      receivedAt: now,
      reportedBy: raw.reportedBy,
    });
    existingCaseNumbers.add(raw.caseNumber);
  }

  if (newRows.length > 0) await db.insert(crmsCasesTable).values(newRows);
  const newCases: CrmsCase[] = newRows.map((r) => toApiCase(r as CrmsCaseRow, []));

  if (newCases.length) {
    sendToManagers({
      title: `📋 ${newCases.length} new CRMS case${newCases.length > 1 ? "s" : ""} added`,
      body: newCases.map(c => `#${c.caseNumber} — ${c.address.slice(0, 50)}`).join("; ").slice(0, 140),
      tag: "crms-ingest",
      url: "/manager",
    }).catch(() => {});
  }

  res.json({ ok: true, added: newCases.length, skipped, cases: newCases });
});

// GET /api/crms — list all cases
router.get("/crms", async (_req, res) => {
  const cases = await loadAllCases();
  res.json({ cases, count: cases.length });
});

// GET /api/crms/report — Excel (.xlsx) summary report (must come BEFORE /:id)
// ?format=text returns plain-text (used by mobile Share sheet)
router.get("/crms/report", async (req, res) => {
  const cases = await loadAllCases();
  const sgNow = new Date().toLocaleString("en-SG", { timeZone: "Asia/Singapore" });

  // ── Plain-text fallback (mobile share) ──────────────────────────────────────
  if (req.query.format === "text") {
    const lines: string[] = [
      "CRMS CASE SUMMARY REPORT",
      `Generated: ${sgNow}`,
      `Total: ${cases.length} case${cases.length !== 1 ? "s" : ""}`,
      "=".repeat(60),
    ];
    for (const c of cases) {
      lines.push("");
      lines.push(`[${c.status}] CRMS #${c.caseNumber}`);
      lines.push(`FP: ${c.fpName}  |  Contact: ${c.fpContact}`);
      lines.push(`Address: ${c.address}`);
      lines.push(`Details: ${c.details}`);
      if (c.assignedUnitCode) lines.push(`Assigned to: ${c.assignedUnitCode}`);
      if (c.comments.length) {
        for (const cm of c.comments) {
          const t = cm.createdAt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
          lines.push(`  [${t}] ${cm.unitCode}: ${cm.text}`);
        }
      }
      lines.push("-".repeat(60));
    }
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.send(lines.join("\n"));
    return;
  }

  // ── Excel report ─────────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "CWD Deployment Tracker";
  wb.created = new Date();

  const ws = wb.addWorksheet("CRMS Cases", { views: [{ state: "frozen", ySplit: 2 }] });

  // ── Title row ───────────────────────────────────────────────────────────────
  ws.mergeCells("A1:R1");
  const titleCell = ws.getCell("A1");
  titleCell.value = `CRMS CASE SUMMARY REPORT   |   Generated: ${sgNow}   |   Total: ${cases.length} case${cases.length !== 1 ? "s" : ""}`;
  titleCell.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 28;

  // ── Column widths & keys (no header: here — ExcelJS writes headers to row 1 which conflicts with the title merge) ──
  ws.columns = [
    { key: "caseNumber",            width: 14 },
    { key: "status",                width: 20 },
    { key: "receivedAt",            width: 20 },
    { key: "acknowledgedAt",        width: 22 },
    { key: "fpUpdatedAt",           width: 20 },
    { key: "assistanceProvidedAt",  width: 22 },
    { key: "resolvedAt",            width: 20 },
    { key: "address",               width: 38 },
    { key: "postalCode",            width: 10 },
    { key: "details",               width: 45 },
    { key: "fpName",                width: 22 },
    { key: "fpContact",             width: 15 },
    { key: "assignedUnit",          width: 14 },
    { key: "updateProvidedToFP",    width: 35 },
    { key: "floodAssessment",       width: 35 },
    { key: "lat",                   width: 12 },
    { key: "lng",                   width: 12 },
    { key: "comments",              width: 40 },
  ];

  // ── Header row (row 2) — written manually so labels are always visible ────────
  const HEADERS = [
    "Case #", "Status", "Received (SGT)", "Team Ack OTW (SGT)", "FP Updated (SGT)",
    "Assistance Given (SGT)", "Resolved (SGT)", "Address", "Postal", "Details",
    "Complainant", "Contact", "Assigned To", "Update Provided to FP",
    "Flood Assessment", "Lat", "Lng", "Field Comments",
  ];
  const headerRow = ws.getRow(2);
  headerRow.height = 26;
  HEADERS.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FF1E3A5F" } } };
  });
  headerRow.commit();

  // Status colour map
  const STATUS_COLOR: Record<string, string> = {
    TO_BE_ASSIGNED:       "FFFFF3CC",  // soft yellow
    TEAM_ACKNOWLEDGE_OTW: "FFFFE4C4",  // soft orange
    FP_UPDATED:           "FFD6EAF8",  // soft blue
    ASSISTANCE_PROVIDED:  "FFE8D5F5",  // soft violet
    RESOLVED:             "FFD1FAE5",  // soft green
  };
  const STATUS_FONT: Record<string, string> = {
    TO_BE_ASSIGNED:       "FF78350F",
    TEAM_ACKNOWLEDGE_OTW: "FF9A3412",
    FP_UPDATED:           "FF1E3A5F",
    ASSISTANCE_PROVIDED:  "FF4C1D95",
    RESOLVED:             "FF065F46",
  };

  // ── Data rows ────────────────────────────────────────────────────────────────
  for (const c of cases) {
    const sgTime = (d: Date) =>
      d.toLocaleString("en-SG", { timeZone: "Asia/Singapore", hour12: false,
        day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

    const commentsText = c.comments.length
      ? c.comments.map(cm => {
          const t = cm.createdAt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Singapore" });
          return `[${t}] ${cm.unitCode}: ${cm.text}`;
        }).join("\n")
      : "";

    const statusLabel: Record<string, string> = {
      TO_BE_ASSIGNED: "To Be Assigned", TEAM_ACKNOWLEDGE_OTW: "Team Acknowledge OTW",
      FP_UPDATED: "FP Updated", ASSISTANCE_PROVIDED: "Assistance Provided", RESOLVED: "Resolved",
    };
    const row = ws.addRow({
      caseNumber:           c.caseNumber,
      status:               statusLabel[c.status] ?? c.status,
      receivedAt:           sgTime(c.receivedAt),
      acknowledgedAt:       c.acknowledgedAt ? sgTime(c.acknowledgedAt) : "",
      fpUpdatedAt:          c.fpUpdatedAt ? sgTime(c.fpUpdatedAt) : "",
      assistanceProvidedAt: c.assistanceProvidedAt ? sgTime(c.assistanceProvidedAt) : "",
      resolvedAt:           c.resolvedAt ? sgTime(c.resolvedAt) : "",
      address:              c.address,
      postalCode:           c.postalCode || "",
      details:              c.details,
      fpName:               c.fpName,
      fpContact:            c.fpContact,
      assignedUnit:         c.assignedUnitCode ?? "",
      updateProvidedToFP:   c.updateProvidedToFP ?? "",
      floodAssessment:      c.floodAssessment ?? "",
      lat:                  c.lat != null ? +c.lat.toFixed(5) : "",
      lng:                  c.lng != null ? +c.lng.toFixed(5) : "",
      comments:             commentsText,
    });

    const bgColor = STATUS_COLOR[c.status] ?? "FFFFFFFF";
    const fontColor = STATUS_FONT[c.status] ?? "FF0F172A";

    row.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.font = { size: 10, color: { argb: fontColor } };
      cell.border = {
        bottom: { style: "hair", color: { argb: "FFCBD5E1" } },
      };
    });

    // Bold case number
    row.getCell("caseNumber").font = { bold: true, size: 10, color: { argb: fontColor } };
    // Status badge — centred
    row.getCell("status").alignment = { vertical: "middle", horizontal: "center" };

    row.height = commentsText ? Math.max(22, Math.min(80, 22 + commentsText.split("\n").length * 14)) : 22;
  }

  // ── Auto-filter on header row ────────────────────────────────────────────────
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: 18 } };

  const filename = `CRMS_Report_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

// GET /api/crms/:id — single case
router.get("/crms/:id", async (req, res) => {
  const c = await loadCase(req.params.id);
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  res.json(c);
});

// PUT /api/crms/:id — update (status, assignment, coords, etc.)
router.put("/crms/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const current = await loadCase(id);
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  const updates = req.body as Partial<CrmsCase>;
  const prevVehicleId = current.assignedVehicleId;
  const incomingVehicleId = updates.assignedVehicleId;

  const patch: Partial<typeof crmsCasesTable.$inferInsert> = {};
  const ALLOWED: (keyof CrmsCase)[] = [
    "status", "assignedVehicleId", "assignedUnitCode",
    "lat", "lng", "locationName", "details",
    "fpName", "fpContact", "address", "postalCode",
    "floodAssessment", "updateProvidedToFP",
  ];
  for (const k of ALLOWED) {
    if (!(k in updates)) continue;
    if (k === "updateProvidedToFP") {
      patch.updateProvidedToFp = updates.updateProvidedToFP ?? null;
    } else {
      // nosemgrep: javascript.express.security.audit.remote-property-injection.remote-property-injection
      // k only ever comes from the ALLOWED literal array above, never from
      // Object.keys(updates)/user-controlled input — can't be __proto__ etc.
      (patch as any)[k] = (updates as any)[k];
    }
  }
  const now = new Date();
  if (updates.status === "TEAM_ACKNOWLEDGE_OTW" && !current.acknowledgedAt) patch.acknowledgedAt = now;
  if (updates.status === "FP_UPDATED" && !current.fpUpdatedAt) patch.fpUpdatedAt = now;
  if (updates.status === "ASSISTANCE_PROVIDED" && !current.assistanceProvidedAt) patch.assistanceProvidedAt = now;
  if (updates.status === "RESOLVED" && !current.resolvedAt) patch.resolvedAt = now;

  await db.transaction(async (tx) => {
    // If reassigning a vehicle to this case, remove it from any other active (non-RESOLVED) case
    if (incomingVehicleId && incomingVehicleId !== prevVehicleId) {
      await tx
        .update(crmsCasesTable)
        .set({ assignedVehicleId: null, assignedUnitCode: null })
        .where(
          and(
            ne(crmsCasesTable.id, current.id),
            eq(crmsCasesTable.assignedVehicleId, incomingVehicleId),
            ne(crmsCasesTable.status, "RESOLVED"),
          ),
        );
    }
    await tx.update(crmsCasesTable).set(patch).where(eq(crmsCasesTable.id, current.id));
  });

  const updated = (await loadCase(current.id))!;

  // Notify crew when newly assigned
  if (updated.assignedVehicleId && updated.assignedVehicleId !== prevVehicleId) {
    sendToCrewVehicle(updated.assignedVehicleId, {
      title: `📋 CRMS Case Assigned — #${updated.caseNumber}`,
      body: `${updated.address || updated.details || "No address"} · FP: ${updated.fpName}`,
      tag: `crms-assign-${updated.id}`,
      url: "/crms",
    }).catch(() => {});
  }

  res.json(updated);
});

// POST /api/crms/:id/regeocode — re-geocode a case using its current address/postal code
router.post("/crms/:id/regeocode", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const current = await loadCase(id);
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  // Re-extract postal code from the current address in case it was updated
  const postalMatch = current.address.match(/\bS?(\d{6})\b/i);
  const postal = postalMatch?.[1] ?? current.postalCode;

  let geo: GeoResult | null = null;
  if (postal) geo = await geocodePostal(postal);
  if (!geo && current.address) geo = await geocodeAddress(current.address);

  if (!geo) {
    res.status(422).json({ error: "Geocoding failed — address not found on OneMap" }); return;
  }

  await db
    .update(crmsCasesTable)
    .set({ lat: geo.lat, lng: geo.lng, locationName: geo.name, ...(postal ? { postalCode: postal } : {}) })
    .where(eq(crmsCasesTable.id, current.id));

  const updated = await loadCase(current.id);
  res.json({ ok: true, case: updated });
});

// DELETE /api/crms/:id
router.delete("/crms/:id", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const deleted = await db.transaction(async (tx) => {
    await tx.delete(crmsCommentsTable).where(eq(crmsCommentsTable.caseId, id));
    return tx.delete(crmsCasesTable).where(eq(crmsCasesTable.id, id)).returning({ id: crmsCasesTable.id });
  });
  res.json({ ok: deleted.length > 0 });
});

// DELETE /api/crms — clear all resolved, or all if ?all=1
router.delete("/crms", requireManager, async (req, res) => {
  const clearAll = req.query.all === "1";

  await db.transaction(async (tx) => {
    if (clearAll) {
      await tx.delete(crmsCommentsTable);
      await tx.delete(crmsCasesTable);
    } else {
      const toDelete = await tx
        .select({ id: crmsCasesTable.id })
        .from(crmsCasesTable)
        .where(eq(crmsCasesTable.status, "RESOLVED"));
      const ids = toDelete.map((c) => c.id);
      if (ids.length > 0) {
        await tx.delete(crmsCommentsTable).where(inArray(crmsCommentsTable.caseId, ids));
        await tx.delete(crmsCasesTable).where(inArray(crmsCasesTable.id, ids));
      }
    }
  });

  const remaining = await db.select({ id: crmsCasesTable.id }).from(crmsCasesTable);
  res.json({ ok: true, remaining: remaining.length });
});

// POST /api/crms/:id/resolve — crew marks their assigned case as resolved (no manager auth
// required — requireCrew is enough: any authenticated crew session, not just managers)
router.post("/crms/:id/resolve", requireCrew, async (req, res) => {
  const { id } = req.params as { id: string };
  const current = await loadCase(id);
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  const { vehicleId, unitCode } = req.body as { vehicleId?: string; unitCode?: string };
  // Only the assigned vehicle may resolve, unless vehicleId is not set on the case
  if (current.assignedVehicleId && vehicleId && current.assignedVehicleId !== vehicleId) {
    res.status(403).json({ error: "Not assigned to this vehicle" }); return;
  }

  const resolvedAt = current.resolvedAt ?? new Date();
  await db
    .update(crmsCasesTable)
    .set({ status: "RESOLVED", resolvedAt })
    .where(eq(crmsCasesTable.id, current.id));

  const updated = (await loadCase(current.id))!;

  sendToManagers({
    title: `✅ CRMS #${updated.caseNumber} resolved by ${unitCode ?? vehicleId ?? "crew"}`,
    body: updated.address || updated.details || "Case resolved in the field",
    tag: `crms-resolved-${updated.id}`,
    url: "/manager",
  }).catch(() => {});

  res.json({ ok: true, case: updated });
});

// POST /api/crms/:id/comment — a field comment, from crew or a manager.
// requireManager here doesn't mean "manager role only" (see auth.ts —
// requireManager/requireManagerSession accept any approved account
// regardless of role, requireCrew is the one that narrows to crew-only), so
// this one gate already covers both callers.
router.post("/crms/:id/comment", requireManager, async (req, res) => {
  const { id } = req.params as { id: string };
  const current = await loadCase(id);
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  const { vehicleId, unitCode, text } = req.body as { vehicleId?: string; unitCode?: string; text?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text required" }); return; }

  const commentRow: typeof crmsCommentsTable.$inferInsert = {
    commentId: randomUUID(),
    caseId: current.id,
    vehicleId: vehicleId ?? "unknown",
    unitCode: unitCode ?? "unknown",
    text: text.trim(),
    createdAt: new Date(),
  };

  await db.transaction(async (tx) => {
    await tx.insert(crmsCommentsTable).values(commentRow);
    if (current.status === "TO_BE_ASSIGNED") {
      await tx.update(crmsCasesTable).set({ status: "TEAM_ACKNOWLEDGE_OTW" }).where(eq(crmsCasesTable.id, current.id));
    }
  });

  sendToManagers({
    title: `💬 CRMS #${current.caseNumber} — comment from ${unitCode ?? vehicleId}`,
    body: text.trim().slice(0, 120),
    tag: `crms-comment-${current.id}`,
    url: "/manager",
  }).catch(() => {});

  res.json({ ok: true, comment: toApiComment(commentRow as CrmsCommentRow) });
});

export default router;
