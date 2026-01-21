import React, { useEffect, useRef } from 'react';

function TranscriptDisplay({ transcript, partialTranscript, isRecording }) {
  const containerRef = useRef(null);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [transcript, partialTranscript]);

  const hasContent = transcript || partialTranscript;

  return (
    <div
      ref={containerRef}
      className={`transcript-box ${isRecording ? 'live' : ''}`}
    >
      {hasContent ? (
        <>
          <span>{transcript}</span>
          {partialTranscript && (
            <span className="partial-text"> {partialTranscript}</span>
          )}
        </>
      ) : (
        <div style={{
          textAlign: 'center',
          color: 'var(--text-secondary)',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '0.5rem'
        }}>
          <span style={{ fontSize: '2rem' }}>🎤</span>
          <p>Start recording to see live transcription</p>
          <p style={{ fontSize: '0.75rem' }}>Your speech will appear here in real-time</p>
        </div>
      )}
    </div>
  );
}

export default TranscriptDisplay;
