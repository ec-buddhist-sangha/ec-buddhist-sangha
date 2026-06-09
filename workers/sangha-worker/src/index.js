// workers/sangha-worker/src/index.js
// Entry point — routing will be wired up in Task 8.
export default {
  async fetch(request, env, ctx) {
    return new Response("sangha-worker", { status: 200 });
  },
};
