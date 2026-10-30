import type { Role } from "@/lib/types";

export type Reviewer = { userId: string; role: Role };
export type LetterRoute = {
  direction: string;
  created_by: string;
  routing_target_user_id: string | null;
  finance_reviewer_user_id?: string | null;
};

export function dispositionTargetRoles(role: string): Role[] {
  const targets: Record<string, Role[]> = {
    ROOT_ADMIN: [
      "PRESIDENT_DIRECTOR",
      "DIRECTOR_OPS",
      "MANAGER",
      "FINANCE",
      "STAFF",
    ],
    PRESIDENT_DIRECTOR: ["DIRECTOR_OPS", "MANAGER", "FINANCE", "STAFF"],
    DIRECTOR_OPS: ["MANAGER", "FINANCE", "STAFF"],
    MANAGER: ["FINANCE", "STAFF"],
    FINANCE: ["STAFF"],
  };
  return targets[role] || [];
}

export function letterReviewRole(status: string): Role | null {
  const roles: Record<string, Role> = {
    FINANCE_REVIEW: "FINANCE",
    MANAGER_REVIEW: "MANAGER",
    DIRECTOR_OPS_REVIEW: "DIRECTOR_OPS",
    PRESIDENT_DIRECTOR_REVIEW: "PRESIDENT_DIRECTOR",
  };
  return roles[status] || null;
}

export function initialLetterReview(letter: LetterRoute) {
  if (letter.direction !== "OUTGOING" && letter.finance_reviewer_user_id) {
    return {
      status: "FINANCE_REVIEW",
      role: "FINANCE" as Role,
      userId: letter.finance_reviewer_user_id,
    };
  }
  if (!letter.routing_target_user_id)
    throw new Error("Manager tujuan belum dipilih.");
  return {
    status: "MANAGER_REVIEW",
    role: "MANAGER" as Role,
    userId: letter.routing_target_user_id,
  };
}

export function returnedLetterReview(
  letter: LetterRoute,
  status: string,
  diropsId?: string,
) {
  if (
    letter.direction === "OUTGOING" ||
    status === "FINANCE_REVIEW" ||
    (status === "MANAGER_REVIEW" && !letter.finance_reviewer_user_id)
  ) {
    return { status: "RETURNED_STAFF", role: null, userId: letter.created_by };
  }
  if (status === "MANAGER_REVIEW")
    return {
      status: "FINANCE_REVIEW",
      role: "FINANCE" as Role,
      userId: letter.finance_reviewer_user_id!,
    };
  if (status === "DIRECTOR_OPS_REVIEW" && letter.routing_target_user_id)
    return {
      status: "MANAGER_REVIEW",
      role: "MANAGER" as Role,
      userId: letter.routing_target_user_id,
    };
  if (status === "PRESIDENT_DIRECTOR_REVIEW" && diropsId)
    return {
      status: "DIRECTOR_OPS_REVIEW",
      role: "DIRECTOR_OPS" as Role,
      userId: diropsId,
    };
  throw new Error("Jalur pengembalian dokumen tidak ditemukan.");
}

export function dispositionReviewStatus(role: Role) {
  const statuses: Partial<Record<Role, string>> = {
    ROOT_ADMIN: "REVIEW_ROOT",
    FINANCE: "REVIEW_FINANCE",
    MANAGER: "REVIEW_MANAGER",
    DIRECTOR_OPS: "REVIEW_DIROPS",
    PRESIDENT_DIRECTOR: "REVIEW_DIRUT",
  };
  const status = statuses[role];
  if (!status) throw new Error("Role pemeriksa hasil tidak valid.");
  return status;
}

export function buildDispositionReviewRoute(input: {
  originator: Reviewer;
  assignee: Reviewer;
  manager?: Reviewer | null;
  dirops?: Reviewer | null;
  parentId?: string | null;
}): Reviewer[] {
  const { originator, assignee, manager, dirops, parentId } = input;
  if (
    !dispositionTargetRoles(originator.role).includes(assignee.role) ||
    originator.userId === assignee.userId
  )
    throw new Error("Penerima tidak sesuai jalur delegasi disposisi.");
  // A child returns to its delegator. The parent keeps its original review path.
  if (
    parentId ||
    originator.role === "ROOT_ADMIN" ||
    originator.role === "MANAGER"
  )
    return [originator];
  const route: Reviewer[] = [];
  if (originator.role === "FINANCE") route.push(originator);
  if (["FINANCE", "STAFF"].includes(assignee.role)) {
    if (!manager || manager.role !== "MANAGER")
      throw new Error("Pilih Manager pemeriksa hasil untuk jalur ini.");
    route.push(manager);
  }
  if (
    originator.role === "PRESIDENT_DIRECTOR" &&
    assignee.role !== "DIRECTOR_OPS"
  ) {
    if (!dirops || dirops.role !== "DIRECTOR_OPS")
      throw new Error("Direktur Operasional aktif tidak ditemukan.");
    route.push(dirops);
  }
  if (originator.role !== "FINANCE") route.push(originator);
  return route;
}
