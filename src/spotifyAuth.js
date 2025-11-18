// src/spotifyAuth.js

// --- CONFIGURATION ---
export const CLIENT_ID = "df15f24ccf514ad8920d69105c44b84e"; // <-- REPLACE THIS!
export const REDIRECT_URI = "https://moodplaylist13.netlify.app/"; 
export const SCOPES = "user-read-private playlist-modify-public playlist-modify-private"; 

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";


// --- PKCE HELPER FUNCTIONS ---
const generateRandomString = (length) => {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = window.crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}
const sha256 = async (plain) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
}
const base64urlencode = (input) => {
    return btoa(String.fromCharCode(...new Uint8Array(input)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

// --- LOGOUT HELPER ---
export function clearAllTokens() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('token_expiry');
    localStorage.removeItem('code_verifier');
    // Note: We don't want to clear ALL localStorage, just these keys
}


// --- AUTH FLOW FUNCTIONS ---

/**
 * Initiates the Spotify login redirect.
 */
export async function handleSpotifyLogin() {
    // Clear any previous session data before starting a new flow
    clearAllTokens(); 
    
    const codeVerifier = generateRandomString(128);
    localStorage.setItem('code_verifier', codeVerifier);

    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64urlencode(hashed);

    const authUrl = new URL(AUTH_URL);
    const params = {
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: SCOPES,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        redirect_uri: REDIRECT_URI,
        state: generateRandomString(16)
    };

    authUrl.search = new URLSearchParams(params).toString();
    window.location.href = authUrl.toString();
}

/**
 * Exchanges the authorization code for an Access Token and Refresh Token.
 */
export async function exchangeCodeForToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier');

    if (!codeVerifier) {
        // If code verifier is missing, try logging in again
        clearAllTokens();
        throw new Error("PKCE Verifier missing. Try logging in again.");
    }

    try {
        const response = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                grant_type: "authorization_code",
                code: code,
                redirect_uri: REDIRECT_URI,
                code_verifier: codeVerifier,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Spotify Token Error: ${errorData.error_description || response.statusText}`);
        }

        const data = await response.json();
        
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);
        localStorage.setItem('token_expiry', Date.now() + (data.expires_in * 1000));
        
        localStorage.removeItem('code_verifier'); 
        
        return data.access_token;

    } catch (error) {
        console.error("Token exchange failed:", error);
        clearAllTokens(); 
        throw error;
    }
}

/**
 * Uses the refresh_token to get a new access_token without user interaction.
 */
export async function refreshAccessToken() {
    const refreshToken = localStorage.getItem('refresh_token');

    if (!refreshToken) {
        clearAllTokens();
        throw new Error("No refresh token. Full re-authorization needed.");
    }

    try {
        const response = await fetch(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: CLIENT_ID,
                grant_type: "refresh_token",
                refresh_token: refreshToken,
            }),
        });

        if (!response.ok) {
             // If the refresh token itself is invalid, clear storage
             clearAllTokens();
             throw new Error(`Refresh failed with status ${response.status}. Full login required.`);
        }

        const data = await response.json();

        localStorage.setItem('access_token', data.access_token);
        if (data.refresh_token) {
            localStorage.setItem('refresh_token', data.refresh_token); 
        }
        localStorage.setItem('token_expiry', Date.now() + (data.expires_in * 1000));
        
        return data.access_token;

    } catch (error) {
        console.error("Token refresh failed:", error);
        clearAllTokens(); 
        throw error; 
    }
}