const KMB = "https://data.etabus.gov.hk/v1/transport/kmb";
const CTB = "https://rt.data.gov.hk/v2/transport/citybus";
const STORAGE_KEY = "hk-bus-eta-watches";
const REFRESH_MS = 30000;

const DEFAULT_WATCHES = [
  {
    id: "ctb-796p-kinming",
    co: "CTB",
    route: "796P",
    stopId: "001821",
    stopName: "健明邨（景嶺路）",
    destName: "尖沙咀東",
    dir: "O",
    serviceType: "1",
  },
  {
    id: "kmb-290a-choiming",
    co: "KMB",
    route: "290A",
    stopId: "21AD38E162AE7E57",
    stopName: "彩明總站（鄰近健明邨）",
    destName: "荃灣西站",
    dir: "O",
    serviceType: "1",
  },
];

const cardsEl = document.getElementById("cards");
const statusEl = document.getElementById("status");
const defaultBar = document.getElementById("default-bar");
const lookupMsg = document.getElementById("lookup-msg");
const dirSelect = document.getElementById("dir");
const stopSelect = document.getElementById("stop");
const dirWrap = document.getElementById("dir-wrap");
const stopWrap = document.getElementById("stop-wrap");
const lookupResults = document.getElementById("lookup-results");

let directions = [];
let directionStops = [];
let timer = null;
let refreshSeq = 0;

function watchId(item) {
  return `${item.co}-${item.route}-${item.stopId}-${item.dir}`.toLowerCase();
}

function loadWatches() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_WATCHES));
      return DEFAULT_WATCHES.map((item) => ({ ...item }));
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_WATCHES.map((item) => ({ ...item }));
  } catch {
    return DEFAULT_WATCHES.map((item) => ({ ...item }));
  }
}

function saveWatches(watches) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(watches));
}

function sameStop(a, b) {
  return (
    a.co === b.co &&
    String(a.route).toUpperCase() === String(b.route).toUpperCase() &&
    a.stopId === b.stopId &&
    a.dir === b.dir
  );
}

function hasWatch(itemOrId) {
  const watches = loadWatches();
  if (typeof itemOrId === "string") {
    const def = DEFAULT_WATCHES.find((row) => row.id === itemOrId);
    return watches.some((row) => row.id === itemOrId || (def && sameStop(row, def)));
  }
  return watches.some((row) => row.id === itemOrId.id || sameStop(row, itemOrId));
}

