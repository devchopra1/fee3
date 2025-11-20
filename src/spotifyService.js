// src/spotifyService.js
// Robust, fallback-first Spotify service wrapper for MoodPlayl.ist
// - Safe URL building (no double-encoding)
// - Auto refresh token
// - Try recommendations -> fallback to user's top tracks -> saved tracks -> built-in fallback list
// - Create playlist via /me/playlists and add tracks in chunks of 100
// - Optional debugCallback(request/response) for UI debug panel

import { refreshAccessToken, clearAllTokens, getStoredAccessToken } from './spotifyAuth';

let API_BASE_URL = "https://api.spotify.com/v1";
API_BASE_URL = API_BASE_URL.replace(/\/+$/, '');

const moodMap = {
  excited: { target_valence: 0.85, target_energy: 0.9, target_danceability: 0.7, min_tempo: 120 },
  chill:   { target_valence: 0.7,  target_energy: 0.4, target_danceability: 0.5, max_tempo: 110 },
  sad:     { target_valence: 0.2,  target_energy: 0.3, target_danceability: 0.4, max_tempo: 90  },
  pumped:  { target_valence: 0.5,  target_energy: 0.95, target_danceability: 0.6, min_tempo: 140 },
};

// A small static fallback list (last resort). Replace or expand later if you want.
const STATIC_FALLBACK_URIS = [
  "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp",
  "spotify:track:7ouMYWpwJ422jRcDASZB7P",
  "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
  "spotify:track:0VjIjW4GlUZAMYd2vXMi3b",
  "spotify:track:2XU0oxnq2qxCpomAAuJY8K"
];

