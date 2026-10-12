/**
 * Reading the JSON files these scripts pass to each other.
 *
 * The usual way to make one is `node select-checks.mjs --json > plan.json`,
 * and on Windows PowerShell 5.1 that redirect writes UTF-16 with a byte-order
 * mark (and `Out-File -Encoding utf8` writes UTF-8 with one). `JSON.parse`
 * rejects both, so a tool that fails on its own recommended workflow would be
 * abandoned. Reading tolerates all three encodings.
 */
import { readFileSync } from "node:fs";

/** Text from a file, whatever PowerShell or an editor wrote: UTF-8 (with or without BOM), UTF-16 LE or BE. */
export function readText(path) {
  const buf = readFileSync(path);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  const text = buf.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readJson(path) {
  return JSON.parse(readText(path));
}
