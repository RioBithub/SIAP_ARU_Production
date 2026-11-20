export const demoRoles = [
  ["staff", "STAFF", "Operasional", "Staff Operasional"],
  ["sdm", "STAFF", "SDM", "Staff SDM"],
  ["staffkeu", "STAFF", "Keuangan", "Staff Keuangan"],
  ["it", "STAFF", "IT & Sistem", "Staff IT"],
  ["secretariat", "SECRETARIAT", "Sekretariat", "Sekretariat"],
  ["ops", "MANAGER", "Operasional", "Manager Operasional"],
  ["ksu", "MANAGER", "Keuangan, SDM & Umum", "Manager Keuangan, SDM & Umum"],
  ["gedung", "MANAGER", "Gedung", "Manager Gedung Historis"],
  ["dirops", "DIRECTOR_OPS", null, "Dirops"],
  ["dirut", "PRESIDENT_DIRECTOR", null, "Dirut"],
  ["finance", "FINANCE", "Keuangan", "Finance"],
  ["root", "ROOT_ADMIN", "IT & Sistem", "Root Admin"],
];

export const devRoles = demoRoles.filter(([key]) => !["sdm", "staffkeu", "it", "gedung"].includes(key));

export async function chooseDevAccounts(admin, ask) {
  const [users] = await admin.query(
    `SELECT id,name,email,role,unit_name FROM aru_siap.siap_users
     WHERE is_active=1 AND role IN ('ROOT_ADMIN','STAFF','SECRETARIAT','MANAGER','DIRECTOR_OPS','PRESIDENT_DIRECTOR','FINANCE')
     ORDER BY name,email`,
  );
  let managerIds = {};
  try {
    const [managers] = await admin.query("SELECT scope,user_id FROM aru_siap.siap_v11_managers WHERE scope IN ('OPS','KSU')");
    managerIds = Object.fromEntries(managers.map(row => [row.scope.toLowerCase(), row.user_id]));
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
  }
  const chosen = {};
  for (const [key, role, unit, label] of devRoles) {
    const available = users.filter(user => user.role === role && !Object.values(chosen).some(picked => picked.id === user.id) &&
      (key !== "staff" || /^(ops|(?:unit\s+)?operasional)$/i.test(user.unit_name?.trim() ?? "")));
    if (!available.length) throw new Error("Tidak ada akun sumber yang cocok untuk " + label + ".");
    const preferred = available.find(user => user.id === managerIds[key])
      ?? available.find(user => role === "MANAGER" && user.unit_name?.toLowerCase() === unit?.toLowerCase());
    if (available.length === 1) {
      chosen[key] = available[0];
      continue;
    }
    console.log(label);
    for (const [i, user] of available.entries()) {
      console.log("  " + (i + 1) + "  " + user.name + " <" + user.email + ">" + (user.unit_name ? " · " + user.unit_name : ""));
    }
    const fallback = preferred ? String(available.indexOf(preferred) + 1) : "";
    const index = Number(await ask("Pilih nomor akun " + label, { fallback })) - 1;
    if (!Number.isInteger(index) || !available[index]) throw new Error("Nomor akun " + label + " belum valid.");
    chosen[key] = available[index];
  }
  return chosen;
}
