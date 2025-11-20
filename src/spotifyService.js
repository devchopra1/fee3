// src/spotifyService.js
// Final updated Spotify service for MoodPlayl.ist
// - recommendations-first (seed_artists -> seed_tracks -> seed_genres)
// - automatic fallbacks to user's top tracks / saved tracks / static list
// - safe URL building (no double-encoding)
// - token auto-refresh, helpful error messages
// - create playlist (private by default) and add tracks in chunks (100 max)
// - optional debugCallback(stage, { request, response })

import { refreshAccessToken, clearAllTokens, getStoredAccessToken } from './spotifyAuth';

let API_BASE_URL = "https://api.spotify.com/v1";
API_BASE_URL = API_BASE_URL.replace(/\/+$/, '');

const moodMap = {
  excited: { target_valence: 0.85, target_energy: 0.9, target_danceability: 0.7, min_tempo: 120 },
  chill:   { target_valence: 0.7,  target_energy: 0.4, target_danceability: 0.5, max_tempo: 110 },
  sad:     { target_valence: 0.2,  target_energy: 0.3, target_danceability: 0.4, max_tempo: 90  },
  pumped:  { target_valence: 0.5,  target_energy: 0.95, target_danceability: 0.6, min_tempo: 140 },
};

// Final fallback list of URIs (used only if all else fails)
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

function safeJSONParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function spotifyFetch(url, token, options = {}, retries = 0, debugCallback) {
  // debug helper — non-blocking
  const pushDebug = (stage, req, resp) => {
    try {
      if (typeof debugCallback === 'function') debugCallback({ stage, request: req, response: resp });
    } catch (e) {
      // ignore debug errors
      console.warn('debugCallback failed', e);
    }
  };

  let currentToken = token || getStoredAccessToken();
  if (!currentToken) {
    try { currentToken = await refreshAccessToken(); } catch (e) { clearAllTokens(); throw new Error('No access token available. Please sign in.'); }
  }

  // refresh shortly before expiry
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
      ...(options.headers || {})
    },
    body: options.body ?? null
  };

  const reqDebug = { method: finalOptions.method, url: fullUrl, body: finalOptions.body };
  pushDebug('request:prepare', reqDebug, null);
  console.debug('[spotifyFetch] FINAL URL ->', fullUrl);

  let response;
  try {
    // IMPORTANT: do not re-encode the URL (URLSearchParams already encodes). Use fullUrl as-is.
    response = await fetch(fullUrl, finalOptions);
  } catch (networkErr) {
    const respErr = { status: null, statusText: String(networkErr), bodyText: null, bodyJson: null };
    pushDebug('response:error', reqDebug, respErr);
    console.error('[spotifyFetch] Network error:', networkErr);
    throw new Error('Network error while contacting Spotify API.');
  }

  let bodyText = null;
  try { bodyText = await response.text(); } catch {}
  const bodyJson = safeJSONParse(bodyText);
  const respDebug = { status: response.status, statusText: response.statusText, bodyText, bodyJson };
  pushDebug('response:received', reqDebug, respDebug);

  console.debug('[spotifyFetch] RESPONSE TEXT ->', bodyText);

  // 401: try refresh once
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

  // success: return parsed json if possible
  if (bodyJson !== null) return bodyJson;
  try { return bodyText ? JSON.parse(bodyText) : {}; } catch { return bodyText; }
}

/* ---------- Public API ---------- */

export async function getCurrentUserId(token, debugCallback) {
  const profile = await spotifyFetch('/me', token, {}, 0, debugCallback);
  if (!profile || !profile.id) throw new Error('Unable to fetch user profile.');
  return profile.id;
}

/* Helper to build params object from targets */
function applyTargetsToParams(params, targets) {
  Object.entries(targets || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && (typeof v === 'number' || typeof v === 'string')) {
      params.set(k, String(v));
    }
  });
}

/**
 * Recommendations-first function:
 * 1) Try /recommendations with seed_artists from user's top artists
 * 2) Then try seed_tracks (user's top tracks)
 * 3) Then try a small safe seed_genres list
 * 4) If recommendations fail or return empty -> fallback to /me/top/tracks -> /me/tracks -> STATIC_FALLBACK_URIS
 */
