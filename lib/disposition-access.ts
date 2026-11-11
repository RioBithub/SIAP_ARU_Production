import type { SessionUser } from "@/lib/types";

export function dispositionAccess(user: SessionUser) {
  if (user.role === "ROOT_ADMIN") return { clause: "1=1", params: [] };
  return {
    clause: `(
      d.visibility='PUBLIC' OR d.to_user_id=? OR d.from_user_id=? OR d.current_owner_user_id=?
      OR EXISTS (SELECT 1 FROM siap_disposition_actions a WHERE a.disposition_id=d.id AND a.actor_user_id=?)
      OR (d.visibility='ROUTE' AND EXISTS (
        SELECT 1 FROM siap_dispositions route WHERE route.letter_id=d.letter_id
          AND (route.to_user_id=? OR route.from_user_id=? OR route.current_owner_user_id=?)
      ))
    )`,
    params: Array<string>(7).fill(user.id),
  };
}
