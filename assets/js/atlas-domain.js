export const LEVELS = [
  { name: "Непереборний", color: "#183f58" },
  { name: "Дуже високий", color: "#376d88" },
  { name: "Високий", color: "#729fae" },
  { name: "Помірний", color: "#b5cbd0" },
  { name: "Задовільний", color: "#e0e7df" },
];
export const SPECIAL_ID = "3200000";
export const normalize = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("uk")
    .replace(/[’‘`ʼ']/g, "")
    .replace(/\s+/g, " ")
    .trim();
export const shortName = (s) =>
  String(s).replace(/ (міська|сільська|селищна)?\s*територіальна громада$/, "");
export function classification(record) {
  if (record.id === SPECIAL_ID)
    return { kind: "special", label: "Особлива територія", color: "#95988b" };
  if (!record.source)
    return {
      kind: "missing-record",
      label: "Немає запису про рівень",
      color: "#e7e5de",
    };
  if (record.risk == null || String(record.risk).trim() === "")
    return {
      kind: "missing-value",
      label: "Рівень не вказано",
      color: "#e7e5de",
    };
  const level = LEVELS.find((l) => l.name === record.risk);
  return level
    ? { ...level, kind: "valid", label: level.name }
    : { kind: "invalid", label: "Невідоме значення рівня", color: "#e7e5de" };
}
export function createRecords(raw, geography) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !Array.isArray(geography.geometryIds)
  )
    throw new Error("Invalid snapshot structure");
  const ids = new Set(geography.geometryIds);
  return [...new Set([...Object.keys(raw), ...ids])]
    .map((id) => {
      const d = raw[id];
      if (d != null && (typeof d !== "object" || Array.isArray(d)))
        throw new Error("Invalid record");
      const r = {
        id,
        source: d != null,
        name:
          d?.name ||
          (id === SPECIAL_ID
            ? "Чорнобильська зона відчуження"
            : `Територія ${id}`),
        region:
          d?.region || geography.regions[id.slice(0, 2)] || "Регіон не вказано",
        code: d?.code || "",
        risk: d?.risk,
        mapped: ids.has(id),
      };
      r.classification = classification(r);
      r.searchText = normalize(r.name + " " + r.region);
      r.nameKey = normalize(r.name);
      r.codeKey = normalize(r.code);
      return r;
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "uk") ||
        a.region.localeCompare(b.region, "uk") ||
        a.id.localeCompare(b.id),
    );
}
export function searchRecords(records, query, fuse) {
  const q = normalize(query);
  if (!q) return { records, fuzzy: false };
  const code = /^(ua\d*|\d+)$/.test(q);
  const found = records.filter((r) =>
    code
      ? r.codeKey.includes(q) || r.id === q
      : q.split(" ").every((t) => r.searchText.includes(t)),
  );
  const rank = (r) =>
    normalize(shortName(r.name)) === q
      ? 0
      : r.nameKey.startsWith(q)
        ? 1
        : r.nameKey.includes(q)
          ? 2
          : 3;
  if (found.length || code || q.length < 3 || !fuse)
    return { records: found.sort((a, b) => rank(a) - rank(b)), fuzzy: false };
  return { records: fuse.search(q).map((x) => x.item), fuzzy: true };
}
export const scopeRecords = (records, region, risk) =>
  records.filter(
    (r) =>
      (!region || r.region === region) &&
      (!risk ||
        (risk === "special"
          ? r.classification.kind === "special"
          : risk === "unknown"
            ? ["missing-record", "missing-value", "invalid"].includes(
                r.classification.kind,
              )
            : r.risk === risk)),
  );
export const csvCell = (value) =>
  '"' + String(value ?? "").replace(/"/g, '""') + '"';
export function exportCsv(records) {
  const rows = [
    [
      "id",
      "КАТОТТГ",
      "Громада / територія",
      "Регіон",
      "Рівень у джерелі",
      "Статус класифікації",
      "Межі на мапі",
      "Офіційна дата чинності",
    ],
  ];
  for (const r of records)
    rows.push([
      r.id,
      r.code,
      r.name,
      r.region,
      r.risk ?? "",
      r.classification.label,
      r.mapped ? "наявні" : "відсутні",
      "не встановлено",
    ]);
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
