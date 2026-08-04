import { Router } from "express";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import sharp, { type OverlayOptions } from "sharp";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  inspectionsTable,
  inspectionPhotosTable,
  inspectionLinesTable,
  type Inspection as InspectionRow,
  type InspectionPhoto as InspectionPhotoRow,
  type InspectionLine as InspectionLineRow,
} from "@workspace/db";
import { uploadObject, getObjectStream, getObjectBuffer, deleteObject } from "../lib/storage";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ImageRun,
} from "docx";

export const inspectionsRouter = Router();

// ── Types ────────────────────────────────────────────────────────────────────

export interface InspectionPhoto {
  photoId: string;
  filename: string;
  originalName: string;
  label: string;
  remarks: string;
  lat: number;
  lng: number;
  takenAt: string;
  pinNumber: number;
}

export interface InspectionLine {
  lineId: string;
  points: { lat: number; lng: number }[];
  color: string;
  createdAt: string;
}

export interface Inspection {
  id: string;
  teamId: string;
  teamName: string;
  vehicleNumber: string;
  officers: string;
  shift: string;
  startedAt: string;
  completedAt: string | null;
  status: "active" | "completed";
  photos: InspectionPhoto[];
  lines: InspectionLine[];
}

// ── Storage ──────────────────────────────────────────────────────────────────

function toApiPhoto(row: InspectionPhotoRow): InspectionPhoto {
  return {
    photoId: row.photoId,
    filename: row.filename ?? "",
    originalName: row.originalName ?? "",
    label: row.label ?? "",
    remarks: row.remarks ?? "",
    lat: row.lat ?? 0,
    lng: row.lng ?? 0,
    takenAt: (row.takenAt ?? new Date()).toISOString(),
    pinNumber: row.pinNumber ?? 0,
  };
}

function toApiLine(row: InspectionLineRow): InspectionLine {
  return {
    lineId: row.lineId,
    points: row.points,
    color: row.color ?? "#e74c3c",
    createdAt: (row.createdAt ?? new Date()).toISOString(),
  };
}

function toApiInspection(row: InspectionRow, photos: InspectionPhotoRow[], lines: InspectionLineRow[]): Inspection {
  return {
    id: row.id,
    teamId: row.teamId ?? "",
    teamName: row.teamName ?? "",
    vehicleNumber: row.vehicleNumber ?? "",
    officers: row.officers ?? "",
    shift: row.shift ?? "",
    startedAt: (row.startedAt ?? new Date()).toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    status: row.status as "active" | "completed",
    photos: photos.map(toApiPhoto).sort((a, b) => a.pinNumber - b.pinNumber),
    lines: lines.map(toApiLine),
  };
}

async function loadInspection(id: string): Promise<Inspection | undefined> {
  const [row] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, id));
  if (!row) return undefined;
  const [photos, lines] = await Promise.all([
    db.select().from(inspectionPhotosTable).where(eq(inspectionPhotosTable.inspectionId, id)),
    db.select().from(inspectionLinesTable).where(eq(inspectionLinesTable.inspectionId, id)),
  ]);
  return toApiInspection(row, photos, lines);
}

async function loadAllInspections(): Promise<Inspection[]> {
  const [rows, photos, lines] = await Promise.all([
    db.select().from(inspectionsTable),
    db.select().from(inspectionPhotosTable),
    db.select().from(inspectionLinesTable),
  ]);
  return rows.map((r) =>
    toApiInspection(
      r,
      photos.filter((p) => p.inspectionId === r.id),
      lines.filter((l) => l.inspectionId === r.id),
    ),
  );
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// ── Map generation helpers ────────────────────────────────────────────────────

const TILE_SIZE = 256;

function lngToFracX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * Math.pow(2, zoom);
}

function latToFracY(lat: number, zoom: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  return (
    (1 - Math.log((1 + sin) / (1 - sin)) / (2 * Math.PI)) /
    2 *
    Math.pow(2, zoom)
  );
}

function latLngToPixel(
  lat: number,
  lng: number,
  zoom: number,
  originFracX: number,
  originFracY: number
): { px: number; py: number } {
  return {
    px: (lngToFracX(lng, zoom) - originFracX) * TILE_SIZE,
    py: (latToFracY(lat, zoom) - originFracY) * TILE_SIZE,
  };
}

