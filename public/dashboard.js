const THEME_KEY = "dash_theme_v1";
const LIMIT = 1500000;

let ME = null;
let ALL_ROWS = [];
let USERS = [];
let chart = null;
let CHART_TAB = "monthly";
const SPARKS = new Map();
let currentEdit = null; // sale row being edited

function money(n){
  return new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(n)||0);
}
function pct(n){
  return new Intl.NumberFormat("pt-BR",{minimumFractionDigits:2, maximumFractionDigits:2}).format(Number(n)||0) + "%";
}
function parseNumber(s){
  if(s===null||s===undefined) return 0;
  if(typeof s === "number") return Number.isFinite(s) ? s : 0;
  const cleaned = String(s).trim().replace(/\./g,"").replace(",",".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function clampCredito(v){
  const n = Number(v)||0;
  return Math.min(LIMIT, Math.max(0, n));
}
function debounce(fn, wait=250){
  let t=null;
  return (...args)=>{
    clearTimeout(t);
    t=setTimeout(()=>fn(...args), wait);
  };
}

async function api(path, opts={}){
  const res = await fetch(path, {
    credentials:"include",
    headers: { "Content-Type":"application/json" , ...(opts.headers||{}) },
    ...opts
  });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data.error || "Erro");
  return data;
}

/* ============ THEME ============ */
function setTheme(mode){
  document.body.dataset.theme = mode;
  localStorage.setItem(THEME_KEY, mode);
  const bt = document.getElementById("btnTheme");
  if(bt) bt.textContent = (mode==="dark") ? "☀️" : "🌙";
}
function initTheme(){
  const saved = localStorage.getItem(THEME_KEY) || "light";
  setTheme(saved);
  const bt = document.getElementById("btnTheme");
  if(!bt) return;
  bt.addEventListener("click", ()=>{
    setTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
  });
}

/* ============ COMPUTATIONS ============ */
function baseLabel(b){ return b==="venda" ? "Venda" : "Crédito"; }

function badgeSeguro(v){
  if(v==="Sim") return `<span class="badge" style="background: rgba(37,99,235,.18); border:1px solid rgba(37,99,235,.35);"><span class="dot" style="background: var(--accent)"></span>Sim</span>`;
  return `<span class="badge" style="background: rgba(148,163,184,.12); border:1px solid rgba(148,163,184,.25);"><span class="dot" style="background: var(--muted)"></span>Não</span>`;
}

function saleComputed(r){
  const credito = clampCredito((r.cotas||0) * (r.valorUnit||0));
  const base = (r.baseComissao==="venda") ? (r.valorVenda||0) : credito;
  const taxaPct = (r.taxaPct||0);
  const comissaoTotal = base * (taxaPct/100);
  const parcelaValor = comissaoTotal / 6;

  const parcelas = Array.isArray(r.parcelas) ? r.parcelas : [];
  let pagoN=0, pendenteN=0, atrasadoN=0;
  for(const p of parcelas){
    if(p==="Pago") pagoN++;
    else if(p==="Atrasado") atrasadoN++;
    else pendenteN++;
  }
  return { credito, base, comissaoTotal, parcelaValor, pagoN, pendenteN, atrasadoN };
}

function rowMatchesStatus(r, status){
  if(status==="todos") return true;
  const parcelas = Array.isArray(r.parcelas) ? r.parcelas : [];
  return parcelas.some(p => p===status);
}

function monthKey(dateStr){
  // expects YYYY-MM-DD
  if(!dateStr || typeof dateStr !== "string" || dateStr.length < 7) return "—";
  return dateStr.slice(0,7);
}

