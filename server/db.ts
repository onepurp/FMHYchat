import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import { getMySqlConnectionOptions } from "./mysqlConnection";

let database: ReturnType<typeof drizzle> | null = null;
let pool: mysql.Pool | null = null;

// Shared protection state uses this connector; it has no user or OAuth responsibilities.
export async function getDb() {
  if (!database && process.env.DATABASE_URL) {
    try {
      pool = mysql.createPool(getMySqlConnectionOptions(process.env.DATABASE_URL, process.env.FMHY_DATABASE_CA_CERT));
      database = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      database = null;
    }
  }
  return database;
}
