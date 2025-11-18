// src/App.js

import React, { useState, useEffect } from 'react';
import { handleSpotifyLogin, exchangeCodeForToken } from './spotifyAuth';
import MoodSelector from './MoodSelector';
import PlaylistDisplay from './PlaylistDisplay';
import './App.css'; 

function App() {
  const [accessToken, setAccessToken] = useState(localStorage.getItem('access_token'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playlistResult, setPlaylistResult] = useState(null); // State to hold the generated playlist info

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    // 1. If we have a code and no token, we need to exchange the code
    if (code && !accessToken) {
      setLoading(true);
      exchangeCodeForToken(code)
        .then(token => {
          setAccessToken(token);
          setLoading(false);
          // Clean up the URL query parameter after successful exchange
          window.history.pushState({}, null, "/"); 
        })
        .catch(err => {
          console.error("Login failed:", err);
          setError("Login failed. Please clear your cache or try again.");
          setLoading(false);
        });
    }
  }, [accessToken]); 

  if (loading) {
    return (
        <div className="app-container">
            <h2>Loading... Completing Spotify login.</h2>
            <p>Please wait while we secure your connection.</p>
        </div>
    );
  }

  if (error) {
    return (
        <div className="app-container">
            <h2>Error</h2>
            <p className="error-message">{error}</p>
            <button onClick={() => window.location.reload()}>Try Login Again</button>
        </div>
    );
  }

  if (!accessToken) {
    // Show the login button if no token is present
    return (
      <div className="login-screen app-container">
        <h1>MoodPlayl.ist Generator</h1>
        <p>Log in with Spotify to generate a playlist based on your mood.</p>
        <button onClick={handleSpotifyLogin}>Log In with Spotify</button>
      </div>
    );
  }

  // --- Main application content once logged in ---
  return (
    <div className="app-container">
      <h1>MoodPlayl.ist Generator</h1>
      <MoodSelector 
        accessToken={accessToken} 
        setPlaylistResult={setPlaylistResult} 
      />
      <PlaylistDisplay data={playlistResult} />
    </div>
  );
}

export default App;