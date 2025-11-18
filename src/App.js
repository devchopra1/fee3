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
  const [playlistResult, setPlaylistResult] = useState(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');

    if (code && !accessToken) {
      setLoading(true);
      window.history.pushState({}, null, "/"); 

      exchangeCodeForToken(code)
        .then(token => {
          setAccessToken(token);
          setLoading(false);
        })
        .catch(err => {
          console.error("Login failed:", err);
          // Display the error thrown by the PKCE exchange
          setError(err.message || "Login failed. Check console for details.");
          setLoading(false);
        });
    }
  }, [accessToken]); 

  // Function to force a full re-login by clearing state
  const handleTryLoginAgain = () => {
      localStorage.clear();
      window.location.href = "/";
  };


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
            <button onClick={handleTryLoginAgain} className="generate-button">Try Login Again</button>
        </div>
    );
  }

  if (!accessToken) {
    return (
      <div className="login-screen app-container">
        <h1>MoodPlayl.ist Generator</h1>
        <p>Log in with Spotify to generate a playlist based on your mood.</p>
        <button onClick={handleSpotifyLogin}>Log In with Spotify</button>
      </div>
    );
  }

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