function chooseZoom(
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
  maxTiles: number
): number {
  for (let z = 18; z >= 1; z--) {
    const x0 = Math.floor(lngToFracX(minLng, z));
    const x1 = Math.floor(lngToFracX(maxLng, z));
    const y0 = Math.floor(latToFracY(maxLat, z)); // maxLat → smaller Y
    const y1 = Math.floor(latToFracY(minLat, z));
    if (x1 - x0 + 1 <= maxTiles && y1 - y0 + 1 <= maxTiles) return z;
  }
  return 12;
}

async function fetchTileBuf(
  z: number,
  x: number,
  y: number
): Promise<Buffer | null> {
  try {
    const maxTile = Math.pow(2, z);
    const tx = ((x % maxTile) + maxTile) % maxTile;
    const url = `https://tile.openstreetmap.org/${z}/${tx}/${y}.png`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "FieldInspectorReport/1.0 (CWD field inspection app)",
        Accept: "image/png",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function buildSvgOverlay(
  width: number,
  height: number,
  photos: InspectionPhoto[],
  lines: InspectionLine[],
  zoom: number,
  originFracX: number,
  originFracY: number
): string {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;

  // Lines first (under pins)
  for (const line of lines) {
    if (line.points.length < 2) continue;
    const pts = line.points
      .map((pt) => {
        const { px, py } = latLngToPixel(
          pt.lat,
          pt.lng,
          zoom,
          originFracX,
          originFracY
        );
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ");
    const color = /^#[0-9a-fA-F]{3,6}$/.test(line.color)
      ? line.color
      : "#e74c3c";
    svg += `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="4" stroke-opacity="0.9" stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // Photo pins on top
  for (const photo of photos) {
    const { px, py } = latLngToPixel(
      photo.lat,
      photo.lng,
      zoom,
      originFracX,
      originFracY
    );
    svg += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="14" fill="#3b82f6" stroke="white" stroke-width="2.5"/>`;
    svg += `<text x="${px.toFixed(1)}" y="${(py + 5).toFixed(1)}" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="white">${photo.pinNumber}</text>`;
  }

  svg += "</svg>";
  return svg;
}

async function generateMapImage(
  photos: InspectionPhoto[],
  lines: InspectionLine[]
): Promise<Buffer | null> {
  const allLat = [
    ...photos.map((p) => p.lat),
    ...lines.flatMap((l) => l.points.map((pt) => pt.lat)),
  ];
  const allLng = [
    ...photos.map((p) => p.lng),
    ...lines.flatMap((l) => l.points.map((pt) => pt.lng)),
  ];
  if (allLat.length === 0) return null;

  const minLat = Math.min(...allLat);
  const maxLat = Math.max(...allLat);
  const minLng = Math.min(...allLng);
  const maxLng = Math.max(...allLng);

  // If all points are the same, add a tiny bbox
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  const padLat = latSpan < 0.005 ? 0.005 : latSpan * 0.2;
  const padLng = lngSpan < 0.005 ? 0.005 : lngSpan * 0.2;
  const bMinLat = minLat - padLat;
  const bMaxLat = maxLat + padLat;
  const bMinLng = minLng - padLng;
  const bMaxLng = maxLng + padLng;

  const MAX_TILES = 4;
  const zoom = chooseZoom(bMinLat, bMaxLat, bMinLng, bMaxLng, MAX_TILES);

  const startTileX = Math.floor(lngToFracX(bMinLng, zoom));
  const startTileY = Math.floor(latToFracY(bMaxLat, zoom));
  const endTileX = Math.floor(lngToFracX(bMaxLng, zoom));
  const endTileY = Math.floor(latToFracY(bMinLat, zoom));

  const tilesX = Math.min(endTileX - startTileX + 1, 5);
  const tilesY = Math.min(endTileY - startTileY + 1, 5);

  // Fetch all tiles in parallel
  const tilePromises: Promise<Buffer | null>[][] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    tilePromises.push([]);
    for (let tx = 0; tx < tilesX; tx++) {
      tilePromises[ty].push(fetchTileBuf(zoom, startTileX + tx, startTileY + ty));
    }
  }
  const tileBufs: (Buffer | null)[][] = await Promise.all(
    tilePromises.map((row) => Promise.all(row))
  );

  const width = tilesX * TILE_SIZE;
  const height = tilesY * TILE_SIZE;

  // Stitch tiles onto a grey base
  const base = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 200, b: 200 },
    },
  }).png();

  const composites: OverlayOptions[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const buf = tileBufs[ty][tx];
      if (buf) {
        composites.push({
          input: buf,
          left: tx * TILE_SIZE,
          top: ty * TILE_SIZE,
        });
      }
    }
  }

  // SVG overlay
  const svgStr = buildSvgOverlay(
    width,
    height,
    photos,
    lines,
    zoom,
    startTileX,
    startTileY
  );
  composites.push({ input: Buffer.from(svgStr), left: 0, top: 0 });

  try {
    const result = await base.composite(composites).png().toBuffer();
    return result;
  } catch {
    return null;
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// POST /inspections — create
inspectionsRouter.post("/inspections", async (req, res) => {
  const { teamId, teamName, vehicleNumber, officers, shift } = req.body as {
    teamId?: string;
    teamName?: string;
    vehicleNumber?: string;
    officers?: string;
    shift?: string;
  };
  if (!vehicleNumber) {
    res.status(400).json({ error: "vehicleNumber is required" });
    return;
  }
  const id = randomUUID();
  const startedAt = new Date();
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      id,
      teamId: teamId ?? "",
      teamName: teamName ?? vehicleNumber,
      vehicleNumber,
      officers: officers ?? "",
      shift: shift ?? "",
      startedAt,
      completedAt: null,
      status: "active",
    })
    .returning();
  res.status(201).json(toApiInspection(row, [], []));
});