/* ============ LOADERS ============ */
async function loadMe(){
  const me = await api("/api/me");
  ME = me;
  document.getElementById("meLine").textContent = `Logado como: ${me.name} • Perfil: ${me.role}`;
  document.getElementById("adminExtras").style.display = (me.role === "admin") ? "block" : "none";

  // ranking only for admin
  document.getElementById("rankingSection").style.display = (me.role === "admin") ? "block" : "none";

  // consultor filter only for admin
  document.getElementById("fConsultorWrap").style.display = (me.role === "admin") ? "block" : "none";
  document.getElementById("editAdminBlock").style.display = (me.role === "admin") ? "block" : "none";

  // consultor chart tab only for admin (evita desmotivação)
  const tabC = document.getElementById("tabConsultors");
  if(tabC) tabC.style.display = (me.role === "admin") ? "inline-flex" : "none";
  if(me.role !== "admin" && CHART_TAB === "consultors") CHART_TAB = "monthly";
}


async function loadUsersIfAdmin(){
  if(!ME || ME.role !== "admin") return;
  const data = await api("/api/users");
  USERS = data.users || [];
  const sel = document.getElementById("fConsultor");
  sel.innerHTML = `<option value="todos" selected>Todos</option>` + USERS
    .map(u => `<option value="${escapeHtml(u.name)}">${escapeHtml(u.name)}</option>`)
    .join("");
}

async function loadSales(){
  const data = await api("/api/sales");
  ALL_ROWS = data.rows || [];
  applyAndRender();
}

/* ============ FILTERS ============ */
function readFilters(){
  const from = document.getElementById("fDateFrom").value || "";
  const to = document.getElementById("fDateTo").value || "";
  const status = document.getElementById("fStatus").value;
  const search = (document.getElementById("fSearch").value || "").trim().toLowerCase();
  const consultor = (ME && ME.role==="admin") ? document.getElementById("fConsultor").value : "todos";
  return { from, to, status, search, consultor };
}

function applyFilters(rows){
  const { from, to, status, search, consultor } = readFilters();

  return rows.filter(r=>{
    // date
    if(from && r.data < from) return false;
    if(to && r.data > to) return false;

    // status
    if(!rowMatchesStatus(r, status)) return false;

    // consultor
    if(consultor !== "todos"){
      if((r.consultorName||"") !== consultor) return false;
    }

    // search
    if(search){
      const hay = `${r.cliente||""} ${r.produto||""}`.toLowerCase();
      if(!hay.includes(search)) return false;
    }
    return true;
  });
}

function clearFilters(){
  document.getElementById("fDateFrom").value = "";
  document.getElementById("fDateTo").value = "";
  document.getElementById("fStatus").value = "todos";
  document.getElementById("fSearch").value = "";
  if(ME && ME.role==="admin") document.getElementById("fConsultor").value = "todos";
  applyAndRender();
}

/* ============ RENDER ============ */
function renderKpis(rows){
  let total = 0;
  let pago = 0;
  let pendente = 0;
  let atrasado = 0;

  for(const r of rows){
    const c = saleComputed(r);
    total += c.comissaoTotal;
    pago += c.parcelaValor * c.pagoN;
    pendente += c.parcelaValor * c.pendenteN;
    atrasado += c.parcelaValor * c.atrasadoN;
  }

  document.getElementById("kpiTotal").textContent = money(total);
  const kv = document.getElementById("kpiVendas");
  if(kv) kv.textContent = `${rows.length} venda(s) no filtro`;

  document.getElementById("kpiPago").textContent = money(pago);
  document.getElementById("kpiPagoPct").textContent = total>0 ? `${pct((pago/total)*100)} do total` : "—";

  document.getElementById("kpiPendente").textContent = money(pendente);
  document.getElementById("kpiPendenteInfo").textContent = total>0 ? `${pct((pendente/total)*100)} do total` : "—";

  document.getElementById("kpiAtrasado").textContent = money(atrasado);
  document.getElementById("kpiAtrasadoInfo").textContent = total>0 ? `${pct((atrasado/total)*100)} do total` : "—";

  // quick summary
  const ticket = rows.length ? (total/rows.length) : 0;
  document.getElementById("quickTicket").textContent = money(ticket);

  // top consultor
  const agg = aggregateByConsultor(rows);
  const top = agg.sort((a,b)=> (b.pago - a.pago) || (b.total - a.total))[0];
  document.getElementById("quickTop").textContent = top ? `${top.consultor}` : "—";
  document.getElementById("quickTopSub").textContent = top ? `${money(top.pago)} pago • ${top.vendas} venda(s)` : "—";

  const crit = agg.reduce((acc,x)=> acc + (x.atrasado>0 ? 1 : 0), 0);
  document.getElementById("quickCriticos").textContent = String(crit);
}

