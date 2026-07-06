import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";

const migrations = await readD1Migrations("./migrations");

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/apply-migrations.js"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: ["DB"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            JWT_SIGNING_SECRET: "test-signing-secret-please-change",
            GOOGLE_CLIENT_ID: "test-client-id",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
            GOOGLE_REDIRECT_URI: "https://worker.test/auth/callback",
            CORS_ORIGIN: "https://eauclairesangha.org",
            GITHUB_CLIENT_ID: "gh-client-id",
            GITHUB_CLIENT_SECRET: "gh-client-secret",
            BOOTSTRAP_ADMINS: "boss@eauclairesangha.org",
            NOTIFY_SENDER: "noreply@eauclairesangha.org"
          }
        }
      }
    }
  }
});
