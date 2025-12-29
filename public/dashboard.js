const THEME_KEY = "dash_theme_v1";
const LIMIT = 1500000;

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
function clampCredito(raw){ return Math.min(Math.max(raw,0), LIMIT); }

function setTheme(t){
  document.body.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);
  const btn = document.getElementById("btnTheme");
  if(btn) btn.textContent = (t==="dark") ? "☀️" : "🌙";
}
(function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if(saved) return setTheme(saved);
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(prefersDark ? "dark" : "light");
})();
document.getElementById("btnTheme").addEventListener("click", ()=>{
  const cur = document.body.getAttribute("data-theme");
  setTheme(cur==="dark" ? "light" : "dark");
});

let ME = null;
let LAST_ROWS = [];

// filtros
let FILTERS = { q:"", consultor:"", status:"", from:"", to:"" };
let CURRENT_VIEW = []; // rows filtradas

// modal detalhe
let DETAIL_ID = null;
let DETAIL_ROW = null;

async function api(path, opts){
  const res = await fetch(path, opts);
  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    throw new Error(data?.error || "Erro");
  }
  return data;
}

async function loadMe(){
  const me = await api("/api/me");
  ME = me;
  document.getElementById("meLine").textContent = `Logado como: ${me.name} • Perfil: ${me.role}`;
  document.getElementById("adminExtras").style.display = (me.role === "admin") ? "block" : "none";
}

function baseLabel(b){ return b==="venda" ? "Venda" : "Crédito"; }

function badgeSeguro(v){
  if(v==="Sim") return `<span class="badge" style="background: rgba(37,99,235,.12);"><span class="dot" style="background: var(--accent)"></span>Sim</span>`;
  return `<span class="badge" style="background: rgba(148,163,184,.10);"><span class="dot" style="background: var(--muted)"></span>Não</span>`;
}

function saleComputed(r){
  const credito = clampCredito((r.cotas||0) * (r.valorUnit||0));
  const base = (r.baseComissao==="venda") ? (r.valorVenda||0) : credito;
  const comissaoTotal = base * ((r.taxaPct||0)/100);
  const parcelaValor = comissaoTotal / 6;

  const parcelas = Array.isArray(r.parcelas) ? r.parcelas : Array(6).fill("Pendente");
  const pagoN = parcelas.filter(x=>x==="Pago").length;
  const atrasadoN = parcelas.filter(x=>x==="Atrasado").length;
  const pendenteN = parcelas.filter(x=>x==="Pendente").length;

  return { credito, base, comissaoTotal, parcelaValor, pagoN, atrasadoN, pendenteN };
}

function renderKPIs(rows){
  const totalVendas = rows.length;

  let total = 0;
  let pago = 0;
  let atrasado = 0;
  let pendente = 0;

  let parcelasTotal = 0;
  let parcelasPago = 0;
  let parcelasAtrasado = 0;
  let parcelasPendente = 0;

  for(const r of rows){
    const c = saleComputed(r);
    total += c.comissaoTotal;

    parcelasTotal += 6;
    parcelasPago += c.pagoN;
    parcelasAtrasado += c.atrasadoN;
    parcelasPendente += c.pendenteN;

    pago += c.parcelaValor * c.pagoN;
    atrasado += c.parcelaValor * c.atrasadoN;
    pendente += c.parcelaValor * c.pendenteN;
  }

  document.getElementById("kpiTotal").textContent = money(total);
  document.getElementById("kpiVendas").textContent = `${totalVendas} venda(s) • ${parcelasTotal} parcela(s) no total`;

  document.getElementById("kpiPago").textContent = money(pago);
  const pagoPct = total > 0 ? (pago / total) * 100 : 0;
  document.getElementById("kpiPagoPct").textContent = `${pct(pagoPct).replace("%","")}% do total • ${parcelasPago}/${parcelasTotal} parcelas pagas`;

  document.getElementById("kpiPendente").textContent = money(pendente);
  document.getElementById("kpiPendenteInfo").textContent = `${parcelasPendente}/${parcelasTotal} parcelas pendentes`;

  document.getElementById("kpiAtrasado").textContent = money(atrasado);
  document.getElementById("kpiAtrasadoInfo").textContent = `${parcelasAtrasado}/${parcelasTotal} parcelas atrasadas`;

  // Resumo rápido
  const ticket = totalVendas > 0 ? total / totalVendas : 0;
  document.getElementById("quickTicket").textContent = money(ticket);
  document.getElementById("quickParcelas").textContent = `${parcelasTotal} (P: ${parcelasPago} • Pen: ${parcelasPendente} • Atr: ${parcelasAtrasado})`;
  document.getElementById("quickMix").textContent =
    `Pago: ${money(pago)} • Pendente: ${money(pendente)} • Atrasado: ${money(atrasado)} • Comissão total: ${money(total)}`;

  return { total, pago, atrasado, pendente };
}

