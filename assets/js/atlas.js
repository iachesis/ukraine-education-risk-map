import {
  LEVELS,
  SPECIAL_ID,
  normalize,
  shortName,
  createRecords,
  searchRecords,
  scopeRecords,
  exportCsv,
} from "./atlas-domain.js";
import { AtlasMap } from "./atlas-map.js";

const plurals = new Intl.PluralRules("uk-UA");
const nouns = {
  record: { one: "запис", few: "записи", many: "записів", other: "запису" },
  result: {
    one: "результат",
    few: "результати",
    many: "результатів",
    other: "результату",
  },
};
const word = (n, kind) => nouns[kind][plurals.select(n)];
const counted = (n, kind) => `${num(n)} ${word(n, kind)}`;
const $ = (s) => document.querySelector(s),
  num = (n) => new Intl.NumberFormat("uk-UA").format(n),
  el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
const state = {
  records: [],
  lookup: new Map(),
  query: "",
  region: "",
  risk: "",
  selected: null,
  view: "map",
  compare: [],
  limit: 40,
  fuzzy: false,
};
let geography,
  topology,
  map,
  fuse,
  suggestions = [],
  activeSuggestion = -1,
  toastTimer,
  resizeTimer;
const announce = (text) => ($("#announcement").textContent = text);
const toast = (text) => {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 3500);
};
const swatch = (r, cls = "risk-swatch") => {
  const n = el("i", cls);
  n.style.setProperty("--risk", r.classification.color);
  n.setAttribute("aria-hidden", "true");
  if (r.id === SPECIAL_ID) n.className = "special-swatch";
  return n;
};
function button(text, cls, fn) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
}
function currentResults() {
  const searched = searchRecords(state.records, state.query, fuse);
  state.fuzzy = searched.fuzzy;
  return scopeRecords(searched.records, state.region, state.risk);
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function loadData() {
  $("#data-state").hidden = false;
  $("#data-state").textContent = "Завантажуємо перелік громад…";
  $("#retry-data").hidden = true;
  try {
    const [raw, manifest] = await Promise.all([
      json("assets/data/data.json"),
      json("assets/derived/geography.json"),
    ]);
    geography = manifest;
    state.records = createRecords(raw, manifest);
    state.lookup = new Map(state.records.map((r) => [r.id, r]));
    fuse = new Fuse(state.records, {
      keys: ["nameKey"],
      threshold: 0.23,
      ignoreLocation: true,
      minMatchCharLength: 3,
    });
    fillFilters();
    $("#search").disabled = false;
    $("#region").disabled = false;
    $("#risk-select").disabled = false;
    $("#data-state").hidden = true;
    $("#search").dataset.ready = "true";
    performance.mark("atlas-search-ready");
    restoreUrl();
    render();
    initMap();
  } catch (error) {
    $("#data-state").textContent =
      "Не вдалося завантажити перелік. Перевірте з’єднання та спробуйте ще раз.";
    $("#retry-data").hidden = false;
    $("#view-count").textContent = "Перелік недоступний";
    $("#map-state").classList.add("failed");
    $("#map-state strong").textContent = "Дані громад поки недоступні";
    $("#map-state>span:not(.loading-mark)").textContent =
      "Повторіть завантаження переліку, щоб побачити класифікації на мапі.";
  }
}
async function loadGeometry() {
  $("#map-state").hidden = false;
  $("#map-state").classList.remove("failed");
  $("#map-state strong").textContent = "Вимальовуємо Україну";
  $("#map-state>span:not(.loading-mark)").textContent =
    "Перелік громад доступний окремо від мапи.";
  $("#retry-map").hidden = true;
  try {
    const response = await fetch("assets/derived/boundaries.topo.json.gz", {
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const decoded = response.body.pipeThrough(new DecompressionStream("gzip"));
    topology = await new Response(decoded).json();
    if (
      topology.type !== "Topology" ||
      !topology.objects?.adm3 ||
      !topology.objects?.adm1
    )
      throw new Error("Invalid geometry");
    initMap();
  } catch (error) {
    $("#map-state").classList.add("failed");
    $("#map-state strong").textContent = "Мапа поки недоступна";
    $("#map-state>span:not(.loading-mark)").textContent =
      "Громади й рівні ризику можна переглянути у списку. Або спробуйте завантажити межі ще раз.";
    $("#retry-map").hidden = false;
  }
}
function initMap() {
  if (!topology || !state.records.length || map) return;
  try {
    map = new AtlasMap(state.records, topology, (id) => selectRecord(id));
    $("#map-state").hidden = true;
    map.filter(currentResults());
    if (state.selected) map.focus(state.selected);
    if (state.view === "list") $("#map-frame").hidden = true;
  } catch (error) {
    $("#map-state").classList.add("failed");
    $("#map-state strong").textContent = "Не вдалося побудувати мапу";
    $("#map-state>span:not(.loading-mark)").textContent =
      "Спробуйте перезавантажити сторінку. Пошук та список залишаються доступними.";
  }
}
function fillFilters() {
  const region = $("#region");
  region.replaceChildren(new Option("Уся Україна", ""));
  [...new Set(state.records.map((r) => r.region))]
    .sort((a, b) => a.localeCompare(b, "uk"))
    .forEach((r) => region.add(new Option(r, r)));
  const risk = $("#risk-select");
  risk.replaceChildren(new Option("Усі рівні", ""));
  LEVELS.forEach((l) => risk.add(new Option(l.name, l.name)));
  risk.add(new Option("Зона відчуження", "special"));
  if (
    state.records.some(
      (r) => !["valid", "special"].includes(r.classification.kind),
    )
  )
    risk.add(new Option("Невизначений рівень", "unknown"));
}
function renderDistribution() {
  const records = scopeRecords(state.records, state.region, "");
  const valid = records.filter((r) => r.classification.kind === "valid");
  $("#record-total").textContent = num(valid.length);
  $("#scope-label").textContent = state.region
    ? `${word(valid.length, "record")} з рівнем у регіоні`
    : `${word(valid.length, "record")} з рівнем ризику`;
  const root = $("#distribution");
  root.replaceChildren();
  LEVELS.forEach((level) => {
    const count = valid.filter((r) => r.risk === level.name).length;
    const b = button("", "risk-row", () =>
      setRisk(state.risk === level.name ? "" : level.name),
    );
    b.style.setProperty("--risk", level.color);
    b.setAttribute("aria-pressed", String(state.risk === level.name));
    b.setAttribute("aria-label", `${level.name}: ${counted(count, "record")}`);
    const s = el("i", "risk-swatch");
    s.setAttribute("aria-hidden", "true");
    const bar = el("span", "risk-bar");
    bar.setAttribute("aria-hidden", "true");
    const fill = el("i");
    fill.style.width = (valid.length ? (count / valid.length) * 100 : 0) + "%";
    bar.append(fill);
    b.append(
      s,
      el("span", "", level.name),
      bar,
      el("span", "risk-count", num(count)),
    );
    root.append(b);
  });
  if (
    records.some((r) => !["valid", "special"].includes(r.classification.kind))
  ) {
    const unknown = records.filter(
      (r) => !["valid", "special"].includes(r.classification.kind),
    ).length;
    root.append(
      button(`Невизначений рівень · ${unknown}`, "outline-button", () =>
        setRisk("unknown"),
      ),
    );
  }
  const special = $("#special-filter");
  special.hidden = !records.some((r) => r.id === SPECIAL_ID);
  special.setAttribute("aria-pressed", String(state.risk === "special"));
}
function render() {
  const results = currentResults(),
    mapped = results.filter((r) => r.mapped),
    special = results.some((r) => r.id === SPECIAL_ID);
  $("#view-scope").textContent = state.region
    ? state.region.replace(" область", "").toLocaleUpperCase("uk")
    : "УКРАЇНА";
  $("#view-count").textContent =
    state.query || state.risk
      ? `${counted(results.length, "result")} · ${num(mapped.length)} на мапі`
      : `${counted(results.filter((r) => r.source).length, "record")}${special ? " + зона відчуження" : ""}`;
  $("#region").value = state.region;
  $("#risk-select").value = state.risk;
  const filters = [
    state.region,
    state.risk === "special"
      ? "Зона відчуження"
      : state.risk === "unknown"
        ? "Невизначений рівень"
        : state.risk,
    state.query ? `«${state.query}»` : null,
  ].filter(Boolean);
  $("#active-filters").hidden = !filters.length;
  $("#filter-description").textContent = filters.join(" · ");
  $("#clear-search").hidden = !state.query;
  renderDistribution();
  if (state.view === "list") renderList(results);
  if (map) map.filter(results);
}
function closeSuggestions() {
  $("#suggestion-panel").hidden = true;
  $("#search").setAttribute("aria-expanded", "false");
  $("#search").removeAttribute("aria-activedescendant");
  activeSuggestion = -1;
}
function renderSuggestions() {
  if (!normalize(state.query)) {
    closeSuggestions();
    return;
  }
  const results = currentResults();
  suggestions = results.slice(0, 7);
  activeSuggestion = -1;
  const list = $("#suggestions");
  list.replaceChildren();
  $("#suggestion-panel").hidden = false;
  $("#search").setAttribute("aria-expanded", "true");
  $("#search").removeAttribute("aria-activedescendant");
  if (!suggestions.length) {
    const li = el(
      "li",
      "suggestion-empty",
      "Нічого не знайдено. Спробуйте частину назви або змініть фільтри.",
    );
    li.setAttribute("role", "presentation");
    list.append(li);
  }
  suggestions.forEach((r, index) => {
    const li = el("li");
    li.id = "suggestion-" + r.id;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    const risk = el("span", "suggestion-risk");
    risk.append(
      swatch(r, "suggestion-dot"),
      el("span", "", r.classification.label),
    );
    li.append(
      el(
        "span",
        "suggestion-name",
        r.name.replace(/ територіальна громада$/, ""),
      ),
      el(
        "span",
        "suggestion-meta",
        r.region + (r.mapped ? "" : " · без меж на мапі"),
      ),
      el("span", "suggestion-code", r.code || "Код у наборі не зазначено"),
      risk,
    );
    li.addEventListener("pointerdown", (e) => e.preventDefault());
    li.addEventListener("click", () => selectRecord(r.id));
    list.append(li);
  });
  $("#all-results").textContent = results.length
    ? `${state.fuzzy ? "Схожі назви · " : ""}Переглянути всі результати (${num(results.length)}) →`
    : "Відкрити список і змінити пошук →";
  announce(
    `${state.fuzzy ? "Схожі назви. " : ""}Знайдено ${counted(results.length, "result")}.`,
  );
}
function setRisk(risk) {
  const focused = document.activeElement
    ?.closest(".risk-row")
    ?.getAttribute("aria-label");
  state.risk = risk;
  state.limit = 40;
  resetSelection(false);
  render();
  closeSuggestions();
  if (map) map.filter(currentResults(), true);
  syncUrl();
  if (focused)
    [...$("#distribution").children]
      .find((b) => b.getAttribute("aria-label") === focused)
      ?.focus({ preventScroll: true });
  announce(
    `Фільтр: ${risk || "усі рівні"}. Результатів: ${currentResults().length}.`,
  );
}
function selectRecord(id, { focus = true, writeUrl = true } = {}) {
  const r = state.lookup.get(id);
  if (!r) return;
  if (state.region && state.region !== r.region) state.region = "";
  if (state.risk && !scopeRecords([r], "", state.risk).length) state.risk = "";
  state.selected = id;
  state.query = "";
  $("#search").value = "";
  closeSuggestions();
  $("#intro").hidden = true;
  $("#overview").hidden = true;
  $("#detail").hidden = false;
  renderDetail(r);
  render();
  if (map) {
    if (state.view === "map") map.focus(id);
    else map.selected = id;
  }
  if (writeUrl) syncUrl(true);
  announce(`${r.name}. ${r.classification.label}. ${r.region}.`);
  if (focus) {
    $("#detail-title").focus({ preventScroll: true });
    if (matchMedia("(max-width:760px)").matches)
      $("#detail").scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
  }
}
function renderDetail(r) {
  const root = $("#detail");
  root.replaceChildren();
  root.dataset.record = r.id;
  const top = el("div", "detail-top");
  top.append(
    button("← До огляду", "detail-back", () => {
      resetSelection();
      $("#search").focus();
    }),
    el("span", "eyebrow", "ОБРАНА ТЕРИТОРІЯ"),
  );
  const title = el("h1", "", shortName(r.name));
  title.id = "detail-title";
  title.tabIndex = -1;
  const risk = el("div", "risk-card");
  risk.style.setProperty("--risk", r.classification.color);
  risk.append(
    el("span", "field-label", "Рівень ризику безпеки в освіті"),
    el("strong", "", r.classification.label),
  );
  if (r.classification.kind === "valid") {
    const scale = el("div", "risk-scale");
    scale.setAttribute("aria-hidden", "true");
    [...LEVELS].reverse().forEach((l) => {
      const n = el("i", l.name === r.risk ? "active" : "");
      n.style.setProperty("--risk", l.color);
      scale.append(n);
    });
    risk.append(
      scale,
      el(
        "p",
        "",
        "Категорія із зафіксованого набору. Не є оцінкою поточної безпеки.",
      ),
    );
  } else
    risk.append(
      el(
        "p",
        "",
        r.classification.kind === "special"
          ? "Зона відчуження не належить до жодного з п’яти рівнів у цьому наборі."
          : r.classification.kind === "invalid"
            ? `У джерелі: «${String(r.risk)}». Значення не відповідає жодному з п’яти класів.`
            : "Даних недостатньо, щоб визначити категорію. Відсутність значення не означає низький ризик.",
      ),
    );
  const dl = el("dl", "detail-meta");
  const region = el("div");
  region.append(el("dt", "", "Регіон"), el("dd", "", r.region));
  dl.append(region);
  const code = el("div");
  code.append(el("dt", "", "Код КАТОТТГ"));
  const dd = el("dd", "code-row");
  if (r.code) {
    const b = button(r.code + " ⧉", "copy-code", () =>
      copy(r.code, "Код скопійовано"),
    );
    b.setAttribute("aria-label", "Скопіювати код " + r.code);
    dd.append(b);
  } else dd.textContent = "Не зазначено";
  code.append(dd);
  dl.append(code);
  root.append(top, title, el("p", "detail-name", r.name), risk, dl);
  if (!r.mapped)
    root.append(
      el(
        "p",
        "detail-note",
        "Межі цієї громади відсутні у вихідній геометрії. Запис збережено в переліку; місце на мапі не підставляється.",
      ),
    );
  if (r.id === SPECIAL_ID)
    root.append(
      el(
        "p",
        "detail-note",
        "Особлива територія позначена штрихуванням. Окремий запис із класифікацією та кодом КАТОТТГ у наборі відсутній.",
      ),
    );
  const actions = el("div", "detail-actions");
  const compare = button(
    state.compare.includes(r.id) ? "✓ Додано до порівняння" : "+ До порівняння",
    "outline-button",
    () => toggleCompare(r.id),
  );
  compare.setAttribute("aria-pressed", String(state.compare.includes(r.id)));
  compare.id = "compare-selected";
  actions.append(
    compare,
    button("Копіювати посилання ↗", "outline-button", () =>
      copy(location.href, "Посилання на громаду скопійовано"),
    ),
  );
  if (r.mapped) {
    const show = button(
      "Показати на мапі ↓",
      "outline-button detail-show-map",
      () => {
        setView("map");
        requestAnimationFrame(() =>
          $("#map-frame").scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "instant"
              : "smooth",
            block: "center",
          }),
        );
      },
    );
    actions.append(show);
  }
  root.append(
    actions,
    el(
      "p",
      "detail-provenance",
      "Файл у репозиторії: 12.01.2026. Офіційну дату чинності цієї версії не встановлено.",
    ),
  );
  root.append(
    button("Джерела та пояснення ↗", "text-button", () => openDialog("about")),
  );
}
function resetSelection(fit = true, writeUrl = true) {
  state.selected = null;
  $("#detail").hidden = true;
  $("#detail").removeAttribute("data-record");
  $("#intro").hidden = false;
  $("#overview").hidden = false;
  if (map) {
    map.resetSelection();
    if (fit) map.fit();
  }
  if (writeUrl) syncUrl();
}
function resetAll() {
  state.query = "";
  state.region = "";
  state.risk = "";
  state.limit = 40;
  $("#search").value = "";
  closeSuggestions();
  resetSelection();
  render();
  syncUrl();
  announce("Фільтри скинуто. Уся Україна.");
}
function setView(view) {
  state.view = view;
  $("#map-view").setAttribute("aria-pressed", String(view === "map"));
  $("#list-view").setAttribute("aria-pressed", String(view === "list"));
  $("#map-frame").hidden = view !== "map";
  $("#list-panel").hidden = view !== "list";
  closeSuggestions();
  render();
  if (view === "map" && map) requestAnimationFrame(() => map.resize());
  syncUrl();
}
function renderList(results) {
  $("#list-title").textContent = state.query
    ? "Результати пошуку"
    : state.region
      ? "Громади регіону"
      : "Громади України";
  const missing = results.filter((r) => !r.mapped).length,
    special = results.filter((r) => r.id === SPECIAL_ID).length;
  $("#list-note").textContent =
    `${state.fuzzy ? "Схожі назви. " : ""}${counted(results.length, "result")}${missing ? ` · ${missing} без меж на мапі` : ""}${special ? " · включно із зоною відчуження" : ""}. Кожен запис можна відкрити або додати до порівняння.`;
  $("#download").disabled = !results.length;
  const root = $("#community-list");
  root.replaceChildren();
  if (!results.length) {
    const empty = el("div", "empty-state");
    empty.append(
      el("span", "empty-symbol", "⌕"),
      el("h3", "", "Громаду не знайдено"),
      el(
        "p",
        "",
        "Перевірте назву або код. Можна скоротити запит чи прибрати фільтри.",
      ),
      button("Скинути пошук і фільтри", "outline-button", () => {
        resetAll();
        $("#search").focus();
      }),
    );
    root.append(empty);
  }
  results.slice(0, state.limit).forEach((r) => {
    const row = el("div", "community-row");
    row.dataset.record = r.id;
    const open = button("", "community-open", () => selectRecord(r.id));
    open.setAttribute(
      "aria-label",
      `${r.name}, ${r.region}, ${r.classification.label}${r.mapped ? "" : ", без меж на мапі"}`,
    );
    const text = el("span");
    text.append(
      el(
        "span",
        "community-title",
        r.name.replace(/ територіальна громада$/, ""),
      ),
      el("span", "community-region", r.region),
      el("span", "community-code", r.code || "Код не зазначено"),
      el(
        "span",
        "community-status",
        r.classification.label + (r.mapped ? "" : " · без меж на мапі"),
      ),
    );
    open.append(swatch(r), text, el("span", "community-arrow", "↗"));
    const added = state.compare.includes(r.id);
    const compare = button(
      added ? "✓ Додано" : "+ Порівняти",
      "outline-button",
      () => toggleCompare(r.id),
    );
    compare.setAttribute("aria-pressed", String(added));
    compare.setAttribute(
      "aria-label",
      (added ? "Прибрати з порівняння: " : "Порівняти: ") +
        r.name +
        ", " +
        r.region,
    );
    row.append(open, compare);
    root.append(row);
  });
  $("#load-more").hidden = results.length <= state.limit;
  $("#load-more").textContent =
    `Показати ще ${Math.min(40, results.length - state.limit)} · ${num(Math.min(state.limit, results.length))} із ${num(results.length)}`;
}
function toggleCompare(id) {
  if (state.compare.includes(id))
    state.compare = state.compare.filter((x) => x !== id);
  else if (state.compare.length < 3) state.compare.push(id);
  else {
    toast("Можна порівняти до трьох громад. Спершу приберіть одну.");
    return;
  }
  updateCompare();
  if (state.selected === id) {
    const b = $("#compare-selected");
    b.textContent = state.compare.includes(id)
      ? "✓ Додано до порівняння"
      : "+ До порівняння";
    b.setAttribute("aria-pressed", String(state.compare.includes(id)));
  }
  if (state.view === "list") {
    renderList(currentResults());
    $("#community-list")
      .querySelector(`[data-record="${id}"] > button`)
      ?.focus({ preventScroll: true });
  }
  announce(`У порівнянні: ${state.compare.length} із 3 територій.`);
}
function updateCompare() {
  $("#compare-tray").hidden = !state.compare.length;
  $("#compare-count").textContent =
    state.compare.length === 1
      ? "Додайте ще одну громаду"
      : `Обрано ${state.compare.length} із 3`;
  $("#open-compare").disabled = state.compare.length < 2;
}
function openComparison() {
  const root = $("#comparison-content");
  root.replaceChildren();
  const grid = el("div", "comparison-grid");
  grid.style.setProperty("--columns", state.compare.length);
  state.compare.forEach((id) => {
    const r = state.lookup.get(id),
      card = el("article", "comparison-card");
    card.style.setProperty("--risk", r.classification.color);
    card.append(
      el("p", "eyebrow", r.region),
      el("h3", "", shortName(r.name)),
      el("strong", "", r.classification.label),
      el("code", "", r.code || "Код не зазначено"),
      el(
        "p",
        "",
        r.mapped
          ? "Межі є у вихідній геометрії"
          : "Межі відсутні у вихідній геометрії",
      ),
      button("Відкрити громаду ↗", "text-button", () => {
        $("#comparison").close();
        selectRecord(id);
      }),
    );
    grid.append(card);
  });
  root.append(
    grid,
    el(
      "p",
      "",
      "Офіційну дату чинності набору не встановлено. Кількість шкіл, учнів і зміни в часі у цих даних відсутні.",
    ),
  );
  openDialog("comparison", $("#open-compare"));
}
async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    const field = el("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.top = "-10000px";
    document.body.append(field);
    field.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    field.remove();
    toast(
      ok
        ? message
        : "Не вдалося скопіювати. Виділіть текст або скопіюйте адресу сторінки.",
    );
  }
}
function openDialog(id, opener = document.activeElement) {
  closeSuggestions();
  opener?.focus({ preventScroll: true });
  $("#" + id).showModal();
}
function syncUrl(push = false) {
  const params = new URLSearchParams();
  if (state.selected)
    params.set(
      "hromada",
      state.lookup.get(state.selected)?.code || state.selected,
    );
  if (state.region) params.set("region", state.region);
  if (state.risk) params.set("risk", state.risk);
  if (state.query) params.set("q", state.query);
  if (state.view !== "map") params.set("view", state.view);
  const hash = params.toString();
  history[push ? "pushState" : "replaceState"](
    null,
    "",
    location.pathname + location.search + (hash ? "#" + hash : ""),
  );
}
function restoreUrl() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.query = p.get("q")?.slice(0, 180) || "";
  state.region = state.records.some((r) => r.region === p.get("region"))
    ? p.get("region")
    : "";
  state.risk = [...LEVELS.map((l) => l.name), "special", "unknown"].includes(
    p.get("risk"),
  )
    ? p.get("risk")
    : "";
  state.view = p.get("view") === "list" ? "list" : "map";
  $("#search").value = state.query;
  const code = p.get("hromada"),
    r = state.records.find((r) => r.id === code || r.code === code);
  if (r) selectRecord(r.id, { focus: false, writeUrl: false });
  else if (code) toast("Громаду з цього посилання не знайдено у наборі.");
  setView(state.view);
}

