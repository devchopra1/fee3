// src/MoodSelector.js

import React, { useState } from 'react';
import { generatePlaylist } from './spotifyService';

const MOODS = ['excited', 'chill', 'sad', 'pumped'];

const MoodSelector = ({ accessToken, setPlaylistResult, setError }) => {
    const [selectedMood, setSelectedMood] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [localError, setLocalError] = useState(null);

    const handleGenerate = async () => {
        if (!selectedMood) {
            setLocalError("Please select a mood before generating.");
            return;
        }

        setIsLoading(true);
        setLocalError(null);
        setError && setError(null); 
        setPlaylistResult(null);

        try {
            const result = await generatePlaylist(accessToken, selectedMood);
            setPlaylistResult(result);
        } catch (err) {
            console.error("Playlist Generation Failed:", err);

            const message = err?.message || "Unknown API error occurred.";
            setLocalError(`Could not generate playlist: ${message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSelectMood = (mood) => {
        setSelectedMood(mood);
        setLocalError(null);
        setError && setError(null);
    };

    return (
        <div className="mood-selector">
            <h2>1. Select Your Current Mood</h2>

            <div className="mood-buttons">
                {MOODS.map(mood => (
                    <button
                        key={mood}
                        className={`mood-button ${selectedMood === mood ? 'selected' : ''}`}
                        onClick={() => handleSelectMood(mood)}
                        disabled={isLoading}
                    >
                        {mood.charAt(0).toUpperCase() + mood.slice(1)}
                    </button>
                ))}
            </div>

            <button
                className="generate-button"
                onClick={handleGenerate}
                disabled={isLoading || !selectedMood}
            >
                {isLoading ? 'Generating Playlist...' : '2. Generate Playlist'}
            </button>

            {localError && <p className="error-message">{localError}</p>}
        </div>
    );
};

export default MoodSelector;
