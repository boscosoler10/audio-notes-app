import React, { useState, useRef, useCallback, useEffect } from 'react';

function AudioRecorder({
  onTranscriptUpdate,
  onRecordingStart,
  onRecordingStop,
  onConnectionChange,
  onError
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const durationIntervalRef = useRef(null);
  const animationFrameRef = useRef(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setIsConnecting(true);

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      streamRef.current = stream;

      // Set up audio analysis for visualizer
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      analyserRef.current.fftSize = 256;

      // Connect to WebSocket
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:3001/ws`;
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        console.log('WebSocket connected');
        setIsConnecting(false);
        setIsRecording(true);
        onConnectionChange(true);
        onRecordingStart();

        // Start duration timer
        setDuration(0);
        durationIntervalRef.current = setInterval(() => {
          setDuration(prev => prev + 1);
        }, 1000);

        // Start audio level monitoring
        monitorAudioLevel();

        // Start sending audio data
        startAudioCapture();
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case 'session_start':
              console.log('Transcription session started:', data.sessionId);
              break;
            case 'partial_transcript':
              onTranscriptUpdate(data.text, false);
              break;
            case 'final_transcript':
              onTranscriptUpdate(data.text, true);
              break;
            case 'session_end':
              console.log('Transcription session ended');
              break;
            case 'error':
              onError(data.message);
              break;
            default:
              console.log('Unknown message type:', data.type);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        onError('Connection error. Please check if the server is running.');
        setIsConnecting(false);
      };

      wsRef.current.onclose = () => {
        console.log('WebSocket closed');
        onConnectionChange(false);
        setIsRecording(false);
        setIsConnecting(false);
      };

    } catch (error) {
      console.error('Error starting recording:', error);
      setIsConnecting(false);
      if (error.name === 'NotAllowedError') {
        onError('Microphone access denied. Please allow microphone access and try again.');
      } else {
        onError('Failed to start recording: ' + error.message);
      }
    }
  }, [onTranscriptUpdate, onRecordingStart, onConnectionChange, onError]);

  const startAudioCapture = useCallback(() => {
    if (!streamRef.current || !audioContextRef.current) return;

    const scriptProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
    const source = audioContextRef.current.createMediaStreamSource(streamRef.current);
    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContextRef.current.destination);

    scriptProcessor.onaudioprocess = (event) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const inputData = event.inputBuffer.getChannelData(0);

        // Convert Float32Array to Int16Array (PCM)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        wsRef.current.send(pcmData.buffer);
      }
    };

    mediaRecorderRef.current = scriptProcessor;
  }, []);

  const monitorAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;

    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

    const updateLevel = () => {
      if (!analyserRef.current) return;

      analyserRef.current.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setAudioLevel(average / 255);

      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    updateLevel();
  }, []);

  const stopRecording = useCallback(() => {
    // Stop duration timer
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    mediaRecorderRef.current = null;

    setIsRecording(false);
    setAudioLevel(0);
    onRecordingStop();
  }, [onRecordingStop]);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="audio-controls">
      <button
        className={`record-button ${isRecording ? 'recording' : ''}`}
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isConnecting}
      >
        {isConnecting ? '⏳' : isRecording ? '⏹️' : '⏺️'}
      </button>

      <div className={`recording-status ${isRecording ? 'active' : ''}`}>
        <span className="status-dot"></span>
        {isConnecting ? 'Connecting...' : isRecording ? `Recording - ${formatDuration(duration)}` : 'Ready to record'}
      </div>

      <div className="audio-visualizer">
        {[...Array(10)].map((_, i) => (
          <div
            key={i}
            className={`visualizer-bar ${isRecording ? 'active' : ''}`}
            style={{
              height: isRecording ? `${20 + audioLevel * 40 + Math.random() * audioLevel * 20}px` : '20px',
              animationDelay: `${i * 0.1}s`
            }}
          />
        ))}
      </div>

      <div className="control-buttons">
        <button
          className="control-btn primary"
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isConnecting}
        >
          {isConnecting ? '⏳ Connecting...' : isRecording ? '⏹️ Stop Recording' : '🎙️ Start Recording'}
        </button>
      </div>

      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '0.5rem' }}>
        Click to start recording. Audio will be transcribed in real-time.
      </p>
    </div>
  );
}

export default AudioRecorder;
