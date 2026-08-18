import type { ConnectionOptions } from "mysql2/promise";

const TLS_SSL_MODES = new Set(["REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY"]);

function normalizeCertificateAuthority(certificateAuthority: string): string {
  return certificateAuthority
    .trim()
    .replace(/^-----BEGIN\s*CERTIFICATE-----\s*/, "-----BEGIN CERTIFICATE-----\n")
    .replace(/\s*-----END\s*CERTIFICATE-----$/, "\n-----END CERTIFICATE-----");
}

export function getMySqlConnectionOptions(
  connectionUrl: string,
  certificateAuthority?: string
): ConnectionOptions {
  const parsedUrl = new URL(connectionUrl);
  const sslMode = (parsedUrl.searchParams.get("ssl-mode") ?? parsedUrl.searchParams.get("sslmode"))?.toUpperCase();

  parsedUrl.searchParams.delete("ssl-mode");
  parsedUrl.searchParams.delete("sslmode");

  if (sslMode && TLS_SSL_MODES.has(sslMode)) {
    return {
      uri: parsedUrl.toString(),
      ssl: {
        ...(certificateAuthority ? { ca: normalizeCertificateAuthority(certificateAuthority) } : {}),
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
    };
  }

  return { uri: parsedUrl.toString() };
}
