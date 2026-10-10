import { defineConfig } from "drizzle-kit";
import { assertSafeDbTarget } from "./src/lib/db/target-guard";

const direct = process.env.DATABASE_URL;
const isFile = direct?.startsWith("file:");

// db:push / db:migrate / db:studio must never reach production: see src/lib/db/target-guard.ts.
assertSafeDbTarget(direct ?? process.env.TURSO_CONNECTION_URL ?? "");

export default defineConfig(
  isFile
    ? {
        schema: "./src/lib/db/schema.ts",
        out: "./drizzle",
        dialect: "sqlite",
        dbCredentials: { url: direct! },
      }
    : {
        schema: "./src/lib/db/schema.ts",
        out: "./drizzle",
        dialect: "turso",
        dbCredentials: {
          url: direct ?? process.env.TURSO_CONNECTION_URL!,
          authToken: process.env.TURSO_AUTH_TOKEN,
        },
      }
);
