// src/spotifyService.js
// Robust Spotify service wrapper for MoodPlayl.ist
// - defensive spotifyFetch with auto-refresh
// - recommendations -> create playlist -> add tracks (chunked)
// - uses /me/playlists (safer) and private playlists by default
// - helpful debug logging for 403/404

import { refreshAccessToken, clearAllTokens, getStoredAccessToken } from './spotifyAuth';

const API_BASE_URL = "https://api.spotify.com/v1";

const moodMap = {
  excited: { target_valence: 0.85, target_energy: 0.9, target_danceability: 0.7, min_tempo: 120 },
  chill:   { target_valence: 0.7,  target_energy: 0.4, target_danceability: 0.5, max_tempo: 110 },
  sad:     { target_valence: 0.2,  target_energy: 0.3, target_danceability: 0.4, max_tempo: 90  },
  pumped:  { target_valence: 0.5,  target_energy: 0.95, target_danceability: 0.6, min_tempo: 140 },
};

/**
 * Internal fetch wrapper for Spotify API.
 * - uses provided token or stored token
 * - attempts refresh when close to expiry and on 401
 * - logs useful debug info (URL, body, response body) on errors
 */
async function spotifyFetch(url, token, options = {}, retries = 0) {
  let currentToken = token || getStoredAccessToken();

  if (!currentToken) {
    try {
      currentToken = await refreshAccessToken();
    } catch (err) {
      clearAllTokens();
      throw new Error("No access token available. Please sign in.");
    }
  }

  // refresh shortly before expiry if necessary
  const expiry = localStorage.getItem('token_expiry');
  if (expiry && Date.now() > parseInt(expiry, 10) - 5000) {
    try {
      currentToken = await refreshAccessToken();
    } catch (err) {
      clearAllTokens();
      throw new Error("Session expired. Please log in again.");
    }
  }

  const fullUrl = `${API_BASE_URL}${url.startsWith('/') ? url : '/' + url}`;
  const finalOptions = {
    method: options.method || 'GET',
    headers: { 'Authorization': `Bearer ${currentToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body
  };

  // Debug: log outgoing request (body parsed if JSON)
  console.debug('SPOTIFY REQUEST ->', finalOptions.method, fullUrl);
  if (finalOptions.body) {
    try { console.debug('SPOTIFY REQUEST BODY ->', JSON.parse(finalOptions.body)); }
    catch { console.debug('SPOTIFY REQUEST BODY (raw) ->', finalOptions.body); }
  }

  let response;
  try {
    response = await fetch(fullUrl, finalOptions);
  } catch (networkErr) {
    console.error('Network error calling Spotify API:', networkErr);
    throw new Error('Network error while contacting Spotify API.');
  }

  // If unauthorized, try refresh once
  if (response.status === 401 && retries === 0) {
    try {
      const newToken = await refreshAccessToken();
      return spotifyFetch(url, newToken, options, retries + 1);
    } catch (e) {
      clearAllTokens();
      throw new Error("Session expired. Please log in again.");
    }
  }

  // No content
  if (response.status === 204) return {};

  // read body text and try parse
  let bodyText = null;
  let bodyJson = null;
  try {
    bodyText = await response.text();
    try { bodyJson = JSON.parse(bodyText); } catch (_) { bodyJson = null; }
  } catch (e) {
    // ignore parse/read errors
  }

  if (!response.ok) {
    console.error(`Spotify API Error ${response.status} ${response.statusText} ->`, bodyJson || bodyText);
    // helpful specialized messages
    if (response.status === 403) {
      clearAllTokens();
      const msg = bodyJson?.error?.message || bodyText || 'Permission Denied (403)';
      throw new Error(`Spotify 403: ${msg} — make sure the user granted required scopes.`);
    }
    if (response.status === 404) {
      const msg = bodyJson?.error?.message || bodyText || 'Not Found (404)';
      throw new Error(`Spotify 404: ${msg} — check endpoint and resource ids.`);
    }
    const generic = bodyJson?.error?.message || bodyText || response.statusText;
    throw new Error(`Spotify API Error ${response.status}: ${generic}`);
  }

  // return parsed JSON if possible, else raw text
  if (bodyJson) return bodyJson;
  try { return JSON.parse(bodyText); } catch { return bodyText; }
}

/* ---------- Helpers & Public API ---------- */

export async function getCurrentUserId(token) {
  const profile = await spotifyFetch('/me', token);
  if (!profile || !profile.id) throw new Error('Unable to fetch user profile.');
  return profile.id;
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
  const url = `/recommendations?${params.toString()}`;
  const data = await spotifyFetch(url, token);

  if (!data || !Array.isArray(data.tracks) || data.tracks.length === 0) {
    throw new Error("No tracks found for this mood.");
  }

  // map to URIs and filter falsy
  return data.tracks.map(t => t?.uri).filter(Boolean);
}

/**
 * Create playlist (defaults to private to avoid requiring public scope).
 * Uses /me/playlists to avoid userId mismatches.
 */
export async function createNewPlaylist(token, userId, mood, isPublic = false) {
  // Validate token by calling /me first (gives clearer errors)
  try {
    const me = await spotifyFetch('/me', token);
    console.debug('DEBUG current user ->', me && me.id ? me.id : me);
  } catch (err) {
    throw new Error(`Failed to get current user before creating playlist: ${err.message || err}`);
  }

  const moodTitle = (typeof mood === 'string' && mood.length) ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'Custom';
  const bodyObj = {
    name: `MoodPlayl.ist: ${moodTitle} Vibe`,
    description: `Generated by MoodPlayl.ist`,
    public: Boolean(isPublic),
  };

  console.debug('DEBUG create playlist ->', bodyObj);
  const playlist = await spotifyFetch('/me/playlists', token, {
    method: 'POST',
    body: JSON.stringify(bodyObj),
  });

  console.debug('DEBUG playlist created ->', playlist);

  if (!playlist || !playlist.id) {
    throw new Error(`Playlist creation failed or returned invalid response: ${JSON.stringify(playlist)}`);
  }

  return { id: playlist.id, url: playlist.external_urls?.spotify ?? null };
}

/**
 * Add tracks to playlist in chunks (100 max per Spotify).
 * Accepts playlistId (or converts spotify:playlist:... URI into id).
 */
export async function addTracksToPlaylist(token, playlistId, trackUris) {
  if (!playlistId) throw new Error('playlistId is required.');
  if (!Array.isArray(trackUris) || trackUris.length === 0) return;

  // If caller passed a URI, extract the id
  let id = playlistId;
  if (typeof id === 'string' && id.startsWith('spotify:playlist:')) {
    id = id.split(':').pop();
    console.warn('Converted playlist URI to id:', id);
  }

  const cleanedId = encodeURIComponent(String(id));
  const chunkSize = 100;

  for (let i = 0; i < trackUris.length; i += chunkSize) {
    const chunk = trackUris.slice(i, i + chunkSize);
    const endpoint = `/playlists/${cleanedId}/tracks`;
    console.debug(`DEBUG addTracks -> endpoint: ${endpoint}, uris: ${chunk.length}`);
    try {
      const resp = await spotifyFetch(endpoint, token, {
        method: 'POST',
        body: JSON.stringify({ uris: chunk }),
      });
      console.debug('DEBUG addTracks response ->', resp);
    } catch (err) {
      console.error(`Failed to add tracks to playlist ${cleanedId} (chunk start ${i}):`, err);
      throw new Error(`Failed to add tracks to playlist: ${err.message || err}`);
    }
  }
}

/**
 * High-level: generate playlist for a mood.
 * Creates private playlist by default (pass makePublic=true to create public).
 */
export async function generatePlaylist(token, mood, makePublic = false) {
  // validate /me and token
  const me = await spotifyFetch('/me', token);
  if (!me || !me.id) throw new Error('Unable to fetch current user profile (invalid token).');

  // get recommended tracks
  const trackUris = await getRecommendedTracks(token, mood);
  if (!Array.isArray(trackUris) || trackUris.length === 0) {
    throw new Error('No track URIs returned from recommendations.');
  }

  // create playlist
  const { id: playlistId, url: playlistUrl } = await createNewPlaylist(token, me.id, mood, makePublic);
  if (!playlistId) throw new Error('Playlist creation did not return an id.');

  // add tracks
  await addTracksToPlaylist(token, playlistId, trackUris);

  return {
    name: `MoodPlayl.ist: ${mood.charAt(0).toUpperCase() + mood.slice(1)} Vibe`,
    url: playlistUrl,
    tracks: trackUris.length,
  };
}
