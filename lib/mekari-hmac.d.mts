export const MEKARI_SANDBOX_BASE: string;

export function hmacHeaders(
  method: string,
  url: URL,
  config: { id: string; secret: string | Buffer },
  date?: Date,
): { Date: string; Authorization: string };
