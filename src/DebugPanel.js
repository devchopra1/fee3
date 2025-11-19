// src/DebugPanel.js

import React from 'react';

const formatObj = (o) => {
  try { return JSON.stringify(o, null, 2); } catch { return String(o); }
};

export default function DebugPanel({ logs = [] }) {
  if (!Array.isArray(logs) || logs.length === 0) return null;
  return (
    <div style={{ border: '2px dashed #f0a', padding: 12, marginTop: 12, background: '#111', color: '#fff', fontFamily: 'monospace', fontSize: 12 }}>
      <h4 style={{ marginTop: 0 }}>🪲 Debug Panel (latest requests)</h4>
      {logs.slice().reverse().map((entry, idx) => (
        <div key={idx} style={{ marginBottom: 10 }}>
          <div style={{ color: '#7fffd4' }}>{entry.stage}</div>
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>
            <strong>Request:</strong>{"\n"}{formatObj(entry.request)}{"\n\n"}
            <strong>Response:</strong>{"\n"}{formatObj(entry.response)}
          </pre>
          <hr style={{ borderColor: '#333' }} />
        </div>
      ))}
    </div>
  );
}
