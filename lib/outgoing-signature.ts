import type { RowDataPacket } from "mysql2/promise";
import { canHandleSecretariat } from "@/lib/correspondence-workflow";
import type { SessionUser } from "@/lib/types";

export function canPrepareOutgoingSignature(user: SessionUser, letter: RowDataPacket) {
  if (letter.direction !== "OUTGOING" || letter.status !== (letter.uses_secretariat ? "WAITING_SIGNATURE" : "READY_TO_ISSUE")) return false;
  return canHandleSecretariat(user.role) || (user.role === "STAFF" && letter.created_by === user.id);
}

export function uploadedOutgoingSignatureMethod(value: unknown) {
  return value === "DIGITAL" || value === "BASAH" || value === "MEKARI_MANUAL" ? value : null;
}
