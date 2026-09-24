export type Role =
  | "ROOT_ADMIN"
  | "STAFF"
  | "MANAGER"
  | "DIRECTOR_OPS"
  | "PRESIDENT_DIRECTOR"
  | "FINANCE";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  unit_name: string | null;
};

export const ROLE_LABELS: Record<Role, string> = {
  ROOT_ADMIN: "Root Admin",
  STAFF: "Staff Administrasi",
  MANAGER: "Manager",
  DIRECTOR_OPS: "Direktur Operasional",
  PRESIDENT_DIRECTOR: "Direktur Utama",
  FINANCE: "Finance",
};

export const FINANCE_VIEW_ROLES: Role[] = [
  "ROOT_ADMIN", "FINANCE", "MANAGER", "DIRECTOR_OPS", "PRESIDENT_DIRECTOR"
];

export const FINANCE_EDIT_ROLES: Role[] = ["ROOT_ADMIN", "FINANCE"];
export const ROOT_ONLY: Role[] = ["ROOT_ADMIN"];
