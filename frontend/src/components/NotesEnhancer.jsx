import React, { useState, useRef, useCallback } from 'react';

function NotesEnhancer({ currentTranscript, onNotification }) {
  const [existingNotes, setExistingNotes] = useState('');
  const [transcriptionText, setTranscriptionText] = useState('');
  const [enhancedNotes, setEnhancedNotes] = useState('');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState('');

  const fileInputRef = useRef(null);

  // Use current transcript from recording if available
  React.useEffect(() => {
    if (currentTranscript && !transcriptionText) {
      setTranscriptionText(currentTranscript);
    }
  }, [currentTranscript]);

  const handleFileUpload = useCallback(async (file) => {
    if (!file) return;

    // Check file type
    const allowedTypes = ['text/plain', 'text/markdown', 'application/json'];
    const allowedExtensions = ['.txt', '.md', '.json'];

    const isAllowedType = allowedTypes.includes(file.type);
    const isAllowedExtension = allowedExtensions.some(ext =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!isAllowedType && !isAllowedExtension) {
      onNotification('Please upload a .txt, .md, or .json file', 'error');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('document', file);

      const response = await fetch('/api/upload-document', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      setExistingNotes(data.content);
      setUploadedFileName(data.filename);
      onNotification(`Loaded "${data.filename}"`, 'success');
    } catch (error) {
      console.error('File upload error:', error);
      onNotification('Failed to upload file', 'error');
    }
  }, [onNotification]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);

    const file = e.dataTransfer.files[0];
    handleFileUpload(file);
  }, [handleFileUpload]);

  const handleFileInputChange = useCallback((e) => {
    const file = e.target.files[0];
    handleFileUpload(file);
  }, [handleFileUpload]);

  const handleEnhanceNotes = useCallback(async () => {
    if (!existingNotes.trim()) {
      onNotification('Please enter or upload existing notes first', 'error');
      return;
    }

    if (!transcriptionText.trim()) {
      onNotification('Please provide transcription text to enhance notes', 'error');
      return;
    }

    setIsEnhancing(true);

    try {
      const response = await fetch('/api/enhance-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingNotes: existingNotes,
          transcription: transcriptionText
        })
      });

      if (!response.ok) {
        throw new Error('Enhancement failed');
      }

      const data = await response.json();
      setEnhancedNotes(data.enhancedNotes);
      onNotification('Notes enhanced successfully!', 'success');
    } catch (error) {
      console.error('Enhancement error:', error);
      onNotification('Failed to enhance notes', 'error');
    } finally {
      setIsEnhancing(false);
    }
  }, [existingNotes, transcriptionText, onNotification]);

  const handleCopyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(enhancedNotes);
    onNotification('Copied to clipboard', 'success');
  }, [enhancedNotes, onNotification]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([enhancedNotes], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'enhanced-notes.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotification('Notes downloaded', 'success');
  }, [enhancedNotes, onNotification]);

  const handleUseRecordingTranscript = useCallback(() => {
    if (currentTranscript) {
      setTranscriptionText(currentTranscript);
      onNotification('Using transcript from recording', 'info');
    } else {
      onNotification('No transcript available from recording', 'error');
    }
  }, [currentTranscript, onNotification]);

  return (
    <div className="upload-section">
      <div className="card">
        <div className="card-header">
          <h2>
            <span>📄</span> Your Notes
          </h2>
        </div>
        <div className="card-body">
          <div
            className={`upload-area ${isDragOver ? 'dragover' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="upload-icon">📁</div>
            <p className="upload-text">
              {uploadedFileName
                ? `Loaded: ${uploadedFileName}`
                : 'Drag & drop your notes file here'}
            </p>
            <p className="upload-hint">or click to browse (supports .txt, .md, .json)</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.json"
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
          />

          <div style={{ margin: '1rem 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
            — or type your notes below —
          </div>

          <textarea
            className="notes-editor"
            placeholder="Enter your existing notes here..."
            value={existingNotes}
            onChange={(e) => setExistingNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>
            <span>🎙️</span> Transcription for Enhancement
          </h2>
        </div>
        <div className="card-body">
          {currentTranscript && (
            <button
              className="control-btn primary"
              onClick={handleUseRecordingTranscript}
              style={{ marginBottom: '1rem', width: '100%' }}
            >
              📝 Use Transcript from Recording
            </button>
          )}

          <textarea
            className="notes-editor"
            placeholder="Paste transcription text here, or use the recording transcript..."
            value={transcriptionText}
            onChange={(e) => setTranscriptionText(e.target.value)}
          />

          <div className="control-buttons" style={{ marginTop: '1rem' }}>
            <button
              className="control-btn primary"
              onClick={handleEnhanceNotes}
              disabled={isEnhancing || !existingNotes.trim() || !transcriptionText.trim()}
            >
              {isEnhancing ? '⏳ Enhancing...' : '✨ Enhance Notes'}
            </button>
          </div>
        </div>
      </div>

      {enhancedNotes && (
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header">
            <h2>
              <span>✨</span> Enhanced Notes
            </h2>
          </div>
          <div className="card-body">
            <div className="control-buttons" style={{ marginBottom: '1rem' }}>
              <button className="control-btn secondary" onClick={handleCopyToClipboard}>
                📋 Copy to Clipboard
              </button>
              <button className="control-btn secondary" onClick={handleDownload}>
                💾 Download as Markdown
              </button>
            </div>
            <div className="enhanced-notes">
              {enhancedNotes.split('\n').map((line, i) => {
                if (line.startsWith('# ')) {
                  return <h1 key={i}>{line.substring(2)}</h1>;
                } else if (line.startsWith('## ')) {
                  return <h2 key={i}>{line.substring(3)}</h2>;
                } else if (line.startsWith('### ')) {
                  return <h3 key={i}>{line.substring(4)}</h3>;
                } else if (line.startsWith('- [ ] ')) {
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <input type="checkbox" />
                      <span>{line.substring(6)}</span>
                    </div>
                  );
                } else if (line.startsWith('- ')) {
                  return <p key={i} style={{ marginLeft: '1rem', marginBottom: '0.25rem' }}>• {line.substring(2)}</p>;
                } else if (line.trim() === '') {
                  return <br key={i} />;
                } else {
                  return <p key={i}>{line}</p>;
                }
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default NotesEnhancer;
