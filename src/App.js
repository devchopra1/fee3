// src/App.js

import React, { useState, useEffect } from 'react';
import { handleSpotifyLogin, exchangeCodeForToken, getStoredAccessToken, clearAllTokens } from './spotifyAuth';
import MoodSelector from './MoodSelector';
import PlaylistDisplay from './PlaylistDisplay';
import './App.css';

function App() {
  // initialize from storage helper so we stay consistent with spotifyAuth
  const [accessToken, setAccessToken] = useState(getStoredAccessToken());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playlistResult, setPlaylistResult] = useState(null);

  useEffect(() => {
    // On app mount check URL for code/state from Spotify redirect
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');

      // If there's a code and we don't already have an access token, exchange it.
      if (code && !accessToken) {
        setLoading(true);
        try {
          const token = await exchangeCodeForToken(code, state);
          setAccessToken(token || getStoredAccessToken());
          setError(null);
        } catch (err) {
          console.error('Login failed:', err);
          setError(err && err.message ? err.message : 'Login failed. Check console for details.');
          // clear any partial auth state
          clearAllTokens();
          setAccessToken(null);
        } finally {
          setLoading(false);
          // clean up the URL so code/state aren't visible or retried on refresh
          try {
            window.history.replaceState({}, document.title, window.location.pathname);
          } catch (e) {
            // ignore replaceState failures on some environments
          }
        }
      } else {
        // If no code but storage has a token, sync state
        const stored = getStoredAccessToken();
        if (stored && !accessToken) setAccessToken(stored);
      }
    })();
    // We want this effect to run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTryLoginAgain = () => {
    // Clear only Spotify-related tokens and re-run auth flow
    clearAllTokens();
    setAccessToken(null);
    setError(null);
    // redirect to the auth page (handleSpotifyLogin will redirect)
    handleSpotifyLogin();
  };

  const handleLogout = () => {
    clearAllTokens();
    setAccessToken(null);
    setPlaylistResult(null);
    setError(null);
  };

  if (loading) {
    return (
      <div className="app-container">
        <h2>Loading… Completing Spotify login</h2>
        <p>Please wait — finalizing authentication with Spotify.</p>
      </div>
    );
  }

  if (error && !accessToken) {
    return (
      <div className="app-container">
        <h2>Error</h2>
        <p className="error-message">{error}</p>
        <div style={{ display: 'flex', gap: '8px', marginTop: 12 }}>
          <button onClick={handleTryLoginAgain} className="generate-button">Try Login Again</button>
          <button onClick={() => { clearAllTokens(); setError(null); }} className="generate-button outline">Clear & Retry</button>
        </div>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div className="login-screen app-container">
        <h1>MoodPlayl.ist Generator</h1>
        <p>Log in with Spotify to generate a playlist based on your mood.</p>
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <button onClick={handleSpotifyLogin} className="generate-button">Log In with Spotify</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>MoodPlayl.ist Generator</h1>
        <div>
          <button onClick={handleLogout} className="generate-button outline">Logout</button>
        </div>
      </header>

      <main style={{ marginTop: 20 }}>
        <MoodSelector
          accessToken={accessToken}
          setPlaylistResult={setPlaylistResult}
          setError={setError}
        />
        <PlaylistDisplay data={playlistResult} />
      </main>
    </div>
  );
}

export default App;