// GET /inspections — list
inspectionsRouter.get("/inspections", async (_req, res) => {
  const list = (await loadAllInspections()).sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  res.json(list);
});

// GET /inspections/summary — plain-text bulk report (must be before /:id)
inspectionsRouter.get("/inspections/summary", async (req, res) => {
  const mode = (req.query.mode as string | undefined) ?? "all";
  const list = (await loadAllInspections())
    .filter((i) => mode === "completed" ? i.status === "completed" : true)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("en-SG", {
      timeZone: "Asia/Singapore",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const elapsedMin = (start: string, end: string | null) => {
    const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  const divider = "─".repeat(70);
  const now = new Date().toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const activeCount = list.filter((i) => i.status === "active").length;
  const completedCount = list.filter((i) => i.status === "completed").length;

  let text = `FIELD INSPECTION SUMMARY\n`;
  text += `Generated: ${now}\n`;
  text += `Total: ${list.length} inspection${list.length !== 1 ? "s" : ""}`;
  if (list.length > 0) text += ` (${completedCount} completed, ${activeCount} active)`;
  text += "\n";

  if (list.length === 0) {
    text += "\nNo inspections found.\n";
  }

  for (const insp of list) {
    text += `\n${divider}\n`;
    const statusIcon = insp.status === "completed" ? "✅" : "🟡";
    text += `${statusIcon} ${insp.vehicleNumber}  ${insp.officers ? "— " + insp.officers : ""}  (${insp.shift})\n`;
    text += `   Started: ${fmtDate(insp.startedAt)}`;
    if (insp.completedAt) text += `  |  Completed: ${fmtDate(insp.completedAt)}`;
    text += `  |  Duration: ${elapsedMin(insp.startedAt, insp.completedAt)}\n`;
    text += `   Photos: ${insp.photos.length}  |  Lines: ${insp.lines.length}\n`;

    if (insp.photos.length > 0) {
      text += "\n";
      for (const p of insp.photos) {
        text += `   [${p.pinNumber}]`;
        if (p.label) text += ` ${p.label}`;
        text += "\n";
        if (p.remarks) text += `        Remarks: ${p.remarks}\n`;
        text += `        Coords: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}  |  ${fmtDate(p.takenAt)}\n`;
      }
    }
  }

  text += `\n${divider}\n`;

  const filename = `inspection-summary-${new Date().toISOString().slice(0, 10)}.txt`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(text);
});

// DELETE /api/inspections — clear inspections (?mode=completed clears only completed, default all)
inspectionsRouter.delete("/inspections", async (req, res) => {
  const mode = (req.query.mode as string | undefined) ?? "all";

  const rows = mode === "completed"
    ? await db.select().from(inspectionsTable).where(eq(inspectionsTable.status, "completed"))
    : await db.select().from(inspectionsTable);
  const toDelete = rows.map((r) => r.id);

  if (toDelete.length > 0) {
    const photos = await db
      .select()
      .from(inspectionPhotosTable)
      .where(inArray(inspectionPhotosTable.inspectionId, toDelete));
    // Clean up uploaded photo objects from MinIO
    for (const photo of photos) {
      if (!photo.filename) continue;
      try {
        await deleteObject(photo.filename);
      } catch {
        // Best-effort cleanup
      }
    }

    await db.transaction(async (tx) => {
      await tx.delete(inspectionPhotosTable).where(inArray(inspectionPhotosTable.inspectionId, toDelete));
      await tx.delete(inspectionLinesTable).where(inArray(inspectionLinesTable.inspectionId, toDelete));
      await tx.delete(inspectionsTable).where(inArray(inspectionsTable.id, toDelete));
    });
  }

  res.json({ deleted: toDelete.length, mode });
});

// GET /inspections/:id — detail
inspectionsRouter.get("/inspections/:id", async (req, res) => {
  const { id } = req.params as { id: string };
  const insp = await loadInspection(id);
  if (!insp) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(insp);
});

// POST /inspections/:id/photos — upload
inspectionsRouter.post(
  "/inspections/:id/photos",
  upload.single("photo"),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const [inspRow] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, id));
    if (!inspRow) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No photo uploaded" });
      return;
    }
    const rawLat = req.body.lat as string | string[] | undefined;
    const rawLng = req.body.lng as string | string[] | undefined;
    const rawLabel = req.body.label as string | string[] | undefined;
    const rawRemarks = req.body.remarks as string | string[] | undefined;
    const lat = Array.isArray(rawLat) ? rawLat[0] : rawLat;
    const lng = Array.isArray(rawLng) ? rawLng[0] : rawLng;
    const label = Array.isArray(rawLabel) ? rawLabel[0] : rawLabel;
    const remarks = Array.isArray(rawRemarks) ? rawRemarks[0] : rawRemarks;

    const photoId = randomUUID();
    const ext = path.extname(req.file.originalname) || ".jpg";
    const key = `inspections/${id}/${photoId}${ext}`;
    await uploadObject(key, req.file.buffer, req.file.mimetype);

    const existingPhotos = await db
      .select()
      .from(inspectionPhotosTable)
      .where(eq(inspectionPhotosTable.inspectionId, id));

    const [row] = await db
      .insert(inspectionPhotosTable)
      .values({
        photoId,
        inspectionId: id,
        filename: key,
        originalName: req.file.originalname,
        label: label ?? "",
        remarks: remarks ?? "",
        lat: parseFloat(lat ?? "0"),
        lng: parseFloat(lng ?? "0"),
        takenAt: new Date(),
        pinNumber: existingPhotos.length + 1,
      })
      .returning();
    res.status(201).json(toApiPhoto(row));
  }
);

