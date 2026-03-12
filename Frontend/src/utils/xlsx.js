import * as XLSX from "xlsx";

const INVALID_SHEET_CHARS = /[\\/?*[\]:]/g;

function sanitizeSheetName(name, fallback) {
  const cleaned = String(name || "")
    .replace(INVALID_SHEET_CHARS, " ")
    .trim();
  const safe = cleaned || fallback || "Sheet";
  return safe.length > 31 ? safe.slice(0, 31) : safe;
}

export function downloadXlsx(filename, rows, options = {}) {
  if (!rows || !rows.length) return;
  const { sheetBy, headers } = options;
  const workbook = XLSX.utils.book_new();
  const headerList = headers || Object.keys(rows[0]);

  if (sheetBy) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = row?.[sheetBy] || "All";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    let index = 1;
    for (const [key, groupRows] of groups.entries()) {
      const sheetName = sanitizeSheetName(key, `Sheet ${index}`);
      const worksheet = XLSX.utils.json_to_sheet(groupRows, {
        header: headerList,
        skipHeader: false,
      });
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      index += 1;
    }
  } else {
    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: headerList,
      skipHeader: false,
    });
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet 1");
  }

  XLSX.writeFile(workbook, filename);
}
