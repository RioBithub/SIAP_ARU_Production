// Development regression tests. Node >=22.13 supplies the isolated in-memory SQLite database.
// Application routes execute unchanged; this adapter translates MySQL syntax for the test database.
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const ts = require("typescript");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "siap-workflow-test-"));
process.env.UPLOAD_DIR = storage;
const sql = new DatabaseSync(":memory:");
sql.exec("PRAGMA foreign_keys=ON");
sql.function("UTC_TIMESTAMP", () =>
  new Date().toISOString().slice(0, 19).replace("T", " "),
);
sql.function("IF", (condition, yes, no) => (condition ? yes : no));
sql.function("DATE_FORMAT", (value, format) => {
  if (!value) return null;
  const iso = String(value).replace(" ", "T");
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n) => String(n).padStart(2, "0");
  return format.replace(
    /%[YmdHis]/g,
    (part) =>
      ({
        "%Y": d.getUTCFullYear(),
        "%m": pad(d.getUTCMonth() + 1),
        "%d": pad(d.getUTCDate()),
        "%H": pad(d.getUTCHours()),
        "%i": pad(d.getUTCMinutes()),
        "%s": pad(d.getUTCSeconds()),
      })[part],
  );
});
sql.exec(`
CREATE TABLE siap_users(id TEXT PRIMARY KEY,name TEXT,email TEXT,role TEXT,unit_name TEXT,is_active INTEGER DEFAULT 1);
CREATE TABLE siap_number_formats(id TEXT PRIMARY KEY,pattern TEXT,document_type TEXT,sequence_start INTEGER,is_active INTEGER DEFAULT 1,name TEXT,code TEXT);
CREATE TABLE siap_document_types(id TEXT PRIMARY KEY,code TEXT,direction TEXT,is_active INTEGER DEFAULT 1);
CREATE TABLE siap_letters(id TEXT PRIMARY KEY,direction TEXT,document_type TEXT,number_format_id TEXT,letter_number TEXT,external_number TEXT,subject TEXT,sender TEXT,recipient TEXT,letter_date TEXT,received_date TEXT,issued_date TEXT,confidentiality TEXT,summary TEXT,notes TEXT,status TEXT,current_role TEXT,current_owner_user_id TEXT,routing_target_user_id TEXT,finance_reviewer_user_id TEXT,is_public INTEGER,is_backdated INTEGER,cancelled_reason TEXT,created_by TEXT,updated_by TEXT,legacy_number_text TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE siap_number_ledger(id TEXT PRIMARY KEY,format_id TEXT,letter_id TEXT,number_year INTEGER,letter_date TEXT,seq_base INTEGER,variant INTEGER,rendered_number TEXT,status TEXT,created_by TEXT,cancelled_reason TEXT,UNIQUE(format_id,number_year,seq_base,variant));
CREATE TABLE siap_letter_actions(id TEXT PRIMARY KEY,letter_id TEXT,actor_user_id TEXT,action TEXT,from_status TEXT,to_status TEXT,comment TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE siap_dispositions(id TEXT PRIMARY KEY,letter_id TEXT,parent_id TEXT,from_user_id TEXT,to_user_id TEXT,current_owner_user_id TEXT,visibility TEXT,instruction TEXT,status TEXT,priority TEXT,due_date TEXT,result_note TEXT,submitted_at TEXT,reviewed_at TEXT,return_note TEXT,seen_at TEXT,started_at TEXT,completed_at TEXT,returned_at TEXT,review_step_index INTEGER DEFAULT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE siap_disposition_actions(id TEXT PRIMARY KEY,disposition_id TEXT,actor_user_id TEXT,action TEXT,from_status TEXT,to_status TEXT,note TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE siap_disposition_reviewers(disposition_id TEXT,step_order INTEGER,user_id TEXT,reviewer_role TEXT,PRIMARY KEY(disposition_id,step_order));
CREATE TABLE siap_letter_reads(letter_id TEXT,user_id TEXT,first_read_at TEXT,PRIMARY KEY(letter_id,user_id));
CREATE TABLE siap_attachments(id TEXT PRIMARY KEY,letter_id TEXT,letter_action_id TEXT,disposition_id TEXT,disposition_action_id TEXT,attachment_kind TEXT,original_name TEXT,stored_name TEXT,storage_path TEXT,mime_type TEXT,original_size INTEGER,stored_size INTEGER,is_compressed INTEGER,uploaded_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE siap_audit_logs(id INTEGER PRIMARY KEY,user_id TEXT,action TEXT,entity_type TEXT,entity_id TEXT,metadata_json TEXT,ip_address TEXT,user_agent TEXT);
`);
const actors = {};
for (const [id, role] of [
  ["root", "ROOT_ADMIN"],
  ["staff", "STAFF"],
  ["staff2", "STAFF"],
  ["finance", "FINANCE"],
  ["finance2", "FINANCE"],
  ["manager", "MANAGER"],
  ["manager2", "MANAGER"],
  ["dirops", "DIRECTOR_OPS"],
  ["dirut", "PRESIDENT_DIRECTOR"],
]) {
  actors[id] = {
    id,
    name: id,
    email: id + "@example.test",
    role,
    unit_name: "Unit " + id,
  };
  sql
    .prepare(
      "INSERT INTO siap_users(id,name,email,role,unit_name) VALUES(?,?,?,?,?)",
    )
    .run(id, id, actors[id].email, role, actors[id].unit_name);
}
sql.exec(
  `INSERT INTO siap_number_formats(id,pattern,document_type,sequence_start,name,code) VALUES('fmt','{seq}/ARU/{year}','SURAT_UMUM',1,'Umum','UMUM'); INSERT INTO siap_document_types(id,code,direction) VALUES('type','SURAT_UMUM','OUTGOING');`,
);
let actor = actors.staff;
let failAudit = false;
async function query(statement, params = []) {
  if (failAudit && /INSERT INTO siap_audit_logs/i.test(statement))
    throw new Error("Injected audit failure");
  const translated = statement
    .replace(/\s+FOR UPDATE\b/gi, "")
    .replace(/INSERT IGNORE INTO/gi, "INSERT OR IGNORE INTO");
  const values = params.map((v) =>
    v instanceof Date
      ? v.toISOString().slice(0, 19).replace("T", " ")
      : v === undefined
        ? null
        : v,
  );
  // sqlite validates column names and parameter counts for every application query.
  const prepared = sql.prepare(translated);
  if (/^\s*(SELECT|WITH)/i.test(translated))
    return [prepared.all(...values), []];
  const r = prepared.run(...values);
  return [
    { affectedRows: Number(r.changes), insertId: Number(r.lastInsertRowid) },
    [],
  ];
}
const db = { query, execute: query };
const dbModule = {
  db,
  withTransaction: async (fn) => {
    sql.exec("BEGIN");
    try {
      const r = await fn(db);
      sql.exec("COMMIT");
      return r;
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  },
};
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  cache.set(filename, mod);
  const nativeRequire = mod.require.bind(mod);
  mod.require = (name) => {
    if (name === "@/lib/db") return dbModule;
    if (name === "@/lib/auth") return { getCurrentUser: async () => actor };
    if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
    return nativeRequire(name);
  };
  mod._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return mod.exports;
}
const letters = load("app/api/letters/route.ts");
const letterDetail = load("app/api/letters/[id]/route.ts");
const letterActions = load("app/api/letters/[id]/actions/route.ts");
const read = load("app/api/letters/[id]/read/route.ts");
const dispositions = load("app/api/dispositions/route.ts");
const dispDetail = load("app/api/dispositions/[id]/route.ts");
const dispActions = load("app/api/dispositions/[id]/actions/route.ts");
const download = load("app/api/attachments/[id]/route.ts");
const policies = load("lib/workflow-policy.ts");
const uploads = load("lib/upload.ts");
const uploadPolicy = load("lib/upload-policy.ts");
async function call(route, method, who, body, id) {
  actor = who ? actors[who] : null;
  const multipart = body instanceof FormData;
  const request = new Request("http://localhost/api/test", {
    method,
    ...(method !== "GET"
      ? {
          body: multipart ? body : JSON.stringify(body || {}),
          headers: multipart ? {} : { "content-type": "application/json" },
        }
      : {}),
  });
  const response = await route[method](request, { params: { id } });
  const content = await response.json();
  return { status: response.status, ...content };
}
const getLetter = (id) =>
  sql.prepare("SELECT * FROM siap_letters WHERE id=?").get(id);
