// src/spotifyService.js

import { refreshAccessToken, clearAllTokens } from './spotifyAuth'; // <--- Import clearAllTokens

const API_BASE_URL = "https://api.spotify.com/v1";

// ... (moodMap remains the same) ...
const moodMap = {
    'excited': { target_valence: 0.85, target_energy: 0.9, target_danceability: 0.7, min_tempo: 120 },
    'chill': { target_valence: 0.7, target_energy: 0.4, target_danceability: 0.5, max_tempo: 110 },
    'sad': { target_valence: 0.2, target_energy: 0.3, target_danceability: 0.4, max_tempo: 90 },
    'pumped': { target_valence: 0.5, target_energy: 0.95, target_tempo: 140, min_danceability: 0.6 },
};

/**
 * Generic API fetch wrapper that handles token expiry and retries.
 */
async function spotifyFetch(url, token, options = {}, retries = 0) {
    const expiry = localStorage.getItem('token_expiry');
    let currentToken = token;

    // 1. Token Expiry Check
    if (expiry && Date.now() > parseInt(expiry) - 5000) {
        try {
            currentToken = await refreshAccessToken();
        } catch (e) {
            // Refresh failed, clear state and throw
            clearAllTokens();
            throw new Error("Session expired. Please log in again to renew permissions.");
        }
    }

    const defaultOptions = {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${currentToken}`,
            'Content-Type': 'application/json',
        },
    };
    const finalOptions = {
        ...defaultOptions,
        ...options,
        headers: { ...defaultOptions.headers, ...options.headers }
    };

    const response = await fetch(`${API_BASE_URL}${url}`, finalOptions);

    // 2. Handle 401 Unauthorized errors (token just expired)
    if (response.status === 401 && retries === 0) {
        try {
            const newToken = await refreshAccessToken();
            // Retry the original call with the new token
            return spotifyFetch(url, newToken, options, 1); 
        } catch (e) {
            // If refresh fails on 401, throw to force full login
            clearAllTokens();
            throw new Error("Session expired. Please log in.");
        }
    }
    
    // 3. Handle 403 Forbidden (Missing Scopes)
    if (response.status === 403) {
        clearAllTokens();
        throw new Error("Permission Denied (403). You must log in again and agree to **all** permissions to create playlists.");
    }

    if (!response.ok) {
        const errorDetail = await response.text();
        console.error(`Spotify API call failed: ${response.status} for ${url}`, errorDetail);
        throw new Error(`Spotify API Error: ${response.statusText}. Code: ${response.status}`);
    }

    if (response.status === 204) return {}; 
    
    return response.json();
}

// ... (getCurrentUserId, getRecommendedTracks, createNewPlaylist, addTracksToPlaylist, generatePlaylist all remain the same) ...