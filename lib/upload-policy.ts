export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_ACTION = 5;
export const MAX_ACTION_BYTES = MAX_FILE_BYTES * MAX_FILES_PER_ACTION;

type UploadInfo = { name: string; size: number };
export function assertUploadSelection(files: UploadInfo[]) {
  if (files.length > MAX_FILES_PER_ACTION)
    throw new Error("Maksimal 5 lampiran per aksi.");
  for (const file of files) {
    if (file.size <= 0 || file.size > MAX_FILE_BYTES)
      throw new Error(
        "Ukuran setiap file harus lebih dari 0 dan maksimal 10 MB sebelum kompresi.",
      );
    if (!/\.(pdf|doc|docx|xls|xlsx|png|jpg|jpeg|txt|csv)$/i.test(file.name))
      throw new Error("Tipe file tidak diizinkan.");
  }
  if (files.reduce((n, f) => n + f.size, 0) > MAX_ACTION_BYTES)
    throw new Error("Total lampiran maksimal 50 MB per aksi sebelum kompresi.");
}

export function assertDocumentUploads(
  original: UploadInfo | null,
  additional: UploadInfo[],
) {
  if (original) assertUploadSelection([original]);
  assertUploadSelection(additional);
  if (
    (original?.size || 0) + additional.reduce((n, f) => n + f.size, 0) >
    MAX_ACTION_BYTES
  )
    throw new Error(
      "Total dokumen utama dan lampiran maksimal 50 MB sebelum kompresi.",
    );
}
