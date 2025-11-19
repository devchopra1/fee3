// src/PlaylistDisplay.js

import React from 'react';

const PlaylistDisplay = ({ data }) => {
  if (!data) return null;

  return (
    <div className="playlist-display">
      <h3>✅ Success! Playlist Generated</h3>
      <h4>{data.name}</h4>
      <p>A new playlist with <strong>{data.tracks}</strong> tracks has been created in your Spotify account.</p>
      {data.url ? (
        <a href={data.url} target="_blank" rel="noopener noreferrer" className="spotify-link">Open Playlist on Spotify</a>
      ) : (
        <p className="note">Playlist created but URL not available.</p>
      )}
    </div>
  );
};

export default PlaylistDisplay;
