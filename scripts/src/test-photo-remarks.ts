/**
 * End-to-end test: photo upload with remarks round-trip
 *
 * Verifies:
 *  1. POST /api/inspections/:id/photos with a remarks string returns 201 with the
 *     correct remarks value in the response body.
 *  2. GET /api/inspections/:id includes the photo with the same remarks value.
 *  3. GET /api/inspections/:id/report returns a valid .docx whose word/document.xml
 *     contains the exact remarks text for both uploaded photos (correct entry association).
 *
 * Run:
 *   pnpm --filter @workspace/scripts run test:photo-remarks
 *
 * The API server must be reachable at http://localhost:80.
 * Uses only Node 18+ built-in fetch / FormData / Blob + child_process (no new deps).
 */

import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const BASE = "http://localhost:80";

function ok(label: string): void {
  console.log(`  ✅  ${label}`);
}

function fail(label: string, detail?: unknown): never {
  console.error(`  ❌  ${label}`);
  if (detail !== undefined) console.error("     ", detail);
  process.exit(1);
}

async function assertOk(res: Response, context: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text().catch(() => "(unreadable)");
    fail(`${context} — expected 2xx but got ${res.status}`, body);
  }
}

// Minimal 1×1 red PNG (hard-coded bytes, avoids needing a file on disk).
const TINY_PNG_HEX =
  "89504e470d0a1a0a0000000d494844520000000100000001080200000090" +
  "012e000000000c49444154789c6260f8cf" +
  "c00000000200016034718660000000049454e44ae426082";

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, "");
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

async function uploadPhoto(
  id: string,
  label: string,
  remarks: string,
  lat: string,
  lng: string
): Promise<{ photoId: string; remarks: string; label: string }> {
  const fd = new FormData();
  fd.append(
    "photo",
    new Blob([hexToUint8Array(TINY_PNG_HEX)], { type: "image/png" }),
    "test.png"
  );
  fd.append("lat", lat);
  fd.append("lng", lng);
  fd.append("label", label);
  fd.append("remarks", remarks);

  const res = await fetch(`${BASE}/api/inspections/${id}/photos`, {
    method: "POST",
    body: fd,
  });
  await assertOk(res, `POST /api/inspections/${id}/photos`);
  return res.json() as Promise<{ photoId: string; remarks: string; label: string }>;
}