$("#search").addEventListener("input", () => {
  state.query = $("#search").value.slice(0, 180);
  state.limit = 40;
  render();
  renderSuggestions();
  syncUrl();
});
$("#search").addEventListener("focus", () => {
  if (state.query) renderSuggestions();
});
$("#search").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSuggestions();
    event.stopPropagation();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
  if ($("#suggestion-panel").hidden && event.key !== "Enter")
    renderSuggestions();
  if (event.key === "Enter") {
    event.preventDefault();
    if (activeSuggestion >= 0 && suggestions[activeSuggestion])
      selectRecord(suggestions[activeSuggestion].id);
    else if (suggestions.length === 1) selectRecord(suggestions[0].id);
    else setView("list");
    return;
  }
  if (!suggestions.length) return;
  event.preventDefault();
  activeSuggestion =
    (activeSuggestion +
      (event.key === "ArrowDown" ? 1 : -1) +
      suggestions.length) %
    suggestions.length;
  $("#suggestions")
    .querySelectorAll("[role=option]")
    .forEach((n, i) =>
      n.setAttribute("aria-selected", String(i === activeSuggestion)),
    );
  const option = $("#suggestion-" + suggestions[activeSuggestion].id);
  $("#search").setAttribute("aria-activedescendant", option.id);
  option.scrollIntoView({ block: "nearest" });
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".search-area")) closeSuggestions();
});
document.addEventListener("focusin", (event) => {
  if (!event.target.closest(".search-area")) closeSuggestions();
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "/" &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.target.matches("input,textarea,select") &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    $("#search").focus();
  }
});
$("#clear-search").addEventListener("click", () => {
  state.query = "";
  $("#search").value = "";
  closeSuggestions();
  render();
  syncUrl();
  $("#search").focus();
});
$("#all-results").addEventListener("click", () => setView("list"));
$("#region").addEventListener("change", () => {
  state.region = $("#region").value;
  state.limit = 40;
  resetSelection(false);
  render();
  closeSuggestions();
  if (map) map.filter(currentResults(), true);
  syncUrl();
  announce(
    `${state.region || "Уся Україна"}. ${counted(currentResults().length, "result")}.`,
  );
});
$("#risk-select").addEventListener("change", () =>
  setRisk($("#risk-select").value),
);
$("#special-filter").addEventListener("click", () =>
  setRisk(state.risk === "special" ? "" : "special"),
);
$("#reset-filters").addEventListener("click", resetAll);
$("#map-view").addEventListener("click", () => setView("map"));
$("#list-view").addEventListener("click", () => setView("list"));
$("#fit-map").addEventListener("click", () => {
  resetAll();
  if (map) map.fit();
});
$("#zoom-in").addEventListener("click", () => map?.zoom(0.75));
$("#zoom-out").addEventListener("click", () => map?.zoom(-0.75));
$("#load-more").addEventListener("click", () => {
  const previous = state.limit;
  state.limit += 40;
  renderList(currentResults());
  $("#community-list")
    .children[previous]?.querySelector("button")
    ?.focus({ preventScroll: true });
});
$("#open-compare").addEventListener("click", openComparison);
$("#clear-compare").addEventListener("click", () => {
  state.compare = [];
  updateCompare();
  if (state.selected) renderDetail(state.lookup.get(state.selected));
  if (state.view === "list") renderList(currentResults());
  $("#search").focus();
  announce("Порівняння очищено.");
});
$("#download").addEventListener("click", () => {
  const url = URL.createObjectURL(
    new Blob([exportCsv(currentResults())], { type: "text/csv;charset=utf-8" }),
  );
  const link = el("a");
  link.href = url;
  link.download = "osvitnii-atlas-snapshot-2026-01-records.csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(
    `Завантажено ${counted(currentResults().length, "record")}. Дата чинності — не встановлена.`,
  );
});
$("#retry-data").addEventListener("click", loadData);
$("#retry-map").addEventListener("click", loadGeometry);
document
  .querySelectorAll("[data-open]")
  .forEach((b) =>
    b.addEventListener("click", () => openDialog(b.dataset.open, b)),
  );
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog
    .querySelector("[data-close]")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        dialog.close();
    }
  });
});
for (const l of [...LEVELS].reverse()) {
  const item = el("span", "legend-item");
  item.style.setProperty("--risk", l.color);
  item.append(el("i"), el("span", "", l.name));
  $("#compact-legend").append(item);
}
for (const l of [...LEVELS].reverse()) {
  const item = el("div", "about-level");
  item.style.setProperty("--risk", l.color);
  item.append(el("i"), el("span", "", l.name));
  $("#about-levels").append(item);
}
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.view === "map") map?.resize();
  }, 150);
});
$(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  $("#search").focus();
});
window.addEventListener("hashchange", () => {
  if (state.records.length) {
    resetSelection(false, false);
    restoreUrl();
    render();
  }
});
loadData();
loadGeometry();
