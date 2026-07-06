// workers/sangha-worker/src/index.js
// Single entry point for the Sangha Worker. Later plans register more routes here.
import { Router } from "itty-router";
import { handleLogin, handleCallback } from "./auth.js";
import { handleDecapAuth, handleDecapCallback } from "./decap.js";
import { handlePreflight, jsonResponse, errorHandler, requireRole } from "./middleware.js";
import {
  handleGetCalendar, handlePutCalendar,
  handlePostSignup, handleDeleteSignup, handleGetSignup
} from "./calendar.js";
import {
  handleGetComments, handlePostComment, handlePatchComment, handleDeleteComment
} from "./comments.js";
import {
  handleMe, handleAccessRequest, handleListMembers,
  handleApprove, handleDeny, handleSetRole
} from "./access.js";

const router = Router();

router.options("*", (request, env) => handlePreflight(request, env));
router.get("/api/health", (request, env) => jsonResponse(env, { status: "ok" }));
router.get("/auth/login", (request, env) => handleLogin(request, env));
router.get("/auth/callback", (request, env) => handleCallback(request, env));
router.get("/api/me", requireRole(["reader", "member", "admin"], handleMe));
router.post("/api/access-request", requireRole(["reader", "member", "admin"], handleAccessRequest));
router.get("/api/members", requireRole(["admin"], handleListMembers));
router.post("/api/members/approve", requireRole(["admin"], handleApprove));
router.post("/api/members/deny", requireRole(["admin"], handleDeny));
router.post("/api/members/role", requireRole(["admin"], handleSetRole));
router.get("/decap/auth", (request, env) => handleDecapAuth(request, env));
router.get("/decap/callback", (request, env) => handleDecapCallback(request, env));
router.get("/api/calendar", (request, env) => handleGetCalendar(request, env));
router.put("/api/calendar", requireRole(["admin"], handlePutCalendar));
router.post("/api/signups", requireRole(["member", "admin"], handlePostSignup));
router.delete("/api/signups", requireRole(["member", "admin"], handleDeleteSignup));
router.get("/api/signups", requireRole(["member", "admin"], handleGetSignup));
router.get("/api/comments", (request, env) => handleGetComments(request, env));
router.post("/api/comments", requireRole(["member", "admin"], handlePostComment));
router.patch("/api/comments", requireRole(["member", "admin"], handlePatchComment));
router.delete("/api/comments", requireRole(["member", "admin"], handleDeleteComment));
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
