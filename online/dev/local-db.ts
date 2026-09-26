/**
 * A real Postgres for local online testing, with nothing to install.
 *
 * PGlite is Postgres compiled to WebAssembly; the socket server speaks the
 * ordinary wire protocol, so the league server connects to it exactly as it
 * connects to Neon in production — same `pg` driver, same schema, same SQL.
 * Development only: production uses DATABASE_URL.
 *
 *   npm run online:db          # postgres://postgres@localhost:5433/postgres
 *   DATABASE_URL=postgres://postgres@localhost:5433/postgres DB_POOL_MAX=1 npm run online
 *
 * PGlite is one Postgres session behind every socket, so a league server
 * killed mid-transaction can leave it wedged ("Connection terminated
 * unexpectedly" on every query) — restart this process too when that happens.
 *
 * In memory by default — every start is a clean league server. Set
 * LOCAL_DB_DIR=.pglite-data (gitignored) to keep data between runs; a killed
 * process can leave that folder unreadable, so delete it if startup fails.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.LOCAL_DB_PORT ?? 5433);
const dataDir = process.env.LOCAL_DB_DIR;

const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
// A few spare connections: the league server holds its pool to one (PGlite
// runs one query at a time and interleaved transactions would tangle), but a
// port scanner or health probe that opens a socket and sits on it must not
// lock the server out — at the default of one, it did.
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 4 });
await server.start();
// eslint-disable-next-line no-console
console.log(`local Postgres (PGlite) on postgres://postgres@localhost:${port}/postgres, ${dataDir ? `data in ${dataDir}` : "in memory"}`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
