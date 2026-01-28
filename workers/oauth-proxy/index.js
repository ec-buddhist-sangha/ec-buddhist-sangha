import { Router } from 'itty-router';

const router = Router();

const GITHUB_CLIENT_ID = GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = GITHUB_CLIENT_SECRET || '';
const DECAP_OAUTH_REDIRECT_URL = DECAP_OAUTH_REDIRECT_URL || 'https://yoursite.com/admin/';

const BASE_URL = 'https://github.com';

// Start OAuth flow - redirect to GitHub
router.get('/auth', async (request) => {
  const url = new URL(`${BASE_URL}/login/oauth/authorize`);
  url.searchParams.set('client_id', GITHUB_CLIENT_ID);
  url.searchParams.set('redirect_uri', `${new URL(request.url).origin}/callback`);
  url.searchParams.set('scope', 'repo,read:org');
  url.searchParams.set('state', crypto.randomUUID());
  
  return Response.redirect(url.toString(), 302);
});

// OAuth callback - exchange code for token
router.get('/callback', async (request) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  
  if (!code) {
    return new Response('No code provided', { status: 400 });
  }
  
  try {
    const tokenResponse = await fetch(`${BASE_URL}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${new URL(request.url).origin}/callback`,
      }),
    });
    
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      return new Response(`Error: ${tokenData.error_description}`, { status: 400 });
    }
    
    // Redirect back to Decap with the token
    const redirectUrl = new URL(DECAP_OAUTH_REDIRECT_URL);
    redirectUrl.searchParams.set('access_token', tokenData.access_token);
    
    return Response.redirect(redirectUrl.toString(), 302);
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
  fetch: router.fetch,
};
