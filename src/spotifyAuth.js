// src/spotifyAuth.js

// --- CONFIGURATION ---
export const CLIENT_ID = "df15f24ccf514ad8920d69105c44b84e"; // replace if needed
export const REDIRECT_URI = "https://moodplaylist13.netlify.app/";
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
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest('SHA-256', data);
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

export function getStoredRefreshToken() {
  return localStorage.getItem('refresh_token');
}

/* ----------------------
   Start PKCE flow
   ---------------------- */
export async function handleSpotifyLogin() {
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
    state
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
    throw new Error("PKCE verifier missing. Please log in again.");
  }

  if (storedState && returnedState && storedState !== returnedState) {
    clearAllTokens();
    throw new Error("State mismatch. Possible CSRF attack. Login again.");
  }

  try {
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
      let errText;
      try {
        const errJson = await response.json();
        errText = errJson.error_description || JSON.stringify(errJson);
      } catch {
        errText = await response.text().catch(() => response.statusText);
      }
      clearAllTokens();
      throw new Error(`Spotify Token Error: ${errText || response.statusText}`);
    }

    const data = await response.json();
    if (!data.access_token) { clearAllTokens(); throw new Error("No access token received from Spotify."); }

    localStorage.setItem('access_token', data.access_token);
    if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);

    const expiresIn = Number.isFinite(Number(data.expires_in)) ? Number(data.expires_in) : 3600;
    localStorage.setItem('token_expiry', String(Date.now() + expiresIn * 1000));

    localStorage.removeItem('code_verifier');
    localStorage.removeItem('pkce_state');

    return data.access_token;
  } catch (error) {
    console.error("Token exchange failed:", error);
    clearAllTokens();
    throw error;
  }
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

  try {
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
      let errText;
      try {
        const errJson = await response.json();
        errText = errJson.error_description || JSON.stringify(errJson);
      } catch {
        errText = await response.text().catch(() => response.statusText);
      }
      clearAllTokens();
      throw new Error(`Refresh token failed: ${errText || response.statusText}`);
    }

    const data = await response.json();
    if (!data.access_token) { clearAllTokens(); throw new Error("No access token returned when refreshing."); }

    localStorage.setItem('access_token', data.access_token);
    if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);

    const expiresIn = Number.isFinite(Number(data.expires_in)) ? Number(data.expires_in) : 3600;
    localStorage.setItem('token_expiry', String(Date.now() + expiresIn * 1000));

    return data.access_token;
  } catch (error) {
    console.error("Token refresh failed:", error);
    clearAllTokens();
    throw error;
  }
}
