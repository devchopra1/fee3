// src/App.js

import React, { useState, useEffect } from 'react';
import { handleSpotifyLogin, exchangeCodeForToken, getStoredAccessToken, clearAllTokens } from './spotifyAuth';
import MoodSelector from './MoodSelector';
import PlaylistDisplay from './PlaylistDisplay';
import './App.css';

function App() {
  const [accessToken, setAccessToken] = useState(getStoredAccessToken());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playlistResult, setPlaylistResult] = useState(null);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');

      if (code && !accessToken) {
        setLoading(true);
        try {
          const token = await exchangeCodeForToken(code, state);
          setAccessToken(token || getStoredAccessToken());
          setError(null);
        } catch (err) {
          console.error('Login failed:', err);
          setError(err?.message || 'Login failed');
          clearAllTokens();
          setAccessToken(null);
        } finally {
          setLoading(false);
          try { window.history.replaceState({}, document.title, window.location.pathname); } catch {}
        }
      } else {
        const stored = getStoredAccessToken();
        if (stored && !accessToken) setAccessToken(stored);
      }
    })();
    // run only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTryLoginAgain = () => {
    clearAllTokens();
    handleSpotifyLogin(true);
  };

  const handleLogout = () => {
    clearAllTokens();
    setAccessToken(null);
    setPlaylistResult(null);
    setError(null);
  };

  return (
    <div className="app-container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>MoodPlayl.ist Generator</h1>
        {accessToken && <button onClick={handleLogout} className="generate-button outline">Logout</button>}
      </header>

      {loading ? (
        <div className="app-container">
          <h2>Loading… completing Spotify login</h2>
        </div>
      ) : error && !accessToken ? (
        <div className="app-container">
          <h2>Error</h2>
          <p className="error-message">{error}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleTryLoginAgain} className="generate-button">Re-login with Spotify</button>
            <button onClick={() => { clearAllTokens(); setError(null); }} className="generate-button outline">Clear & Retry</button>
          </div>
        </div>
      ) : !accessToken ? (
        <div className="login-screen app-container">
          <h2>Log in with Spotify to generate a mood playlist</h2>
          <button onClick={() => handleSpotifyLogin(true)} className="generate-button">Log in with Spotify</button>
        </div>
      ) : (
        <main style={{ marginTop: 20 }}>
          <MoodSelector accessToken={accessToken} setPlaylistResult={setPlaylistResult} setError={setError} />
          <PlaylistDisplay data={playlistResult} />
        </main>
      )}
    </div>
  );
}

export default App;
