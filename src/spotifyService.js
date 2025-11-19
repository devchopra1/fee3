// src/spotifyService.js
// Defensive Spotify service wrapper — aggressive debug + encodeURI + Accept header
// Replaces previous version. Copy entire file over src/spotifyService.js

import { refreshAccessToken, clearAllTokens, getStoredAccessToken } from './spotifyAuth';

let API_BASE_URL = "https://api.spotify.com/v1";
API_BASE_URL = API_BASE_URL.replace(/\/+$/, '');

const moodMap = {
  excited: { target_valence: 0.85, target_energy: 0.9, target_danceability: 0.7, min_tempo: 120 },
  chill:   { target_valence: 0.7,  target_energy: 0.4, target_danceability: 0.5, max_tempo: 110 },
  sad:     { target_valence: 0.2,  target_energy: 0.3, target_danceability: 0.4, max_tempo: 90  },
  pumped:  { target_valence: 0.5,  target_energy: 0.95, target_danceability: 0.6, min_tempo: 140 },
};

function buildFullUrl(url) {
  if (!url) return API_BASE_URL;

  if (/^https?:\/\//i.test(url)) return url;
  if (/^api\.spotify\.com/i.test(url)) return 'https://' + url.replace(/^\/+/, '');
  if (url.startsWith('/')) return API_BASE_URL + url;
  return API_BASE_URL + '/' + url;
}

async function spotifyFetch(url, token, options = {}, retries = 0) {
  let currentToken = token || getStoredAccessToken();

  if (!currentToken) {
    try {
      currentToken = await refreshAccessToken();
    } catch (err) {
      clearAllTokens();
      throw new Error('No access token available. Please log in.');
    }
  }

  const expiry = localStorage.getItem('token_expiry');
  if (expiry && Date.now() > parseInt(expiry, 10) - 5000) {
    try {
      currentToken = await refreshAccessToken();
    } catch (err) {
      clearAllTokens();
      throw new Error('Session expired. Please log in again.');
    }
  }

  const fullUrl = buildFullUrl(url);
  const encodedUrl = encodeURI(fullUrl);

  const finalOptions = {
    method: options.method || 'GET',
    headers: { 
      'Authorization': `Bearer ${currentToken}`, 
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(options.headers || {}) 
    },
    body: options.body
  };

  console.debug('[spotifyFetch] FINAL URL ->', fullUrl);
  console.debug('[spotifyFetch] ENCODED URL ->', encodedUrl);
  if (finalOptions.body) {
    try { console.debug('[spotifyFetch] REQ BODY ->', JSON.parse(finalOptions.body)); }
    catch { console.debug('[spotifyFetch] REQ BODY (raw) ->', finalOptions.body); }
  }

  let response;
  try {
    // try encoded URL first (prevents accidental malformed URLs)
    response = await fetch(encodedUrl, finalOptions);
  } catch (networkErr) {
    // if network error, surface it
    console.error('[spotifyFetch] Network error:', networkErr);
    throw new Error('Network error while contacting Spotify API.');
  }

  // read response body text for debugging (always)
  let bodyText = null;
  try { bodyText = await response.text(); } catch (e) { bodyText = null; }

  // log the exact response text so we know what Spotify returned
  console.debug('[spotifyFetch] RESPONSE TEXT ->', bodyText);

  // If 401, try refresh once
  if (response.status === 401 && retries === 0) {
    try {
      const newToken = await refreshAccessToken();
      return spotifyFetch(url, newToken, options, retries + 1);
    } catch (e) {
      clearAllTokens();
      throw new Error('Session expired. Please log in again.');
    }
  }

  // If 404 or other not ok, do an extra diagnostic: try raw full URL (unencoded) once and log its response
  if (!response.ok) {
    // Attempt a diagnostic fetch to compare encoded vs raw (only once)
    try {
      const rawResp = await fetch(fullUrl, finalOptions);
      let rawBody = null;
      try { rawBody = await rawResp.text(); } catch {}
      console.debug('[spotifyFetch] DIAGNOSTIC RAW URL ->', fullUrl);
      console.debug('[spotifyFetch] DIAGNOSTIC RAW RESPONSE ->', rawResp.status, rawBody);
    } catch (diagErr) {
      console.debug('[spotifyFetch] DIAGNOSTIC RAW FETCH FAILED ->', diagErr);
    }

    // Normalize response text to JSON if possible
    let bodyJson = null;
    try { bodyJson = JSON.parse(bodyText); } catch {}
    // Log detailed error
    console.error(`[spotifyFetch] ERROR ${response.status} ${response.statusText} ->`, bodyJson || bodyText);

    if (response.status === 403) {
      clearAllTokens();
      const msg = (bodyJson && (bodyJson.error?.message || bodyJson.error)) || bodyText || 'Permission Denied (403)';
      throw new Error(`Spotify 403: ${msg}`);
    }
    if (response.status === 404) {
      const msg = (bodyJson && (bodyJson.error?.message || bodyJson.error)) || bodyText || 'Not Found (404)';
      throw new Error(`Spotify 404: ${msg}`);
    }
    const generic = (bodyJson && (bodyJson.error?.message || bodyJson.error)) || bodyText || response.statusText;
    throw new Error(`Spotify API Error ${response.status}: ${generic}`);
  }

  // success: return parsed JSON if possible
  try { return bodyText ? JSON.parse(bodyText) : {}; } catch { return bodyText; }
}

/* ---------- API ---------- */

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
  if (!mood || typeof mood !== 'string') throw new Error('Mood required.');
  const targets = moodMap[mood.toLowerCase()];
  if (!targets) throw new Error(`Invalid mood: ${mood}`);

  const params = buildRecommendationParams(targets, { limit: 25 });
  const url = `/recommendations?${params.toString()}`;
  console.debug('[getRecommendedTracks] calling ->', url);
  const data = await spotifyFetch(url, token);

  if (!data || !Array.isArray(data.tracks)) throw new Error('Recommendations response malformed.');
  if (data.tracks.length === 0) throw new Error('No tracks returned from recommendations.');

  return data.tracks.map(t => t?.uri).filter(Boolean);
}

