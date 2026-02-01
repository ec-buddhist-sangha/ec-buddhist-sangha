import { Router } from 'itty-router';

const router = Router();
const BASE_URL = 'https://github.com';

// Environment variables will be accessed via env object in handlers

// Start OAuth flow - redirect to GitHub
router.get('/auth', async (request, env) => {
  const clientId = env.GITHUB_CLIENT_ID || '';
  
  if (!clientId) {
    return new Response('GITHUB_CLIENT_ID not configured', { status: 500 });
  }
  
  const url = new URL(`${BASE_URL}/login/oauth/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `${new URL(request.url).origin}/callback`);
  url.searchParams.set('scope', 'repo,read:org');
  url.searchParams.set('state', crypto.randomUUID());
  
  return Response.redirect(url.toString(), 302);
});

// OAuth callback - exchange code for token
router.get('/callback', async (request, env) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  
  if (!code) {
    return new Response('No code provided', { status: 400 });
  }
  
  const clientId = env.GITHUB_CLIENT_ID || '';
  const clientSecret = env.GITHUB_CLIENT_SECRET || '';
  
  if (!clientId || !clientSecret) {
    return new Response('OAuth credentials not configured', { status: 500 });
  }
  
  try {
    const tokenResponse = await fetch(`${BASE_URL}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${new URL(request.url).origin}/callback`,
      }),
    });
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      return new Response(`Error: ${tokenData.error_description}`, { status: 400 });
    }
    
    // Return HTML page that communicates token back to parent window via postMessage
    // This is the correct way to handle OAuth popup flow for Decap CMS
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Decap CMS Authorization</title>
</head>
<body>
  <p>Authorizing Decap CMS...</p>
  <script>
    (function() {
      // Send authorization success message to parent window
      window.opener.postMessage(
        'authorization:github:success:${JSON.stringify({ token: "${tokenData.access_token}" })}',
        '*'
      );
      
      // Close this popup window after a short delay
      setTimeout(function() {
        window.close();
      }, 100);
    })();
  </script>
</body>
</html>`;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
      status: 200
    });
  } catch (error) {
    console.error('OAuth error:', error);
    return new Response('Authentication failed', { status: 500 });
  }
});

// Health check
router.get('/health', () => new Response('OK', { status: 200 }));

// 404 for everything else
router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
  async fetch(request, env, ctx) {
    return router.fetch(request, env, ctx);
  },
};
