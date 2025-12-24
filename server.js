import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import crypto from "crypto";

import {
  seedUsersIfNeeded,
  findUserByUsername,
  listUsers,
  listSalesForUser,
  createSale,
  updateSale,
  deleteSale
} from "./db.js";

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static("public"));

seedUsersIfNeeded({ adminPassword: process.env.ADMIN_PASSWORD });

const sessions = new Map(); // sid -> { userId, role, name, username }

function makeSid() {
  return crypto.randomBytes(24).toString("hex");
}

function auth(req, res, next) {
  const sid = req.cookies.sid;
  if (!sid || !sessions.has(sid)) return res.status(401).json({ error: "Não autenticado" });
  req.user = sessions.get(sid);
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Acesso negado" });
  next();
}

const LIMIT_CREDITO = 1500000;

function parseNum(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function clampCredito(raw) {
  return Math.min(Math.max(raw, 0), LIMIT_CREDITO);
}

function normalizeSaleInput(body) {
  const cotas = Math.max(0, Math.floor(parseNum(body.cotas)));
  const valorUnit = Math.max(0, parseNum(body.valorUnit));
  const taxaPct = parseNum(body.taxaPct);
  const seguro = body.seguro === "Sim" ? "Sim" : "Não";
  const baseComissao = body.baseComissao === "venda" ? "venda" : "credito";

  const creditoRaw = cotas * valorUnit;
  const credito = clampCredito(creditoRaw);

  const valorVenda = Math.max(0, parseNum(body.valorVenda));

  const base = baseComissao === "venda" ? valorVenda : credito;
  const comissaoTotal = base * (taxaPct / 100);

  const parcelas = Array.isArray(body.parcelas) && body.parcelas.length === 6
    ? body.parcelas.map(s => (s === "Pago" || s === "Pendente" || s === "Atrasado") ? s : "Pendente")
    : Array.from({ length: 6 }, () => "Pendente");

  return {
    cliente: String(body.cliente || "").trim(),
    produto: String(body.produto || "").trim(),
    data: String(body.data || "").trim(),
    seguro,
    cotas,
    valorUnit,
    valorVenda,
    baseComissao,
    taxaPct,
    creditoRaw,
    credito,
    comissaoTotal,
    parcelas
  };
}

/* ===== AUTH ===== */
app.post("/api/login", (req, res) => {
  const username = String(req.body?.username || "").toLowerCase();
  const password = String(req.body?.password || "");

  const user = findUserByUsername(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Usuário ou senha inválidos" });
  }

  const sid = makeSid();
  sessions.set(sid, {
    userId: user.id,
    role: user.role,
    name: user.displayName,
    username: user.username
  });

  res.cookie("sid", sid, { httpOnly: true, sameSite: "lax" });
  res.json({ ok: true, role: user.role, name: user.displayName, username: user.username });
});

app.post("/api/logout", auth, (req, res) => {
  const sid = req.cookies.sid;
  sessions.delete(sid);
  res.clearCookie("sid");
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ ok: true, ...req.user });
});

app.get("/api/users", auth, adminOnly, (req, res) => {
  res.json({ ok: true, users: listUsers() });
});

/* ===== SALES ===== */
app.get("/api/sales", auth, (req, res) => {
  const rows = listSalesForUser({ role: req.user.role, userId: req.user.userId });
  res.json({ ok: true, rows });
});

app.post("/api/sales", auth, (req, res) => {
  const input = normalizeSaleInput(req.body || {});
  if (!input.cliente || !input.produto || !input.data) {
    return res.status(400).json({ error: "Preencha cliente, produto e data." });
  }
  if (input.cotas <= 0 || input.valorUnit <= 0) {
    return res.status(400).json({ error: "Informe cotas e valor unitário (> 0)." });
  }

  const id = crypto.randomUUID();
  const ts = new Date().toISOString();

  const consultorName = req.user.role === "admin"
    ? String(req.body?.consultorName || req.user.name)
    : req.user.name;

  const userId = req.user.role === "admin"
    ? (String(req.body?.userId || req.user.userId))
    : req.user.userId;

  const sale = {
    id,
    userId,
    consultorName,
    ...input,
    createdAt: ts,
    updatedAt: ts
  };

  createSale(sale);
  res.json({ ok: true, id });
});

app.put("/api/sales/:id", auth, (req, res) => {
  const id = req.params.id;

  const input = normalizeSaleInput(req.body || {});
  if (!input.cliente || !input.produto || !input.data) {
    return res.status(400).json({ error: "Preencha cliente, produto e data." });
  }

  const result = updateSale(id, (current) => {
    if (req.user.role !== "admin" && current.userId !== req.user.userId) {
      // mantém como estava (sem alterar)
      return current;
    }

    const consultorName = req.user.role === "admin"
      ? (String(req.body?.consultorName || current.consultorName))
      : req.user.name;

    const userId = req.user.role === "admin"
      ? (String(req.body?.userId || current.userId))
      : req.user.userId;

    return {
      ...current,
      userId,
      consultorName,
      ...input,
      updatedAt: new Date().toISOString()
    };
  });

  if (!result.ok) return res.status(404).json({ error: "Venda não encontrada" });

  // Se consultor tentou editar venda de outro, bloqueia de verdade:
  const updated = result.updated;
  if (req.user.role !== "admin" && updated.userId !== req.user.userId) {
    return res.status(403).json({ error: "Você não pode editar venda de outro consultor" });
  }

  res.json({ ok: true });
});

app.delete("/api/sales/:id", auth, (req, res) => {
  const id = req.params.id;

  // checagem antes
  const { rows } = listSalesForUser({ role: "admin", userId: req.user.userId });
  const all = rows; // (não usado) — simples, vamos checar via update-delete segura:

  // apagar com permissão
  const canDelete = updateSale(id, (current) => {
    if (req.user.role === "admin") return current;
    if (current.userId !== req.user.userId) return current;
    return current;
  });

  // Se não existe:
  if (!canDelete.ok) return res.status(404).json({ error: "Venda não encontrada" });

  // Buscar novamente pra validar dono
  // (como estamos em JSON simples, faremos validação por uma segunda via: tentar deletar e depois verificar)
  // Aqui a validação real: se não é admin, precisamos confirmar o dono:
  const me = req.user;

  // carrega lista do usuário e checa se ele tem essa venda
  const mine = listSalesForUser({ role: me.role, userId: me.userId });
  const isMine = mine.some(s => s.id === id);

  if (me.role !== "admin" && !isMine) {
    return res.status(403).json({ error: "Você não pode excluir venda de outro consultor" });
  }

  const del = deleteSale(id);
  if (!del.ok) return res.status(404).json({ error: "Venda não encontrada" });

  res.json({ ok: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Rodando em http://localhost:${process.env.PORT || 3000}`);
});