function aggregateByConsultor(rows){
  const by = new Map();
  for(const r of rows){
    const key = r.consultorName || "—";
    if(!by.has(key)){
      by.set(key, { consultor:key, vendas:0, total:0, pago:0, pendente:0, atrasado:0 });
    }
    const agg = by.get(key);
    agg.vendas += 1;

    const c = saleComputed(r);
    agg.total += c.comissaoTotal;
    agg.pago += c.parcelaValor * c.pagoN;
    agg.pendente += c.parcelaValor * c.pendenteN;
    agg.atrasado += c.parcelaValor * c.atrasadoN;
  }
  return Array.from(by.values());
}

function renderRanking(rows){
  if(!ME || ME.role !== "admin") return;

  const list = aggregateByConsultor(rows);
  list.sort((a,b)=> (b.pago - a.pago) || (b.total - a.total));

  const tbody = document.getElementById("rankBody");
  const max = list[0]?.pago || 1;


  // podium (top 3)
  try{
    const p1 = list[0], p2 = list[1], p3 = list[2];
    const setPod = (id, item)=>{
      const el = document.getElementById(id);
      if(!el) return;
      const nameEl = el.querySelector(".podium-name");
      const metEl = el.querySelector(".podium-metric");
      if(!item){
        if(nameEl) nameEl.textContent = "—";
        if(metEl) metEl.textContent = "—";
        return;
      }
      if(nameEl) nameEl.textContent = item.consultor;
      if(metEl) metEl.textContent = `${money(item.pago)} pago • ${item.vendas} venda(s)`;
    };
    setPod("podium1", p1);
    setPod("podium2", p2);
    setPod("podium3", p3);
  }catch(e){}

  tbody.innerHTML = list.map((r, idx)=>{
    const medal = idx===0 ? "🥇" : idx===1 ? "🥈" : idx===2 ? "🥉" : String(idx+1);
    const barW = Math.max(4, Math.round((r.pago/max)*100));
    return `
      <tr>
        <td style="font-weight:900;">${medal}</td>
        <td>
          <div style="font-weight:900;">${escapeHtml(r.consultor)}</div>
          <div class="muted text-xs">
            <div class="bar mt-1" style="height:8px; background: rgba(148,163,184,.16); border-radius:999px; overflow:hidden;">
              <div style="height:100%; width:${barW}%; background: rgba(37,99,235,.65);"></div>
            </div>
          </div>
        </td>
        <td>${r.vendas}</td>
        <td>${money(r.total)}</td>
        <td style="color:var(--good); font-weight:900;">${money(r.pago)}</td>
      </tr>`;
  }).join("");
}


