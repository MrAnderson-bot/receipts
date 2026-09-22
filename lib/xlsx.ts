// Minimal .xlsx reader: enough to pull cell text out of government spreadsheets
// without adding a dependency. An .xlsx file is a zip of XML parts.
import { inflateRawSync } from "zlib";

export type Row = Record<string, string>; // column letter -> cell text, e.g. { A: "Agency", B: "GA ID" }

// Lists the files in a zip. Each entry is a function so nothing is inflated until asked for.
export function unzip(buf: Buffer): Map<string, () => Buffer> {
  // The end-of-central-directory record sits at the tail of the file.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a zip file");

  const files = new Map<string, () => Buffer>();
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt zip directory");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    files.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : inflateRawSync(data);
    });
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

export type Workbook = { sheetNames: string[]; sheet: (name: string) => Row[] };

export function readWorkbook(buf: Buffer): Workbook {
  const files = unzip(buf);
  const text = (path: string) => {
    const f = files.get(path);
    if (!f) throw new Error(`Spreadsheet is missing ${path}`);
    return f().toString("utf8");
  };

  const strings = files.has("xl/sharedStrings.xml")
    ? [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")))
    : [];

  const targets = new Map<string, string>();
  for (const m of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*>/g)) {
    const id = m[0].match(/Id="([^"]+)"/)?.[1];
    const target = m[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const sheets = new Map<string, string>();
  for (const m of text("xl/workbook.xml").matchAll(/<sheet [^>]*>/g)) {
    const name = m[0].match(/name="([^"]+)"/)?.[1];
    const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
    if (name && rid && targets.has(rid)) sheets.set(decode(name), targets.get(rid)!);
  }

  return {
    sheetNames: [...sheets.keys()],
    sheet(name) {
      const path = sheets.get(name);
      if (!path) throw new Error(`No sheet called "${name}". Found: ${[...sheets.keys()].join(", ")}`);
      const rows: Row[] = [];
      for (const r of text(path).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const row: Row = {};
        for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const col = c[1].match(/r="([A-Z]+)/)?.[1];
          if (!col || !c[2]) continue;
          const v = c[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
          const inline = c[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
          const value = /t="s"/.test(c[1]) ? strings[Number(v)] : decode(inline ?? v ?? "");
          if (value !== undefined && value !== "") row[col] = value;
        }
        rows.push(row);
      }
      return rows;
    },
  };
}

// Excel stores dates as days since 30 Dec 1899.
export const excelDate = (serial: string | number): string | null => {
  const n = Number(serial);
  return Number.isFinite(n) && n > 0 ? new Date(Math.round((n - 25569) * 86_400_000)).toISOString() : null;
};

// Government sites turn away clients that don't look like a browser or a named
// crawler, so every download identifies this project the way crawlers do.
export const USER_AGENT = "Mozilla/5.0 (compatible; ReceiptsDashboard/0.1; open-source economic dashboard)";
