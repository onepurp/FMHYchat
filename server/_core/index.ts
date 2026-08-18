import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { publicServerHost } from "./network";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  // This application accepts only compact search and administrator-password payloads.
  app.use(express.json({ limit: "64kb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: true }));
  app.get("/healthz", (_req, res) => res.status(200).json({ status: "ok" }));
  registerStorageProxy(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number.parseInt(process.env.PORT || "3000", 10);
  const host = publicServerHost();

  server.listen(port, host, () => {
    console.log(`Server running on http://${host}:${port}/`);
  });
}

startServer().catch(console.error);
