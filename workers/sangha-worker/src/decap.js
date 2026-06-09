// workers/sangha-worker/src/decap.js
// GitHub OAuth proxy for Decap CMS, ported from workers/oauth-proxy/index.js and
// namespaced under /decap/* so it co-exists with the Google login routes.
// Decap's git backend is GitHub, so it authenticates with a GitHub token here.

const GITHUB_BASE = "https://github.com";

function decapRedirectUri(request) {
  return new URL(request.url).origin + "/decap/callback";
}

export async function handleDecapAuth(request, env) {
  const clientId = env.GITHUB_CLIENT_ID || "";
  if (!clientId) return new Response("GITHUB_CLIENT_ID not configured", { status: 500 });
  const url = new URL(GITHUB_BASE + "/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", decapRedirectUri(request));
  url.searchParams.set("scope", "repo,read:org");
  url.searchParams.set("state", crypto.randomUUID());
  return Response.redirect(url.toString(), 302);
}

export async function handleDecapCallback(request, env, options = {}) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  if (!code) return new Response("No code provided", { status: 400 });

  const clientId = env.GITHUB_CLIENT_ID || "";
  const clientSecret = env.GITHUB_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) return new Response("OAuth credentials not configured", { status: 500 });

  const fetchImpl = options.fetch || fetch;
  let tokenData;
  try {
    const tokenResponse = await fetchImpl(GITHUB_BASE + "/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: decapRedirectUri(request)
      })
    });
    tokenData = await tokenResponse.json();
  } catch (error) {
    return new Response("Authentication failed", { status: 500 });
  }

  if (tokenData.error) {
    return new Response("Error: " + (tokenData.error_description || tokenData.error), { status: 400 });
  }

  const html = `<!DOCTYPE html>
<html>
<head><title>Decap CMS Authorization</title></head>
<body>
  <p>Authorizing Decap CMS...</p>
  <script>
    (function() {
      const token = ${JSON.stringify(tokenData.access_token).replace(/</g, "\\u003c")};
      const receiveMessage = (message) => {
        window.opener.postMessage(
          'authorization:github:success:' + JSON.stringify({ token: token }),
          '*'
        );
        window.removeEventListener("message", receiveMessage, false);
        setTimeout(function() { window.close(); }, 100);
      };
      window.addEventListener("message", receiveMessage, false);
      window.opener.postMessage("authorizing:github", "*");
    })();
  </script>
</body>
</html>`;

  return new Response(html, { status: 200, headers: { "Content-Type": "text/html" } });
}
