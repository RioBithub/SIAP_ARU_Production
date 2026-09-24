import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { db } from "@/lib/db";
import type { Role, SessionUser } from "@/lib/types";

const COOKIE_NAME = "siap_session";
const SESSION_HOURS = 12;

function tokenHash(value: string) {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 32) throw new Error("SESSION_SECRET minimal 32 karakter.");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function getIp(request?: Request) {
  if (!request) return null;
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id,name,email,password_hash,role,unit_name,is_active
     FROM siap_users WHERE email=? LIMIT 1`,
    [email.trim().toLowerCase()]
  );
  const row = rows[0];
  if (!row || !row.is_active) return null;
  const ok = await bcrypt.compare(password, String(row.password_hash));
  if (!ok) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as Role,
    unit_name: row.unit_name ? String(row.unit_name) : null,
  };
}

export async function createSession(userId: string, request?: Request) {
  await db.execute(`DELETE FROM siap_sessions WHERE expires_at<=UTC_TIMESTAMP()`);
  const raw = crypto.randomBytes(48).toString("hex");
  const hash = tokenHash(raw);
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await db.execute<ResultSetHeader>(
    `INSERT INTO siap_sessions
      (id,user_id,token_hash,expires_at,ip_address,user_agent)
     VALUES (?,?,?,?,?,?)`,
    [
      id,
      userId,
      hash,
      expires,
      getIp(request),
      request?.headers.get("user-agent")?.slice(0, 500) || null,
    ]
  );
  cookies().set(COOKIE_NAME, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (raw) {
    await db.execute(`DELETE FROM siap_sessions WHERE token_hash=?`, [tokenHash(raw)]);
  }
  cookies().set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT u.id,u.name,u.email,u.role,u.unit_name,u.is_active,s.id AS session_id
     FROM siap_sessions s
     JOIN siap_users u ON u.id=s.user_id
     WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP()
     LIMIT 1`,
    [tokenHash(raw)]
  );
  const row = rows[0];
  if (!row || !row.is_active) return null;
  await db.execute(`UPDATE siap_sessions SET last_seen_at=UTC_TIMESTAMP() WHERE id=?`, [row.session_id]);
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: row.role as Role,
    unit_name: row.unit_name ? String(row.unit_name) : null,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
    throw new Error("UNREACHABLE");
  }
  return user;
}

export async function requireRoles(roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  // ROOT_ADMIN is a true superuser: every protected role-gated page is allowed.
  if (user.role === "ROOT_ADMIN") return user;
  if (!roles.includes(user.role)) {
    redirect("/dashboard?forbidden=1");
    throw new Error("UNREACHABLE");
  }
  return user;
}

export async function hashPassword(password: string) {
  if (password.length < 10) throw new Error("Password minimal 10 karakter.");
  return bcrypt.hash(password, 12);
}
