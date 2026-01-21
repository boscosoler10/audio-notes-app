import React, { useState, useRef, useCallback, useEffect } from 'react';
import AudioRecorder from './components/AudioRecorder';
import TranscriptDisplay from './components/TranscriptDisplay';
import NotesEnhancer from './components/NotesEnhancer';
import Notification from './components/Notification';

function App() {
  const [activeTab, setActiveTab] = useState('record');
  const [transcript, setTranscript] = useState('');
  const [partialTranscript, setPartialTranscript] = useState('');
  const [summary, setSummary] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);

  const addNotification = useCallback((message, type = 'info') => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const handleTranscriptUpdate = useCallback((text, isFinal) => {
    if (isFinal) {
      setTranscript(prev => prev + (prev ? ' ' : '') + text);
      setPartialTranscript('');
    } else {
      setPartialTranscript(text);
    }
  }, []);

  const handleRecordingStart = useCallback(() => {
    setIsRecording(true);
    setTranscript('');
    setPartialTranscript('');
    setSummary(null);
    addNotification('Recording started', 'info');
  }, [addNotification]);

  const handleRecordingStop = useCallback(async () => {
    setIsRecording(false);
    setPartialTranscript('');
    addNotification('Recording stopped', 'info');

    // Generate summary if we have transcript
    if (transcript) {
      try {
        const response = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: transcript })
        });
        const data = await response.json();
        setSummary(data.summary);
        addNotification('Summary generated successfully', 'success');
      } catch (error) {
        console.error('Failed to generate summary:', error);
        addNotification('Failed to generate summary', 'error');
      }
    }
  }, [transcript, addNotification]);

  const handleConnectionChange = useCallback((connected) => {
    setIsConnected(connected);
  }, []);

  const handleSummarize = useCallback(async () => {
    if (!transcript) {
      addNotification('No transcript to summarize', 'error');
      return;
    }

    try {
      const response = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript })
      });
      const data = await response.json();
      setSummary(data.summary);
      addNotification('Summary generated successfully', 'success');
    } catch (error) {
      console.error('Failed to generate summary:', error);
      addNotification('Failed to generate summary', 'error');
    }
  }, [transcript, addNotification]);

  const handleClear = useCallback(() => {
    setTranscript('');
    setPartialTranscript('');
    setSummary(null);
    addNotification('Cleared all content', 'info');
  }, [addNotification]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="logo">
            <div className="logo-icon">🎙️</div>
            <h1>Audio Notes</h1>
          </div>
          <nav className="nav-tabs">
            <button
              className={`nav-tab ${activeTab === 'record' ? 'active' : ''}`}
              onClick={() => setActiveTab('record')}
            >
              Live Recording
            </button>
            <button
              className={`nav-tab ${activeTab === 'enhance' ? 'active' : ''}`}
              onClick={() => setActiveTab('enhance')}
            >
              Enhance Notes
            </button>
          </nav>
        </div>
      </header>

      <main className="main-content">
        {activeTab === 'record' && (
          <>
            <div className="card">
              <div className="card-header">
                <h2>
                  <span>🎤</span> Audio Recording
                </h2>
              </div>
              <div className="card-body">
                <AudioRecorder
                  onTranscriptUpdate={handleTranscriptUpdate}
                  onRecordingStart={handleRecordingStart}
                  onRecordingStop={handleRecordingStop}
                  onConnectionChange={handleConnectionChange}
                  onError={(error) => addNotification(error, 'error')}
                />
              </div>
            </div>

            <div className="transcript-container">
              <div className="card">
                <div className="card-header">
                  <h2>
                    <span>📝</span> Live Transcript
                  </h2>
                </div>
                <div className="card-body">
                  <TranscriptDisplay
                    transcript={transcript}
                    partialTranscript={partialTranscript}
                    isRecording={isRecording}
                  />
                  <div className="control-buttons" style={{ marginTop: '1rem' }}>
                    <button
                      className="control-btn primary"
                      onClick={handleSummarize}
                      disabled={!transcript || isRecording}
                    >
                      📊 Generate Summary
                    </button>
                    <button
                      className="control-btn secondary"
                      onClick={handleClear}
                      disabled={isRecording}
                    >
                      🗑️ Clear
                    </button>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <h2>
                    <span>✨</span> Summary & Notes
                  </h2>
                </div>
                <div className="card-body">
                  {summary ? (
                    <div className="summary-section">
                      {summary.keyPoints && summary.keyPoints.length > 0 && (
                        <>
                          <h3>Key Points</h3>
                          <ul className="summary-list">
                            {summary.keyPoints.map((point, i) => (
                              <li key={i}>{point}</li>
                            ))}
                          </ul>
                        </>
                      )}

                      {summary.actionItems && summary.actionItems.length > 0 && (
                        <>
                          <h3>Action Items</h3>
                          <ul className="summary-list">
                            {summary.actionItems.map((item, i) => (
                              <li key={i} className="action-item">{item}</li>
                            ))}
                          </ul>
                        </>
                      )}

                      {summary.summary && (
                        <>
                          <h3>Summary</h3>
                          <p style={{ color: 'var(--text-secondary)' }}>{summary.summary}</p>
                        </>
                      )}

                      <div className="stats">
                        <div className="stat">
                          <div className="stat-value">{summary.wordCount || 0}</div>
                          <div className="stat-label">Words</div>
                        </div>
                        <div className="stat">
                          <div className="stat-value">{summary.sentenceCount || 0}</div>
                          <div className="stat-label">Sentences</div>
                        </div>
                        <div className="stat">
                          <div className="stat-value">{summary.keyPoints?.length || 0}</div>
                          <div className="stat-label">Key Points</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '3rem' }}>
                      <p>Record audio or enter text to generate a summary</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'enhance' && (
          <NotesEnhancer
            currentTranscript={transcript}
            onNotification={addNotification}
          />
        )}
      </main>

      {notifications.map(notification => (
        <Notification
          key={notification.id}
          message={notification.message}
          type={notification.type}
          onClose={() => removeNotification(notification.id)}
        />
      ))}
    </div>
  );
}

export default App;
