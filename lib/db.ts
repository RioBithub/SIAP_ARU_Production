import mysql, { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

declare global {
  // eslint-disable-next-line no-var
  var __siapPool: Pool | undefined;
}

function boolEnv(name: string, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function makePool() {
  const sslEnabled = boolEnv("DB_SSL", false);
  const ssl = sslEnabled
    ? { rejectUnauthorized: boolEnv("DB_SSL_REJECT_UNAUTHORIZED", true) }
    : undefined;

  return mysql.createPool({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || "aru_siap",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    charset: "utf8mb4",
    timezone: "Z",
    ssl,
    decimalNumbers: true,
  });
}

export const db = global.__siapPool || makePool();
if (process.env.NODE_ENV !== "production") global.__siapPool = db;

export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export type DbRow = RowDataPacket & Record<string, unknown>;