const getTask = (id) =>
  sql.prepare("SELECT * FROM siap_dispositions WHERE id=?").get(id);
async function createLetter(who = "staff", fields = {}) {
  const r = await call(letters, "POST", who, {
    direction: "INCOMING",
    document_type: "SURAT_MASUK_UMUM",
    external_number: "INV/TEST",
    sender: "PT Penguji",
    subject: "Undangan tender pengujian",
    letter_date: "2026-10-30",
    routing_target_user_id: "manager",
    is_public: false,
    ...fields,
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  return r.data.id;
}
async function letterAction(who, id, action, extra = {}) {
  return call(letterActions, "POST", who, { action, ...extra }, id);
}
async function taskAction(who, id, action, extra = {}) {
  return call(
    dispActions,
    "POST",
    who,
    { action, note: "Catatan pengujian", ...extra },
    id,
  );
}
async function approveIncoming(id, withFinance = false) {
  if (withFinance)
    assert.equal((await letterAction("finance", id, "APPROVE")).status, 200);
  for (const who of ["manager", "dirops", "dirut"])
    assert.equal((await letterAction(who, id, "APPROVE")).status, 200);
}
async function createTask(who, letterId, to, extra = {}) {
  const r = await call(dispositions, "POST", who, {
    letter_id: letterId,
    to_user_id: to,
    instruction: "Telaah dan tindak lanjuti",
    visibility: "PRIVATE",
    manager_user_id: "manager",
    ...extra,
  });
  assert.equal(r.status, 201, JSON.stringify(r));
  return r.data.id;
}
function count(table) {
  return sql.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
}
function storedFiles() {
  return fs
    .readdirSync(storage, { recursive: true })
    .filter((p) => fs.statSync(path.join(storage, p)).isFile());
}

test("Staff keeps direct Manager route and can opt into Finance; Finance cannot register incoming", async () => {
  const plain = await createLetter();
  assert.equal(getLetter(plain).status, "MANAGER_REVIEW");
  const via = await createLetter("staff", {
    finance_reviewer_user_id: "finance",
  });
  assert.equal(getLetter(via).status, "FINANCE_REVIEW");
  assert.equal((await letterAction("finance2", via, "APPROVE")).ok, false);
  assert.equal((await letterAction("manager2", plain, "APPROVE")).ok, false);
  assert.equal((await letterAction("finance", via, "APPROVE")).status, 200);
  assert.equal(getLetter(via).current_owner_user_id, "manager");
  assert.equal(
    (await call(letters, "POST", "finance", { direction: "INCOMING" })).status,
    403,
  );
});

test("Early leadership visibility and idempotent explicit read receipt never approve or edit a letter", async () => {
  const id = await createLetter("staff", {
    finance_reviewer_user_id: "finance",
  });
  assert.equal(
    (await call(letterDetail, "GET", "dirut", null, id)).status,
    200,
  );
  const before = { ...getLetter(id) };
  assert.equal((await letterAction("dirut", id, "APPROVE")).ok, false);
  assert.equal(
    (await letterAction("dirut", id, "ADD_NOTE", { comment: "Attempt" })).ok,
    false,
  );
  assert.equal((await call(read, "POST", "dirut", {}, id)).status, 200);
  const first = sql
    .prepare("SELECT * FROM siap_letter_reads WHERE letter_id=?")
    .get(id);
  assert.equal((await call(read, "POST", "dirut", {}, id)).status, 200);
  assert.deepEqual({ ...getLetter(id) }, before);
  assert.deepEqual(
    {
      ...sql
        .prepare("SELECT * FROM siap_letter_reads WHERE letter_id=?")
        .get(id),
    },
    { ...first },
  );
  assert.equal(
    sql
      .prepare(
        "SELECT COUNT(*) n FROM siap_audit_logs WHERE entity_id=? AND action='LETTER_READ'",
      )
      .get(id).n,
    1,
  );
  assert.equal(
    (await call(letterDetail, "GET", "staff2", null, id)).status,
    403,
  );
  const secret = await createLetter("staff", {
    confidentiality: "RAHASIA",
    finance_reviewer_user_id: "finance",
  });
  assert.equal(
    (await call(letterDetail, "GET", "dirut", null, secret)).status,
    403,
  );
  assert.equal(
    (await call(letterDetail, "GET", "manager", null, secret)).status,
    200,
  );
  assert.equal((await call(read, "POST", "staff2", {}, secret)).status, 403);
});

test("Return via Finance and resubmit follow the selected route; direct route remains direct", async () => {
  const id = await createLetter("staff", {
    finance_reviewer_user_id: "finance",
  });
  await letterAction("finance", id, "APPROVE");
  await letterAction("manager", id, "RETURN", {
    comment: "Lengkapi telaah Finance",
  });
  assert.equal(getLetter(id).status, "FINANCE_REVIEW");
  await letterAction("finance", id, "RETURN", { comment: "Lengkapi dokumen" });
  assert.equal(getLetter(id).status, "RETURNED_STAFF");
  assert.equal(getLetter(id).current_owner_user_id, "staff");
  assert.equal((await letterAction("staff2", id, "SUBMIT")).ok, false);
  await letterAction("staff", id, "SUBMIT");
  assert.equal(getLetter(id).status, "FINANCE_REVIEW");
  const direct = await createLetter();
  await letterAction("manager", direct, "RETURN", { comment: "Revisi" });
  await letterAction("staff", direct, "SUBMIT");
  assert.equal(getLetter(direct).status, "MANAGER_REVIEW");
});

test("Finance Nota Dinas goes to Manager and can finish there; Staff Nota Dinas may use Finance", async () => {
  const id = await createLetter("finance", {
    direction: "INTERNAL",
    document_type: "NOTA_DINAS",
  });
  await letterAction("finance", id, "SUBMIT");
  assert.equal(getLetter(id).status, "MANAGER_REVIEW");
  await letterAction("manager", id, "RETURN", { comment: "Revisi Nota Dinas" });
  assert.equal(getLetter(id).current_role, "FINANCE");
  await letterAction("finance", id, "SUBMIT");
  await letterAction("manager", id, "APPROVE_FINAL");
  assert.equal(getLetter(id).status, "APPROVED");
  const staffNote = await createLetter("staff", {
    direction: "INTERNAL",
    document_type: "NOTA_DINAS",
    finance_reviewer_user_id: "finance",
  });
  await letterAction("staff", staffNote, "SUBMIT");
  assert.equal(getLetter(staffNote).status, "FINANCE_REVIEW");
  assert.equal(
    (await letterAction("finance", staffNote, "APPROVE_FINAL")).ok,
    false,
  );
});

test("Outgoing approval never issues automatically, every return goes to author and numbering remains reserved", async () => {
  const id = await createLetter("staff", {
    direction: "OUTGOING",
    document_type: "SURAT_UMUM",
    recipient: "Mitra",
    number_format_id: "fmt",
  });
  await letterAction("staff", id, "SUBMIT");
  await letterAction("manager", id, "APPROVE");
  await letterAction("dirops", id, "RETURN", { comment: "Revisi penawaran" });
  assert.equal(getLetter(id).status, "RETURNED_STAFF");
  await letterAction("staff", id, "SUBMIT");
  for (const who of ["manager", "dirops", "dirut"])
    await letterAction(who, id, "APPROVE");
  assert.equal(getLetter(id).status, "READY_TO_ISSUE");
  assert.equal(
    sql
      .prepare("SELECT status FROM siap_number_ledger WHERE letter_id=?")
      .get(id).status,
    "RESERVED",
  );
  assert.equal((await letterAction("dirut", id, "ISSUE")).ok, false);
  await letterAction("staff", id, "ISSUE");
  assert.equal(getLetter(id).status, "ISSUED");
  const issuedDate = getLetter(id).issued_date;
  await letterAction("staff", id, "ADD_NOTE", {
    comment: "Catatan setelah terbit",
  });
  assert.equal(getLetter(id).issued_date, issuedDate);
  assert.equal(
    sql
      .prepare("SELECT status FROM siap_number_ledger WHERE letter_id=?")
      .get(id).status,
    "ISSUED",
  );
});

test("Finance creates Staff tasks and their results require Finance then the selected Manager", async () => {
  const id = await createLetter("staff", {
    finance_reviewer_user_id: "finance",
  });
  await approveIncoming(id, true);
  const task = await createTask("finance", id, "staff");
  await taskAction("staff", task, "START");
  await taskAction("staff", task, "SUBMIT_RESULT");
  assert.equal(getTask(task).status, "REVIEW_FINANCE");
  await taskAction("finance", task, "APPROVE_RESULT");
  assert.equal(getTask(task).status, "REVIEW_MANAGER");
  assert.equal(
    (await taskAction("manager2", task, "APPROVE_RESULT")).ok,
    false,
  );
  await taskAction("manager", task, "APPROVE_RESULT");
  assert.equal(getTask(task).status, "COMPLETED");
  assert.equal(
    (
      await call(dispositions, "POST", "finance", {
        letter_id: id,
        to_user_id: "manager",
        instruction: "Wrong direction",
      })
    ).ok,
    false,
  );
});

test("Linked Manager → Finance → Staff tasks block premature submission and return results through the original chain", async () => {
  const letter = await createLetter();
  await approveIncoming(letter);
  const top = await createTask("dirut", letter, "manager");
  await taskAction("manager", top, "START");
  const child = await createTask("manager", letter, "finance", {
    parent_id: top,
  });
  await taskAction("finance", child, "START");
  const grandchild = await createTask("finance", letter, "staff", {
    parent_id: child,
  });
  await taskAction("staff", grandchild, "START");
  assert.equal((await taskAction("finance", child, "SUBMIT_RESULT")).ok, false);
  assert.equal((await taskAction("manager", top, "SUBMIT_RESULT")).ok, false);
  await taskAction("staff", grandchild, "RETURN_TASK");
  assert.equal((await taskAction("finance", child, "SUBMIT_RESULT")).ok, false);
  await taskAction("finance", grandchild, "RESEND");
  await taskAction("staff", grandchild, "START");
  await taskAction("staff", grandchild, "SUBMIT_RESULT");
  await taskAction("finance", grandchild, "APPROVE_RESULT");
  assert.equal(getTask(grandchild).status, "COMPLETED");
  assert.equal(getTask(child).status, "IN_PROGRESS");
  await taskAction("finance", child, "SUBMIT_RESULT");
  assert.equal(getTask(child).current_owner_user_id, "manager");
  await taskAction("manager", child, "APPROVE_RESULT");
  await taskAction("manager", top, "SUBMIT_RESULT");
  assert.equal(getTask(top).status, "REVIEW_DIROPS");
  await taskAction("dirops", top, "APPROVE_RESULT");
  assert.equal(getTask(top).status, "REVIEW_DIRUT");
  await taskAction("dirut", top, "APPROVE_RESULT");
  assert.equal(getTask(top).status, "COMPLETED");
  assert.equal(getLetter(letter).status, "COMPLETED");
});

test("Primary Word/PDF stays byte-for-byte unchanged; extra files compress and private task files remain restricted", async () => {
  const mainBytes = Buffer.from("Word document bytes ".repeat(100));
  const original = await uploads.saveUpload(
    new File([mainBytes], "nota.docx"),
    "ORIGINAL",
  );
  assert.equal(original.isCompressed, false);
  assert.deepEqual(fs.readFileSync(original.storagePath), mainBytes);
  const extra = await uploads.saveUpload(
    new File(["Evidence ".repeat(1000)], "bukti.txt"),
    "ADDITIONAL",
  );
  assert.equal(extra.isCompressed, true);
  assert.equal(
    (await uploads.readStoredFile(extra.storagePath, true)).toString(),
    "Evidence ".repeat(1000),
  );
  const letter = await createLetter("staff", { is_public: true });
  await approveIncoming(letter);
  const task = await createTask("manager", letter, "finance");
  const body = new FormData();
  body.set("action", "ADD_NOTE");
  body.set("note", "Dokumen pendukung");
  body.append("files", new File(["Data pendukung ".repeat(100)], "bukti.pdf"));
  const before = { ...getTask(task) };
  assert.equal(
    (await call(dispActions, "POST", "finance", body, task)).status,
    200,
  );
  assert.equal(getTask(task).status, before.status);
  assert.equal(
    getTask(task).current_owner_user_id,
    before.current_owner_user_id,
  );
  const f = sql
    .prepare("SELECT * FROM siap_attachments WHERE disposition_id=?")
    .get(task);
  actor = actors.staff2;
  assert.equal(
    (
      await download.GET(new Request("http://localhost/file"), {
        params: { id: f.id },
      })
    ).status,
    403,
  );
  actor = actors.finance;
  const response = await download.GET(new Request("http://localhost/file"), {
    params: { id: f.id },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "Data pendukung ".repeat(100));
  const metadata = await call(letterDetail, "GET", "staff2", null, letter);
  assert.equal(metadata.data.attachments.length, 0);
});

test("File counts and raw sizes are enforced before writes, and audit failure rolls back both record and files", async () => {
  assert.throws(
    () =>
      uploadPolicy.assertUploadSelection(
        Array.from({ length: 6 }, () => ({ name: "x.pdf", size: 1 })),
      ),
    /5/,
  );
  assert.throws(
    () =>
      uploadPolicy.assertUploadSelection([
        { name: "x.pdf", size: 10 * 1024 * 1024 + 1 },
      ]),
    /10 MB/,
  );
  assert.throws(
    () =>
      uploadPolicy.assertDocumentUploads(
        { name: "main.pdf", size: 10 * 1024 * 1024 },
        Array.from({ length: 5 }, () => ({
          name: "x.pdf",
          size: 10 * 1024 * 1024,
        })),
      ),
    /50 MB/,
  );
  const before = count("siap_letters"),
    filesBefore = storedFiles().length;
  const invalid = new FormData();
  invalid.set("direction", "INCOMING");
  invalid.append("original_file", new File(["bad"], "malware.exe"));
  assert.equal((await call(letters, "POST", "staff", invalid)).ok, false);
  assert.equal(count("siap_letters"), before);
  const body = new FormData();
  for (const [key, value] of Object.entries({
    direction: "INCOMING",
    document_type: "SURAT_MASUK_UMUM",
    external_number: "FAIL",
    sender: "Test",
    subject: "Rollback",
    letter_date: "2026-10-30",
    routing_target_user_id: "manager",
  }))
    body.set(key, value);
  body.append("original_file", new File(["Primary"], "main.pdf"));
  body.append(
    "additional_files",
    new File(["extra ".repeat(100)], "extra.txt"),
  );
  failAudit = true;
  const response = await call(letters, "POST", "staff", body);
  failAudit = false;
  assert.equal(response.ok, false);
  assert.equal(count("siap_letters"), before);
  assert.equal(storedFiles().length, filesBefore);
});

test("List, detail, read filters and linked-task permissions execute with the same access rules", async () => {
  const letter = await createLetter("staff", {
    finance_reviewer_user_id: "finance",
  });
  const listed = await call(letters, "GET", "finance");
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.ok(listed.data.some((l) => l.id === letter));
  await approveIncoming(letter, true);
  const task = await createTask("manager", letter, "finance");
  await taskAction("finance", task, "START");
  const child = await createTask("finance", letter, "staff", {
    parent_id: task,
  });
  const details = await call(dispDetail, "GET", "manager", null, task);
  assert.equal(details.status, 200, JSON.stringify(details));
  assert.equal(details.data.children[0].id, child);
  assert.equal(
    (await call(dispDetail, "GET", "manager", null, child)).status,
    200,
  );
  assert.equal(
    (await call(dispDetail, "GET", "staff2", null, child)).status,
    403,
  );
  const list = await call(dispositions, "GET", "finance");
  assert.equal(list.status, 200, JSON.stringify(list));
  assert.equal((await call(read, "POST", null, {}, letter)).status, 401);
});

test("Legacy dispositions retain their old review chain and later notes preserve completion time", async () => {
  const letter = await createLetter();
  await approveIncoming(letter);
  sql
    .prepare(
      "INSERT INTO siap_dispositions(id,letter_id,from_user_id,to_user_id,current_owner_user_id,visibility,instruction,status,priority) VALUES('legacy-task',?,'dirut','staff','staff','PRIVATE','Legacy task','IN_PROGRESS','NORMAL')",
    )
    .run(letter);
  await taskAction("staff", "legacy-task", "SUBMIT_RESULT");
  assert.equal(getTask("legacy-task").status, "REVIEW_DIROPS");
  await taskAction("dirops", "legacy-task", "APPROVE_RESULT");
  assert.equal(getTask("legacy-task").status, "REVIEW_DIRUT");
  await taskAction("dirut", "legacy-task", "APPROVE_RESULT");
  assert.equal(getTask("legacy-task").status, "COMPLETED");
  sql.exec(
    "UPDATE siap_dispositions SET completed_at='2026-10-01 10:00:00' WHERE id='legacy-task'",
  );
  await taskAction("dirut", "legacy-task", "ADD_NOTE");
  assert.equal(getTask("legacy-task").completed_at, "2026-10-01 10:00:00");
});

test("Policy routes keep Finance optional and reject upward delegation", () => {
  assert.deepEqual(policies.dispositionTargetRoles("FINANCE"), ["STAFF"]);
  assert.equal(
    policies.initialLetterReview({
      direction: "INCOMING",
      created_by: "s",
      routing_target_user_id: "m",
    }).status,
    "MANAGER_REVIEW",
  );
  assert.throws(() =>
    policies.buildDispositionReviewRoute({
      originator: { userId: "f", role: "FINANCE" },
      assignee: { userId: "m", role: "MANAGER" },
    }),
  );
  const route = policies.buildDispositionReviewRoute({
    originator: { userId: "p", role: "PRESIDENT_DIRECTOR" },
    assignee: { userId: "f", role: "FINANCE" },
    manager: { userId: "m", role: "MANAGER" },
    dirops: { userId: "d", role: "DIRECTOR_OPS" },
  });
  assert.deepEqual(
    route.map((r) => r.role),
    ["MANAGER", "DIRECTOR_OPS", "PRESIDENT_DIRECTOR"],
  );
});

after(() => {
  sql.close();
  fs.rmSync(storage, { recursive: true, force: true });
});