function buildFullUrl(url) {
  if (!url) return API_BASE_URL;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^api\.spotify\.com/i.test(url)) return 'https://' + url.replace(/^\/+/, '');
  if (url.startsWith('/')) return API_BASE_URL + url;
  return API_BASE_URL + '/' + url;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function spotifyFetch(url, token, options = {}, retries = 0, debugCallback) {
  const pushDebug = (stage, req, resp) => {
    try { if (typeof debugCallback === 'function') debugCallback({ stage, request: req, response: resp }); } catch {}
  };

  let currentToken = token || getStoredAccessToken();
  if (!currentToken) {
    try { currentToken = await refreshAccessToken(); } catch (e) { clearAllTokens(); throw new Error('No access token available. Please sign in.'); }
  }

  const expiry = localStorage.getItem('token_expiry');
  if (expiry && Date.now() > parseInt(expiry, 10) - 5000) {
    try { currentToken = await refreshAccessToken(); } catch (e) { clearAllTokens(); throw new Error('Session expired. Please log in again.'); }
  }

  const fullUrl = buildFullUrl(url);
  const finalOptions = {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${currentToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ?? null
  };

  const reqDebug = { method: finalOptions.method, url: fullUrl, body: finalOptions.body };
  pushDebug('request:prepare', reqDebug, null);
  console.debug('[spotifyFetch] FINAL URL ->', fullUrl);

  let response;
  try {
    // Important: DO NOT re-encode the fullUrl (URLSearchParams already encodes). Use fullUrl as-is.
    response = await fetch(fullUrl, finalOptions);
  } catch (networkErr) {
    const respErr = { status: null, statusText: String(networkErr), bodyText: null, bodyJson: null };
    pushDebug('response:error', reqDebug, respErr);
    console.error('[spotifyFetch] Network error:', networkErr);
    throw new Error('Network error while contacting Spotify API.');
  }

  let bodyText = null;
  try { bodyText = await response.text(); } catch {}
  const bodyJson = safeParse(bodyText);
  const respDebug = { status: response.status, statusText: response.statusText, bodyText, bodyJson };
  pushDebug('response:received', reqDebug, respDebug);
  console.debug('[spotifyFetch] RESPONSE TEXT ->', bodyText);

  if (response.status === 401 && retries === 0) {
    try {
      const newToken = await refreshAccessToken();
      return spotifyFetch(url, newToken, options, retries + 1, debugCallback);
    } catch (e) {
      clearAllTokens();
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (response.status === 204) return {};

  if (!response.ok) {
    const msg = (bodyJson && (bodyJson.error?.message || bodyJson.message)) || bodyText || response.statusText || `HTTP ${response.status}`;
    pushDebug('response:error-final', reqDebug, respDebug);
    console.error(`[spotifyFetch] ERROR ${response.status} ->`, msg);
    if (response.status === 403) { clearAllTokens(); throw new Error(`Spotify 403: ${msg}`); }
    if (response.status === 404) { throw new Error(`Spotify 404: ${msg}`); }
    throw new Error(`Spotify API Error ${response.status}: ${msg}`);
  }

  if (bodyJson !== null) return bodyJson;
  try { return bodyText ? JSON.parse(bodyText) : {}; } catch { return bodyText; }
}

/* ========== Public API ========== */

export async function getCurrentUserId(token, debugCallback) {
  const profile = await spotifyFetch('/me', token, {}, 0, debugCallback);
  if (!profile || !profile.id) throw new Error('Unable to fetch user profile.');
  return profile.id;
}

function buildRecommendationParams(targets = {}, extra = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(extra.limit ?? 25));
  // don't hardcode seed_genres here; the recommendation caller will set seeds
  Object.entries(targets).forEach(([k, v]) => {
    if (v !== undefined && v !== null && (typeof v === 'number' || typeof v === 'string')) {
      params.set(k, String(v));
    }
  });
  return params;
}

/**
 * getRecommendedTracks(token, mood)
 * Strategy:
 * 1) Try recommendations (preferring seed_artists from user's top artists)
 * 2) If recommendations endpoint fails or returns empty -> fallback to user's top tracks
 * 3) If none -> fallback to user's saved tracks
 * 4) If still none -> use STATIC_FALLBACK_URIS
 */
export async function getRecommendedTracks(token, mood, debugCallback) {
  if (!mood || typeof mood !== 'string') throw new Error('Mood required.');
  const targets = moodMap[mood.toLowerCase()];
  if (!targets) throw new Error(`Invalid mood: ${mood}`);

  // 1) gather user's top artists (best seeds)
  let topArtistIds = [];
  try {
    const topArtists = await spotifyFetch('/me/top/artists?limit=5', token, {}, 0, debugCallback);
    if (topArtists && Array.isArray(topArtists.items) && topArtists.items.length) {
      topArtistIds = topArtists.items.map(a => a.id).filter(Boolean).slice(0,5);
    }
  } catch (e) {
    console.warn('Could not fetch top artists (non-fatal):', e?.message || e);
  }

  // Try recommendations using artist seeds if we have them
  const tryRecommendations = async (seedParams) => {
    try {
      const params = buildRecommendationParams(targets, { limit: 25 });
      Object.entries(seedParams).forEach(([k,v]) => { if (v) params.set(k, v); });
      const url = `/recommendations?${params.toString()}`;
      console.debug('[getRecommendedTracks] Attempting recommendations ->', url);
      const data = await spotifyFetch(url, token, {}, 0, debugCallback);
      if (data && Array.isArray(data.tracks) && data.tracks.length) {
        return data.tracks.map(t => t?.uri).filter(Boolean);
      }
      return null;
    } catch (err) {
      console.warn('Recommendations attempt failed:', err?.message || err);
      return null;
    }
  };

  // 1a: Try with seed_artists from /me/top/artists
  if (topArtistIds.length) {
    const res = await tryRecommendations({ seed_artists: topArtistIds.join(',') });
    if (Array.isArray(res) && res.length) return res;
  }

  // 1b: Try with user's top tracks as seed_tracks
  try {
    const topTracks = await spotifyFetch('/me/top/tracks?limit=5', token, {}, 0, debugCallback);
    if (topTracks && Array.isArray(topTracks.items) && topTracks.items.length) {
      const ids = topTracks.items.map(t => t.id).filter(Boolean).slice(0,5);
      if (ids.length) {
        const res2 = await tryRecommendations({ seed_tracks: ids.join(',') });
        if (Array.isArray(res2) && res2.length) return res2;
      }
    }
  } catch (e) {
    console.warn('Top-tracks based recommendation failed:', e?.message || e);
  }

  // 2) If recommendations are failing or blocked (404 etc), fall back to returning user's own tracks:
  // 2a) /me/top/tracks
  try {
    const topTracksAgain = await spotifyFetch('/me/top/tracks?limit=25', token, {}, 0, debugCallback);
    if (topTracksAgain && Array.isArray(topTracksAgain.items) && topTracksAgain.items.length) {
      return topTracksAgain.items.map(t => t?.uri).filter(Boolean);
    }
  } catch (e) {
    console.warn('/me/top/tracks fallback failed:', e?.message || e);
  }

  // 2b) /me/tracks (saved tracks)
  try {
    const saved = await spotifyFetch('/me/tracks?limit=25', token, {}, 0, debugCallback);
    if (saved && Array.isArray(saved.items) && saved.items.length) {
      // saved.items are { track: { uri } }
      return saved.items.map(i => i?.track?.uri).filter(Boolean);
    }
  } catch (e) {
    console.warn('/me/tracks fallback failed:', e?.message || e);
  }

  // 3) Final fallback: built-in static URIs
  console.warn('Using static fallback track URIs (final fallback).');
  return STATIC_FALLBACK_URIS.slice(0, 25);
}

/* ---------- Playlist helpers ---------- */

export async function createNewPlaylist(token, userId, mood, isPublic = false, debugCallback) {
  // Use /me/playlists for consistency
  const moodTitle = (typeof mood === 'string' && mood.length) ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'Custom';
  const bodyObj = { name: `MoodPlayl.ist: ${moodTitle} Vibe`, description: 'Generated by MoodPlayl.ist', public: Boolean(isPublic) };
  const playlist = await spotifyFetch('/me/playlists', token, { method: 'POST', body: JSON.stringify(bodyObj) }, 0, debugCallback);
  if (!playlist || !playlist.id) throw new Error('Failed to create playlist.');
  return { id: playlist.id, url: playlist.external_urls?.spotify ?? null, raw: playlist };
}

export async function addTracksToPlaylist(token, playlistId, trackUris, debugCallback) {
  if (!playlistId) throw new Error('playlistId required.');
  if (!Array.isArray(trackUris) || trackUris.length === 0) return;

  let id = playlistId;
  if (typeof id === 'string' && id.startsWith('spotify:playlist:')) id = id.split(':').pop();
  const cleanedId = encodeURIComponent(String(id));
  const chunkSize = 100;
  for (let i = 0; i < trackUris.length; i += chunkSize) {
    const chunk = trackUris.slice(i, i + chunkSize);
    await spotifyFetch(`/playlists/${cleanedId}/tracks`, token, { method: 'POST', body: JSON.stringify({ uris: chunk }) }, 0, debugCallback);
  }
}

export async function generatePlaylist(token, mood, makePublic = false, debugCallback) {
  // Validate user first (throws if token invalid)
  const me = await spotifyFetch('/me', token, {}, 0, debugCallback);
  if (!me || !me.id) throw new Error('Unable to fetch user profile.');

  // Get tracks (recommendations or fallbacks)
  const trackUris = await getRecommendedTracks(token, mood, debugCallback);
  if (!Array.isArray(trackUris) || trackUris.length === 0) throw new Error('No tracks available to add.');

  // Create playlist and add tracks
  const { id: playlistId, url: playlistUrl } = await createNewPlaylist(token, me.id, mood, makePublic, debugCallback);
  await addTracksToPlaylist(token, playlistId, trackUris, debugCallback);

  return { name: `MoodPlayl.ist: ${mood.charAt(0).toUpperCase() + mood.slice(1)} Vibe`, url: playlistUrl, tracks: trackUris.length };
}
