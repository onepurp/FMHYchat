import { describe, expect, it } from "vitest";
import { getMySqlConnectionOptions } from "./mysqlConnection";

describe("getMySqlConnectionOptions", () => {
  it("converts Aiven ssl-mode into enforced mysql2 TLS configuration", () => {
    const options = getMySqlConnectionOptions(
      "mysql://fmhy:password@mysql-aiven.example:12345/fmhychat?ssl-mode=REQUIRED",
      "-----BEGINCERTIFICATE-----\ntest Aiven CA\n-----ENDCERTIFICATE-----"
    );

    expect(options.uri).not.toContain("ssl-mode");
    expect(options.ssl).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\ntest Aiven CA\n-----END CERTIFICATE-----",
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    });
  });
});
