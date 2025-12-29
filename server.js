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
app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(express.static("public"));

seedUsersIfNeeded({ adminPassword: process.env.ADMIN_PASSWORD });

/* =========================
   TOKEN ASSINADO NO COOKIE
   (stateless, não depende de Map)
========================= */
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.warn("⚠️ Defina SESSION_SECRET no Render (Environment).");
}

function b64urlFromBuffer(buf) {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlEncodeString(str) {
  return b64urlFromBuffer(Buffer.from(str, "utf8"));
}
function b64urlDecodeToString(b64u) {
  const b64 = b64u.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Buffer.from(b64 + pad, "base64").toString("utf8");
}

function sign(body) {
  const key = SESSION_SECRET || "dev_secret_change_me";
  const sig = crypto.createHmac("sha256", key).update(body).digest();
  return b64urlFromBuffer(sig);
}

function makeToken(payload) {
  const body = b64urlEncodeString(JSON.stringify(payload));
  const sig = sign(body);
  return `${body}.${sig}`;
}

function readToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [body, sig] = parts;
  const expected = sign(body);

  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToString(body));
  } catch {
    return null;
  }

  if (payload?.exp && Date.now() > payload.exp) return null;
  return payload;
}

function auth(req, res, next) {
  const token = req.cookies.sid;
  const session = readToken(token);
  if (!session) return res.status(401).json({ error: "Não autenticado" });
  req.user = session;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Acesso negado" });
  next();
}

/* ===== Regras ===== */
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

  const payload = {
    userId: user.id,
    role: user.role,
    name: user.displayName,
    username: user.username,
    exp: Date.now() + 1000 * 60 * 60 * 12 // 12h
  };

  const token = makeToken(payload);

  res.cookie("sid", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 1000 * 60 * 60 * 12
  });

  res.json({ ok: true, role: user.role, name: user.displayName, username: user.username });
});

app.post("/api/logout", auth, (req, res) => {
  res.clearCookie("sid", { path: "/" });
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
    ? String(req.body?.userId || req.user.userId)
    : req.user.userId;

  const sale = { id, userId, consultorName, ...input, createdAt: ts, updatedAt: ts };
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
    if (req.user.role !== "admin" && current.userId !== req.user.userId) return current;

    const consultorName = req.user.role === "admin"
      ? String(req.body?.consultorName || current.consultorName)
      : req.user.name;

    const userId = req.user.role === "admin"
      ? String(req.body?.userId || current.userId)
      : req.user.userId;

    return { ...current, userId, consultorName, ...input, updatedAt: new Date().toISOString() };
  });

  if (!result.ok) return res.status(404).json({ error: "Venda não encontrada" });

  const updated = result.updated;
  if (req.user.role !== "admin" && updated.userId !== req.user.userId) {
    return res.status(403).json({ error: "Você não pode editar venda de outro consultor" });
  }

  res.json({ ok: true });
});

app.delete("/api/sales/:id", auth, (req, res) => {
  const id = req.params.id;

  if (req.user.role !== "admin") {
    const mine = listSalesForUser({ role: req.user.role, userId: req.user.userId }) || [];
    const isMine = mine.some(s => s.id === id);
    if (!isMine) return res.status(403).json({ error: "Você não pode excluir venda de outro consultor" });
  }

  const del = deleteSale(id);
  if (!del.ok) return res.status(404).json({ error: "Venda não encontrada" });

  res.json({ ok: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Rodando em http://localhost:${process.env.PORT || 3000}`);
});
