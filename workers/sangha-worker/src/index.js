// workers/sangha-worker/src/index.js
// Single entry point for the Sangha Worker. Later plans register more routes here.
import { Router } from "itty-router";
import { handleLogin, handleCallback } from "./auth.js";
import { handlePreflight, jsonResponse, errorHandler, requireRole } from "./middleware.js";
import {
  handleGetCalendar, handlePutCalendar,
  handlePostSignup, handleDeleteSignup, handleGetSignup
} from "./calendar.js";
import {
  handleGetComments, handlePostComment, handlePatchComment, handleDeleteComment
} from "./comments.js";
import {
  handleListPosts, handleGetPost, handleCreatePost, handlePatchPost, handleDeletePost
} from "./posts.js";
import {
  handleListTopics, handleGetTopic, handleCreateTopic, handlePatchTopic, handleDeleteTopic
} from "./topics.js";
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
router.get("/api/calendar", (request, env) => handleGetCalendar(request, env));
router.put("/api/calendar", requireRole(["admin"], handlePutCalendar));
router.post("/api/signups", requireRole(["member", "admin"], handlePostSignup));
router.delete("/api/signups", requireRole(["member", "admin"], handleDeleteSignup));
router.get("/api/signups", requireRole(["member", "admin"], handleGetSignup));
router.get("/api/comments", (request, env) => handleGetComments(request, env));
router.post("/api/comments", requireRole(["member", "admin"], handlePostComment));
router.patch("/api/comments", requireRole(["member", "admin"], handlePatchComment));
router.delete("/api/comments", requireRole(["member", "admin"], handleDeleteComment));
router.get("/api/posts", (request, env) => handleListPosts(request, env));
router.get("/api/posts/:slug", (request, env) => handleGetPost(request, env));
router.post("/api/posts", requireRole(["admin"], handleCreatePost));
router.patch("/api/posts", requireRole(["admin"], handlePatchPost));
router.delete("/api/posts", requireRole(["admin"], handleDeletePost));
router.get("/api/topics", (request, env) => handleListTopics(request, env));
router.get("/api/topics/:slug", (request, env) => handleGetTopic(request, env));
router.post("/api/topics", requireRole(["member", "admin"], handleCreateTopic));
router.patch("/api/topics", requireRole(["member", "admin"], handlePatchTopic));
router.delete("/api/topics", requireRole(["member", "admin"], handleDeleteTopic));
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
