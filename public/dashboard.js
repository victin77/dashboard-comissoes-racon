const THEME_KEY = "dash_theme_v1";
const LIMIT = 1500000;

/* =========================
   UTILIDADES
========================= */
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
function clampCredito(raw){
  return Math.min(Math.max(raw,0), LIMIT);
}

/* =========================
   TEMA
========================= */
function setTheme(t){
  document.body.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);
  const btn = document.getElementById("btnTheme");
  if(btn) btn.textContent = (t==="dark") ? "☀️" : "🌙";
}
(function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if(saved) return setTheme(saved);
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  setTheme(prefersDark ? "dark" : "light");
})();
document.getElementById("btnTheme").addEventListener("click", ()=>{
  const cur = document.body.getAttribute("data-theme");
  setTheme(cur==="dark" ? "light" : "dark");
});

/* =========================
   ESTADO GLOBAL
========================= */
let ME = null;
let LAST_ROWS = [];

/* =========================
   GRÁFICOS
========================= */
let chartComissoes = null;

/* =========================
   API
========================= */
async function api(path, opts){
  const res = await fetch(path, opts);
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error || "Erro");
  return data;
}

/* =========================
   USUÁRIO
========================= */
async function loadMe(){
  const me = await api("/api/me");
  ME = me;
  document.getElementById("meLine").textContent =
    `Logado como: ${me.name} • Perfil: ${me.role}`;
  document.getElementById("adminExtras").style.display =
    (me.role === "admin") ? "block" : "none";
}

/* =========================
   CÁLCULOS
========================= */
function baseLabel(b){
  return b==="venda" ? "Venda" : "Crédito";
}

function badgeSeguro(v){
  return v==="Sim"
    ? `<span class="badge">Sim</span>`
    : `<span class="badge muted">Não</span>`;
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

/* =========================
   KPIs + RANKING
========================= */
function renderKPIs(rows){
  let total = 0, pago = 0, atrasado = 0, pendente = 0;

  rows.forEach(r=>{
    const c = saleComputed(r);
    total += c.comissaoTotal;
    pago += c.parcelaValor * c.pagoN;
    atrasado += c.parcelaValor * c.atrasadoN;
    pendente += c.parcelaValor * c.pendenteN;
  });

  document.getElementById("kpiTotal").textContent = money(total);
  document.getElementById("kpiPago").textContent = money(pago);
  document.getElementById("kpiPendente").textContent = money(pendente);
  document.getElementById("kpiAtrasado").textContent = money(atrasado);
}

function renderRanking(rows){
  const map = {};
  rows.forEach(r=>{
    const k = r.consultorName || "—";
    map[k] ??= { nome:k, vendas:0, total:0, pago:0 };
    const c = saleComputed(r);
    map[k].vendas++;
    map[k].total += c.comissaoTotal;
    map[k].pago += c.parcelaValor * c.pagoN;
  });

  const arr = Object.values(map).sort((a,b)=>b.pago-a.pago);
  document.getElementById("rankBody").innerHTML = arr.map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${r.nome}</td>
      <td>${r.vendas}</td>
      <td>${money(r.total)}</td>
      <td>${money(r.pago)}</td>
    </tr>
  `).join("");
}

/* =========================
   FILTROS
========================= */
let FILTROS = {
  cliente: "",
  cotas: "",
  dataInicio: "",
  dataFim: "",
  status: ""
};

function aplicarFiltros(vendas){
  return vendas.filter(v=>{
    if (FILTROS.cliente && !v.cliente.toLowerCase().includes(FILTROS.cliente.toLowerCase())) return false;
    if (FILTROS.cotas && Number(v.cotas) !== Number(FILTROS.cotas)) return false;
    if (FILTROS.dataInicio && v.data < FILTROS.dataInicio) return false;
    if (FILTROS.dataFim && v.data > FILTROS.dataFim) return false;

    if (FILTROS.status) {
      const c = saleComputed(v);
      if (FILTROS.status === "Pago" && c.pagoN === 0) return false;
      if (FILTROS.status === "Pendente" && c.pendenteN === 0) return false;
      if (FILTROS.status === "Atrasado" && c.atrasadoN === 0) return false;
    }
    return true;
  });
}

/* =========================
   GRÁFICO — COMISSÕES (PIZZA)
========================= */
function renderGraficoComissoes(rows){
  let pago = 0, pendente = 0, atrasado = 0;

  rows.forEach(r=>{
    const c = saleComputed(r);
    pago += c.parcelaValor * c.pagoN;
    pendente += c.parcelaValor * c.pendenteN;
    atrasado += c.parcelaValor * c.atrasadoN;
  });

  const ctx = document.getElementById("chartComissoes");
  if(!ctx) return;
  if(chartComissoes) chartComissoes.destroy();

  chartComissoes = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Pago", "Pendente", "Atrasado"],
      datasets: [{
        data: [pago, pendente, atrasado],
        backgroundColor: [
          "rgba(34,197,94,.85)",
          "rgba(245,158,11,.85)",
          "rgba(239,68,68,.85)"
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      layout: { padding: 10 },
      onClick: (_, elements) => {
        if (!elements.length) {
          FILTROS.status = "";
        } else {
          FILTROS.status = chartComissoes.data.labels[elements[0].index];
        }
        atualizarDashboard();
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#94a3b8", usePointStyle: true }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: ${money(ctx.raw)}`
          }
        }
      }
    }
  });
}

