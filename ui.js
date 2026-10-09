(function () {
  const api = window.FaturaKarsilastir;
  const slots = {
    ekstre: { parsed: null, column: -1 },
    ref: { parsed: null, column: -1 },
  };
  let result = null;

  const els = {
    note: document.querySelector("#note"),
    error: document.querySelector("#error"),
    compare: document.querySelector("#compare"),
    reset: document.querySelector("#reset"),
    exportBtn: document.querySelector("#export"),
    result: document.querySelector("#result"),
  };

  function setNote(text) {
    els.note.textContent = text || "";
  }

  function setError(text) {
    els.error.textContent = text || "";
    els.error.classList.toggle("hidden", !text);
  }

  function fillSelect(select, parsed, preferred) {
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "-1";
    placeholder.textContent = "Sütun seçin";
    select.appendChild(placeholder);
    parsed.headers.forEach((header, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = header;
      select.appendChild(option);
    });
    select.value = preferred >= 0 ? String(preferred) : "-1";
  }

  function renderSlot(role) {
    const slot = slots[role];
    const card = document.querySelector('[data-role="' + role + '"]');
    const name = card.querySelector(".file-name");
    const meta = card.querySelector(".meta");
    const select = card.querySelector("select");
    if (!slot.parsed) {
      name.textContent = "Dosya seçilmedi";
      meta.textContent = "";
      select.innerHTML = "";
      return;
    }
    name.textContent = slot.parsed.filename;
    const kind = role === "ref" ? "ref" : "fatura";
    if (slot.column < 0) slot.column = api.findColumn(slot.parsed.headers, kind);
    fillSelect(select, slot.parsed, slot.column);
    const groups = slot.column >= 0 ? countKeys(slot.parsed, slot.column) : 0;
    meta.textContent =
      slot.parsed.rows.length +
      " satır" +
      (slot.column >= 0 ? " · " + groups + " tekil numara" : " · sütun seçin");
  }

  function countKeys(parsed, column) {
    const keys = new Set();
    parsed.rows.forEach((row) => {
      const key = api.normKey(row[column]);
      if (key) keys.add(key);
    });
    return keys.size;
  }

  function placeFiles() {
    const loaded = ["ekstre", "ref"].map((role) => ({ role, parsed: slots[role].parsed })).filter((item) => item.parsed);
    if (loaded.length < 2) return;
    const roles = loaded.map((item) => api.roleOf(item.parsed));
    const ekstreAt = roles.indexOf("ekstre");
    const refAt = roles.indexOf("ref");
    if (ekstreAt === -1 || refAt === -1 || ekstreAt === refAt) return;
    const ekstreParsed = loaded[ekstreAt].parsed;
    const refParsed = loaded[refAt].parsed;
    const swapped = loaded[ekstreAt].role !== "ekstre";
    slots.ekstre.parsed = ekstreParsed;
    slots.ekstre.column = api.findColumn(ekstreParsed.headers, "fatura");
    slots.ref.parsed = refParsed;
    slots.ref.column = api.findColumn(refParsed.headers, "ref");
    renderSlot("ekstre");
    renderSlot("ref");
    if (swapped) setNote("Sütun başlıklarına göre dosyalar yerleştirildi.");
  }

  async function loadFile(role, file) {
    setError("");
    setNote("");
    result = null;
    els.result.classList.add("hidden");
    try {
      const buffer = await file.arrayBuffer();
      slots[role].parsed = api.parseArrayBuffer(buffer, file.name);
      slots[role].column = api.findColumn(slots[role].parsed.headers, role === "ref" ? "ref" : "fatura");
      renderSlot(role);
      placeFiles();
      updateButtons();
      maybeAuto();
    } catch (error) {
      slots[role].parsed = null;
      renderSlot(role);
      updateButtons();
      setError(file.name + " okunamadı. " + error.message);
    }
  }

  function maybeAuto() {
    if (slots.ekstre.parsed && slots.ref.parsed && slots.ekstre.column >= 0 && slots.ref.column >= 0) {
      runCompare();
    }
  }

  function updateButtons() {
    const ready = Boolean(slots.ekstre.parsed && slots.ref.parsed);
    els.compare.disabled = !ready;
    els.exportBtn.disabled = !result;
  }

  function selectedColumn(role) {
    const value = Number(document.querySelector('[data-role="' + role + '"] select').value);
    slots[role].column = value;
    return value;
  }

  function runCompare() {
    setError("");
    const ekstreColumn = selectedColumn("ekstre");
    const refColumn = selectedColumn("ref");
    if (!Number.isInteger(ekstreColumn) || ekstreColumn < 0) {
      setError("Depo ekstresinde Fatura No sütununu seçin.");
      return;
    }
    if (!Number.isInteger(refColumn) || refColumn < 0) {
      setError("Referans dosyasında Ref. Belge No sütununu seçin.");
      return;
    }
    result = api.compare(slots.ekstre.parsed, ekstreColumn, slots.ref.parsed, refColumn);
    result.ekstreColumn = ekstreColumn;
    result.refColumn = refColumn;
    paint();
    els.exportBtn.disabled = false;
  }

  function paint() {
    els.result.classList.remove("hidden");
    document.querySelector("#count-ekstre").textContent = String(result.ekstreCount);
    document.querySelector("#count-ref").textContent = String(result.referansCount);
    document.querySelector("#count-only-ekstre").textContent = String(result.onlyEkstre.length);
    document.querySelector("#count-only-ref").textContent = String(result.onlyReferans.length);
    document.querySelector("#verdict").textContent = verdictText();
    paintTable("ekstre-table", "ekstre", result.onlyEkstre, result.ekstreGroups);
    paintTable("ref-table", "ref", result.onlyReferans, result.referansGroups);
    paintTable("match-table", "ekstre", result.matched, result.ekstreGroups);
    document.querySelector("#only-ekstre-pill").textContent = result.onlyEkstre.length + " numara";
    document.querySelector("#only-ref-pill").textContent = result.onlyReferans.length + " numara";
    document.querySelector("#match-pill").textContent = result.matched.length + " numara";
  }

  function verdictText() {
    const left =
      result.onlyEkstre.length === 0
        ? "Depo ekstresinde olup referans listede olmayan fatura yok."
        : result.onlyEkstre.length + " fatura numarası depo ekstresinde var, referans listede yok.";
    const right =
      result.onlyReferans.length === 0
        ? "Referans listede olup ekstrede olmayan fatura yok."
        : result.onlyReferans.length + " ref. belge no referans listede var, ekstrede yok.";
    return left + " " + right;
  }

  function paintTable(tableId, kind, keys, groups) {
    const table = document.querySelector("#" + tableId);
    const parsed = kind === "ref" ? slots.ref.parsed : slots.ekstre.parsed;
    const keyColumn = kind === "ref" ? result.refColumn : result.ekstreColumn;
    const columns = api.preferredColumns(parsed.headers, kind === "ref" ? "ref" : "ekstre");
    if (!columns.includes(keyColumn)) columns.unshift(keyColumn);
    const body = table.querySelector("tbody");
    const head = table.querySelector("thead");
    head.innerHTML = "<tr>" + columns.map((index) => "<th>" + escapeHtml(parsed.headers[index]) + "</th>").join("") + "</tr>";
    const rows = [];
    keys.forEach((key) => {
      (groups.get(key) || []).forEach((entry) => rows.push(entry));
    });
    const query = (document.querySelector("#search").value || "").trim().toLocaleLowerCase("tr");
    body.innerHTML = "";
    let shown = 0;
    rows.forEach((entry) => {
      const cells = columns.map((column) => api.displayValue(entry.row[column], column === keyColumn));
      if (query && !cells.join(" ").toLocaleLowerCase("tr").includes(query)) return;
      shown += 1;
      const tr = document.createElement("tr");
      cells.forEach((text, index) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (columns[index] === keyColumn) td.className = "key";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    const empty = table.closest(".panel").querySelector(".empty");
    if (!keys.length) empty.textContent = "Bu tarafta eksik fatura yok.";
    else if (!shown) empty.textContent = "Aramayla eşleşen satır yok.";
    else empty.textContent = shown + " satır gösteriliyor. Aynı numara birden fazla satırdaysa hepsi listelenir.";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function exportWorkbook() {
    if (!result || !window.XLSX) return;
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheetFor("ekstre", result.onlyEkstre, result.ekstreGroups), "Sadece ekstre");
    XLSX.utils.book_append_sheet(book, sheetFor("ref", result.onlyReferans, result.referansGroups), "Sadece referans");
    XLSX.writeFile(book, "fatura-farklari.xlsx");
  }

  function sheetFor(kind, keys, groups) {
    const parsed = kind === "ref" ? slots.ref.parsed : slots.ekstre.parsed;
    const keyColumn = kind === "ref" ? result.refColumn : result.ekstreColumn;
    const columns = api.preferredColumns(parsed.headers, kind === "ref" ? "ref" : "ekstre");
    if (!columns.includes(keyColumn)) columns.unshift(keyColumn);
    const aoa = [columns.map((index) => parsed.headers[index])];
    keys.forEach((key) => {
      (groups.get(key) || []).forEach((entry) => {
        aoa.push(columns.map((column) => api.displayValue(entry.row[column], column === keyColumn)));
      });
    });
    return XLSX.utils.aoa_to_sheet(aoa);
  }

  function bindDrop(card) {
    const role = card.dataset.role;
    const input = card.querySelector("input");
    card.addEventListener("click", (event) => {
      if (event.target.closest("select") || event.target.closest("label")) return;
      input.click();
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input.click();
      }
    });
    input.addEventListener("change", () => {
      if (input.files[0]) loadFile(role, input.files[0]);
    });
    ["dragenter", "dragover"].forEach((name) => {
      card.addEventListener(name, (event) => {
        event.preventDefault();
        card.classList.add("hot");
      });
    });
    ["dragleave", "drop"].forEach((name) => {
      card.addEventListener(name, (event) => {
        event.preventDefault();
        card.classList.remove("hot");
      });
    });
    card.addEventListener("drop", (event) => {
      const file = event.dataTransfer.files && event.dataTransfer.files[0];
      if (file) loadFile(role, file);
    });
    card.querySelector("select").addEventListener("change", (event) => {
      event.stopPropagation();
      slots[role].column = Number(event.target.value);
      renderSlot(role);
      maybeAuto();
    });
    card.querySelector("select").addEventListener("click", (event) => event.stopPropagation());
  }

  document.querySelectorAll(".drop").forEach(bindDrop);
  els.compare.addEventListener("click", runCompare);
  els.exportBtn.addEventListener("click", exportWorkbook);
  els.reset.addEventListener("click", () => {
    slots.ekstre = { parsed: null, column: -1 };
    slots.ref = { parsed: null, column: -1 };
    result = null;
    document.querySelectorAll(".drop input").forEach((input) => {
      input.value = "";
    });
    renderSlot("ekstre");
    renderSlot("ref");
    els.result.classList.add("hidden");
    setError("");
    setNote("");
    updateButtons();
  });
  document.querySelector("#search").addEventListener("input", () => {
    if (result) paint();
  });
  updateButtons();
})();
