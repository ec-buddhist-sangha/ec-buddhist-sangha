import { applyD1Migrations, env } from "cloudflare:test";

// Runs once per test file before tests; idempotent (tracks applied migrations).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