export async function getRecommendedTracks(token, mood, debugCallback) {
  if (!mood || typeof mood !== 'string') throw new Error('Mood required.');
  const targets = moodMap[mood.toLowerCase()];
  if (!targets) throw new Error(`Invalid mood: ${mood}`);

  // helper to call /recommendations with provided seed params (object)
  const tryRecommendations = async (seedObj) => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '25');
      Object.entries(seedObj || {}).forEach(([k, v]) => { if (v) params.set(k, v); });
      applyTargetsToParams(params, targets);
      const url = `/recommendations?${params.toString()}`;
      console.debug('[getRecommendedTracks] requesting', url);
      const data = await spotifyFetch(url, token, {}, 0, debugCallback);
      if (data && Array.isArray(data.tracks) && data.tracks.length) {
        return data.tracks.map(t => t?.uri).filter(Boolean);
      }
      return null;
    } catch (err) {
      console.warn('recommendations request failed:', err?.message || err);
      return null;
    }
  };

  // 1) seed_artists from /me/top/artists
  try {
    const topArtists = await spotifyFetch('/me/top/artists?limit=5', token, {}, 0, debugCallback);
    if (topArtists && Array.isArray(topArtists.items) && topArtists.items.length) {
      const artistSeeds = topArtists.items.map(a => a.id).filter(Boolean).slice(0,5).join(',');
      const res = await tryRecommendations({ seed_artists: artistSeeds });
      if (Array.isArray(res) && res.length) return res;
    }
  } catch (e) {
    console.warn('top artists fetch failed (non-fatal):', e?.message || e);
  }

  // 2) seed_tracks from /me/top/tracks
  try {
    const topTracks = await spotifyFetch('/me/top/tracks?limit=5', token, {}, 0, debugCallback);
    if (topTracks && Array.isArray(topTracks.items) && topTracks.items.length) {
      const trackSeeds = topTracks.items.map(t => t.id).filter(Boolean).slice(0,5).join(',');
      const res2 = await tryRecommendations({ seed_tracks: trackSeeds });
      if (Array.isArray(res2) && res2.length) return res2;
    }
  } catch (e) {
    console.warn('top tracks fetch failed (non-fatal):', e?.message || e);
  }

  // 3) Safe genre fallback
  try {
    const safeGenres = 'pop,rock,edm,chill';
    const res3 = await tryRecommendations({ seed_genres: safeGenres });
    if (Array.isArray(res3) && res3.length) return res3;
  } catch (e) {
    console.warn('genre-based recs attempt failed:', e?.message || e);
  }

  // 4) Fallbacks if /recommendations is blocked or returns empty:
  // 4a: Try returning user's top tracks directly
  try {
    const fallbackTop = await spotifyFetch('/me/top/tracks?limit=25', token, {}, 0, debugCallback);
    if (fallbackTop && Array.isArray(fallbackTop.items) && fallbackTop.items.length) {
      return fallbackTop.items.map(t => t?.uri).filter(Boolean);
    }
  } catch (e) {
    console.warn('/me/top/tracks fallback failed:', e?.message || e);
  }

  // 4b: Try user's saved tracks (/me/tracks)
  try {
    const saved = await spotifyFetch('/me/tracks?limit=25', token, {}, 0, debugCallback);
    if (saved && Array.isArray(saved.items) && saved.items.length) {
      return saved.items.map(i => i?.track?.uri).filter(Boolean);
    }
  } catch (e) {
    console.warn('/me/tracks fallback failed:', e?.message || e);
  }

  // 4c: Final static fallback
  console.warn('Using static fallback URIs (final fallback).');
  return STATIC_FALLBACK_URIS.slice(0, 25);
}

/* ---------- Playlist helpers ---------- */

export async function createNewPlaylist(token, userId, mood, isPublic = false, debugCallback) {
  const moodTitle = (typeof mood === 'string' && mood.length) ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'Custom';
  const bodyObj = { name: `MoodPlayl.ist: ${moodTitle} Vibe`, description: 'Generated by MoodPlayl.ist', public: Boolean(isPublic) };
  const playlist = await spotifyFetch('/me/playlists', token, { method: 'POST', body: JSON.stringify(bodyObj) }, 0, debugCallback);
  if (!playlist || !playlist.id) throw new Error('Failed to create playlist.');
  return { id: playlist.id, url: playlist.external_urls?.spotify ?? null, raw: playlist };
}

export async function addTracksToPlaylist(token, playlistId, trackUris, debugCallback) {
  if (!playlistId) throw new Error('playlistId required.');
  if (!Array.isArray(trackUris) || trackUris.length === 0) return;

  // Convert playlist URI -> id if needed
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
  // validate /me first
  const me = await spotifyFetch('/me', token, {}, 0, debugCallback);
  if (!me || !me.id) throw new Error('Unable to fetch user profile.');

  // get recommended tracks (recommendations-first)
  const trackUris = await getRecommendedTracks(token, mood, debugCallback);
  if (!Array.isArray(trackUris) || trackUris.length === 0) throw new Error('No tracks available to add.');

  // create playlist and add tracks
  const { id: playlistId, url: playlistUrl } = await createNewPlaylist(token, me.id, mood, makePublic, debugCallback);
  await addTracksToPlaylist(token, playlistId, trackUris, debugCallback);

  return { name: `MoodPlayl.ist: ${mood.charAt(0).toUpperCase() + mood.slice(1)} Vibe`, url: playlistUrl, tracks: trackUris.length };
}
