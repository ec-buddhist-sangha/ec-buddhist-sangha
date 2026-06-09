import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Test-only bindings. Production values come from the real Worker env.
          bindings: {
            JWT_SIGNING_SECRET: "test-signing-secret-please-change",
            GOOGLE_CLIENT_ID: "test-client-id",
            GOOGLE_CLIENT_SECRET: "test-client-secret",
            GOOGLE_REDIRECT_URI: "https://worker.test/auth/callback",
            GOOGLE_GROUP_EMAIL: "sangha@eauclairesangha.org",
            GOOGLE_ADMIN_EMAIL: "admin@eauclairesangha.org",
            CORS_ORIGIN: "https://eauclairesangha.org",
            GITHUB_CLIENT_ID: "gh-client-id",
            GITHUB_CLIENT_SECRET: "gh-client-secret"
          }
        }
      }
    }
  }
});
