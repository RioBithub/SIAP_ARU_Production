import {
  accounts, approvedIncoming, approveOutgoing, date, disposition, dispositionAction, expect,
  issue, multipart, outgoing, post, tag, test, textFile,
} from "./helpers.mjs";

test("DIS-01 | Dirut menugaskan PIC dan hasil melalui review Dirops lalu Dirut", async ({ api }) => {
  const letter = await approvedIncoming(api, "dirut");
  const task = await disposition(api, "dirut", letter.id, "staff", { priority: "HIGH", due_date: date });
  const listed = (await api("staff", "/api/dispositions")).find((row) => row.id === task.id);
  expect(listed).toMatchObject({ status: "UNSEEN", priority: "HIGH", to_user_id: accounts.staff.id });
  expect((await api("other", "/api/dispositions")).some((row) => row.id === task.id)).toBe(false);
  await dispositionAction(api, "staff", task.id, "SEEN", "SEEN");
  await dispositionAction(api, "staff", task.id, "START", "IN_PROGRESS");
  await dispositionAction(api, "staff", task.id, "SUBMIT_RESULT", "REVIEW_DIROPS", { note: "Tindak lanjut fiktif." });
  await dispositionAction(api, "dirops", task.id, "APPROVE_RESULT", "REVIEW_DIRUT");
  await dispositionAction(api, "dirut", task.id, "APPROVE_RESULT", "COMPLETED");
  expect((await api("dirut", `/api/letters/${letter.id}`)).letter.status).toBe("COMPLETED");
});

test("DIS-02 | Delegasi, surat hasil wajib terbit, dan persetujuan anak sebelum induk", async ({ api }) => {
  const original = await approvedIncoming(api);
  const parent = await disposition(api, "dirops", original.id, "manager", { result_requirement: "OUTGOING_LETTER" });
  await dispositionAction(api, "manager", parent.id, "START", "IN_PROGRESS");
  const child = await disposition(api, "manager", original.id, "staff", {
    parent_id: parent.id, result_requirement: "OUTGOING_LETTER",
  });
  await dispositionAction(api, "manager", parent.id, "SUBMIT_RESULT", null, { note: "Anak belum selesai." }, 400);
  await dispositionAction(api, "staff", child.id, "START", "IN_PROGRESS");

  const result = await outgoing(api, { source_disposition_id: child.id, routing_target_user_id: accounts.manager2.id });
  const detail = await api("staff", `/api/letters/${result.id}`);
  expect(detail.sourceLetter.id).toBe(original.id);
  expect(detail.sourceDisposition.id).toBe(child.id);
  await dispositionAction(api, "staff", child.id, "SUBMIT_RESULT", null, {
    note: "Masih draf", result_letter_id: result.id,
  }, 400);
  const search = `/api/dispositions/${child.id}/result-letters?q=${encodeURIComponent(detail.letter.subject)}`;
  expect(await api("staff", search)).toHaveLength(0);

  await approveOutgoing(api, result, "staff", "manager2");
  await issue(api, result.id);
  expect(await api("staff", search)).toEqual([expect.objectContaining({ id: result.id })]);
  await dispositionAction(api, "staff", child.id, "SUBMIT_RESULT", "REVIEW_MANAGER", {
    note: "Surat hasil terbit.", result_letter_id: result.id,
  });
  const reviewerFile = (await api("manager", `/api/letters/${result.id}`)).attachments[0];
  await api.response("manager", `/api/attachments/${reviewerFile.id}`);
  await api.response("other", `/api/attachments/${reviewerFile.id}`, { expect: 403 });
  await dispositionAction(api, "manager", child.id, "APPROVE_RESULT", "COMPLETED");
  await dispositionAction(api, "manager", parent.id, "SUBMIT_RESULT", "REVIEW_DIROPS", {
    note: "Hasil tugas turunan telah ditelaah.", result_letter_id: result.id,
  });
  await dispositionAction(api, "dirops", parent.id, "APPROVE_RESULT", "COMPLETED");
});

