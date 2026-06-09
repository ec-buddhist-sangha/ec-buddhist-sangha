// workers/sangha-worker/src/index.js
// Single entry point for the Sangha Worker. Later plans register more routes here.
import { Router } from "itty-router";
import { handleLogin, handleCallback } from "./auth.js";
import { handleDecapAuth, handleDecapCallback } from "./decap.js";
import { handlePreflight, jsonResponse, errorHandler } from "./middleware.js";

const router = Router();

router.options("*", (request, env) => handlePreflight(request, env));
router.get("/api/health", (request, env) => jsonResponse(env, { status: "ok" }));
router.get("/auth/login", (request, env) => handleLogin(request, env));
router.get("/auth/callback", (request, env) => handleCallback(request, env));
router.get("/decap/auth", (request, env) => handleDecapAuth(request, env));
router.get("/decap/callback", (request, env) => handleDecapCallback(request, env));
router.all("*", (request, env) => jsonResponse(env, { error: "not_found" }, 404));

export default {
  async fetch(request, env, ctx) {
    try {
      return await router.fetch(request, env, ctx);
    } catch (error) {
      return errorHandler(error, env);
    }
  }
};