export async function createNewPlaylist(token, userId, mood, isPublic = false) {
  const moodTitle = (typeof mood === 'string' && mood.length) ? mood.charAt(0).toUpperCase() + mood.slice(1) : 'Custom';
  const bodyObj = { name: `MoodPlayl.ist: ${moodTitle} Vibe`, description: 'Generated by MoodPlayl.ist', public: Boolean(isPublic) };
  const playlist = await spotifyFetch('/me/playlists', token, { method: 'POST', body: JSON.stringify(bodyObj) });
  if (!playlist || !playlist.id) throw new Error('Failed to create playlist.');
  return { id: playlist.id, url: playlist.external_urls?.spotify ?? null };
}

export async function addTracksToPlaylist(token, playlistId, trackUris) {
  if (!playlistId) throw new Error('playlistId required.');
  if (!Array.isArray(trackUris) || trackUris.length === 0) return;

  let id = playlistId;
  if (typeof id === 'string' && id.startsWith('spotify:playlist:')) id = id.split(':').pop();

  const cleanedId = encodeURIComponent(String(id));
  const chunkSize = 100;
  for (let i = 0; i < trackUris.length; i += chunkSize) {
    const chunk = trackUris.slice(i, i + chunkSize);
    await spotifyFetch(`/playlists/${cleanedId}/tracks`, token, { method: 'POST', body: JSON.stringify({ uris: chunk }) });
  }
}

export async function generatePlaylist(token, mood, makePublic = false) {
  const me = await spotifyFetch('/me', token);
  if (!me || !me.id) throw new Error('Unable to fetch user profile.');
  const trackUris = await getRecommendedTracks(token, mood);
  const { id: playlistId, url: playlistUrl } = await createNewPlaylist(token, me.id, mood, makePublic);
  await addTracksToPlaylist(token, playlistId, trackUris);
  return { name: `MoodPlayl.ist: ${mood.charAt(0).toUpperCase() + mood.slice(1)} Vibe`, url: playlistUrl, tracks: trackUris.length };
}
