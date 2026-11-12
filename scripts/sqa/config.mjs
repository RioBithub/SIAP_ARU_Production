import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const sqaDirectory = path.join(repoRoot, ".sqa");
export const database = process.env.SIAP_SQA_DB_NAME ?? "siap_aru_sqa";

if (!/^siap_aru_sqa(?:_[a-z0-9_]{1,32})?$/.test(database)) {
  throw new Error("Gunakan nama database siap_aru_sqa atau siap_aru_sqa_<suffix>.");
}

function port(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("Port SQA harus bilangan bulat 1–65535.");
  }
  return parsed;
}

export const db = {
  host: "127.0.0.1",
  port: port(process.env.SIAP_SQA_DB_PORT, 33326),
  user: process.env.SIAP_SQA_DB_USER ?? "siap_aru_sqa",
  password: process.env.SIAP_SQA_DB_PASSWORD ?? "siap-sqa-db-local",
};
export const appPort = port(process.env.SIAP_SQA_APP_PORT, 33317);
export const baseURL = `http://127.0.0.1:${appPort}`;
export const uploadDirectory = path.join(sqaDirectory, "uploads", database);
export const date = new Date().toISOString().slice(0, 10);
export const demoPassword = process.env.SIAP_SQA_DEMO_PASSWORD ?? "test-workflow-2026";
export const adminPassword = process.env.SIAP_SQA_ADMIN_PASSWORD ?? "Sqa-Admin-2026!";

export const accounts = Object.fromEntries([
  ["root", "Root Admin Demo", "ROOT_ADMIN", "IT / Sistem"],
  ["staff", "Staf Operasional Demo", "STAFF", "Operasional"],
  ["secretariat", "Sekretariat Demo", "SECRETARIAT", "Sekretariat"],
  ["manager", "Manager Operasional Demo", "MANAGER", "Operasional"],
  ["dirops", "Dirops Demo", "DIRECTOR_OPS", "Direksi"],
  ["dirut", "Dirut Demo", "PRESIDENT_DIRECTOR", "Direksi"],
  ["finance", "Finance Demo", "FINANCE", "Keuangan"],
  ["other", "Staf SDM Demo", "STAFF", "SDM"],
  ["manager2", "Manager SDM Demo", "MANAGER", "SDM"],
].map(([key, name, role, unit], index) => [
  key,
  {
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    name, role, unit,
    email: `${key}@siap-test.invalid`,
    password: key === "root" ? adminPassword : demoPassword,
  },
]));

export const samples = {
  legacy: "20000000-0000-4000-8000-000000000001",
  intake: "20000000-0000-4000-8000-000000000002",
  internal: "20000000-0000-4000-8000-000000000003",
  approved: "20000000-0000-4000-8000-000000000004",
  task: "30000000-0000-4000-8000-000000000001",
  bank: "40000000-0000-4000-8000-000000000001",
};
