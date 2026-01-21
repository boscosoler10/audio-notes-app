const express = require('express');
const cors = require('cors');
const { AssemblyAI } = require('assemblyai');
const WebSocket = require('ws');
const http = require('http');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// AssemblyAI client
const assemblyClient = new AssemblyAI({
  apiKey: '6c5fc93a9cb84beeb4f5c6ba2e49d68f'
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Store active transcription sessions
const activeSessions = new Map();

// WebSocket server for real-time transcription
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', async (ws) => {
  console.log('Client connected for real-time transcription');

  let realtimeTranscriber = null;
  let sessionId = Date.now().toString();
  let fullTranscript = '';

  try {
    // Create real-time transcriber
    realtimeTranscriber = assemblyClient.realtime.transcriber({
      sampleRate: 16000,
      encoding: 'pcm_s16le'
    });

    realtimeTranscriber.on('open', ({ sessionId: sid }) => {
      console.log('Real-time session opened:', sid);
      sessionId = sid;
      ws.send(JSON.stringify({ type: 'session_start', sessionId: sid }));
    });

    realtimeTranscriber.on('transcript', (transcript) => {
      if (transcript.text) {
        if (transcript.message_type === 'FinalTranscript') {
          fullTranscript += transcript.text + ' ';
          ws.send(JSON.stringify({
            type: 'final_transcript',
            text: transcript.text,
            fullTranscript: fullTranscript.trim()
          }));
        } else {
          ws.send(JSON.stringify({
            type: 'partial_transcript',
            text: transcript.text
          }));
        }
      }
    });

    realtimeTranscriber.on('error', (error) => {
      console.error('Transcription error:', error);
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    });

    realtimeTranscriber.on('close', (code, reason) => {
      console.log('Real-time session closed:', code, reason);
      ws.send(JSON.stringify({ type: 'session_end', fullTranscript: fullTranscript.trim() }));
    });

    await realtimeTranscriber.connect();

    activeSessions.set(sessionId, { transcriber: realtimeTranscriber, transcript: '' });

  } catch (error) {
    console.error('Failed to create real-time transcriber:', error);
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to initialize transcription service' }));
    ws.close();
    return;
  }

  ws.on('message', async (data) => {
    if (realtimeTranscriber) {
      try {
        // Convert to Buffer if needed and send to AssemblyAI
        const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        realtimeTranscriber.sendAudio(audioBuffer);
      } catch (error) {
        console.error('Error sending audio:', error);
      }
    }
  });

  ws.on('close', async () => {
    console.log('Client disconnected');
    if (realtimeTranscriber) {
      try {
        await realtimeTranscriber.close();
      } catch (error) {
        console.error('Error closing transcriber:', error);
      }
    }
    activeSessions.delete(sessionId);
  });
});

// REST API Endpoints

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Transcribe uploaded audio file
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('Transcribing file:', req.file.path);

    const transcript = await assemblyClient.transcripts.transcribe({
      audio: req.file.path
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    if (transcript.status === 'error') {
      return res.status(500).json({ error: transcript.error });
    }

    res.json({
      text: transcript.text,
      words: transcript.words,
      duration: transcript.audio_duration
    });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Failed to transcribe audio' });
  }
});

// Summarize text into notes
app.post('/api/summarize', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'No text provided for summarization' });
    }

    const summary = generateSummary(text);
    res.json({ summary });
  } catch (error) {
    console.error('Summarization error:', error);
    res.status(500).json({ error: 'Failed to summarize text' });
  }
});

// Enhance existing notes with transcription
app.post('/api/enhance-notes', async (req, res) => {
  try {
    const { existingNotes, transcription } = req.body;

    if (!existingNotes || !transcription) {
      return res.status(400).json({ error: 'Both existing notes and transcription are required' });
    }

    const enhancedNotes = enhanceNotes(existingNotes, transcription);
    res.json({ enhancedNotes });
  } catch (error) {
    console.error('Note enhancement error:', error);
    res.status(500).json({ error: 'Failed to enhance notes' });
  }
});

// Upload document with notes
app.post('/api/upload-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No document provided' });
    }

    const content = fs.readFileSync(req.file.path, 'utf-8');

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      content,
      filename: req.file.originalname
    });
  } catch (error) {
    console.error('Document upload error:', error);
    res.status(500).json({ error: 'Failed to process document' });
  }
});

// Use AssemblyAI's LeMUR for AI-powered summarization
app.post('/api/ai-summarize', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'No text provided for summarization' });
    }

    // First, we need to create a transcript to use LeMUR
    // For direct text summarization, we'll use the local algorithm
    // LeMUR requires a transcript_id from a completed transcription

    const summary = generateSummary(text);
    res.json({ summary });
  } catch (error) {
    console.error('AI Summarization error:', error);
    res.status(500).json({ error: 'Failed to generate AI summary' });
  }
});

