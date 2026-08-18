import { drizzle } from "drizzle-orm/mysql2";

let database: ReturnType<typeof drizzle> | null = null;

// Shared protection state uses this connector; it has no user or OAuth responsibilities.
export async function getDb() {
  if (!database && process.env.DATABASE_URL) {
    try {
      database = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      database = null;
    }
  }
  return database;
}