function addWatch(item) {
  const watches = loadWatches();
  if (hasWatch(item)) return false;
  const id = item.id || watchId(item);
  watches.push({ ...item, id });
  saveWatches(watches);
  return true;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchJsonOrNull(url) {
  try {
    return await fetchJson(url);
  } catch {
    return null;
  }
}

function formatEta(iso) {
  if (!iso) return { label: "暫無資料", clock: "—" };
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return { label: "暫無資料", clock: "—" };
  const mins = Math.round((when.getTime() - Date.now()) / 60000);
  const clock = when.toLocaleTimeString("zh-HK", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (mins <= 0) return { label: "即將到站", clock };
  return { label: `${mins} 分鐘`, clock };
}

function pickEtas(rows, watch, limit = 3) {
  return (rows || [])
    .filter((row) => {
      const sameRoute = String(row.route).toUpperCase() === String(watch.route).toUpperCase();
      const sameDir = !watch.dir || row.dir === watch.dir;
      return sameRoute && sameDir && row.eta;
    })
    .sort((a, b) => new Date(a.eta) - new Date(b.eta) || (a.eta_seq || 0) - (b.eta_seq || 0))
    .slice(0, limit);
}

async function fetchWatchEtas(watch) {
  if (watch.co === "CTB") {
    const json = await fetchJson(`${CTB}/eta/ctb/${watch.stopId}/${watch.route}`);
    return pickEtas(json.data, watch);
  }
  const json = await fetchJson(
    `${KMB}/eta/${watch.stopId}/${watch.route}/${watch.serviceType || "1"}`
  );
  return pickEtas(json.data, watch);
}

function etaListHtml(etas, error) {
  if (error) return `<p class="error">暫時未能取得班次（${error}）</p>`;
  if (!etas.length) return `<p class="empty">暫無班次預測</p>`;
  return `<ul class="etas">${etas
    .map((row) => {
      const { label, clock } = formatEta(row.eta);
      const remark = row.rmk_tc ? ` · ${row.rmk_tc}` : "";
      return `<li><span class="mins">${label}</span><span class="clock">${clock}${remark}</span></li>`;
    })
    .join("")}</ul>`;
}

function renderCard(watch, etas, error) {
  const coLabel = watch.co === "CTB" ? "城巴" : "九巴";
  const coClass = watch.co === "CTB" ? "ctb" : "kmb";
  return `<article class="card" data-id="${watch.id}">
    <div class="card-head">
      <div>
        <span class="badge ${coClass}">${coLabel}</span>
        <div class="route">${watch.route}</div>
        <p class="meta">${watch.stopName}<br />往 ${watch.destName}</p>
      </div>
      <button type="button" class="remove" data-remove="${watch.id}">移除</button>
    </div>
    ${etaListHtml(etas, error)}
  </article>`;
}

function renderDefaultBar() {
  const missing = DEFAULT_WATCHES.filter((item) => !hasWatch(item));
  if (!missing.length) {
    defaultBar.hidden = true;
    defaultBar.innerHTML = "";
    return;
  }
  defaultBar.hidden = false;
  defaultBar.innerHTML = `<p>已移除的預設路線可加回：</p>
    ${missing
      .map(
        (item) =>
          `<button type="button" class="chip" data-restore="${item.id}">加回 ${item.route} · ${item.stopName}</button>`
      )
      .join("")}`;
}

async function refresh() {
  const seq = ++refreshSeq;
  const watches = loadWatches();
  renderDefaultBar();
  if (!watches.length) {
    if (seq !== refreshSeq) return;
    cardsEl.innerHTML = `<p class="empty">尚未收藏路線。可加回預設，或在下面即時查詢。</p>`;
    statusEl.textContent = "沒有收藏";
    return;
  }
  statusEl.textContent = "更新中…";
  const results = await Promise.all(
    watches.map(async (watch) => {
      try {
        return { watch, etas: await fetchWatchEtas(watch), error: null };
      } catch (err) {
        return { watch, etas: [], error: err.message || "網絡錯誤" };
      }
    })
  );
  if (seq !== refreshSeq) return;
  cardsEl.innerHTML = results.map((item) => renderCard(item.watch, item.etas, item.error)).join("");
  const now = new Date().toLocaleTimeString("zh-HK", { hour12: false });
  statusEl.textContent = `已更新 ${now} · 每 30 秒自動刷新`;
}

function startTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(refresh, REFRESH_MS);
}

async function kmbStopName(stopId) {
  const json = await fetchJsonOrNull(`${KMB}/stop/${stopId}`);
  return json?.data?.name_tc || stopId;
}

async function ctbStopName(stopId) {
  const json = await fetchJsonOrNull(`${CTB}/stop/${stopId}`);
  return json?.data?.name_tc || stopId;
}

function dirLabel(item, list) {
  const base = `${item.origName} → ${item.destName}`;
  const clashes = (list || []).filter(
    (row) => row.origName === item.origName && row.destName === item.destName
  );
  if (clashes.length > 1) {
    return `${base}（${item.co === "CTB" ? "城巴" : "九巴"}）`;
  }
  return base;
}

async function loadDirections() {
  const route = document.getElementById("route").value.trim().toUpperCase();
  lookupMsg.textContent = "";
  lookupResults.innerHTML = "";
  directions = [];
  directionStops = [];
  dirSelect.innerHTML = `<option value="">載入中…</option>`;
  dirSelect.disabled = true;
  stopSelect.innerHTML = `<option value="">先選方向</option>`;
  stopSelect.disabled = true;
  stopWrap.hidden = true;
  dirWrap.hidden = false;

  if (!route) {
    lookupMsg.textContent = "請先輸入路線號碼。";
    dirWrap.hidden = true;
    return;
  }

  document.getElementById("route").value = route;

  const [kmbOut, kmbIn, ctbInfo] = await Promise.all([
    fetchJsonOrNull(`${KMB}/route/${route}/outbound/1`),
    fetchJsonOrNull(`${KMB}/route/${route}/inbound/1`),
    fetchJsonOrNull(`${CTB}/route/ctb/${route}`),
  ]);

  if (kmbOut?.data?.route) {
    directions.push({
      co: "KMB",
      route,
      dir: "O",
      serviceType: String(kmbOut.data.service_type || "1"),
      origName: kmbOut.data.orig_tc,
      destName: kmbOut.data.dest_tc,
    });
  }
  if (kmbIn?.data?.route) {
    directions.push({
      co: "KMB",
      route,
      dir: "I",
      serviceType: String(kmbIn.data.service_type || "1"),
      origName: kmbIn.data.orig_tc,
      destName: kmbIn.data.dest_tc,
    });
  }
  if (ctbInfo?.data?.route) {
    directions.push({
      co: "CTB",
      route,
      dir: "O",
      serviceType: "1",
      origName: ctbInfo.data.orig_tc,
      destName: ctbInfo.data.dest_tc,
    });
    directions.push({
      co: "CTB",
      route,
      dir: "I",
      serviceType: "1",
      origName: ctbInfo.data.dest_tc,
      destName: ctbInfo.data.orig_tc,
    });
  }

  if (!directions.length) {
    dirSelect.innerHTML = `<option value="">找不到路線</option>`;
    lookupMsg.textContent = "找不到這條線，請確認路線號碼。";
    return;
  }

  dirSelect.innerHTML = `<option value="">請選擇方向</option>${directions
    .map((item, index) => `<option value="${index}">${dirLabel(item, directions)}</option>`)
    .join("")}`;
  dirSelect.disabled = false;
  lookupMsg.textContent = `找到 ${directions.length} 個方向，請選擇。`;
}

async function loadStopsForDirection() {
  const picked = directions[Number(dirSelect.value)];
  lookupResults.innerHTML = "";
  directionStops = [];
  stopWrap.hidden = true;
  if (!picked) {
    stopSelect.innerHTML = `<option value="">先選方向</option>`;
    stopSelect.disabled = true;
    return;
  }

  stopWrap.hidden = false;
  stopSelect.disabled = true;
  stopSelect.innerHTML = `<option value="">載入車站中…</option>`;
  lookupMsg.textContent = "正在載入車站…";

  try {
    let rows = [];
    if (picked.co === "CTB") {
      const path = picked.dir === "O" ? "outbound" : "inbound";
      const json = await fetchJson(`${CTB}/route-stop/ctb/${picked.route}/${path}`);
      rows = json.data || [];
      directionStops = await Promise.all(
        rows.map(async (row, seq) => ({
          ...picked,
          stopId: row.stop,
          seq: Number(row.seq) || seq + 1,
          stopName: await ctbStopName(row.stop),
        }))
      );
    } else {
      const path = picked.dir === "O" ? "outbound" : "inbound";
      const json = await fetchJson(
        `${KMB}/route-stop/${picked.route}/${path}/${picked.serviceType || "1"}`
      );
      rows = json.data || [];
      directionStops = await Promise.all(
        rows.map(async (row, seq) => ({
          ...picked,
          stopId: row.stop,
          seq: Number(row.seq) || seq + 1,
          serviceType: String(row.service_type || picked.serviceType || "1"),
          stopName: await kmbStopName(row.stop),
        }))
      );
    }

    if (!directionStops.length) {
      stopSelect.innerHTML = `<option value="">沒有車站</option>`;
      lookupMsg.textContent = "這個方向沒有車站資料。";
      return;
    }

    stopSelect.innerHTML = `<option value="">請選擇車站</option>${directionStops
      .map(
        (item, index) =>
          `<option value="${index}">${index + 1}. ${item.stopName}</option>`
      )
      .join("")}`;
    stopSelect.disabled = false;
    lookupMsg.textContent = `請選擇車站，之後會顯示當站及前 2 / 後 2 站。`;
  } catch (err) {
    stopSelect.innerHTML = `<option value="">載入失敗</option>`;
    lookupMsg.textContent = `載入車站失敗：${err.message}`;
  }
}

function nearbyWindow(stops, index) {
  const start = Math.max(0, index - 2);
  const end = Math.min(stops.length, index + 3);
  return stops.slice(start, end).map((stop, i) => {
    const abs = start + i;
    return { ...stop, abs, offset: abs - index, isCurrent: abs === index };
  });
}

function offsetLabel(offset) {
  if (offset === 0) return "當站";
  if (offset < 0) return `前 ${Math.abs(offset)} 站`;
  return `後 ${offset} 站`;
}

async function showLookupResults() {
  const index = Number(stopSelect.value);
  lookupResults.innerHTML = "";
  if (!Number.isInteger(index) || !directionStops[index]) return;

  const windowStops = nearbyWindow(directionStops, index);
  lookupMsg.textContent = "查詢到站時間中…";
  lookupResults.innerHTML = `<p class="empty">載入 5 個鄰近車站…</p>`;

  const results = await Promise.all(
    windowStops.map(async (stop) => {
      const watch = {
        co: stop.co,
        route: stop.route,
        stopId: stop.stopId,
        dir: stop.dir,
        serviceType: stop.serviceType,
      };
      try {
        return { stop, etas: await fetchWatchEtas(watch), error: null };
      } catch (err) {
        return { stop, etas: [], error: err.message || "網絡錯誤" };
      }
    })
  );

  const current = results.find((item) => item.stop.isCurrent);
  const neighbors = results
    .filter((item) => !item.stop.isCurrent)
    .sort((a, b) => a.stop.offset - b.stop.offset);

  if (!current) {
    lookupResults.innerHTML = `<p class="empty">找不到當站資料。</p>`;
    return;
  }

  const saved = hasWatch(current.stop);
  const neighborRows = neighbors
    .map(({ stop, etas, error }) => {
      const first = etas[0];
      const time = error ? "查詢失敗" : first ? formatEta(first.eta).label : "暫無班次";
      return `<li>
        <span class="near-tag">${offsetLabel(stop.offset)}</span>
        <span class="near-name">${stop.stopName}</span>
        <span class="near-time">${time}</span>
      </li>`;
    })
    .join("");

  lookupResults.innerHTML = `<article class="card neighbor current compact">
    <div class="card-head">
      <div>
        <span class="badge offset">當站</span>
        <div class="stop-name">${current.stop.stopName}</div>
        <p class="meta">${current.stop.route} 往 ${current.stop.destName}</p>
      </div>
      <button type="button" class="ghost save-stop" data-save-index="${current.stop.abs}" ${
        saved ? "disabled" : ""
      }>${saved ? "已收藏" : "加入收藏"}</button>
    </div>
    ${etaListHtml(current.etas, current.error)}
    ${
      neighbors.length
        ? `<div class="nearby">
            <p class="nearby-title">前 2 / 後 2 站（各 1 班）</p>
            <ul class="nearby-list">${neighborRows}</ul>
          </div>`
        : ""
    }
  </article>`;
  lookupMsg.textContent = "當站在最上；前後站各顯示 1 個時間。";
}

document.getElementById("load-dirs").addEventListener("click", loadDirections);
document.getElementById("route").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadDirections();
  }
});
dirSelect.addEventListener("change", loadStopsForDirection);
stopSelect.addEventListener("change", showLookupResults);

defaultBar.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-restore]");
  if (!btn) return;
  const item = DEFAULT_WATCHES.find((row) => row.id === btn.getAttribute("data-restore"));
  if (item) addWatch(item);
  refresh();
});

cardsEl.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-remove]");
  if (!btn) return;
  saveWatches(loadWatches().filter((item) => item.id !== btn.getAttribute("data-remove")));
  refresh();
});

lookupResults.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-save-index]");
  if (!btn) return;
  const stop = directionStops[Number(btn.getAttribute("data-save-index"))];
  if (!stop) return;
  addWatch(stop);
  btn.textContent = "已收藏";
  btn.disabled = true;
  refresh();
});

document.getElementById("refresh-btn").addEventListener("click", refresh);

refresh();
startTimer();