// Summarization Algorithm
function generateSummary(text) {
  if (!text || text.trim().length === 0) {
    return { keyPoints: [], summary: '', actionItems: [] };
  }

  // Split text into sentences
  const sentences = text
    .replace(/([.!?])\s+/g, '$1|')
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 10);

  // Extract key points (sentences with important indicators)
  const importanceIndicators = [
    'important', 'key', 'main', 'critical', 'essential', 'must', 'should',
    'need', 'require', 'deadline', 'priority', 'focus', 'goal', 'objective',
    'remember', 'note', 'action', 'task', 'decision', 'conclusion'
  ];

  const keyPoints = [];
  const actionItems = [];
  const regularPoints = [];

  sentences.forEach(sentence => {
    const lowerSentence = sentence.toLowerCase();

    // Check for action items
    if (
      lowerSentence.includes('need to') ||
      lowerSentence.includes('have to') ||
      lowerSentence.includes('must') ||
      lowerSentence.includes('should') ||
      lowerSentence.includes('will') ||
      lowerSentence.includes('action') ||
      lowerSentence.includes('todo') ||
      lowerSentence.includes('task')
    ) {
      actionItems.push(sentence);
    }

    // Check for key points
    const hasImportance = importanceIndicators.some(indicator =>
      lowerSentence.includes(indicator)
    );

    if (hasImportance) {
      keyPoints.push(sentence);
    } else {
      regularPoints.push(sentence);
    }
  });

  // Create a condensed summary
  const summaryPoints = [...keyPoints.slice(0, 5)];

  // Add some regular points if we don't have enough key points
  if (summaryPoints.length < 5) {
    const remaining = 5 - summaryPoints.length;
    // Pick sentences spread throughout the text
    const step = Math.max(1, Math.floor(regularPoints.length / remaining));
    for (let i = 0; i < regularPoints.length && summaryPoints.length < 5; i += step) {
      summaryPoints.push(regularPoints[i]);
    }
  }

  // Generate summary paragraph
  const summaryParagraph = summaryPoints.length > 0
    ? summaryPoints.join(' ')
    : text.substring(0, 500) + (text.length > 500 ? '...' : '');

  return {
    keyPoints: keyPoints.slice(0, 10),
    summary: summaryParagraph,
    actionItems: actionItems.slice(0, 10),
    wordCount: text.split(/\s+/).length,
    sentenceCount: sentences.length
  };
}

// Note Enhancement Algorithm
function enhanceNotes(existingNotes, transcription) {
  const existingLines = existingNotes
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const transcriptionSummary = generateSummary(transcription);

  // Find topics mentioned in existing notes
  const existingTopics = new Set();
  existingLines.forEach(line => {
    const words = line.toLowerCase().split(/\s+/);
    words.forEach(word => {
      if (word.length > 4) {
        existingTopics.add(word);
      }
    });
  });

  // Find new information from transcription that relates to existing topics
  const newInformation = [];
  const transcriptionSentences = transcription
    .replace(/([.!?])\s+/g, '$1|')
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 10);

  transcriptionSentences.forEach(sentence => {
    const sentenceWords = sentence.toLowerCase().split(/\s+/);
    const hasRelatedTopic = sentenceWords.some(word => existingTopics.has(word));

    if (hasRelatedTopic) {
      // Check if this information is not already in notes
      const isDuplicate = existingLines.some(line => {
        const similarity = calculateSimilarity(line.toLowerCase(), sentence.toLowerCase());
        return similarity > 0.6;
      });

      if (!isDuplicate) {
        newInformation.push(sentence);
      }
    }
  });

  // Build enhanced notes
  let enhancedNotes = '# Enhanced Notes\n\n';
  enhancedNotes += '## Original Notes\n';
  enhancedNotes += existingLines.map(line => `- ${line}`).join('\n');
  enhancedNotes += '\n\n';

  if (newInformation.length > 0) {
    enhancedNotes += '## Additional Information from Recording\n';
    enhancedNotes += newInformation.slice(0, 10).map(info => `- ${info}`).join('\n');
    enhancedNotes += '\n\n';
  }

  if (transcriptionSummary.keyPoints.length > 0) {
    enhancedNotes += '## Key Points\n';
    enhancedNotes += transcriptionSummary.keyPoints.map(point => `- ${point}`).join('\n');
    enhancedNotes += '\n\n';
  }

  if (transcriptionSummary.actionItems.length > 0) {
    enhancedNotes += '## Action Items\n';
    enhancedNotes += transcriptionSummary.actionItems.map(item => `- [ ] ${item}`).join('\n');
    enhancedNotes += '\n\n';
  }

  enhancedNotes += '## Summary\n';
  enhancedNotes += transcriptionSummary.summary;

  return enhancedNotes;
}

// Simple text similarity calculation (Jaccard similarity)
function calculateSimilarity(text1, text2) {
  const words1 = new Set(text1.split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.split(/\s+/).filter(w => w.length > 2));

  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  return intersection.size / union.size;
}

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});
