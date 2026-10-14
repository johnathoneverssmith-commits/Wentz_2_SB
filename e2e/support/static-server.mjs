/**
 * A static file server for one directory, for one test run.
 *
 *   node static-server.mjs <directory> <port> <token> [<parentPid>]
 *
 * Owned by the run that started it: it listens on 127.0.0.1 only, serves GET/HEAD for files under the directory
 * (nothing outside it), prints `READY <token>` once it is listening, and exits when its parent process is gone
 * or after 30 minutes, so a run that is killed outright cannot leave a server behind.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const [dirArg, portArg, token, parentArg] = process.argv.slice(2);
if (!dirArg || !portArg || !token) {
  console.error("usage: static-server.mjs <directory> <port> <token> [<parentPid>]");
  process.exit(2);
}
const root = resolve(dirArg);
const port = Number(portArg);
const parentPid = parentArg ? Number(parentArg) : null;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = resolve(join(root, normalize(path === "/" ? "/index.html" : path)));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end(); // nothing outside the directory
    return;
  }
  let st;
  try {
    st = statSync(file);
  } catch {
    res.writeHead(404).end();
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": st.size,
    "cache-control": "no-store",
    "x-e2e-token": token,
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`READY ${token}\n`);
});
server.on("error", (e) => {
  console.error(`static server: ${e.message}`);
  process.exit(1);
});

const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};
if (parentPid) {
  setInterval(() => {
    if (gone(parentPid)) process.exit(0);
  }, 1500).unref();
}
setTimeout(() => process.exit(0), 30 * 60 * 1000).unref();
// keep the process alive: the timers above are unref'd so they never hold it open on their own
setInterval(() => {}, 60_000);
