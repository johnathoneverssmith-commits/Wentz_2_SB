/**
 * The league server against the local PGlite database (`local-db.ts`), for local testing only.
 *
 *   npm run online:db      # in one terminal (a clean in-memory Postgres on :5433)
 *   npm run online:local   # in another; the UI's default API is this server
 *
 *   options: --test-database <local-pglite | postgres://… on this machine>   (default local-pglite)
 *            --port <n>  (default 8788)   --client-origin <http://localhost:5173>
 *
 * It is the production server (same entry point, routes, schema and rules), started safely: the database
 * is chosen explicitly and validated before the server's code is loaded, a database setting inherited from
 * the shell is refused rather than used, the server runs in a child process with a scrubbed environment,
 * listens on 127.0.0.1 only, and will not start on a port something else is using. See `launcher-safety.ts`.
 *
 * Exit codes: 2 refused to start (nothing was launched); 1 failed to become ready; otherwise the server's own.
 */
import { startLocalServer, LauncherError } from "./local-launcher.ts";
import { resolveLauncherConfig } from "./launcher-safety.ts";

const resolved = resolveLauncherConfig(process.argv.slice(2), process.env);
if (!resolved.ok) {
  for (const problem of resolved.problems) console.error(`refused: ${problem}`);
  console.error("nothing was started.");
  process.exit(2);
}
const { config } = resolved;

let server;
try {
  server = await startLocalServer({ config, onLog: (line) => console.log(`[server] ${line}`) });
} catch (e) {
  console.error(`failed: ${e instanceof LauncherError ? e.message : String(e)}`);
  process.exit(e instanceof LauncherError && /already in use/.test(e.message) ? 2 : 1);
}
console.log(`local league server ready on ${server.url} (database: ${config.databaseDescription}; schema applied; loopback only)`);

const stop = (): void => {
  void server.stop().then(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.exit((await server.exited) ?? 1);
