// src/spotifyAuth.js

// --- CONFIGURATION ---
export const CLIENT_ID = "df15f24ccf514ad8920d69105c44b84e"; // <-- REPLACE THIS!
export const REDIRECT_URI = "http://192.168.144.109:3000"; 
// ... (rest of the secure PKCE helper functions and handleSpotifyLogin/exchangeCodeForToken)
// src/spotifyAuth.js

// --- CONFIGURATION ---
// !! REPLACE with your actual Client ID !!
// Scopes needed for: reading user info, creating public/private playlists, adding songs
export const SCOPES = "user-read-private playlist-modify-public playlist-modify-private"; 

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";


// --- PKCE HELPER FUNCTIONS ---

// Generates a high-entropy random string
const generateRandomString = (length) => {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = window.crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

// Hashes the verifier using SHA-256
const sha256 = async (plain) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
}

// Converts the hash to a URL-safe Base64 string
const base64urlencode = (input) => {
    return btoa(String.fromCharCode(...new Uint8Array(input)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}


// --- MAIN PKCE FLOW FUNCTIONS ---

/**
 * Step 1 & 2: Initiates the Spotify login redirect.
 */
export async function handleSpotifyLogin() {
    // 1. Generate code verifier and challenge
    const codeVerifier = generateRandomString(128);
    // Save the verifier for later exchange
    localStorage.setItem('code_verifier', codeVerifier);

    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64urlencode(hashed);

    // 2. Prepare parameters and redirect
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
    window.location.href = authUrl.toString(); // Redirect user to Spotify
}

/**
 * Step 3 & 4: Exchanges the authorization code for an Access Token.
 */
export async function exchangeCodeForToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier');

    if (!codeVerifier) {
        throw new Error("Code Verifier not found in storage. Cannot exchange code.");
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
            throw new Error(`Spotify API Token Error: ${response.status} - ${errorData.error_description || response.statusText}`);
        }

        const data = await response.json();
        
        localStorage.setItem('access_token', data.access_token);
        localStorage.setItem('refresh_token', data.refresh_token);
        localStorage.setItem('token_expiry', Date.now() + (data.expires_in * 1000));
        
        localStorage.removeItem('code_verifier'); 
        
        return data.access_token;

    } catch (error) {
        console.error("Token exchange failed:", error);
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('token_expiry');
        throw error;
    }
}