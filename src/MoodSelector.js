// src/MoodSelector.js

import React, { useState } from 'react';
import { generatePlaylist } from './spotifyService';

const MOODS = ['excited', 'chill', 'sad', 'pumped'];

const MoodSelector = ({ accessToken, setPlaylistResult }) => {
    const [selectedMood, setSelectedMood] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleGenerate = async () => {
        if (!selectedMood) {
            setError("Please select a mood before generating.");
            return;
        }

        setIsLoading(true);
        setError(null);
        setPlaylistResult(null);

        try {
            const result = await generatePlaylist(accessToken, selectedMood);
            setPlaylistResult(result);
        } catch (err) {
            console.error("Playlist Generation Failed:", err);
            // Display the specific message from the thrown error
            setError(`Could not generate playlist: ${err.message || "Unknown API error occurred"}.`); 
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="mood-selector">
            <h2>1. Select Your Current Mood</h2>
            <div className="mood-buttons">
                {MOODS.map(mood => (
                    <button
                        key={mood}
                        className={`mood-button ${selectedMood === mood ? 'selected' : ''}`}
                        onClick={() => setSelectedMood(mood)}
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

            {error && <p className="error-message">{error}</p>}
        </div>
    );
};
export default MoodSelector;