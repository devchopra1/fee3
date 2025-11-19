// src/spotifyService.js  (DEBUG-ENABLED)
// Replaces previous spotifyService.js — supports debugCallback to surface requests/responses

import { refreshAccessToken, clearAllTokens, getStoredAccessToken } from './spotifyAuth';
const API_BASE_URL = "https://api.spotify.com/v1";

const moodMap = {
  excited: { target_valence: 0.85, target_energy: 0.9, target_danceability: 0.7, min_tempo: 120 },
  chill:   { target_valence: 0.7,  target_energy: 0.4, target_danceability: 0.5, max_tempo: 110 },
  sad:     { target_valence: 0.2,  target_energy: 0.3, target_danceability: 0.4, max_tempo: 90  },
  pumped:  { target_valence: 0.5,  target_energy: 0.95, target_danceability: 0.6, min_tempo: 140 },
};

async function spotifyFetch(url, token, options = {}, retries = 0, debugCallback) {
  const makeDebug = (stage, req, resp) => {
    try { if (typeof debugCallback === 'function') debugCallback({ stage, request: req, response: resp }); } catch (e) { console.warn('debugCallback failed', e); }
  };

  let currentToken = token || getStoredAccessToken();
  if (!currentToken) {
    try { currentToken = await refreshAccessToken(); } catch (err) { clearAllTokens(); throw new Error("No access token. Please log in."); }
  }

  // refresh if near expiry
  const expiry = localStorage.getItem('token_expiry');
  if (expiry && Date.now() > parseInt(expiry, 10) - 5000) {
    try { currentToken = await refreshAccessToken(); } catch (err) { clearAllTokens(); throw new Error("Session expired. Please log in again."); }
  }

  const fullUrl = `${API_BASE_URL}${url.startsWith('/') ? url : '/' + url}`;
  const req = {
    method: options.method || 'GET',
    url: fullUrl,
    body: options.body ?? null,
    headers: { ...(options.headers || {}) }
  };

  makeDebug('request:prepare', req, null);
  let response;
  try {
    response = await fetch(fullUrl, { method: req.method, headers: { Authorization: `Bearer ${currentToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) }, body: req.body });
  } catch (networkErr) {
    const resp = { status: null, statusText: String(networkErr), bodyText: null, bodyJson: null };
    makeDebug('response:error', req, resp);
    console.error('Network fetch failed', networkErr);
    throw new Error('Network error while contacting Spotify API.');
  }

  // read response text
  let bodyText = null;
  let bodyJson = null;
  try {
    bodyText = await response.text();
    try { bodyJson = JSON.parse(bodyText); } catch (_) { bodyJson = null; }
  } catch (e) {
    bodyText = null;
    bodyJson = null;
  }

  const respObj = { status: response.status, statusText: response.statusText, bodyText, bodyJson };
  makeDebug('response:received', req, respObj);

  // 401 -> try refresh once
  if (response.status === 401 && retries === 0) {
    try {
      const newToken = await refreshAccessToken();
      return spotifyFetch(url, newToken, options, retries + 1, debugCallback);
    } catch (e) {
      clearAllTokens();
      throw new Error("Session expired. Please log in again.");
    }
  }

  if (response.status === 204) return {};

  if (!response.ok) {
    // Surface helpful debug info
    const msg = bodyJson?.error?.message || bodyText || response.statusText || `HTTP ${response.status}`;
    // Provide the debug callback one more time with stage 'response:error-final'
    makeDebug('response:error-final', req, respObj);
    if (response.status === 403) {
      clearAllTokens();
      throw new Error(`Spotify 403: ${msg}`);
    } else if (response.status === 404) {
      throw new Error(`Spotify 404: ${msg}`);
    } else {
      throw new Error(`Spotify API Error ${response.status}: ${msg}`);
    }
  }

  return bodyJson ?? (bodyText ? (() => { try { return JSON.parse(bodyText); } catch { return bodyText; } })() : {});
}

/* ---------- Public API with debugCallback param ---------- */

export async function getCurrentUserId(token, debugCallback) {
  const profile = await spotifyFetch('/me', token, {}, 0, debugCallback);
  if (!profile || !profile.id) throw new Error('Unable to fetch user profile (no id in /me).');
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

export async function getRecommendedTracks(token, mood, debugCallback) {
  if (!mood || typeof mood !== 'string') throw new Error('Mood required.');
  const targets = moodMap[mood.toLowerCase()];
  if (!targets) throw new Error(`Invalid mood: ${mood}`);

  const params = buildRecommendationParams(targets, { limit: 25 });
  const url = `/recommendations?${params.toString()}`;
  const data = await spotifyFetch(url, token, {}, 0, debugCallback);

  if (!data || !Array.isArray(data.tracks)) {
    throw new Error('Recommendations response malformed.');
  }
  if (data.tracks.length === 0) throw new Error('No recommendation tracks returned.');

  return data.tracks.map(t => t?.uri).filter(Boolean);
}

export async function createNewPlaylist(token, userId, mood, isPublic = false, debugCallback) {
  // verify /me upfront
  const me = await spotifyFetch('/me', token, {}, 0, debugCallback);
  if (!me || !me.id) throw new Error('/me did not return user id.');

  const moodTitle = (typeof mood === 'string' && mood.length) ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'Custom';
  const bodyObj = { name: `MoodPlayl.ist: ${moodTitle} Vibe`, description: 'Generated by MoodPlayl.ist', public: Boolean(isPublic) };

  const playlist = await spotifyFetch('/me/playlists', token, { method: 'POST', body: JSON.stringify(bodyObj) }, 0, debugCallback);
  if (!playlist || !playlist.id) throw new Error(`Playlist creation failed: ${JSON.stringify(playlist)}`);
  return { id: playlist.id, url: playlist.external_urls?.spotify ?? null, raw: playlist };
}

export async function addTracksToPlaylist(token, playlistId, trackUris, debugCallback) {
  if (!playlistId) throw new Error('playlistId required.');
  if (!Array.isArray(trackUris) || trackUris.length === 0) return;

  // convert URI -> id if needed
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
  // validate token via /me and return debug info
  const me = await spotifyFetch('/me', token, {}, 0, debugCallback);
  if (!me || !me.id) throw new Error('Could not validate user with /me.');

  const trackUris = await getRecommendedTracks(token, mood, debugCallback);
  if (!Array.isArray(trackUris) || trackUris.length === 0) throw new Error('No recommended tracks found.');

  const { id: playlistId, url: playlistUrl, raw } = await createNewPlaylist(token, me.id, mood, makePublic, debugCallback);
  await addTracksToPlaylist(token, playlistId, trackUris, debugCallback);

  return { name: `MoodPlayl.ist: ${mood.charAt(0).toUpperCase() + mood.slice(1)} Vibe`, url: playlistUrl, tracks: trackUris.length, playlistRaw: raw };
}
