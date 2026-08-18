import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2";
import path from "node:path";
import { fileURLToPath } from "node:url";

const connectionUrl = process.env.FMHY_MIGRATION_DATABASE_URL;
const certificateAuthority = process.env.FMHY_DATABASE_CA_CERT;

if (!connectionUrl || !certificateAuthority) {
  throw new Error("FMHY_MIGRATION_DATABASE_URL and FMHY_DATABASE_CA_CERT are required.");
}

const url = new URL(connectionUrl);
const sslMode = (url.searchParams.get("ssl-mode") ?? url.searchParams.get("sslmode"))?.toUpperCase();
url.searchParams.delete("ssl-mode");
url.searchParams.delete("sslmode");

const requiresTls = new Set(["REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY"]).has(sslMode);
if (!requiresTls) {
  throw new Error("The Aiven connection URL must require TLS via ssl-mode=REQUIRED or stronger.");
}

const normalizedCa = certificateAuthority
  .trim()
  .replace(/^-----BEGIN\s*CERTIFICATE-----\s*/, "-----BEGIN CERTIFICATE-----\n")
  .replace(/\s*-----END\s*CERTIFICATE-----$/, "\n-----END CERTIFICATE-----");

const pool = mysql.createPool({
  uri: url.toString(),
  ssl: { ca: normalizedCa, minVersion: "TLSv1.2", rejectUnauthorized: true },
});

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  await migrate(drizzle(pool), { migrationsFolder: path.join(projectRoot, "drizzle") });
  console.log("Aiven schema migration completed.");
} finally {
  await pool.end();
}
