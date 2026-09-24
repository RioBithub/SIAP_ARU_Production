import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { gzip, gunzip } from "zlib";
import { promisify } from "util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set([".pdf",".doc",".docx",".xls",".xlsx",".png",".jpg",".jpeg",".txt",".csv"]);

function uploadRoot() {
  const configured = process.env.UPLOAD_DIR || "./storage";
  return path.resolve(process.cwd(), configured);
}

export function safeFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_").slice(0, 180);
}

export async function saveUpload(file: File, kind: "ORIGINAL" | "ADDITIONAL") {
  if (file.size <= 0) throw new Error("File kosong.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Ukuran file maksimal 10 MB.");
  const originalName = safeFilename(file.name || "dokumen");
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) throw new Error("Tipe file tidak diizinkan.");
  const bytes = Buffer.from(await file.arrayBuffer());
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
  if (!resolved.startsWith(absoluteRoot)) throw new Error("Lokasi file tidak valid.");
  const data = await fs.readFile(resolved);
  return isCompressed ? gunzipAsync(data) : data;
}

export async function deleteStoredFile(storagePath: string) {
  const absoluteRoot = uploadRoot();
  const resolved = path.resolve(storagePath);
  if (!resolved.startsWith(absoluteRoot)) throw new Error("Lokasi file tidak valid.");
  try {
    await fs.unlink(resolved);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
}
