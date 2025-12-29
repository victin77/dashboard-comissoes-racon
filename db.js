import fs from "fs";
import path from "path";

const DATA_FILE = path.resolve(process.cwd(), "data.json");

function readFileSafe() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], sales: [] }, null, 2), "utf8");
  }
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return { users: [], sales: [] };
  }
}

function writeFileSafe(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function loadData() {
  return readFileSafe();
}

export function saveData(data) {
  writeFileSafe(data);
}

export function seedUsersIfNeeded({ adminPassword }) {
  const data = readFileSafe();
  if (data.users && data.users.length > 0) return;

  // Senhas simples (texto puro) — funciona, mas não é o ideal para produção.
  // Para ficar seguro “de verdade”, depois a gente coloca hash.
  data.users = [
    { id: "u_admin", username: "admin", displayName: "Administrador", role: "admin", password: adminPassword || "victor é lindo" },

    { id: "u_graziele", username: "graziele", displayName: "Graziele", role: "consultor", password: "1234" },
    { id: "u_pedro", username: "pedro", displayName: "Pedro", role: "consultor", password: "1234" },
    { id: "u_gustavo", username: "gustavo", displayName: "Gustavo", role: "consultor", password: "1234" },
    { id: "u_poli", username: "poli", displayName: "Poli", role: "consultor", password: "1234" },
    { id: "u_victor", username: "victor", displayName: "Victor", role: "consultor", password: "1234" }
  ];

  data.sales = [];
  writeFileSafe(data);
}

export function findUserByUsername(username) {
  const data = readFileSafe();
  return data.users.find(u => u.username === username) || null;
}

export function listUsers() {
  const data = readFileSafe();
  return data.users.map(({ password, ...rest }) => rest);
}

export function listSalesForUser({ role, userId }) {
  const data = readFileSafe();
  if (role === "admin") return data.sales;
  return data.sales.filter(s => s.userId === userId);
}

export function createSale(sale) {
  const data = readFileSafe();
  data.sales.unshift(sale);
  writeFileSafe(data);
}

export function updateSale(id, updaterFn) {
  const data = readFileSafe();
  const idx = data.sales.findIndex(s => s.id === id);
  if (idx < 0) return { ok: false };

  const updated = updaterFn(data.sales[idx]);
  data.sales[idx] = updated;
  writeFileSafe(data);
  return { ok: true, updated };
}

export function deleteSale(id) {
  const data = readFileSafe();
  const before = data.sales.length;
  data.sales = data.sales.filter(s => s.id !== id);
  writeFileSafe(data);
  return { ok: data.sales.length !== before };
}