// GET /inspections/:id/photos/:photoId/file — serve file
inspectionsRouter.get("/inspections/:id/photos/:photoId/file", async (req, res) => {
  const { id, photoId } = req.params as { id: string; photoId: string };
  const [photo] = await db
    .select()
    .from(inspectionPhotosTable)
    .where(and(eq(inspectionPhotosTable.inspectionId, id), eq(inspectionPhotosTable.photoId, photoId)));
  if (!photo || !photo.filename) {
    res.status(404).json({ error: "Photo not found" });
    return;
  }
  try {
    const { body, contentType } = await getObjectStream(photo.filename);
    if (contentType) res.setHeader("Content-Type", contentType);
    body.pipe(res);
  } catch {
    res.status(404).json({ error: "File missing" });
  }
});

// POST /inspections/:id/lines — add polyline
inspectionsRouter.post("/inspections/:id/lines", async (req, res) => {
  const { id } = req.params as { id: string };
  const [inspRow] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, id));
  if (!inspRow) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const { points, color } = req.body as {
    points?: { lat: number; lng: number }[];
    color?: string;
  };
  if (!points || points.length < 2) {
    res.status(400).json({ error: "At least 2 points required" });
    return;
  }
  const [row] = await db
    .insert(inspectionLinesTable)
    .values({
      lineId: randomUUID(),
      inspectionId: id,
      points,
      color: color ?? "#e74c3c",
      createdAt: new Date(),
    })
    .returning();
  res.status(201).json(toApiLine(row));
});

