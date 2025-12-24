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

  const tbody = document.getElementById("tbody");
  tbody.innerHTML = rows.map(r=>{
    const c = saleComputed(r);
    return `
      <tr>
        <td><b>${r.consultorName || "—"}</b></td>
        <td>${r.cliente}</td>
        <td>${r.produto}</td>
        <td>${r.data}</td>
        <td>${badgeSeguro(r.seguro)}</td>
        <td><b>${r.cotas}</b></td>
        <td><b>${money(r.valorUnit)}</b></td>
        <td><b>${money(c.credito)}</b></td>
        <td>${baseLabel(r.baseComissao)}</td>
        <td>${pct(r.taxaPct)}</td>
        <td><b>${money(c.comissaoTotal)}</b></td>
        <td style="text-align:right;">
          <button class="btn" onclick="delSale('${r.id}')">🗑 Excluir</button>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="12" class="muted" style="text-align:center;padding:16px;">Sem vendas ainda.</td></tr>`;

  renderKPIs(rows);
  renderRanking(rows);
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
