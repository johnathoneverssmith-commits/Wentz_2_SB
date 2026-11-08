import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = fileURLToPath(new URL("..", import.meta.url));
export const OUT_DIR = resolve(process.env.AUDIT_OUT ?? join(HERE, "audit-output", "local"));