function renderChart(rows){
  const canvas = document.getElementById("chartComissoes");
  if(!canvas || !window.Chart) return;

  // destroy previous
  if(chart){ try{ chart.destroy(); }catch(e){} chart = null; }

  const tab = CHART_TAB || "monthly";

  if(tab === "status"){
    // Donut: distribution by status (commission)
    let pago=0, pend=0, atra=0;
    for(const r of rows){
      const c = saleComputed(r);
      if((r.status||"") === "Pago") pago += c.comissao;
      else if((r.status||"") === "Atrasado") atra += c.comissao;
      else pend += c.comissao;
    }
    chart = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: ["Pago","Pendente","Atrasado"],
        datasets: [{ label: "Comissão", data: [pago, pend, atra] }]
      },
      options: {
        responsive: true,
        animation: { duration: 650 },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx)=> `${ctx.label}: ${money(ctx.raw||0)}`
            }
          },
          legend: { position: "bottom" }
        },
        onClick: (evt, els)=>{
          if(!els || !els.length) return;
          const idx = els[0].index;
          const map = ["Pago","Pendente","Atrasado"];
          document.getElementById("fStatus").value = map[idx] || "todos";
          applyAndRender();
        }
      }
    });
    return;
  }

  if(tab === "consultors"){
    // Horizontal bars: top consultors by paid commission
    const m = new Map();
    for(const r of rows){
      const name = (r.consultorName || r.consultor || "—").trim();
      if(!m.has(name)) m.set(name, { consultor: name, pago:0, total:0, vendas:0 });
      const o = m.get(name);
      const c = saleComputed(r);
      o.total += c.comissao;
      if((r.status||"") === "Pago") o.pago += c.comissao;
      o.vendas += 1;
    }
    const arr = Array.from(m.values()).sort((a,b)=> b.pago - a.pago).slice(0, 10);
    const labels = arr.map(x=> x.consultor);
    const data = arr.map(x=> Math.round(x.pago*100)/100);

    chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{ label:"Pago", data }]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        animation: { duration: 650 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks:{ label:(ctx)=> `${money(ctx.raw||0)}` } }
        },
        scales: {
          x: { ticks: { callback: (v)=> money(v) } }
        },
        onClick: (evt, els)=>{
          if(!els || !els.length) return;
          const idx = els[0].index;
          const name = labels[idx];
          // Only admin can filter by consultor selector
          if(ME && ME.role === "admin"){
            document.getElementById("fConsultor").value = name;
            applyAndRender();
          }
        }
      }
    });
    return;
  }

  // Default: monthly stacked bars (Pago/Pendente/Atrasado)
  const byMonth = new Map();
  for(const r of rows){
    const key = monthKey(r.data);
    if(!byMonth.has(key)){
      byMonth.set(key, { month:key, pago:0, pendente:0, atrasado:0, total:0 });
    }
    const c = saleComputed(r);
    const o = byMonth.get(key);
    o.total += c.comissao;
    if((r.status||"") === "Pago") o.pago += c.comissao;
    else if((r.status||"") === "Atrasado") o.atrasado += c.comissao;
    else o.pendente += c.comissao;
  }

  const arr = Array.from(byMonth.values()).sort((a,b)=> a.month.localeCompare(b.month));
  const labels = arr.map(x=> x.month);
  const dsPago = arr.map(x=> x.pago);
  const dsPend = arr.map(x=> x.pendente);
  const dsAtra = arr.map(x=> x.atrasado);

  chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label:"Pago", data: dsPago, stack:"s" },
        { label:"Pendente", data: dsPend, stack:"s" },
        { label:"Atrasado", data: dsAtra, stack:"s" }
      ]
    },
    options: {
      responsive: true,
      animation: { duration: 650 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        tooltip: { callbacks:{ label:(ctx)=> `${ctx.dataset.label}: ${money(ctx.raw||0)}` } },
        legend: { position: "bottom" }
      },
      scales: {
        y: { ticks: { callback: (v)=> money(v) } }
      },
      onClick: (evt, els)=>{
        if(!els || !els.length) return;
        const idx = els[0].index;
        const mk = labels[idx]; // YYYY-MM
        const [y,mn] = mk.split("-").map(x=> parseInt(x,10));
        if(!y || !mn) return;
        const from = `${mk}-01`;
        const to = new Date(y, mn, 0);
        const toStr = `${y}-${String(mn).padStart(2,"0")}-${String(to.getDate()).padStart(2,"0")}`;
        document.getElementById("fDateFrom").value = from;
        document.getElementById("fDateTo").value = toStr;
        applyAndRender();
      }
    }
  });
}


