/**
 * On Render's web service, build the UI so the league server can serve it
 * from its own origin (`SERVE_UI`).
 *
 * Runs as the root package's `postinstall`, so the service's existing Build
 * Command (`npm install`) picks it up with no dashboard change. Everywhere
 * else — a laptop, CI — it does nothing: `RENDER` is set only on Render, and
 * the static site installs inside `ui-source/`, which never runs this.
 *
 * Why: with the UI and the API on two `onrender.com` subdomains the session
 * cookie is a third-party cookie, and Safari (every iPhone) refuses those —
 * a GM could sign in and was signed straight back out. Served from the API's
 * origin, the cookie is first-party everywhere.
 *
 * A failed UI build fails the install, and Render keeps the previous deploy
 * running rather than shipping a server with no UI behind it.
 */
import { execSync } from "node:child_process";

if (!process.env.RENDER || process.env.SKIP_UI_BUILD) process.exit(0);

const run = (cmd, env = {}, cwd = undefined) =>
  execSync(cmd, { stdio: "inherit", cwd, env: { ...process.env, ...env } });

// devDependencies too: Vite is one, and Render installs with NODE_ENV=production
run("npm --prefix ui-source ci --include=dev");
// an empty API base: the client calls the origin it was loaded from
run("npx vite build --configLoader runner", { VITE_LEAGUE_API: "" }, "ui-source");
