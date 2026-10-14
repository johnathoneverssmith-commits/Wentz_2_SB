/**
 * Preloaded into the local league server's process (`--import`), so the server listens on the loopback
 * interface only, without a change to the server itself. Production passes no host to `listen` and so binds
 * every interface; here every `listen` is forced to 127.0.0.1, and the address actually bound is announced on
 * stdout so the launcher can check it rather than assume it.
 *
 * Development and test tooling only: nothing in the deployed server loads this file.
 */
import net from "node:net";

const HOST = "127.0.0.1";
const original = net.Server.prototype.listen;

net.Server.prototype.listen = function listenLoopbackOnly(...args) {
  const first = args[0];
  if (first !== null && typeof first === "object") {
    // listen(options): a unix socket path is left alone, anything else is pinned to loopback
    if (first.path === undefined) args[0] = { ...first, host: HOST };
  } else if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    // listen(port[, host][, backlog][, callback]): replace a host, or put one in front of the rest
    if (typeof args[1] === "string") args[1] = HOST;
    else args.splice(1, 0, HOST);
  }
  this.once("listening", () => {
    const a = this.address();
    if (a && typeof a === "object") process.stdout.write(`WENTZ_LISTENING ${a.address}:${a.port}\n`);
  });
  return original.apply(this, args);
};