async function run(): Promise<void> {
  console.log("\nField Inspector — photo + remarks round-trip test\n");

  // ── 1. Create inspection ───────────────────────────────────────────────────
  console.log("Step 1: create inspection");
  const createRes = await fetch(`${BASE}/api/inspections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      vehicleNumber: "TEST001",
      officers: "Test Officer",
      shift: "DAY",
      teamId: "",
      teamName: "TEST001",
    }),
  });
  await assertOk(createRes, "POST /api/inspections");
  const inspection = (await createRes.json()) as { id: string };
  if (!inspection.id) fail("Response missing `id`", inspection);
  ok(`Inspection created: ${inspection.id}`);

  const id = inspection.id;

  // Two photos with distinct labels/remarks to verify correct entry association.
  const PHOTO_A = {
    label: "Kerb crack",
    remarks: "Visible crack running 2m along kerb — urgent repair needed",
    lat: "1.3521",
    lng: "103.8198",
  };
  const PHOTO_B = {
    label: "Pothole",
    remarks: "Deep pothole near drain cover — standing water present",
    lat: "1.3530",
    lng: "103.8205",
  };

  // ── 2. Upload two photos with remarks ─────────────────────────────────────
  console.log("\nStep 2: upload two photos with distinct remarks");
  const photoA = await uploadPhoto(id, PHOTO_A.label, PHOTO_A.remarks, PHOTO_A.lat, PHOTO_A.lng);
  if (!photoA.photoId) fail("Photo A upload missing photoId", photoA);
  if (photoA.remarks !== PHOTO_A.remarks) {
    fail("Photo A POST response remarks mismatch", {
      expected: PHOTO_A.remarks,
      got: photoA.remarks,
    });
  }
  ok(`Photo A uploaded (${photoA.photoId}), remarks in POST response ✓`);

  const photoB = await uploadPhoto(id, PHOTO_B.label, PHOTO_B.remarks, PHOTO_B.lat, PHOTO_B.lng);
  if (!photoB.photoId) fail("Photo B upload missing photoId", photoB);
  if (photoB.remarks !== PHOTO_B.remarks) {
    fail("Photo B POST response remarks mismatch", {
      expected: PHOTO_B.remarks,
      got: photoB.remarks,
    });
  }
  ok(`Photo B uploaded (${photoB.photoId}), remarks in POST response ✓`);

  // ── 3. GET inspection — assert both remarks persisted ─────────────────────
  console.log("\nStep 3: GET inspection — verify remarks persisted");
  const getRes = await fetch(`${BASE}/api/inspections/${id}`);
  await assertOk(getRes, "GET /api/inspections/:id");
  const fetched = (await getRes.json()) as {
    photos?: { photoId: string; remarks: string; label: string }[];
  };

  if (!Array.isArray(fetched.photos) || fetched.photos.length < 2) {
    fail("GET response has fewer than 2 photos", fetched);
  }

  for (const expected of [PHOTO_A, PHOTO_B]) {
    const match = fetched.photos!.find((p) => p.remarks === expected.remarks);
    if (!match) {
      fail(`GET response missing photo with remarks "${expected.remarks}"`, {
        received: fetched.photos!.map((p) => p.remarks),
      });
    }
    if (match.label !== expected.label) {
      fail(`Label mismatch for photo with remarks "${expected.remarks}"`, {
        expected: expected.label,
        got: match.label,
      });
    }
  }
  ok("Both photos present in GET /inspections/:id with correct remarks + labels");

  // ── 4. GET docx report — structure checks ─────────────────────────────────
  console.log("\nStep 4: GET docx report — structure + content checks");
  const reportRes = await fetch(`${BASE}/api/inspections/${id}/report`);
  await assertOk(reportRes, "GET /api/inspections/:id/report");

  const contentType = reportRes.headers.get("content-type") ?? "";
  const DOCX_MIME =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (!contentType.includes(DOCX_MIME)) {
    fail("Report content-type unexpected", { expected: DOCX_MIME, got: contentType });
  }
  ok("Report content-type correct");

  const docxBytes = new Uint8Array(await reportRes.arrayBuffer());
  if (docxBytes.length < 1000) {
    fail(`Report .docx suspiciously small (${docxBytes.length} bytes)`);
  }
  ok(`Report .docx is ${docxBytes.length} bytes`);

  if (docxBytes[0] !== 0x50 || docxBytes[1] !== 0x4b) {
    fail("Report file does not start with PK signature — not a valid zip/docx");
  }
  ok("Report .docx has valid zip/PK signature");

  // ── 5. Inspect DOCX XML for remarks text ──────────────────────────────────
  console.log("\nStep 5: Inspect word/document.xml for remarks text");

  const tmpDir = os.tmpdir();
  const tmpDocx = path.join(tmpDir, `test-inspection-${id}.docx`);
  fs.writeFileSync(tmpDocx, Buffer.from(docxBytes));

  let docXml: string;
  try {
    // -p: pipe to stdout; word/document.xml contains the main body text
    docXml = execSync(`unzip -p "${tmpDocx}" word/document.xml`, {
      encoding: "utf8",
      timeout: 10000,
    });
  } catch (err) {
    fail("Failed to extract word/document.xml from report .docx", err);
  } finally {
    try { fs.unlinkSync(tmpDocx); } catch { /* best-effort */ }
  }

  // The XML contains runs of text; strip tags to get a flat text corpus for matching.
  // Remarks may be split across <w:t> elements, so we match the full string in the raw XML too.
  const stripped = docXml.replace(/<[^>]+>/g, "");

  for (const expected of [PHOTO_A, PHOTO_B]) {
    const inRaw = docXml.includes(expected.remarks);
    const inStripped = stripped.includes(expected.remarks);
    if (!inRaw && !inStripped) {
      fail(
        `Remarks text not found in DOCX word/document.xml: "${expected.remarks}"`,
        { label: expected.label }
      );
    }
    ok(`Remarks for "${expected.label}" present in DOCX report`);
  }

  // ── 6. Clean up ────────────────────────────────────────────────────────────
  // Scoped delete — removes exactly this test inspection, not every
  // inspection in the environment (DELETE /api/inspections is bulk-only).
  console.log("\nStep 6: clean up test inspection");
  const delRes = await fetch(`${BASE}/api/inspections/${id}`, { method: "DELETE" });
  await assertOk(delRes, `DELETE /api/inspections/${id}`);
  ok("Test inspection deleted");

  console.log("\n✅  All checks passed.\n");
}

run().catch((err: unknown) => {
  console.error("\nUnexpected error:", err);
  process.exit(1);
});
