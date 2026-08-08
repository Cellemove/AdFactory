// Winning-ads importer for the team's Google Sheet ("our winning ads").
//
// The sheet (gid=0) is a wide, human-maintained multi-market ops tracker: ~10
// side-by-side 8-column blocks (a CBO-duplicate block + 9 country accounts). Its
// "Roas 7day" column is packed as "ROAS/Spend" (e.g. "5.06/39.31" = 5.06 ROAS,
// 39.31 spend). A WINNING AD is one with ROAS >= 1.8 AND spend >= 30.
//
// Spend is in each market's LOCAL currency (ES/DE/GR/PT/FR = EUR, PL = PLN,
// RO = RON, CZ = CZK, USA = USD) — the threshold is applied per-market, not
// USD-normalized. Only USA is literally "$30 USD".
//
// This module is pure (no Next/DB deps) so both the server action and the seed
// script can call it. The parsed result is stored as ONE JSON doc in the Research
// table (the codebase's zero-migration trick) — no schema migration needed.

export const SHEET_ID = "1r_2k8ils7nxl8gukXdX7KoK9zCp_Ic1kbIJETEriVjY";
export const SHEET_GID = "0";
export const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;

export const WINNER_MIN_ROAS = 1.8;
export const WINNER_MIN_SPEND = 30;

// Creative content extracted from the ad's FB post (og:image + og:description →
// Gemini vision), added AFTER import via the "analyze" action. The fbcdn image is
// persisted to our own storage (imagePath) because the signed URLs expire.
export interface SheetWinnerEnrichment {
  adType: "static" | "video";
  headline: string;           // exact text rendered in the creative
  visualConcept: string;      // what's literally in the creative
  hookType: string;           // question | transformation | before-after | …
  funnel: string;             // TOFU|MOFU|BOFU ("" when unknown) — parsed from ad name, else model guess
  primaryText: string;        // the post's primary text verbatim ("" when not exposed, e.g. videos)
  imagePath: string;          // persisted creative (local /uploads or Vercel Blob URL)
  enrichedAt: string;         // ISO timestamp
}

// One winning ad, distilled from the sheet to just what the Winners page shows.
export interface SheetWinner {
  market: string;             // short code: ES, DE, GR, PL, PT, RO, CZ, FR, USA, CBO
  adName: string;
  angle: string;              // raw free-text angle from the sheet (unmapped)
  roas: number;               // 7-day ROAS
  spend: number;              // in the market's LOCAL currency
  postLink: string | null;
  enrichment?: SheetWinnerEnrichment | null;
}

// Stable identity for a sheet winner across re-imports (used to target enrichment).
export function sheetWinnerKey(w: Pick<SheetWinner, "market" | "adName" | "postLink">): string {
  return `${w.market}|${w.adName}|${w.postLink ?? ""}`;
}

export interface SheetWinnersDoc {
  importedAt: string;         // ISO timestamp of the import
  sheetId: string;
  gid: string;
  criteria: { minRoas: number; minSpend: number; roasMetric: string; currencyNote: string };
  total: number;
  byMarket: { market: string; count: number }[];
  winners: SheetWinner[];
}

// Minimal RFC-4180-ish CSV parser (handles quotes, commas + newlines in quotes).
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Fetch the sheet as CSV (public link-share export). Throws a clear error if the
// sheet isn't public (Google serves an HTML sign-in page instead of CSV).
export async function fetchSheetCsv(): Promise<string> {
  const res = await fetch(SHEET_CSV_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`Google Sheet export failed: HTTP ${res.status}. Check the sheet is shared as "Anyone with the link".`);
  const text = await res.text();
  if (/^\s*<(?:!doctype|html)/i.test(text)) {
    throw new Error("Google Sheet is not publicly readable (got an HTML page, not CSV). Set link sharing to 'Anyone with the link'.");
  }
  return text;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Derive a short market code from a block's label. Block 0's label is the note
// "means we duplicated to the cbo" → "CBO"; the rest are "Cellumove.es" etc.
function marketCode(rawLabel: string, blockIndex: number): string {
  if (/duplicat/i.test(rawLabel)) return "CBO";
  const cleaned = rawLabel
    .replace(/cellumove/gi, "")
    .replace(/\.?com\b/gi, "")
    .replace(/[^a-z]/gi, "")
    .toUpperCase();
  return cleaned || (blockIndex === 0 ? "CBO" : `B${blockIndex + 1}`);
}

// Parse the whole sheet into the set of winning ads (ROAS >= 1.8 AND spend >= 30),
// across every 8-column market block, deduped by market+adName+postLink.
export function buildSheetWinnersDoc(csvText: string): SheetWinnersDoc {
  const rows = parseCSV(csvText);
  const labelRow = rows[0] ?? [];   // row 1: market labels
  const header = rows[2] ?? [];     // row 3: repeating column headers
  const data = rows.slice(3);       // rows 4+: ad data
  const BLOCK = 8;                  // Ad Account, Pub ID, Post link, Campaign, Roas7, Roas5, Ad Name, Angle
  const nBlocks = Math.ceil(header.length / BLOCK);

  const winners: SheetWinner[] = [];
  const seen = new Set<string>();

  for (let b = 0; b < nBlocks; b++) {
    const base = b * BLOCK;
    // Skip any block that isn't the expected "Roas … Ad Name" layout.
    const looksLikeBlock = /roas/i.test(header[base + 4] ?? "") || /ad name/i.test(header[base + 6] ?? "");
    if (!looksLikeBlock) continue;
    const market = marketCode((labelRow[base] || labelRow[base + 2] || "").trim(), b);

    for (const r of data) {
      const adName = (r[base + 6] || "").trim();
      if (!adName) continue;
      const packed = (r[base + 4] || "").trim(); // "ROAS/Spend"
      if (!packed.includes("/")) continue;
      const [roasStr = "", spendStr = ""] = packed.split("/");
      const roas = parseFloat(roasStr);
      const spend = parseFloat(spendStr);
      if (!Number.isFinite(roas) || !Number.isFinite(spend)) continue;
      if (roas < WINNER_MIN_ROAS || spend < WINNER_MIN_SPEND) continue;

      const postLink = (r[base + 2] || "").trim() || null;
      const key = `${market}|${adName}|${postLink ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      winners.push({
        market,
        adName,
        angle: (r[base + 7] || "").trim(),
        roas: round2(roas),
        spend: round2(spend),
        postLink,
      });
    }
  }

  // Biggest bets first.
  winners.sort((a, b) => b.spend - a.spend);

  const counts = winners.reduce<Record<string, number>>((m, w) => {
    m[w.market] = (m[w.market] ?? 0) + 1;
    return m;
  }, {});
  const byMarket = Object.entries(counts)
    .map(([market, count]) => ({ market, count }))
    .sort((a, b) => b.count - a.count);

  return {
    importedAt: new Date().toISOString(),
    sheetId: SHEET_ID,
    gid: SHEET_GID,
    criteria: {
      minRoas: WINNER_MIN_ROAS,
      minSpend: WINNER_MIN_SPEND,
      roasMetric: "7-day",
      currencyNote: "spend threshold applied in each market's local currency (not USD-normalized)",
    },
    total: winners.length,
    byMarket,
    winners,
  };
}
