// src/spotifyService.js

import { refreshAccessToken, clearAllTokens, getStoredAccessToken } from './spotifyAuth';

// Real Spotify API base URL
const API_BASE_URL = "https://api.spotify.com/v1";

// Mood mapping — use Spotify parameter names (target_*, min_*, max_*)
const moodMap = {
  excited: { target_valence: 0.85, target_energy: 0.9, target_danceability: 0.7, min_tempo: 120 },
  chill:   { target_valence: 0.7,  target_energy: 0.4, target_danceability: 0.5, max_tempo: 110 },
  sad:     { target_valence: 0.2,  target_energy: 0.3, target_danceability: 0.4, max_tempo: 90  },
  pumped:  { target_valence: 0.5,  target_energy: 0.95, target_danceability: 0.6, min_tempo: 140 },
};

async function spotifyFetch(url, token, options = {}, retries = 0) {
  let currentToken = token || getStoredAccessToken();

  if (!currentToken) {
    try { currentToken = await refreshAccessToken(); }
    catch (e) { clearAllTokens(); throw new Error("No access token available. Please sign in."); }
  }

  // Refresh shortly before expiry if needed
  const expiry = localStorage.getItem('token_expiry');
  if (expiry && Date.now() > parseInt(expiry, 10) - 5000) {
    try { currentToken = await refreshAccessToken(); } catch (e) { clearAllTokens(); throw new Error("Session expired. Please log in again."); }
  }

  const fullUrl = `${API_BASE_URL}${url.startsWith('/') ? url : '/' + url}`;
  const finalOptions = {
    method: options.method || 'GET',
    headers: { 'Authorization': `Bearer ${currentToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body
  };

  let response;
  try { response = await fetch(fullUrl, finalOptions); }
  catch (networkErr) { console.error('Network fetch error:', networkErr); throw new Error('Network error while contacting Spotify API.'); }

  // Auto refresh once on 401
  if (response.status === 401 && retries === 0) {
    try {
      const newToken = await refreshAccessToken();
      return spotifyFetch(url, newToken, options, retries + 1);
    } catch (e) {
      clearAllTokens();
      throw new Error("Session expired. Please log in again.");
    }
  }

  if (response.status === 204) return {};

  // Parse body text and maybe JSON
  let bodyText = null, bodyJson = null;
  try {
    bodyText = await response.text();
    try { bodyJson = JSON.parse(bodyText); } catch (e) { bodyJson = null; }
  } catch (e) { /* ignore */ }

  if (!response.ok) {
    console.error(`Spotify API ${response.status} ${response.statusText}:`, bodyJson || bodyText);
    if (response.status === 403) {
      clearAllTokens();
      const msg = bodyJson && bodyJson.error && bodyJson.error.message ? bodyJson.error.message : 'Permission Denied (403)';
      throw new Error(`Spotify 403: ${msg} — Ensure required scopes were granted.`);
    }
    if (response.status === 404) {
      const msg = bodyJson && bodyJson.error && bodyJson.error.message ? bodyJson.error.message : 'Not Found (404)';
      throw new Error(`Spotify 404: ${msg} — Check endpoint and resource identifiers.`);
    }
    const genericMsg = bodyJson && bodyJson.error && bodyJson.error.message ? bodyJson.error.message : bodyText || response.statusText;
    throw new Error(`Spotify API Error ${response.status}: ${genericMsg}`);
  }

  if (bodyJson) return bodyJson;
  try { return JSON.parse(bodyText); } catch { return bodyText; }
}

/* ----------------------
   Simple wrappers
   ---------------------- */
export async function getCurrentUserId(token) {
  const userProfile = await spotifyFetch('/me', token);
  if (!userProfile || !userProfile.id) throw new Error('Unable to fetch user profile.');
  return userProfile.id;
}

function buildRecommendationParams(targets = {}, extra = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(extra.limit ?? 25));
  params.set('seed_genres', extra.seed_genres ?? 'pop,rock,edm,chill');
  Object.entries(targets).forEach(([k, v]) => {
    if (v !== undefined && v !== null && (typeof v === 'number' || typeof v === 'string')) {
      params.set(k, String(v));
    }
  });
  return params;
}

export async function getRecommendedTracks(token, mood) {
  if (!mood || typeof mood !== 'string') throw new Error('Mood must be a non-empty string.');
  const targets = moodMap[mood.toLowerCase()];
  if (!targets) throw new Error(`Invalid mood: ${mood}`);
  const params = buildRecommendationParams(targets, { limit: 25 });
  const data = await spotifyFetch(`/recommendations?${params.toString()}`, token);
  if (!data || !Array.isArray(data.tracks) || data.tracks.length === 0) throw new Error("No tracks found for this mood.");
  return data.tracks.map(t => t && t.uri).filter(Boolean);
}

/* ----------------------
   Create playlist (use /me/playlists)
   ---------------------- */
export async function createNewPlaylist(token, userId, mood) {
  const moodTitle = typeof mood === 'string' && mood.length > 0 ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'Custom';
  const body = { name: `MoodPlayl.ist: ${moodTitle} Vibe`, description: `Generated by MoodPlayl.ist`, public: true };
  // Use /me/playlists to avoid wrong userId issues
  const playlist = await spotifyFetch('/me/playlists', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!playlist || !playlist.id) { console.error('Playlist creation returned unexpected response:', playlist); throw new Error('Failed to create playlist.'); }
  const url = playlist.external_urls && playlist.external_urls.spotify ? playlist.external_urls.spotify : null;
  return { id: playlist.id, url };
}

/* ----------------------
   Add tracks (chunked)
   ---------------------- */
export async function addTracksToPlaylist(token, playlistId, trackUris) {
  if (!playlistId) throw new Error('playlistId is required.');
  if (!Array.isArray(trackUris) || trackUris.length === 0) return;
  const chunkSize = 100; // Spotify limit
  for (let i = 0; i < trackUris.length; i += chunkSize) {
    const chunk = trackUris.slice(i, i + chunkSize);
    try {
      await spotifyFetch(`/playlists/${encodeURIComponent(playlistId)}/tracks`, token, {
        method: 'POST',
        body: JSON.stringify({ uris: chunk }),
      });
    } catch (err) {
      console.error(`Failed to add tracks chunk starting at ${i}:`, err);
      throw err;
    }
  }
}

/* ----------------------
   High-level flow
   ---------------------- */
export async function generatePlaylist(token, mood) {
  const userId = await getCurrentUserId(token);
  const trackUris = await getRecommendedTracks(token, mood);
  const { id: playlistId, url: playlistUrl } = await createNewPlaylist(token, userId, mood);
  await addTracksToPlaylist(token, playlistId, trackUris);
  return {
    name: `MoodPlayl.ist: ${mood.charAt(0).toUpperCase() + mood.slice(1)} Vibe`,
    url: playlistUrl,
    tracks: trackUris.length,
  };
}
