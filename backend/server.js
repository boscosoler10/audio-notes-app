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

// AssemblyAI configuration
const ASSEMBLYAI_API_KEY = '6c5fc93a9cb84beeb4f5c6ba2e49d68f';

// AssemblyAI client (for file transcription)
const assemblyClient = new AssemblyAI({
  apiKey: ASSEMBLYAI_API_KEY
});

// Universal Streaming v3 API endpoint
const ASSEMBLYAI_STREAMING_URL = 'wss://streaming.assemblyai.com/v3/ws';

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

wss.on('connection', async (clientWs) => {
  console.log('Client connected for real-time transcription');

  let assemblyWs = null;
  let sessionId = Date.now().toString();
  let fullTranscript = '';           // Accumulated transcript across all turns
  let currentTurnText = '';          // Current turn's partial text
  let lastCompletedTurn = -1;        // Track which turns we've already processed

  try {
    // Connect to AssemblyAI Universal Streaming v3 API
    const streamingUrl = `${ASSEMBLYAI_STREAMING_URL}?sample_rate=16000&format_turns=true`;

    assemblyWs = new WebSocket(streamingUrl, {
      headers: {
        'Authorization': ASSEMBLYAI_API_KEY
      }
    });

    assemblyWs.on('open', () => {
      console.log('Connected to AssemblyAI Universal Streaming v3');
    });

    assemblyWs.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'Begin':
            // Session started
            console.log('AssemblyAI session started:', data.id);
            sessionId = data.id;
            clientWs.send(JSON.stringify({
              type: 'session_start',
              sessionId: data.id
            }));
            break;

          case 'Turn':
            // Handle turn messages (transcription updates)
            const turnOrder = data.turn_order || 0;

            if (data.end_of_turn && turnOrder > lastCompletedTurn) {
              // End of turn - append this turn's utterance to full transcript
              lastCompletedTurn = turnOrder;
              const turnText = data.utterance || data.transcript || '';

              if (turnText.trim()) {
                // Append to full transcript with proper spacing
                if (fullTranscript) {
                  fullTranscript += ' ' + turnText.trim();
                } else {
                  fullTranscript = turnText.trim();
                }

                currentTurnText = '';

                clientWs.send(JSON.stringify({
                  type: 'final_transcript',
                  text: turnText.trim(),
                  fullTranscript: fullTranscript
                }));
              }
            } else if (!data.end_of_turn && data.transcript) {
              // Partial transcript (still being spoken in current turn)
              currentTurnText = data.transcript;
              clientWs.send(JSON.stringify({
                type: 'partial_transcript',
                text: currentTurnText
              }));
            }
            break;

          case 'Termination':
            // Session ended
            console.log('AssemblyAI session terminated');
            clientWs.send(JSON.stringify({
              type: 'session_end',
              fullTranscript: fullTranscript.trim()
            }));
            break;

          default:
            console.log('Unknown message type from AssemblyAI:', data.type);
        }
      } catch (error) {
        console.error('Error parsing AssemblyAI message:', error);
      }
    });

    assemblyWs.on('error', (error) => {
      console.error('AssemblyAI WebSocket error:', error);
      clientWs.send(JSON.stringify({
        type: 'error',
        message: 'Transcription service error: ' + error.message
      }));
    });

    assemblyWs.on('close', (code, reason) => {
      console.log('AssemblyAI WebSocket closed:', code, reason.toString());
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'session_end',
          fullTranscript: fullTranscript.trim()
        }));
      }
    });

    activeSessions.set(sessionId, { ws: assemblyWs, transcript: '' });

  } catch (error) {
    console.error('Failed to connect to AssemblyAI:', error);
    clientWs.send(JSON.stringify({
      type: 'error',
      message: 'Failed to initialize transcription service'
    }));
    clientWs.close();
    return;
  }

  // Handle audio data from client
  clientWs.on('message', (data) => {
    if (assemblyWs && assemblyWs.readyState === WebSocket.OPEN) {
      try {
        // Send binary audio data directly to AssemblyAI
        const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
        assemblyWs.send(audioBuffer);
      } catch (error) {
        console.error('Error sending audio to AssemblyAI:', error);
      }
    }
  });

  // Handle client disconnect
  clientWs.on('close', () => {
    console.log('Client disconnected');
    if (assemblyWs && assemblyWs.readyState === WebSocket.OPEN) {
      try {
        // Send termination message to AssemblyAI
        assemblyWs.send(JSON.stringify({ type: 'Terminate' }));
        assemblyWs.close();
      } catch (error) {
        console.error('Error closing AssemblyAI connection:', error);
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

// Summarization Algorithm - improved for live transcription
function generateSummary(text) {
  if (!text || text.trim().length === 0) {
    return { keyPoints: [], summary: '', actionItems: [] };
  }

  // Clean and normalize text
  const cleanText = text.trim();
  const words = cleanText.split(/\s+/);
  const wordCount = words.length;

  // Split into segments (handle both punctuated and unpunctuated text)
  let segments = [];

  // First try splitting by punctuation
  const punctuatedSegments = cleanText
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 15);

  if (punctuatedSegments.length >= 3) {
    segments = punctuatedSegments;
  } else {
    // For unpunctuated text, split by word chunks or natural pauses
    // Split into chunks of roughly 15-25 words
    const chunkSize = 20;
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, Math.min(i + chunkSize, words.length)).join(' ');
      if (chunk.length > 15) {
        segments.push(chunk);
      }
    }
  }

  // Keywords for categorization
  const actionKeywords = ['need', 'must', 'should', 'have to', 'going to', 'will', 'plan', 'todo', 'task', 'action', 'deadline', 'complete', 'finish', 'start', 'begin', 'make sure', 'don\'t forget', 'remember to'];
  const importantKeywords = ['important', 'key', 'main', 'critical', 'essential', 'priority', 'focus', 'goal', 'objective', 'significant', 'crucial', 'note that', 'keep in mind', 'basically', 'essentially', 'the point is', 'in summary', 'to summarize', 'conclusion', 'decided', 'agreed'];

  const keyPoints = [];
  const actionItems = [];
  const topicSentences = [];

  segments.forEach((segment, index) => {
    const lowerSegment = segment.toLowerCase();

    // Check for action items
    const isAction = actionKeywords.some(kw => lowerSegment.includes(kw));
    if (isAction) {
      actionItems.push(segment);
    }

    // Check for important points
    const isImportant = importantKeywords.some(kw => lowerSegment.includes(kw));
    if (isImportant) {
      keyPoints.push(segment);
    }

    // First segment often introduces the topic
    if (index === 0 && segment.length > 20) {
      topicSentences.push(segment);
    }
  });

  // If no key points found, extract the most informative segments
  if (keyPoints.length === 0 && segments.length > 0) {
    // Take first, middle, and last segments as representative
    keyPoints.push(segments[0]);
    if (segments.length > 2) {
      keyPoints.push(segments[Math.floor(segments.length / 2)]);
    }
    if (segments.length > 1) {
      keyPoints.push(segments[segments.length - 1]);
    }
  }

  // Generate a condensed summary
  let summary = '';
  const targetSummaryLength = Math.min(150, Math.floor(wordCount * 0.3)); // ~30% of original or 150 words max

  // Build summary from key points and topic sentences
  const summarySource = [...new Set([...topicSentences, ...keyPoints.slice(0, 3)])];

  if (summarySource.length > 0) {
    let summaryWords = [];
    for (const segment of summarySource) {
      const segmentWords = segment.split(/\s+/);
      if (summaryWords.length + segmentWords.length <= targetSummaryLength) {
        summaryWords = summaryWords.concat(segmentWords);
      } else {
        // Add partial segment to reach target
        const remaining = targetSummaryLength - summaryWords.length;
        if (remaining > 5) {
          summaryWords = summaryWords.concat(segmentWords.slice(0, remaining));
        }
        break;
      }
    }
    summary = summaryWords.join(' ');
    if (summary.length > 0 && !summary.match(/[.!?]$/)) {
      summary += '.';
    }
  } else {
    // Fallback: take first portion of text
    summary = words.slice(0, Math.min(targetSummaryLength, words.length)).join(' ');
    if (!summary.match(/[.!?]$/)) {
      summary += '...';
    }
  }

  // Deduplicate and limit results
  const uniqueKeyPoints = [...new Set(keyPoints)].slice(0, 5);
  const uniqueActionItems = [...new Set(actionItems)].slice(0, 5);

  return {
    keyPoints: uniqueKeyPoints,
    summary: summary,
    actionItems: uniqueActionItems,
    wordCount: wordCount,
    sentenceCount: segments.length,
    compressionRatio: summary.split(/\s+/).length / wordCount
  };
}

// Note Enhancement Algorithm - improved for better results
function enhanceNotes(existingNotes, transcription) {
  // Parse existing notes
  const existingLines = existingNotes
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // Generate summary of transcription
  const transcriptionSummary = generateSummary(transcription);

  // Extract key topics/words from existing notes (excluding common words)
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'its', 'your', 'their', 'our', 'his', 'her']);

  const existingTopics = new Set();
  existingLines.forEach(line => {
    const words = line.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    words.forEach(word => {
      if (word.length > 3 && !stopWords.has(word)) {
        existingTopics.add(word);
      }
    });
  });

  // Split transcription into segments
  let transcriptionSegments = [];
  const cleanTranscription = transcription.trim();

  // Try punctuation-based splitting first
  const punctuatedSegments = cleanTranscription
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  if (punctuatedSegments.length >= 2) {
    transcriptionSegments = punctuatedSegments;
  } else {
    // Split by word chunks for unpunctuated text
    const words = cleanTranscription.split(/\s+/);
    const chunkSize = 25;
    for (let i = 0; i < words.length; i += chunkSize) {
      const chunk = words.slice(i, Math.min(i + chunkSize, words.length)).join(' ');
      if (chunk.length > 10) {
        transcriptionSegments.push(chunk);
      }
    }
  }

  // Find new information related to existing topics
  const newInformation = [];
  const usedSegments = new Set();

  transcriptionSegments.forEach(segment => {
    const segmentWords = segment.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
    const matchingTopics = segmentWords.filter(word => existingTopics.has(word));

    // If segment relates to existing topics
    if (matchingTopics.length >= 1) {
      // Check if this is substantially different from existing notes
      const isDuplicate = existingLines.some(line => {
        const similarity = calculateSimilarity(line.toLowerCase(), segment.toLowerCase());
        return similarity > 0.5;
      });

      if (!isDuplicate && !usedSegments.has(segment)) {
        newInformation.push(segment);
        usedSegments.add(segment);
      }
    }
  });

  // Also include segments that might be new topics not in original notes
  const additionalInfo = [];
  transcriptionSegments.forEach(segment => {
    if (!usedSegments.has(segment)) {
      const isDuplicate = existingLines.some(line => {
        const similarity = calculateSimilarity(line.toLowerCase(), segment.toLowerCase());
        return similarity > 0.4;
      });
      if (!isDuplicate) {
        additionalInfo.push(segment);
        usedSegments.add(segment);
      }
    }
  });

  // Build enhanced notes document
  let enhancedNotes = '# Enhanced Notes\n\n';

  // Original notes section
  enhancedNotes += '## Original Notes\n';
  existingLines.forEach(line => {
    // Preserve original formatting if it looks like a list item
    if (line.startsWith('-') || line.startsWith('*') || line.match(/^\d+\./)) {
      enhancedNotes += line + '\n';
    } else {
      enhancedNotes += '- ' + line + '\n';
    }
  });
  enhancedNotes += '\n';

  // Related information from recording
  if (newInformation.length > 0) {
    enhancedNotes += '## Related Details from Recording\n';
    newInformation.slice(0, 8).forEach(info => {
      enhancedNotes += '- ' + info + '\n';
    });
    enhancedNotes += '\n';
  }

  // Additional new information
  if (additionalInfo.length > 0) {
    enhancedNotes += '## Additional Information\n';
    additionalInfo.slice(0, 5).forEach(info => {
      enhancedNotes += '- ' + info + '\n';
    });
    enhancedNotes += '\n';
  }

  // Key points from transcription
  if (transcriptionSummary.keyPoints.length > 0) {
    enhancedNotes += '## Key Points\n';
    transcriptionSummary.keyPoints.forEach(point => {
      enhancedNotes += '- ' + point + '\n';
    });
    enhancedNotes += '\n';
  }

  // Action items
  if (transcriptionSummary.actionItems.length > 0) {
    enhancedNotes += '## Action Items\n';
    transcriptionSummary.actionItems.forEach(item => {
      enhancedNotes += '- [ ] ' + item + '\n';
    });
    enhancedNotes += '\n';
  }

  // Summary
  enhancedNotes += '## Summary\n';
  enhancedNotes += transcriptionSummary.summary + '\n';

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
