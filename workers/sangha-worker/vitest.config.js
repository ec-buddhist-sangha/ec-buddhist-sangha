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
            GOOGLE_GROUP_EMAIL: "sangha@eauclairesangha.org",
            GOOGLE_ADMIN_EMAIL: "admin@eauclairesangha.org",
            CORS_ORIGIN: "https://eauclairesangha.org",
            GITHUB_CLIENT_ID: "gh-client-id",
            GITHUB_CLIENT_SECRET: "gh-client-secret",
            REMARK42_URL: "https://comments.test",
            REMARK42_SITE_ID: "ec-buddhist-sangha",
            REMARK42_JWT_SECRET: "remark-shared-secret",
            BOOTSTRAP_ADMINS: "boss@eauclairesangha.org",
            NOTIFY_SENDER: "noreply@eauclairesangha.org"
          }
        }
      }
    }
  }
});
