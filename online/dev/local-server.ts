/**
 * The league server against the local PGlite database (`local-db.ts`).
 *
 * Exactly the production server — same entry point, routes, schema and
 * rules — with only its database URL defaulted to the local one. PGlite
 * serves one connection at a time, so the pool is held to one.
 *
 *   npm run online:db      # in one terminal
 *   npm run online:local   # in another; the UI's default API is this server
 */
process.env.DATABASE_URL ??= "postgres://postgres@localhost:5433/postgres";
process.env.DB_POOL_MAX ??= "1";
// the Vite dev UI, so a browser can call this server with its session cookie
process.env.CLIENT_ORIGIN ??= "http://localhost:5173";

await import("../src/index.ts");
