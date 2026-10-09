(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FaturaKarsilastir = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TR_MAP = {
    ş: "s",
    Ş: "s",
    ğ: "g",
    Ğ: "g",
    ü: "u",
    Ü: "u",
    ö: "o",
    Ö: "o",
    ç: "c",
    Ç: "c",
    ı: "i",
    İ: "i",
  };

  function fold(value) {
    return String(value ?? "")
      .replace(/[\uFEFF]/g, "")
      .trim()
      .replace(/[şŞğĞüÜöÖçÇıİ]/g, (ch) => TR_MAP[ch])
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function normKey(value) {
    if (value == null) return "";
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "";
      if (Number.isSafeInteger(value)) return String(value);
      return String(value).replace(/\.0+$/, "");
    }
    let text = String(value).replace(/\u00a0/g, " ").trim().replace(/\s+/g, "");
    if (!text || text === "-") return "";
    if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
    if (/^\d+(\.\d+)?e\+\d+$/i.test(text)) {
      const asNumber = Number(text);
      if (Number.isSafeInteger(asNumber)) return String(asNumber);
    }
    return text;
  }

  function displayValue(value, isKey) {
    if (value == null || value === "") return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const day = String(value.getDate()).padStart(2, "0");
      const month = String(value.getMonth() + 1).padStart(2, "0");
      return day + "." + month + "." + value.getFullYear();
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return "";
      if (isKey || Number.isInteger(value)) return String(value);
      return value.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    return String(value).trim();
  }

  function findHeaderIndex(matrix) {
    let bestIndex = 0;
    let bestScore = -1;
    const limit = Math.min(matrix.length, 30);
    for (let i = 0; i < limit; i += 1) {
      const row = matrix[i] || [];
      const norms = row.map(fold);
      let score = row.filter((cell) => String(cell ?? "").trim() !== "").length;
      if (norms.some((name) => name === "faturano" || name === "refbelgeno")) score += 30;
      if (norms.some((name) => name.includes("ref") && name.includes("belge"))) score += 30;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  function cleanHeaders(row) {
    const seen = new Map();
    return (row || []).map((cell, index) => {
      const label = String(cell ?? "").replace(/\s+/g, " ").trim();
      const base = label || "Sütun " + (index + 1);
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count === 0 ? base : base + " (" + (count + 1) + ")";
    });
  }

  function trimMatrix(headers, rows) {
    let last = headers.length - 1;
    while (last >= 0) {
      const headerEmpty = fold(headers[last]) === "" || /^sutun\d+$/.test(fold(headers[last]));
      const hasValue = rows.some((row) => String(row[last] ?? "").trim() !== "");
      if (!headerEmpty || hasValue) break;
      last -= 1;
    }
    const width = last + 1;
    return {
      headers: headers.slice(0, width),
      rows: rows.map((row) => row.slice(0, width)),
    };
  }

  function matrixFromDelimited(text) {
    return text.split(/\r?\n/).map((line) => line.split("\t").map((cell) => cell.trim()));
  }

  function matrixFromWorkbook(buffer) {
    const XLSX = globalThis.XLSX;
    if (!XLSX) throw new Error("Excel okuyucu yüklenemedi.");
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("Dosyada sayfa yok.");
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: false });
  }

  function parseArrayBuffer(buffer, filename) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let matrix;
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      matrix = matrixFromDelimited(new TextDecoder("utf-16le").decode(bytes));
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      matrix = matrixFromDelimited(new TextDecoder("utf-16be").decode(bytes));
    } else {
      matrix = matrixFromWorkbook(bytes);
    }

    matrix = (matrix || []).filter((row) => (row || []).some((cell) => String(cell ?? "").trim() !== ""));
    if (!matrix.length) throw new Error("Dosya boş.");

    const headerIndex = findHeaderIndex(matrix);
    const headers = cleanHeaders(matrix[headerIndex]);
    const rows = matrix.slice(headerIndex + 1).filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
    const trimmed = trimMatrix(headers, rows);
    return {
      filename: filename || "dosya",
      headers: trimmed.headers,
      rows: trimmed.rows,
    };
  }

  function findColumn(headers, kind) {
    const norms = headers.map(fold);
    if (kind === "ref") {
      const exact = norms.findIndex((name) => name === "refbelgeno" || name === "refbelgenumarasi");
      if (exact >= 0) return exact;
      return norms.findIndex((name) => name.includes("ref") && name.includes("belge"));
    }
    return norms.findIndex((name) => name === "faturano" || name === "faturanumarasi" || name === "faturano");
  }

  function roleOf(parsed) {
    if (findColumn(parsed.headers, "ref") >= 0) return "ref";
    if (findColumn(parsed.headers, "fatura") >= 0) return "ekstre";
    return "unknown";
  }

  function groupRows(parsed, columnIndex) {
    const groups = new Map();
    parsed.rows.forEach((row, index) => {
      const key = normKey(row[columnIndex]);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ row, index });
    });
    return groups;
  }

  function sortKeys(keys) {
    return [...keys].sort((a, b) => a.localeCompare(b, "tr", { numeric: true }));
  }

  function compare(ekstre, ekstreColumn, referans, referansColumn) {
    const ekstreGroups = groupRows(ekstre, ekstreColumn);
    const referansGroups = groupRows(referans, referansColumn);
    const onlyEkstre = [];
    const onlyReferans = [];
    const matched = [];
    ekstreGroups.forEach((_, key) => {
      if (referansGroups.has(key)) matched.push(key);
      else onlyEkstre.push(key);
    });
    referansGroups.forEach((_, key) => {
      if (!ekstreGroups.has(key)) onlyReferans.push(key);
    });
    return {
      onlyEkstre: sortKeys(onlyEkstre),
      onlyReferans: sortKeys(onlyReferans),
      matched: sortKeys(matched),
      ekstreGroups,
      referansGroups,
      ekstreCount: ekstreGroups.size,
      referansCount: referansGroups.size,
    };
  }

  function preferredColumns(headers, kind) {
    const wanted =
      kind === "ekstre"
        ? ["faturano", "depoadi", "faturatarihi", "faturatutar", "odemetarihi", "faturatip", "durum"]
        : ["refbelgeno", "tarih", "faturano", "tur", "sube", "tutar", "malbedeli"];
    const norms = headers.map(fold);
    const picked = [];
    wanted.forEach((name) => {
      const index = norms.indexOf(name);
      if (index >= 0 && !picked.includes(index)) picked.push(index);
    });
    if (!picked.length) {
      headers.forEach((_, index) => {
        if (picked.length < 7) picked.push(index);
      });
    }
    return picked;
  }

  function projectRows(parsed, columnIndexes, entries) {
    return entries.map((entry) =>
      columnIndexes.map((column) => displayValue(entry.row[column], column === columnIndexes[0]))
    );
  }

  return {
    fold,
    normKey,
    displayValue,
    parseArrayBuffer,
    findColumn,
    roleOf,
    compare,
    preferredColumns,
    projectRows,
  };
});