test("DIS-03 | Lampiran hasil wajib, review dikembalikan, dan kirim ulang", async ({ api }) => {
  const letter = await approvedIncoming(api);
  const task = await disposition(api, "root", letter.id, "staff", { result_requirement: "ATTACHMENT" });
  await dispositionAction(api, "staff", task.id, "START", "IN_PROGRESS");
  await dispositionAction(api, "staff", task.id, "SUBMIT_RESULT", null, { note: "Tanpa bukti." }, 400);
  const path = `/api/dispositions/${task.id}/actions`;
  const proof = textFile("hasil-disposisi.txt", "Bukti fiktif untuk tugas");
  const first = await api("staff", path, multipart({ action: "SUBMIT_RESULT", note: "Hasil awal", files: proof }));
  expect(first.status).toBe("REVIEW_ROOT");
  await dispositionAction(api, "root", task.id, "RETURN_RESULT", "IN_PROGRESS", { note: "Lengkapi uraian." });
  const revised = await api("staff", path, multipart({ action: "SUBMIT_RESULT", note: "Hasil revisi", files: proof }));
  expect(revised.status).toBe("REVIEW_ROOT");
  await dispositionAction(api, "root", task.id, "APPROVE_RESULT", "COMPLETED");
  const detail = await api("staff", `/api/dispositions/${task.id}`);
  expect(detail.attachments.some((item) => item.original_name === "hasil-disposisi.txt")).toBe(true);
});

test("DIS-04 | Kembalikan tugas dengan alasan dan arsip lampiran sesuai visibilitas", async ({ api }) => {
  const letter = await approvedIncoming(api, "manager");
  const task = await disposition(api, "manager", letter.id, "staff");
  await dispositionAction(api, "staff", task.id, "RETURN_TASK", null, {}, 400);
  const name = tag() + ".txt";
  const file = await api("staff", `/api/dispositions/${task.id}/attachments`, multipart({
    file: textFile(name),
  }, 201));
  expect((await api("manager", `/api/archive?q=${name}`)).some((item) => item.id === file.id)).toBe(true);
  expect(await api("other", `/api/archive?q=${name}`)).toHaveLength(0);
  await dispositionAction(api, "staff", task.id, "RETURN_TASK", "RETURNED", { note: "Perlu penugasan ulang." });
  expect((await api("manager", "/api/dispositions")).find((row) => row.id === task.id).status).toBe("RETURNED");
});

test("DIS-05 | Finance sebagai PIC dapat menyusun surat hasil dari disposisi aktif", async ({ api }) => {
  const letter = await approvedIncoming(api, "manager");
  const task = await disposition(api, "manager", letter.id, "finance", { result_requirement: "OUTGOING_LETTER" });
  await dispositionAction(api, "finance", task.id, "START", "IN_PROGRESS");
  await api("finance", "/api/letters", post({ direction: "OUTGOING" }, 403));
  const result = await outgoing(api, { source_disposition_id: task.id }, "finance");
  expect(result.status).toBe("DRAFT");
  await approveOutgoing(api, result, "finance");
  await issue(api, result.id);
  await dispositionAction(api, "finance", task.id, "SUBMIT_RESULT", "REVIEW_MANAGER", {
    note: "Surat hasil Finance terbit.", result_letter_id: result.id,
  });
  await dispositionAction(api, "manager", task.id, "APPROVE_RESULT", "COMPLETED");
});

test("DIS-06 | Beberapa PIC, visibilitas rute dan publik, serta status akhir gabungan", async ({ api }) => {
  const letter = await approvedIncoming(api, "manager");
  const first = await disposition(api, "manager", letter.id, "staff", { visibility: "ROUTE" });
  await api("other", `/api/dispositions/${first.id}`, { expect: 404 });
  const second = await disposition(api, "manager", letter.id, "other", { visibility: "PRIVATE" });
  const publicTask = await disposition(api, "manager", letter.id, "finance", { visibility: "PUBLIC" });
  expect((await api("other", `/api/dispositions/${first.id}`)).disposition.id).toBe(first.id);
  await api("staff", `/api/dispositions/${second.id}`, { expect: 404 });
  expect((await api("secretariat", `/api/dispositions/${publicTask.id}`)).disposition.id).toBe(publicTask.id);
  await dispositionAction(api, "other", first.id, "START", null, {}, 400);
  for (const [role, task] of [["staff", first], ["other", second], ["finance", publicTask]]) {
    await dispositionAction(api, role, task.id, "START", "IN_PROGRESS");
    await dispositionAction(api, role, task.id, "SUBMIT_RESULT", "REVIEW_MANAGER", { note: "Selesai, data fiktif" });
    await dispositionAction(api, "manager", task.id, "APPROVE_RESULT", "COMPLETED");
    const status = (await api("manager", `/api/letters/${letter.id}`)).letter.status;
    if (task === publicTask) expect(status).toBe("COMPLETED");
    else expect(status).not.toBe("COMPLETED");
  }
});
