import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { withTransaction } from "@/lib/db";
import type { Role } from "@/lib/types";

export class BankWriteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function bankWriteStatus(error: unknown) {
  return error instanceof BankWriteError ? error.status : 400;
}

// Every write acquires the account row first, including Root's lock toggle.
export async function lockBankAccount(conn: PoolConnection, accountId: string, role: Role) {
  const [[account]] = await conn.query<RowDataPacket[]>(
    "SELECT * FROM siap_bank_accounts WHERE id=? AND is_active=1 FOR UPDATE", [accountId],
  );
  if (!account) throw new BankWriteError("Rekening tidak ditemukan atau sudah nonaktif.", 404);
  if (Number(account.finance_locked) && role !== "ROOT_ADMIN") {
    throw new BankWriteError("Rekening dikunci oleh Root Admin. Finance hanya dapat melihat laporan.", 423);
  }
  return account;
}

export function withBankAccountWrite<T>(role: Role, accountId: string,
  change: (conn: PoolConnection, account: RowDataPacket) => Promise<T>) {
  return withTransaction(async conn => change(conn, await lockBankAccount(conn, accountId, role)));
}
