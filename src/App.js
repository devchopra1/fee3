// src/App.js

import React, { useState, useEffect } from 'react';
import {
  handleSpotifyLogin,
  exchangeCodeForToken,
  getStoredAccessToken,
  clearAllTokens
} from './spotifyAuth';

import MoodSelector from './MoodSelector';
import PlaylistDisplay from './PlaylistDisplay';
import DebugPanel from './DebugPanel'; // OPTIONAL: Only if you added DebugPanel.js
import './App.css';

function App() {
  const [accessToken, setAccessToken] = useState(getStoredAccessToken());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playlistResult, setPlaylistResult] = useState(null);

  // Debug logs (optional)
  const [debugLogs, setDebugLogs] = useState([]);
  const pushDebug = (logEntry) => {
    setDebugLogs(prev => [...prev.slice(-19), logEntry]); // keep last 20
  };

  // Handle redirect from Spotify OAuth (PKCE code)
  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');

      // Already logged in → nothing to do
      if (!code || accessToken) return;

      setLoading(true);

      try {
        const token = await exchangeCodeForToken(code, state);
        setAccessToken(token || getStoredAccessToken());
        setError(null);
      } catch (err) {
        console.error('Login failed:', err);
        setError(err?.message || 'Login failed.');
        clearAllTokens();
        setAccessToken(null);
      } finally {
        setLoading(false);

        // Clean URL (remove ?code=...&state=...)
        try {
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (_) { }
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // User pressed "Try Login Again"
  const handleTryLoginAgain = () => {
    clearAllTokens();
    setError(null);
    setAccessToken(null);
    handleSpotifyLogin(true); // force Spotify consent popup
  };

  const handleLogout = () => {
    clearAllTokens();
    setAccessToken(null);
    setPlaylistResult(null);
    setError(null);
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>MoodPlayl.ist Generator</h1>

        {accessToken && (
          <button
            className="generate-button outline"
            onClick={handleLogout}
          >Logout</button>
        )}
      </header>

      {/* Loading screen */}
      {loading && (
        <div className="center">
          <h2>Loading…</h2>
          <p>Completing Spotify login…</p>
        </div>
      )}

      {/* Error screen (not logged in) */}
      {!loading && error && !accessToken && (
        <div className="center">
          <h2>Error</h2>
          <p className="error-message">{error}</p>
          <button onClick={handleTryLoginAgain} className="generate-button">
            Re-Login with Spotify
          </button>
        </div>
      )}

      {/* Login screen */}
      {!loading && !error && !accessToken && (
        <div className="center">
          <h2>Log in with Spotify to generate playlists</h2>
          <button
            className="generate-button"
            onClick={() => handleSpotifyLogin(true)}
          >
            Login with Spotify
          </button>
        </div>
      )}

      {/* Main Screen */}
      {!loading && accessToken && (
        <>
          <MoodSelector
            accessToken={accessToken}
            setPlaylistResult={setPlaylistResult}
            setError={setError}
            debugCallback={pushDebug}  // OPTIONAL
          />

          <PlaylistDisplay data={playlistResult} />

          {/* Debug panel (optional) */}
          <DebugPanel logs={debugLogs} />
        </>
      )}
    </div>
  );
}

export default App;
