// src/MoodSelector.js

import React, { useState } from 'react';
import { generatePlaylist } from './spotifyService';

const MOODS = ['excited', 'chill', 'sad', 'pumped'];

const MoodSelector = ({ accessToken, setPlaylistResult, setError }) => {
  const [selectedMood, setSelectedMood] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState(null);

  const handleGenerate = async () => {
    if (!selectedMood) { setLocalError("Please select a mood."); return; }
    setIsLoading(true);
    setLocalError(null);
    setError && setError(null);
    setPlaylistResult(null);

    try {
      const res = await generatePlaylist(accessToken, selectedMood);
      setPlaylistResult(res);
    } catch (err) {
      console.error('Could not generate playlist:', err);
      const msg = err?.message || 'Unknown error';
      setLocalError(msg);
      setError && setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mood-selector">
      <h2>1. Select Your Mood</h2>
      <div className="mood-buttons">
        {MOODS.map(m => (
          <button key={m} className={`mood-button ${selectedMood === m ? 'selected' : ''}`} onClick={() => { setSelectedMood(m); setLocalError(null); setError && setError(null); }} disabled={isLoading}>
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      <button onClick={handleGenerate} className="generate-button" disabled={isLoading || !selectedMood}>
        {isLoading ? 'Generating Playlist…' : '2. Generate Playlist'}
      </button>

      {localError && <p className="error-message">{localError}</p>}
    </div>
  );
};

export default MoodSelector;