// PUT /inspections/:id/complete — mark complete
inspectionsRouter.put("/inspections/:id/complete", async (req, res) => {
  const { id } = req.params as { id: string };
  const completedAt = new Date();
  const [row] = await db
    .update(inspectionsTable)
    .set({ status: "completed", completedAt })
    .where(eq(inspectionsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const insp = await loadInspection(id);
  res.json(insp);
});

// GET /inspections/:id/report — .docx with map image + embedded photos
inspectionsRouter.get("/inspections/:id/report", async (req, res) => {
  const { id } = req.params as { id: string };
  const insp = await loadInspection(id);
  if (!insp) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("en-SG", {
      timeZone: "Asia/Singapore",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const borderStyle = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
  const cellBorders = {
    top: borderStyle,
    bottom: borderStyle,
    left: borderStyle,
    right: borderStyle,
  };

  // ── Generate map image ──────────────────────────────────────────────────────
  let mapBuf: Buffer | null = null;
  try {
    mapBuf = await generateMapImage(insp.photos, insp.lines);
  } catch {
    // Map generation is optional — report still generated without it
  }

  // ── Resize and embed each photo ─────────────────────────────────────────────
  interface PhotoEmbed {
    photo: InspectionPhoto;
    buf: Buffer;
    width: number;
    height: number;
  }
  const photoEmbeds: PhotoEmbed[] = [];
  for (const photo of insp.photos) {
    if (!photo.filename) continue;
    try {
      const buf = await getObjectBuffer(photo.filename);
      const pipeline = sharp(buf).resize(480, 360, {
        fit: "inside",
        withoutEnlargement: true,
      });
      const resized = await pipeline.jpeg({ quality: 80 }).toBuffer();
      const meta = await sharp(resized).metadata();
      photoEmbeds.push({
        photo,
        buf: resized,
        width: meta.width ?? 480,
        height: meta.height ?? 360,
      });
    } catch {
      // Skip photos that can't be processed
    }
  }

  // ── Build DOCX sections ────────────────────────────────────────────────────

  const docChildren: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [
        new TextRun({ text: "Field Inspection Report", bold: true, size: 44 }),
      ],
    }),
    new Paragraph({ children: [new TextRun({ text: "" })] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: "Team Details", bold: true })],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Vehicle: ", bold: true }),
        new TextRun({ text: insp.vehicleNumber }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Officers: ", bold: true }),
        new TextRun({ text: insp.officers || "—" }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Shift: ", bold: true }),
        new TextRun({ text: insp.shift || "—" }),
      ],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Started: ", bold: true }),
        new TextRun({ text: fmtDate(insp.startedAt) }),
      ],
    }),
    ...(insp.completedAt
      ? [
          new Paragraph({
            children: [
              new TextRun({ text: "Completed: ", bold: true }),
              new TextRun({ text: fmtDate(insp.completedAt) }),
            ],
          }),
        ]
      : []),
    new Paragraph({ children: [new TextRun({ text: "" })] }),
  ];

  // ── Map image ──────────────────────────────────────────────────────────────
  if (mapBuf) {
    const mapMeta = await sharp(mapBuf).metadata();
    const mapW = mapMeta.width ?? 800;
    const mapH = mapMeta.height ?? 600;
    // Scale to max 560pt wide (A4 usable width ~595pt)
    const scale = Math.min(1, 560 / mapW);
    docChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "Inspection Map", bold: true })],
      }),
      new Paragraph({
        children: [
          new ImageRun({
            data: mapBuf,
            transformation: {
              width: Math.round(mapW * scale),
              height: Math.round(mapH * scale),
            },
            type: "png",
          }),
        ],
      }),
      new Paragraph({ children: [new TextRun({ text: "" })] })
    );
  }

  // ── Photo pins table ───────────────────────────────────────────────────────
  docChildren.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: `Photo Pins (${insp.photos.length})`,
          bold: true,
        }),
      ],
    })
  );

  if (insp.photos.length === 0) {
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({ text: "No photos recorded.", italics: true }),
        ],
      })
    );
  } else {
    const photoTableRows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            borders: cellBorders,
            children: [
              new Paragraph({
                children: [new TextRun({ text: "#", bold: true })],
              }),
            ],
          }),
          new TableCell({
            borders: cellBorders,
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Label", bold: true })],
              }),
            ],
          }),
          new TableCell({
            borders: cellBorders,
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Coordinates", bold: true })],
              }),
            ],
          }),
          new TableCell({
            borders: cellBorders,
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Time", bold: true })],
              }),
            ],
          }),
        ],
      }),
      ...insp.photos.map(
        (p) =>
          new TableRow({
            children: [
              new TableCell({
                borders: cellBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: String(p.pinNumber) })],
                  }),
                ],
              }),
              new TableCell({
                borders: cellBorders,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: p.label || "(no label)",
                        italics: !p.label,
                      }),
                    ],
                  }),
                  ...(p.remarks
                    ? [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: p.remarks,
                              italics: true,
                              color: "666666",
                              size: 18,
                            }),
                          ],
                        }),
                      ]
                    : []),
                ],
              }),
              new TableCell({
                borders: cellBorders,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                borders: cellBorders,
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: fmtDate(p.takenAt) })],
                  }),
                ],
              }),
            ],
          })
      ),
    ];

    docChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: photoTableRows,
      })
    );
  }

  // ── Embedded photos ────────────────────────────────────────────────────────
  if (photoEmbeds.length > 0) {
    docChildren.push(
      new Paragraph({ children: [new TextRun({ text: "" })] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: "Photo Evidence", bold: true })],
      })
    );

    for (const { photo, buf, width, height } of photoEmbeds) {
      const scale = Math.min(1, 480 / width);
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Pin ${photo.pinNumber}${photo.label ? ": " + photo.label : ""}  (${fmtDate(photo.takenAt)})`,
              bold: true,
              size: 22,
            }),
          ],
        }),
        ...(photo.remarks
          ? [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `    Remarks: ${photo.remarks}`,
                    italics: true,
                    color: "555555",
                    size: 20,
                  }),
                ],
              }),
            ]
          : []),
        new Paragraph({
          children: [
            new ImageRun({
              data: buf,
              transformation: {
                width: Math.round(width * scale),
                height: Math.round(height * scale),
              },
              type: "jpg",
            }),
          ],
        }),
        new Paragraph({ children: [new TextRun({ text: "" })] })
      );
    }
  }

  // ── Lines table ────────────────────────────────────────────────────────────
  docChildren.push(
    new Paragraph({ children: [new TextRun({ text: "" })] }),
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: `Drawn Lines (${insp.lines.length})`,
          bold: true,
        }),
      ],
    })
  );

  if (insp.lines.length === 0) {
    docChildren.push(
      new Paragraph({
        children: [new TextRun({ text: "No lines drawn.", italics: true })],
      })
    );
  } else {
    const lineTableRows: TableRow[] = [
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            borders: cellBorders,
            children: [
              new Paragraph({
                children: [new TextRun({ text: "#", bold: true })],
              }),
            ],
          }),
          new TableCell({
            borders: cellBorders,
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Points", bold: true })],
              }),
            ],
          }),
          new TableCell({
            borders: cellBorders,
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Time", bold: true })],
              }),
            ],
          }),
        ],
      }),
      ...insp.lines.map(
        (l, i) =>
          new TableRow({
            children: [
              new TableCell({
                borders: cellBorders,
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: String(i + 1) })],
                  }),
                ],
              }),
              new TableCell({
                borders: cellBorders,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: l.points
                          .map(
                            (pt) =>
                              `(${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})`
                          )
                          .join(" → "),
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                borders: cellBorders,
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: fmtDate(l.createdAt) }),
                    ],
                  }),
                ],
              }),
            ],
          })
      ),
    ];

    docChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: lineTableRows,
      })
    );
  }

  // ── Build and stream DOCX ───────────────────────────────────────────────────
  const doc = new Document({
    sections: [{ children: docChildren }],
  });

  try {
    const buffer = await Packer.toBuffer(doc);
    const safeName = `inspection-${insp.vehicleNumber.replace(/\s+/g, "_")}-${insp.startedAt.slice(0, 10)}.docx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: "Failed to generate report" });
  }
});
