/** `npm run online:migrate` — create the schema, then get out of the way. */
import { migrate, pool } from "./db.js";

await migrate();
// eslint-disable-next-line no-console
console.log("schema applied");
await pool.end();