function renderRanking(rows){
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

  const arr = Array.from(by.values())
    .sort((a,b)=> (b.pago - a.pago) || (b.total - a.total) || (b.vendas - a.vendas));

  const rankBody = document.getElementById("rankBody");
  rankBody.innerHTML = arr.map((x,i)=>`
    <tr>
      <td><b>${i+1}</b></td>
      <td><b>${x.consultor}</b></td>
      <td>${x.vendas}</td>
      <td><b>${money(x.total)}</b></td>
      <td><b style="color:var(--good)">${money(x.pago)}</b></td>
      <td><b style="color:var(--warn)">${money(x.pendente)}</b></td>
      <td><b style="color:var(--bad)">${money(x.atrasado)}</b></td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="muted" style="text-align:center;padding:16px;">Sem dados para ranking.</td></tr>`;

  const top = arr[0];
  if(top){
    document.getElementById("quickTop").textContent = `${top.consultor}`;
    document.getElementById("quickTopSub").textContent = `Pago: ${money(top.pago)} • Total: ${money(top.total)} • Vendas: ${top.vendas}`;
  } else {
    document.getElementById("quickTop").textContent = "—";
    document.getElementById("quickTopSub").textContent = "—";
  }
}

async function loadSales(){
  const { rows } = await api("/api/sales");
  LAST_ROWS = rows;

  hydrateConsultorFilter(rows);
  applyFiltersAndRender();
}

function hydrateConsultorFilter(rows){
  const sel = document.getElementById("fConsultor");
  if(!sel) return;
  const cur = sel.value;
  const names = Array.from(new Set(rows.map(r=>r.consultorName||"—"))).sort((a,b)=>a.localeCompare(b,"pt-BR"));
  sel.innerHTML = `<option value="">Todos consultores</option>` + names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  sel.value = names.includes(cur) ? cur : "";
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function anyParcelWithStatus(r, status){
  const parcelas = Array.isArray(r.parcelas) ? r.parcelas : Array(6).fill("Pendente");
  return parcelas.some(x=>x===status);
}

function filterRows(rows){
  const q = (FILTERS.q||"").trim().toLowerCase();
  const consultor = FILTERS.consultor || "";
  const status = FILTERS.status || "";
  const from = FILTERS.from || "";
  const to = FILTERS.to || "";

  return rows.filter(r=>{
    if(consultor && (r.consultorName||"—") !== consultor) return false;
    if(status && !anyParcelWithStatus(r, status)) return false;
    if(from && String(r.data||"") < from) return false;
    if(to && String(r.data||"") > to) return false;
    if(q){
      const hay = `${r.consultorName||""} ${r.cliente||""} ${r.produto||""} ${r.data||""}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

function applyFiltersAndRender(){
  const rows = filterRows(LAST_ROWS);
  CURRENT_VIEW = rows;
  renderSalesTable(rows);
  renderKPIs(rows);
  renderRanking(rows);
}

function renderSalesTable(rows){
  const tbody = document.getElementById("tbody");
  tbody.innerHTML = rows.map(r=>{
    const c = saleComputed(r);
    return `
      <tr>
        <td><b>${escapeHtml(r.consultorName || "—")}</b></td>
        <td>${escapeHtml(r.cliente)}</td>
        <td>${escapeHtml(r.produto)}</td>
        <td>${escapeHtml(r.data)}</td>
        <td>${badgeSeguro(r.seguro)}</td>
        <td><b>${escapeHtml(r.cotas)}</b></td>
        <td><b>${money(r.valorUnit)}</b></td>
        <td><b>${money(c.credito)}</b></td>
        <td>${escapeHtml(baseLabel(r.baseComissao))}</td>
        <td>${pct(r.taxaPct)}</td>
        <td><b>${money(c.comissaoTotal)}</b></td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn" onclick="openDetail('${r.id}')">🔎 Detalhar</button>
          <button class="btn" onclick="delSale('${r.id}')">🗑</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="12" class="muted" style="text-align:center;padding:16px;">Sem vendas ainda.</td></tr>`;
}

window.delSale = async (id) => {
  if(!confirm("Excluir esta venda?")) return;
  try{
    await api(`/api/sales/${id}`, { method:"DELETE" });
    await loadSales();
  }catch(e){
    alert(e.message);
  }
};

window.openDetail = (id)=>{
  const row = LAST_ROWS.find(r=>r.id===id);
  if(!row) return alert("Venda não encontrada na lista.");
  DETAIL_ID = id;
  DETAIL_ROW = JSON.parse(JSON.stringify(row));
  showDetailModal(DETAIL_ROW);
};

function showDetailModal(row){
  const wrap = document.getElementById("detailWrap");
  wrap.style.display = "block";

  document.getElementById("detailSub").textContent = `${row.consultorName || "—"} • ${row.cliente} • ${row.produto}`;

  // admin fields
  document.getElementById("detailAdmin").style.display = (ME?.role === "admin") ? "grid" : "none";

  const f = document.getElementById("detailForm");
  f.consultorName && (f.consultorName.value = row.consultorName || "");
  f.userId && (f.userId.value = row.userId || "");
  f.cliente.value = row.cliente || "";
  f.produto.value = row.produto || "";
  f.data.value = row.data || "";
  f.seguro.value = row.seguro === "Sim" ? "Sim" : "Não";
  f.baseComissao.value = row.baseComissao === "venda" ? "venda" : "credito";
  f.cotas.value = row.cotas ?? "";
  f.valorUnit.value = row.valorUnit ?? "";
  f.valorVenda.value = row.valorVenda ?? "";
  f.taxaPct.value = row.taxaPct ?? "";

  renderDetailPreview();
  renderParcelas(row);
  document.getElementById("detailErr").style.display = "none";
}

function closeDetail(){
  document.getElementById("detailWrap").style.display = "none";
  DETAIL_ID = null;
  DETAIL_ROW = null;
}

function addMonths(yyyyMmDd, months){
  // trabalha em UTC pra evitar bugs de fuso
  const [y,m,d] = String(yyyyMmDd||"").split("-").map(n=>parseInt(n,10));
  if(!y||!m||!d) return null;
  const dt = new Date(Date.UTC(y, m-1, d));
  const targetMonth = (m-1) + months;
  const target = new Date(Date.UTC(y, targetMonth, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth()+1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target;
}

function formatDateBR(dateObj){
  if(!dateObj) return "—";
  const dd = String(dateObj.getUTCDate()).padStart(2,"0");
  const mm = String(dateObj.getUTCMonth()+1).padStart(2,"0");
  const yyyy = dateObj.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function isPastDue(dueDateObj){
  if(!dueDateObj) return false;
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return dueDateObj.getTime() < todayUtc.getTime();
}

function renderParcelas(row){
  const body = document.getElementById("parcelasBody");
  const parcelas = Array.isArray(row.parcelas) ? row.parcelas.slice(0,6) : Array(6).fill("Pendente");
  while(parcelas.length < 6) parcelas.push("Pendente");

  const saleDate = document.getElementById("detailForm").data.value || row.data;
  const dueDates = Array.from({length:6}, (_,i)=> addMonths(saleDate, i+1));

  body.innerHTML = parcelas.map((st,i)=>{
    const due = dueDates[i];
    const overdue = (st !== "Pago") && isPastDue(due);
    const badge = overdue ? `<span class="badge" style="background: rgba(239,68,68,.10);"><span class="dot" style="background: var(--bad)"></span>Vencida</span>` : "";
    return `
      <tr>
        <td><b>${i+1}</b></td>
        <td>${formatDateBR(due)} ${badge}</td>
        <td>
          <select class="select" data-parc="${i}" style="min-width:160px">
            <option value="Pendente" ${st==="Pendente"?"selected":""}>Pendente</option>
            <option value="Pago" ${st==="Pago"?"selected":""}>Pago</option>
            <option value="Atrasado" ${st==="Atrasado"?"selected":""}>Atrasado</option>
          </select>
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <button type="button" class="btn" onclick="setParcela(${i},'Pago')">✅ Paga</button>
          <button type="button" class="btn" onclick="setParcela(${i},'Atrasado')">⏳</button>
          <button type="button" class="btn" onclick="setParcela(${i},'Pendente')">↩</button>
        </td>
      </tr>
    `;
  }).join("");

  // listeners
  body.querySelectorAll("select[data-parc]").forEach(sel=>{
    sel.addEventListener("change", ()=>{
      const idx = Number(sel.getAttribute("data-parc"));
      DETAIL_ROW.parcelas = ensureParcelas6(DETAIL_ROW.parcelas);
      DETAIL_ROW.parcelas[idx] = sel.value;
      renderDetailPreview();
    });
  });
}

function ensureParcelas6(arr){
  const parcelas = Array.isArray(arr) ? arr.slice(0,6) : [];
  while(parcelas.length < 6) parcelas.push("Pendente");
  return parcelas.map(s => (s==="Pago"||s==="Pendente"||s==="Atrasado") ? s : "Pendente");
}

window.setParcela = (idx, status)=>{
  if(!DETAIL_ROW) return;
  DETAIL_ROW.parcelas = ensureParcelas6(DETAIL_ROW.parcelas);
  DETAIL_ROW.parcelas[idx] = status;
  renderParcelas(DETAIL_ROW);
  renderDetailPreview();
};

function renderDetailPreview(){
  if(!DETAIL_ROW) return;
  const f = document.getElementById("detailForm");
  const cotas = Math.max(0, Math.floor(parseNumber(f.cotas.value)));
  const unit = Math.max(0, parseNumber(f.valorUnit.value));
  const taxa = parseNumber(f.taxaPct.value);
  const base = f.baseComissao.value;
  const credito = clampCredito(cotas * unit);
  const venda = Math.max(0, parseNumber(f.valorVenda.value));
  const baseVal = (base==="venda") ? venda : credito;
  const comissao = baseVal * (taxa/100);
  const parcela = comissao / 6;
  const parcelas = ensureParcelas6(DETAIL_ROW.parcelas);
  const pagoN = parcelas.filter(x=>x==="Pago").length;
  const atrasadoN = parcelas.filter(x=>x==="Atrasado").length;
  const pendenteN = parcelas.filter(x=>x==="Pendente").length;
  document.getElementById("detailPreview").textContent =
    `Crédito: ${money(credito)} • Comissão: ${money(comissao)} • Parcela (1/6): ${money(parcela)} • Pago: ${pagoN} • Pendente: ${pendenteN} • Atrasado: ${atrasadoN}`;
}

// ====== UI filtros / export / modal ======
document.getElementById("btnFilters")?.addEventListener("click", ()=>{
  const bar = document.getElementById("filtersBar");
  bar.style.display = (bar.style.display === "none" || !bar.style.display) ? "block" : "none";
});

document.getElementById("btnApplyFilters")?.addEventListener("click", ()=>{
  FILTERS.consultor = document.getElementById("fConsultor").value;
  FILTERS.status = document.getElementById("fStatus").value;
  FILTERS.from = document.getElementById("fFrom").value;
  FILTERS.to = document.getElementById("fTo").value;
  applyFiltersAndRender();
});

document.getElementById("btnClearFilters")?.addEventListener("click", ()=>{
  FILTERS = { q:FILTERS.q||"", consultor:"", status:"", from:"", to:"" };
  document.getElementById("fConsultor").value = "";
  document.getElementById("fStatus").value = "";
  document.getElementById("fFrom").value = "";
  document.getElementById("fTo").value = "";
  applyFiltersAndRender();
});

document.getElementById("q")?.addEventListener("input", (e)=>{
  FILTERS.q = e.target.value;
  applyFiltersAndRender();
});

document.getElementById("btnExport")?.addEventListener("click", ()=>{
  exportCSV(CURRENT_VIEW.length ? CURRENT_VIEW : LAST_ROWS);
});

function exportCSV(rows){
  const header = [
    "consultorName","cliente","produto","data","seguro","cotas","valorUnit","credito","baseComissao","valorVenda","taxaPct","comissaoTotal",
    "p1","p2","p3","p4","p5","p6"
  ];

  const lines = [header.join(",")];
  for(const r of rows){
    const c = saleComputed(r);
    const parcelas = ensureParcelas6(r.parcelas);
    const vals = [
      r.consultorName||"",
      r.cliente||"",
      r.produto||"",
      r.data||"",
      r.seguro||"",
      r.cotas??"",
      r.valorUnit??"",
      c.credito,
      r.baseComissao||"",
      r.valorVenda??"",
      r.taxaPct??"",
      c.comissaoTotal,
      ...parcelas
    ].map(v=>csvCell(v));
    lines.push(vals.join(","));
  }

  const blob = new Blob(["\ufeff" + lines.join("\n")], { type:"text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  a.download = `vendas_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v){
  const s = String(v ?? "");
  // sempre entre aspas pra evitar vírgula quebrar
  return '"' + s.replaceAll('"','""') + '"';
}

document.getElementById("btnCloseDetail")?.addEventListener("click", closeDetail);
document.getElementById("detailWrap")?.addEventListener("click", (e)=>{
  if(e.target && e.target.id === "detailWrap") closeDetail();
});

document.getElementById("detailForm")?.addEventListener("input", ()=>{
  if(!DETAIL_ROW) return;
  const f = document.getElementById("detailForm");
  // se mudar data, recalcula vencimentos
  renderDetailPreview();
  renderParcelas(DETAIL_ROW);
});

document.getElementById("btnAutoLate")?.addEventListener("click", ()=>{
  if(!DETAIL_ROW) return;
  const f = document.getElementById("detailForm");
  const saleDate = f.data.value;
  const dueDates = Array.from({length:6}, (_,i)=> addMonths(saleDate, i+1));
  DETAIL_ROW.parcelas = ensureParcelas6(DETAIL_ROW.parcelas);
  DETAIL_ROW.parcelas = DETAIL_ROW.parcelas.map((st,i)=>{
    if(st === "Pago") return st;
    return isPastDue(dueDates[i]) ? "Atrasado" : st;
  });
  renderParcelas(DETAIL_ROW);
  renderDetailPreview();
});

document.getElementById("btnDeleteInDetail")?.addEventListener("click", async ()=>{
  if(!DETAIL_ID) return;
  if(!confirm("Excluir esta venda?")) return;
  try{
    await api(`/api/sales/${DETAIL_ID}`, { method:"DELETE" });
    closeDetail();
    await loadSales();
  }catch(e){
    alert(e.message);
  }
});

document.getElementById("detailForm")?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  if(!DETAIL_ID || !DETAIL_ROW) return;
  const err = document.getElementById("detailErr");
  err.style.display = "none";

  const f = e.target;
  const payload = {
    cliente: f.cliente.value,
    produto: f.produto.value,
    data: f.data.value,
    seguro: f.seguro.value,
    cotas: f.cotas.value,
    valorUnit: f.valorUnit.value,
    valorVenda: f.valorVenda.value,
    baseComissao: f.baseComissao.value,
    taxaPct: f.taxaPct.value,
    parcelas: ensureParcelas6(DETAIL_ROW.parcelas)
  };

  if(ME?.role === "admin"){
    payload.consultorName = f.consultorName.value;
    payload.userId = f.userId.value;
  }

  try{
    await api(`/api/sales/${DETAIL_ID}`, {
      method:"PUT",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    closeDetail();
    await loadSales();
  }catch(e2){
    err.textContent = e2.message;
    err.style.display = "block";
  }
});

function updatePreview(){
  const f = document.getElementById("formAdd");
  const fd = new FormData(f);

  const cotas = Math.max(0, Math.floor(parseNumber(fd.get("cotas"))));
  const unit = Math.max(0, parseNumber(fd.get("valorUnit")));
  const taxa = parseNumber(fd.get("taxaPct"));
  const base = fd.get("baseComissao");

  const creditoRaw = cotas * unit;
  const credito = clampCredito(creditoRaw);
  const valorVenda = Math.max(0, parseNumber(fd.get("valorVenda")));

  const baseVal = (base==="venda") ? valorVenda : credito;
  const comissao = baseVal * (taxa/100);

  document.getElementById("pvCredito").textContent = creditoRaw ? money(creditoRaw) : "—";

  if(creditoRaw > LIMIT){
    document.getElementById("pvCreditoFinal").style.display = "block";
    document.getElementById("pvCreditoFinal").textContent = `Crédito final (limitado): ${money(LIMIT)}`;
    document.getElementById("pvWarn").style.display = "block";
    document.getElementById("pvWarn").textContent = `⚠️ Crédito bruto ${money(creditoRaw)} passou do limite. Foi ajustado para ${money(LIMIT)}.`;
  } else {
    document.getElementById("pvCreditoFinal").style.display = "none";
    document.getElementById("pvWarn").style.display = "none";
  }

  document.getElementById("pvComissao").textContent = comissao ? money(comissao) : "—";
  document.getElementById("pvParcela").textContent = comissao ? money(comissao/6) : "—";
}

document.getElementById("formAdd").addEventListener("input", updatePreview);
document.getElementById("formAdd").addEventListener("change", updatePreview);

document.getElementById("formAdd").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const addErr = document.getElementById("addErr");
  addErr.style.display = "none";

  const fd = new FormData(e.target);

  const payload = {
    cliente: fd.get("cliente"),
    produto: fd.get("produto"),
    data: fd.get("data"),
    seguro: fd.get("seguro"),
    cotas: fd.get("cotas"),
    valorUnit: fd.get("valorUnit"),
    valorVenda: fd.get("valorVenda"),
    baseComissao: fd.get("baseComissao"),
    taxaPct: fd.get("taxaPct")
  };

  if(ME?.role === "admin"){
    payload.consultorName = fd.get("consultorName");
    payload.userId = fd.get("userId");
  }

  try{
    await api("/api/sales", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    e.target.reset();
    updatePreview();
    await loadSales();
  }catch(err){
    addErr.textContent = err.message;
    addErr.style.display = "block";
  }
});

document.getElementById("btnRefresh").addEventListener("click", loadSales);
document.getElementById("btnLogout").addEventListener("click", async ()=>{
  try{ await api("/api/logout", { method:"POST" }); } catch(e){}
  window.location.href = "/";
});

(async function init(){
  try{
    await loadMe();
    await loadSales();
    updatePreview();
  }catch(e){
    window.location.href = "/";
  }
})();