function renderTable(rows){
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = rows
    .sort((a,b)=> (b.data||"").localeCompare(a.data||""))
    .map(r=>{
      const c = saleComputed(r);
      const parcelas = (Array.isArray(r.parcelas)? r.parcelas : Array.from({length:6},()=> "Pendente"));
      const statusResumo = `${parcelas.filter(p=>p==="Pago").length}P / ${parcelas.filter(p=>p==="Pendente").length}Pe / ${parcelas.filter(p=>p==="Atrasado").length}A`;
      return `
      <tr>
        <td>${escapeHtml(r.consultorName || "—")}</td>
        <td>${escapeHtml(r.cliente||"")}</td>
        <td>${escapeHtml(r.produto||"")}</td>
        <td>${escapeHtml(r.data||"")}</td>
        <td>${badgeSeguro(r.seguro)}</td>
        <td>${Number(r.cotas||0)}</td>
        <td>${money(r.valorUnit||0)}</td>
        <td>${money(c.credito)}</td>
        <td>${baseLabel(r.baseComissao)}</td>
        <td>${pct(r.taxaPct||0)}</td>
        <td style="font-weight:900;">${money(c.comissaoTotal)} <span class="muted text-xs">(${statusResumo})</span></td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-sm" data-action="detail" data-id="${r.id}">Detalhar</button>
          <button class="btn btn-sm" data-action="delete" data-id="${r.id}" style="border-color: rgba(239,68,68,.35); color: var(--bad);">Excluir</button>
        </td>
      </tr>`;
    }).join("");

  tbody.querySelectorAll("button[data-action='delete']").forEach(btn=>{
    btn.addEventListener("click", ()=> onDeleteSale(btn.dataset.id));
  });
  tbody.querySelectorAll("button[data-action='detail']").forEach(btn=>{
    btn.addEventListener("click", ()=> openModal(btn.dataset.id));
  });
}

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}


function renderActiveChips(){
  const wrap = document.getElementById("activeChips");
  if(!wrap) return;
  const from = document.getElementById("fDateFrom")?.value || "";
  const to = document.getElementById("fDateTo")?.value || "";
  const status = document.getElementById("fStatus")?.value || "todos";
  const search = (document.getElementById("fSearch")?.value || "").trim();
  const consultor = (ME && ME.role==="admin") ? (document.getElementById("fConsultor")?.value || "todos") : "todos";

  const chips = [];
  if(from) chips.push({ key:"from", label:`De: ${from}` });
  if(to) chips.push({ key:"to", label:`Até: ${to}` });
  if(status && status!=="todos") chips.push({ key:"status", label:`Status: ${status}` });
  if(search) chips.push({ key:"search", label:`Busca: ${search}` });
  if(ME && ME.role==="admin" && consultor && consultor!=="todos") chips.push({ key:"consultor", label:`Consultor: ${consultor}` });

  if(!chips.length){
    wrap.style.display = "none";
    wrap.innerHTML = "";
    return;
  }
  wrap.style.display = "flex";
  wrap.innerHTML = chips.map(c=>`
    <span class="chipx">
      ${escapeHtml(c.label)}
      <button type="button" data-k="${c.key}" aria-label="Remover filtro">×</button>
    </span>
  `).join("");

  wrap.querySelectorAll("button[data-k]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const k = btn.getAttribute("data-k");
      if(k==="from") document.getElementById("fDateFrom").value = "";
      if(k==="to") document.getElementById("fDateTo").value = "";
      if(k==="status") document.getElementById("fStatus").value = "todos";
      if(k==="search") document.getElementById("fSearch").value = "";
      if(k==="consultor") document.getElementById("fConsultor").value = "todos";
      applyAndRender();
    });
  });
}

