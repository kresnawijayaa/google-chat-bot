const fs = require("node:fs");
const path = require("node:path");
const { neon } = require("@neondatabase/serverless");
if (!process.env.DATABASE_URL && fs.existsSync(path.join(__dirname, "../.env"))) process.loadEnvFile(path.join(__dirname, "../.env"));
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = neon(process.env.DATABASE_URL);
  const migration = fs.readFileSync(path.join(__dirname, "registration.sql"), "utf8");
  const statements = migration.match(/CREATE[\s\S]*?;/g);
  await sql.transaction(statements.map(statement => sql.query(statement)));
  console.log("Registration schema migration completed. No employee data added or removed.");
}
main().catch(() => { console.error("Registration schema migration failed. Check DATABASE_URL, database permissions and existing NIK duplicates."); process.exitCode = 1; });
