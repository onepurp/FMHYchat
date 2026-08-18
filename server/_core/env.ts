export const ENV = {
  adminPassword: process.env.FMHY_ADMIN_PASSWORD ?? "",
  adminSessionSecret: process.env.FMHY_ADMIN_SESSION_SECRET ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
};