function renderSparks(rows){
  if(!window.Chart) return;

  // build last 8 months series
  const byMonth = new Map();
  for(const r of rows){
    const mk = monthKey(r.data);
    if(!byMonth.has(mk)) byMonth.set(mk, { total:0, pago:0, pend:0, atra:0 });
    const o = byMonth.get(mk);
    const c = saleComputed(r);
    o.total += c.comissao;
    if((r.status||"") === "Pago") o.pago += c.comissao;
    else if((r.status||"") === "Atrasado") o.atra += c.comissao;
    else o.pend += c.comissao;
  }
  const months = Array.from(byMonth.keys()).sort().slice(-8);
  const series = {
    sparkTotal: months.map(m=> byMonth.get(m)?.total || 0),
    sparkPago: months.map(m=> byMonth.get(m)?.pago || 0),
    sparkPendente: months.map(m=> byMonth.get(m)?.pend || 0),
    sparkAtrasado: months.map(m=> byMonth.get(m)?.atra || 0),
  };

  for(const [id,data] of Object.entries(series)){
    const canvas = document.getElementById(id);
    if(!canvas) continue;
    const prev = SPARKS.get(id);
    if(prev){ try{ prev.destroy(); }catch(e){} }
    const c = new Chart(canvas, {
      type: "line",
      data: { labels: months, datasets: [{ data, tension: .35, pointRadius: 0, borderWidth: 2, fill: false }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 550 },
        plugins: { legend: { display:false }, tooltip: { enabled:false } },
        scales: { x: { display:false }, y: { display:false } },
        elements: { line: { borderJoinStyle:"round" } }
      }
    });
    SPARKS.set(id, c);
  }
}


function applyAndRender(){
  const rows = applyFilters(ALL_ROWS);

  renderKpis(rows);
  renderSparks(rows);
  renderActiveChips();
  renderRanking(rows);
  renderChart(rows);
  renderTable(rows);
}

/* ============ EXPORT ============ */
function rowsForExport(rows){
  return rows.map(r=>{
    const c = saleComputed(r);
    const parcelas = (Array.isArray(r.parcelas) ? r.parcelas : []);
    const counts = {
      pago: parcelas.filter(p=>p==="Pago").length,
      pendente: parcelas.filter(p=>p==="Pendente").length,
      atrasado: parcelas.filter(p=>p==="Atrasado").length
    };
    return {
      Consultor: r.consultorName || "",
      Cliente: r.cliente || "",
      Produto: r.produto || "",
      Data: r.data || "",
      Seguro: r.seguro || "",
      Cotas: r.cotas || 0,
      "Valor Unitário": r.valorUnit || 0,
      "Crédito": c.credito,
      "Base Comissão": baseLabel(r.baseComissao),
      "% Comissão": r.taxaPct || 0,
      "Comissão Total": c.comissaoTotal,
      "Parcelas Pagas": counts.pago,
      "Parcelas Pendentes": counts.pendente,
      "Parcelas Atrasadas": counts.atrasado
    };
  });
}