/* =========================
   DASHBOARD
========================= */
function atualizarDashboard(){
  const rows = aplicarFiltros(LAST_ROWS);
  renderKPIs(rows);
  renderRanking(rows);
  renderGraficoComissoes(rows);

  document.getElementById("tbody").innerHTML = rows.map(r=>{
    const c = saleComputed(r);
    return `
      <tr>
        <td>${r.consultorName||"—"}</td>
        <td>${r.cliente}</td>
        <td>${r.produto}</td>
        <td>${r.data}</td>
        <td>${badgeSeguro(r.seguro)}</td>
        <td>${r.cotas}</td>
        <td>${money(r.valorUnit)}</td>
        <td>${money(c.credito)}</td>
        <td>${baseLabel(r.baseComissao)}</td>
        <td>${pct(r.taxaPct)}</td>
        <td>${money(c.comissaoTotal)}</td>
        <td><button class="btn" onclick='abrirDetalhes(${JSON.stringify(r)})'>🔍</button></td>
      </tr>
    `;
  }).join("");
}

/* =========================
   VENDAS
========================= */
async function loadSales(){
  const { rows } = await api("/api/sales");
  LAST_ROWS = rows;
  atualizarDashboard();
}

/* =========================
   MODAL
========================= */
let vendaSelecionada = null;

function gerarParcelas(data){
  const base = new Date(data);
  return Array.from({length:6},(_,i)=>{
    const d = new Date(base);
    d.setMonth(d.getMonth()+i+1);
    return { numero:i+1, vencimento:d.toISOString().slice(0,10), status:"Pendente" };
  });
}

function abrirDetalhes(v){
  vendaSelecionada = v;
  if(!v.parcelas) v.parcelas = gerarParcelas(v.data);
  document.getElementById("modalDetalhes").classList.remove("hidden");
  document.getElementById("parcelasBody").innerHTML =
    v.parcelas.map((p,i)=>`
      <tr>
        <td>${p.numero}</td>
        <td>${p.vencimento}</td>
        <td>${p.status}</td>
        <td>${p.status!=="Pago" ? `<button onclick="marcarPaga(${i})">Pagar</button>` : ""}</td>
      </tr>
    `).join("");
}

function marcarPaga(i){
  vendaSelecionada.parcelas[i].status = "Pago";
  abrirDetalhes(vendaSelecionada);
}

document.getElementById("btnFecharDetalhes").onclick =
  ()=>document.getElementById("modalDetalhes").classList.add("hidden");

/* =========================
   INIT
========================= */
(async function init(){
  try{
    await loadMe();
    await loadSales();
  }catch{
    window.location.href = "/";
  }
})();
