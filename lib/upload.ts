import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";
import { assertUploadSelection, MAX_FILE_BYTES } from "@/lib/upload-policy";
export { MAX_FILE_BYTES, MAX_FILES_PER_ACTION, MAX_ACTION_BYTES } from "@/lib/upload-policy";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

const ALLOWED_EXT = new Set([".pdf",".doc",".docx",".xls",".xlsx",".png",".jpg",".jpeg",".txt",".csv"]);

export function validateUploadBatch(files: File[]) {
  assertUploadSelection(files);
  for (const file of files) {
    if (!ALLOWED_EXT.has(path.extname(safeFilename(file.name)).toLowerCase())) throw new Error("Tipe file tidak diizinkan.");
  }
}

function uploadRoot() {
  const configured = process.env.UPLOAD_DIR || "./storage";
  return path.resolve(process.cwd(), configured);
}

export function safeFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 180);
}

export async function saveUpload(file: File, kind: "ORIGINAL" | "ADDITIONAL") {
  validateUploadBatch([file]);
  if (file.size <= 0) throw new Error("File kosong.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Ukuran file maksimal 10 MB.");
  const originalName = safeFilename(file.name || "dokumen");
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error("Tipe file tidak diizinkan.");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > MAX_FILE_BYTES) throw new Error("Ukuran file maksimal 10 MB sebelum kompresi.");
  const dir = path.join(uploadRoot(), kind === "ORIGINAL" ? "originals" : "additional");
  await fs.mkdir(dir, { recursive: true });

  const id = crypto.randomUUID();
  if (kind === "ORIGINAL") {
    const storedName = `${id}${ext}`;
    const storagePath = path.join(dir, storedName);
    await fs.writeFile(storagePath, bytes);
    return {
      originalName, storedName, storagePath,
      mimeType: file.type || "application/octet-stream",
      originalSize: bytes.length, storedSize: bytes.length, isCompressed: false,
    };
  }

  const compressed = await gzipAsync(bytes, { level: 9 });
  if (compressed.length < bytes.length) {
    const storedName = `${id}${ext}.gz`;
    const storagePath = path.join(dir, storedName);
    await fs.writeFile(storagePath, compressed);
    return {
      originalName, storedName, storagePath,
      mimeType: file.type || "application/octet-stream",
      originalSize: bytes.length, storedSize: compressed.length, isCompressed: true,
    };
  }

  // PDF/DOCX/JPG often already compressed. Do not keep a larger gzip result.
  const storedName = `${id}${ext}`;
  const storagePath = path.join(dir, storedName);
  await fs.writeFile(storagePath, bytes);
  return {
    originalName, storedName, storagePath,
    mimeType: file.type || "application/octet-stream",
    originalSize: bytes.length, storedSize: bytes.length, isCompressed: false,
  };
}

export async function readStoredFile(storagePath: string, isCompressed: boolean) {
  const absoluteRoot = uploadRoot();
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(absoluteRoot + path.sep)) throw new Error("Lokasi file tidak valid.");
  const data = await fs.readFile(resolved);
  return isCompressed ? gunzipAsync(data, { maxOutputLength: MAX_FILE_BYTES }) : data;
}

export async function deleteStoredFile(storagePath: string) {
  const absoluteRoot = uploadRoot();
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(absoluteRoot + path.sep)) throw new Error("Lokasi file tidak valid.");
  try {
    await fs.unlink(resolved);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}