function exportCsv(){
  const rows = applyFilters(ALL_ROWS);
  const data = rowsForExport(rows);
  const cols = Object.keys(data[0]||{});
  const lines = [
    cols.join(";"),
    ...data.map(obj=> cols.map(k=> String(obj[k] ?? "").replace(/"/g,'""')).join(";"))
  ];
  const blob = new Blob([ "\ufeff" + lines.join("\n") ], { type:"text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vendas_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportXlsx(){
  const rows = applyFilters(ALL_ROWS);
  const data = rowsForExport(rows);

  if(!window.XLSX){
    // fallback
    exportCsv();
    return;
  }
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vendas");
  XLSX.writeFile(wb, `vendas_${new Date().toISOString().slice(0,10)}.xlsx`);
}

/* ============ CRUD ============ */
async function onDeleteSale(id){
  if(!confirm("Excluir esta venda?")) return;
  try{
    await api(`/api/sales/${id}`, { method:"DELETE" });
    await loadSales();
  }catch(e){
    alert(e.message || "Erro ao excluir");
  }
}

async function onAddSale(ev){
  ev.preventDefault();
  const form = ev.currentTarget;
  const fd = new FormData(form);

  const body = {};
  for(const [k,v] of fd.entries()){
    body[k] = v;
  }

  // normalize numbers
  body.cotas = parseNumber(body.cotas);
  body.valorUnit = parseNumber(body.valorUnit);
  body.valorVenda = parseNumber(body.valorVenda);
  body.taxaPct = parseNumber(body.taxaPct);

  try{
    document.getElementById("addErr").style.display = "none";
    await api("/api/sales", { method:"POST", body: JSON.stringify(body) });
    form.reset();
    updatePreview();
    await loadSales();
  }catch(e){
    const el = document.getElementById("addErr");
    el.textContent = e.message || "Erro ao salvar";
    el.style.display = "block";
  }
}

function updatePreview(){
  const form = document.getElementById("formAdd");
  if(!form) return;
  const fd = new FormData(form);
  const cotas = parseNumber(fd.get("cotas"));
  const valorUnit = parseNumber(fd.get("valorUnit"));
  const valorVenda = parseNumber(fd.get("valorVenda"));
  const taxaPct = parseNumber(fd.get("taxaPct"));
  const baseComissao = fd.get("baseComissao");

  const creditoRaw = cotas*valorUnit;
  const credito = clampCredito(creditoRaw);
  const base = (baseComissao==="venda") ? valorVenda : credito;
  const comissao = base * (taxaPct/100);
  const parcela = comissao/6;

  document.getElementById("pvCredito").textContent = money(credito);
  document.getElementById("pvComissao").textContent = money(comissao);
  document.getElementById("pvParcela").textContent = money(parcela);

  const warn = document.getElementById("pvWarn");
  const creditoFinal = document.getElementById("pvCreditoFinal");
  if(creditoRaw > LIMIT){
    warn.textContent = `Crédito excedeu o limite. Foi ajustado para ${money(LIMIT)}.`;
    warn.style.display = "block";
    creditoFinal.style.display = "block";
    creditoFinal.textContent = `Crédito bruto: ${money(creditoRaw)} • Ajustado: ${money(credito)}`;
  }else{
    warn.style.display = "none";
    creditoFinal.style.display = "none";
  }
}

/* ============ MODAL EDIT ============ */
function openModal(id){
  const r = ALL_ROWS.find(x=>x.id===id);
  if(!r) return;
  currentEdit = JSON.parse(JSON.stringify(r)); // clone

  const modal = document.getElementById("saleModal");
  modal.style.display = "block";
  document.getElementById("modalSub").textContent = `ID: ${id} • Atualizado: ${r.updatedAt ? r.updatedAt.slice(0,19).replace("T"," ") : "—"}`;

  const form = document.getElementById("formEdit");
  form.cliente.value = r.cliente || "";
  form.produto.value = r.produto || "";
  form.data.value = r.data || "";
  form.seguro.value = r.seguro || "Não";
  form.baseComissao.value = r.baseComissao || "credito";
  form.cotas.value = String(r.cotas||0);
  form.valorUnit.value = String(r.valorUnit||0);
  form.valorVenda.value = String(r.valorVenda||0);
  form.taxaPct.value = String(r.taxaPct||0);

  if(ME && ME.role==="admin"){
    form.consultorName.value = r.consultorName || "";
    form.userId.value = r.userId || "";
  }

  renderParcelasEditor(r.parcelas || Array.from({length:6},()=> "Pendente"));
}

function closeModal(){
  document.getElementById("saleModal").style.display = "none";
  currentEdit = null;
}

function renderParcelasEditor(parcelas){
  const wrap = document.getElementById("parcelasEdit");
  const arr = (Array.isArray(parcelas) && parcelas.length===6) ? parcelas.slice() : Array.from({length:6},()=> "Pendente");
  currentEdit.parcelas = arr;

  wrap.innerHTML = arr.map((p, idx)=>{
    const cls = p==="Pago" ? "var(--good)" : p==="Atrasado" ? "var(--bad)" : "var(--warn)";
    return `<button type="button" class="btn btn-sm" data-i="${idx}" style="justify-content:center; border-color: rgba(148,163,184,.25);">
      <span class="dot" style="background:${cls};"></span>${idx+1}º<br><span class="muted text-xs">${p}</span>
    </button>`;
  }).join("");

  wrap.querySelectorAll("button[data-i]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.dataset.i);
      const cur = currentEdit.parcelas[i];
      const next = (cur==="Pendente") ? "Pago" : (cur==="Pago") ? "Atrasado" : "Pendente";
      currentEdit.parcelas[i] = next;
      renderParcelasEditor(currentEdit.parcelas);
    });
  });
}

async function saveEdit(ev){
  ev.preventDefault();
  if(!currentEdit) return;
  const form = document.getElementById("formEdit");
  const body = {
    cliente: form.cliente.value,
    produto: form.produto.value,
    data: form.data.value,
    seguro: form.seguro.value,
    baseComissao: form.baseComissao.value,
    cotas: parseNumber(form.cotas.value),
    valorUnit: parseNumber(form.valorUnit.value),
    valorVenda: parseNumber(form.valorVenda.value),
    taxaPct: parseNumber(form.taxaPct.value),
    parcelas: currentEdit.parcelas
  };

  if(ME && ME.role==="admin"){
    body.consultorName = form.consultorName.value;
    body.userId = form.userId.value;
  }

  try{
    document.getElementById("editErr").style.display="none";
    await api(`/api/sales/${currentEdit.id}`, { method:"PUT", body: JSON.stringify(body) });
    closeModal();
    await loadSales();
  }catch(e){
    const el = document.getElementById("editErr");
    el.textContent = e.message || "Erro ao salvar";
    el.style.display = "block";
  }
}

async function deleteFromModal(){
  if(!currentEdit) return;
  await onDeleteSale(currentEdit.id);
  closeModal();
}

/* ============ INIT ============ */
document.getElementById("btnRefresh").addEventListener("click", loadSales);
document.getElementById("btnLogout").addEventListener("click", async ()=>{
  try{ await api("/api/logout", { method:"POST" }); }catch(e){}
  window.location.href = "/";
});

document.getElementById("formAdd").addEventListener("submit", onAddSale);
["input","change"].forEach(evt=>{
  document.getElementById("formAdd").addEventListener(evt, debounce(updatePreview, 120), true);
});

document.getElementById("btnClearFilters").addEventListener("click", clearFilters);
document.getElementById("btnExportCsv").addEventListener("click", exportCsv);
document.getElementById("btnExportXlsx").addEventListener("click", exportXlsx);

// Filters accordion
const btnT = document.getElementById("btnToggleFilters");
if(btnT){
  btnT.addEventListener("click", ()=>{
    const panel = document.getElementById("filtersPanel");
    if(!panel) return;
    panel.style.display = (panel.style.display==="none" || !panel.style.display) ? "block" : "none";
  });
}
const btnA = document.getElementById("btnApplyFilters");
if(btnA) btnA.addEventListener("click", applyAndRender);

// Chart tabs
["tabMonthly","tabConsultors","tabStatus"].forEach(id=>{
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener("click", ()=>{
    const tab = el.getAttribute("data-tab") || (id==="tabConsultors"?"consultors": id==="tabStatus"?"status":"monthly");
    // block consultors tab for non-admin (hidden, but just in case)
    if(tab==="consultors" && (!ME || ME.role!=="admin")) return;

    CHART_TAB = tab;
    document.querySelectorAll(".tab").forEach(t=> t.classList.remove("active"));
    el.classList.add("active");
    renderChart(applyFilters(ALL_ROWS));
  });
});

["fDateFrom","fDateTo","fStatus","fSearch","fConsultor"].forEach(id=>{
  const el = document.getElementById(id);
  if(!el) return;
  const handler = debounce(applyAndRender, 180);
  el.addEventListener("input", handler);
  el.addEventListener("change", handler);
});

document.getElementById("btnCloseModal").addEventListener("click", closeModal);
document.getElementById("saleModal").addEventListener("click", (e)=>{
  if(e.target && e.target.id==="saleModal") closeModal();
});
document.getElementById("formEdit").addEventListener("submit", saveEdit);
document.getElementById("btnDeleteSale").addEventListener("click", deleteFromModal);

(async function init(){
  initTheme();
  try{
    await loadMe();
    await loadUsersIfAdmin();
    await loadSales();
    updatePreview();
  }catch(e){
    window.location.href = "/";
  }
})();
