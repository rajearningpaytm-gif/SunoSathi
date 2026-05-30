import fs from "node:fs";
import pg from "pg";

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const candidates = [
    "/root/SunoSathi/artifacts/api-server/.env",
    "/root/SunoSathi/artifacts/api-server/.env.local",
    "/root/SunoSathi/.env",
    "/root/SunoSathi/.env.local",
  ];
  for (const f of candidates) {
    try {
      for (const line of fs.readFileSync(f, "utf-8").split("\n")) {
        const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
        if (m) return m[1].replace(/^["']|["']$/g, "");
      }
    } catch {}
  }
  return null;
}

const url = loadEnv();
if (!url) { console.error("MIGRATION FAIL: DATABASE_URL not found"); process.exit(1); }

const pool = new pg.Pool({ connectionString: url });
try {
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS welcome_bonus_used boolean NOT NULL DEFAULT false`);
  const r = await pool.query(`UPDATE profiles SET welcome_bonus_used = true WHERE welcome_bonus_used = false`);
  console.log("MIGRATION OK — existing profiles marked used:", r.rowCount);
} catch (e) {
  console.error("MIGRATION FAIL:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
