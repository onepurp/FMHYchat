import mysql from "mysql2/promise";
import { describe, expect, it } from "vitest";
import { getMySqlConnectionOptions } from "./mysqlConnection";

const connectionUrl = process.env.FMHY_MIGRATION_DATABASE_URL;
const connectionCa = process.env.FMHY_DATABASE_CA_CERT;
const migrationIt = connectionUrl && connectionCa ? it : it.skip;

const expectedTables = [
  "__drizzle_migrations",
  "fmhy_protection_circuit",
  "fmhy_protection_metrics",
  "fmhy_protection_policy",
  "fmhy_rate_buckets",
  "fmhy_search_leases",
  "fmhy_source_cache",
  "users",
];

describe("external migration database", () => {
  migrationIt("accepts a MySQL connection and returns a readiness row", async () => {
    expect(connectionUrl).toMatch(/^mysql2?:\/\//);

    const connection = await mysql.createConnection(getMySqlConnectionOptions(connectionUrl!, connectionCa));
    try {
      const [rows] = await connection.query<{ ready: number }[]>("SELECT 1 AS ready");
      expect(rows).toEqual([{ ready: 1 }]);
    } finally {
      await connection.end();
    }
  }, 20_000);

  migrationIt("contains every existing FMHYchat operational table after migration", async () => {
    const connection = await mysql.createConnection(getMySqlConnectionOptions(connectionUrl!, connectionCa));
    try {
      const [rows] = await connection.query<Record<string, string>[]>("SHOW TABLES");
      const tableNames = rows.map(row => Object.values(row)[0]);
      expect(tableNames).toEqual(expect.arrayContaining(expectedTables));
    } finally {
      await connection.end();
    }
  }, 20_000);
});
