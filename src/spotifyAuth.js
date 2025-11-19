// src/spotifyAuth.js

// --- CONFIGURATION ---
export const CLIENT_ID = "df15f24ccf514ad8920d69105c44b84e"; // replace only if you have different client id
export const REDIRECT_URI = "https://moodplaylist13.netlify.app/"; // must match Spotify Dashboard
export const SCOPES = "user-read-private playlist-modify-public playlist-modify-private";

// Spotify endpoints
const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

/* ----------------------
   Crypto & helper funcs
   ---------------------- */
const generateRandomString = (length = 64) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = new Uint8Array(length);
  window.crypto.getRandomValues(values);
  let out = '';
  for (let i = 0; i < values.length; i++) {
    out += possible[values[i] % possible.length];
  }
  return out;
};

const sha256 = async (plain) => {
  const encoder = new TextEncoder();
  return window.crypto.subtle.digest('SHA-256', encoder.encode(plain));
};

const base64urlencode = (arrayBuffer) => {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};

/* ----------------------
   Storage helpers
   ---------------------- */
export function clearAllTokens() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('token_expiry');
  localStorage.removeItem('code_verifier');
  localStorage.removeItem('pkce_state');
}

export function getStoredAccessToken() {
  return localStorage.getItem('access_token');
}

/* ----------------------
   Start PKCE flow
   ---------------------- */
export async function handleSpotifyLogin(forceReconsent = true) {
  // clear temporary items (keeps other localStorage keys intact)
  clearAllTokens();

  const codeVerifier = generateRandomString(128);
  localStorage.setItem('code_verifier', codeVerifier);

  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64urlencode(hashed);

  const state = generateRandomString(16);
  localStorage.setItem('pkce_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: REDIRECT_URI,
    state,
    show_dialog: String(!!forceReconsent) // force consent screen if true
  });

  const authUrl = `${AUTH_URL}?${params.toString()}`;
  window.location.href = authUrl;
}

/* ----------------------
   Exchange code -> tokens
   ---------------------- */
export async function exchangeCodeForToken(code, returnedState) {
  const codeVerifier = localStorage.getItem('code_verifier');
  const storedState = localStorage.getItem('pkce_state');

  if (!codeVerifier) {
    clearAllTokens();
    throw new Error("PKCE verifier missing. Please try logging in again.");
  }

  // Validate state if present (if mismatch treat as attack)
  if (storedState && returnedState && storedState !== returnedState) {
    clearAllTokens();
    throw new Error("State mismatch. Possible CSRF attack. Login again.");
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code: code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    let errText = await response.text().catch(() => response.statusText);
    clearAllTokens();
    throw new Error(`Spotify Token Error: ${errText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    clearAllTokens();
    throw new Error("No access token received from Spotify.");
  }

  // store tokens and expiry
  localStorage.setItem('access_token', data.access_token);
  if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
  const expiresIn = Number.isFinite(Number(data.expires_in)) ? Number(data.expires_in) : 3600;
  localStorage.setItem('token_expiry', String(Date.now() + expiresIn * 1000));

  // cleanup
  localStorage.removeItem('code_verifier');
  localStorage.removeItem('pkce_state');

  return data.access_token;
}

/* ----------------------
   Refresh access token
   ---------------------- */
export async function refreshAccessToken() {
  const refreshToken = localStorage.getItem('refresh_token');
  if (!refreshToken) {
    clearAllTokens();
    throw new Error("No refresh token available; re-authorization required.");
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    let errText = await response.text().catch(() => response.statusText);
    clearAllTokens();
    throw new Error(`Refresh token failed: ${errText}`);
  }

  const data = await response.json();
  if (!data.access_token) { clearAllTokens(); throw new Error("No access token returned when refreshing."); }

  localStorage.setItem('access_token', data.access_token);
  if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
  const expiresIn = Number.isFinite(Number(data.expires_in)) ? Number(data.expires_in) : 3600;
  localStorage.setItem('token_expiry', String(Date.now() + expiresIn * 1000));

  return data.access_token;
}
