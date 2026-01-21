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

  // Transcript management - store all completed turns
  const completedTurns = new Map(); // turn_order -> utterance text
  let currentPartialText = '';

  // Function to build full transcript from all completed turns
  const buildFullTranscript = () => {
    const sortedTurns = Array.from(completedTurns.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([_, text]) => text);
    return sortedTurns.join(' ').trim();
  };

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

        // Log for debugging
        if (data.type === 'Turn') {
          console.log(`Turn ${data.turn_order}: end_of_turn=${data.end_of_turn}, transcript length=${data.transcript?.length || 0}`);
        }

        switch (data.type) {
          case 'Begin':
            console.log('AssemblyAI session started:', data.id);
            sessionId = data.id;
            clientWs.send(JSON.stringify({
              type: 'session_start',
              sessionId: data.id
            }));
            break;

          case 'Turn':
            const turnOrder = data.turn_order ?? 0;

            if (data.end_of_turn) {
              // Turn completed - store the utterance or transcript
              const turnText = (data.utterance || data.transcript || '').trim();

              if (turnText && !completedTurns.has(turnOrder)) {
                completedTurns.set(turnOrder, turnText);
                currentPartialText = '';

                const fullTranscript = buildFullTranscript();

                console.log(`Completed turn ${turnOrder}: "${turnText.substring(0, 50)}..."`);
                console.log(`Full transcript now: ${fullTranscript.length} chars`);

                clientWs.send(JSON.stringify({
                  type: 'final_transcript',
                  text: turnText,
                  fullTranscript: fullTranscript
                }));
              }
            } else if (data.transcript) {
              // Partial transcript - show current progress
              currentPartialText = data.transcript;
              clientWs.send(JSON.stringify({
                type: 'partial_transcript',
                text: currentPartialText
              }));
            }
            break;

          case 'Termination':
            console.log('AssemblyAI session terminated');
            const finalTranscript = buildFullTranscript();
            console.log(`Final transcript: ${finalTranscript.length} chars, ${completedTurns.size} turns`);

            clientWs.send(JSON.stringify({
              type: 'session_end',
              fullTranscript: finalTranscript
            }));
            break;

          default:
            console.log('Unknown message type:', data.type, data);
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
          fullTranscript: buildFullTranscript()
        }));
      }
    });

    activeSessions.set(sessionId, { ws: assemblyWs });

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

    const summary = generateAdvancedSummary(text);
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

    const enhancedNotes = generateEnhancedNotes(existingNotes, transcription);
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

// ============================================
// ADVANCED SUMMARIZATION ALGORITHM
// ============================================

// Stop words for text processing
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
  'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which',
  'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
  'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by',
  'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
  'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just',
  'don', 'should', 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', 'couldn',
  'didn', 'doesn', 'hadn', 'hasn', 'haven', 'isn', 'ma', 'mightn', 'mustn', 'needn',
  'shan', 'shouldn', 'wasn', 'weren', 'won', 'wouldn', 'um', 'uh', 'like', 'know', 'yeah',
  'okay', 'ok', 'right', 'well', 'going', 'got', 'get', 'thing', 'things', 'way', 'would',
  'could', 'also', 'really', 'actually', 'basically', 'just', 'think', 'something', 'kind'
]);

// Tokenize text into words
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1);
}

// Get content words (excluding stop words)
function getContentWords(text) {
  return tokenize(text).filter(word => !STOP_WORDS.has(word) && word.length > 2);
}

// Split text into sentences (handles unpunctuated text)
function splitIntoSentences(text) {
  // First try standard sentence splitting
  let sentences = text
    .replace(/([.!?])\s+/g, '$1|||')
    .split('|||')
    .map(s => s.trim())
    .filter(s => s.length > 10);

  // If we got very few sentences, the text might be unpunctuated
  if (sentences.length < 3 && text.length > 100) {
    // Split by natural pauses: commas, 'and', 'but', 'so', 'because', etc.
    sentences = text
      .replace(/,\s+/g, '|||')
      .replace(/\s+(and|but|so|because|however|therefore|then|also)\s+/gi, '|||$1 ')
      .split('|||')
      .map(s => s.trim())
      .filter(s => s.length > 15);
  }

  // If still too few, split by word count
  if (sentences.length < 3 && text.length > 100) {
    const words = text.split(/\s+/);
    sentences = [];
    for (let i = 0; i < words.length; i += 15) {
      const chunk = words.slice(i, i + 15).join(' ');
      if (chunk.length > 15) {
        sentences.push(chunk);
      }
    }
  }

  return sentences;
}

// Calculate TF-IDF scores for words
function calculateTFIDF(sentences) {
  const wordDocFreq = new Map(); // How many sentences contain each word
  const sentenceWordFreq = []; // Word frequencies per sentence

  // Calculate document frequencies
  sentences.forEach((sentence, idx) => {
    const words = getContentWords(sentence);
    const wordSet = new Set(words);
    const wordFreq = new Map();

    words.forEach(word => {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    });

    wordSet.forEach(word => {
      wordDocFreq.set(word, (wordDocFreq.get(word) || 0) + 1);
    });

    sentenceWordFreq.push(wordFreq);
  });

  // Calculate TF-IDF for each sentence
  const numDocs = sentences.length;
  const sentenceScores = sentences.map((sentence, idx) => {
    const wordFreq = sentenceWordFreq[idx];
    let score = 0;
    const words = getContentWords(sentence);
    const maxFreq = Math.max(...wordFreq.values(), 1);

    words.forEach(word => {
      const tf = (wordFreq.get(word) || 0) / maxFreq;
      const idf = Math.log(numDocs / (wordDocFreq.get(word) || 1));
      score += tf * idf;
    });

    // Normalize by sentence length
    return score / Math.sqrt(words.length || 1);
  });

  return sentenceScores;
}

// Generate advanced summary using extractive summarization
function generateAdvancedSummary(text) {
  if (!text || text.trim().length === 0) {
    return { keyPoints: [], summary: '', actionItems: [], wordCount: 0, sentenceCount: 0 };
  }

  const cleanText = text.trim();
  const words = cleanText.split(/\s+/);
  const wordCount = words.length;

  // If text is very short, return as-is
  if (wordCount < 30) {
    return {
      keyPoints: [cleanText],
      summary: cleanText,
      actionItems: [],
      wordCount,
      sentenceCount: 1
    };
  }

  const sentences = splitIntoSentences(cleanText);
  const sentenceCount = sentences.length;

  // Calculate TF-IDF scores
  const tfidfScores = calculateTFIDF(sentences);

  // Calculate position scores (first and last sentences are often important)
  const positionScores = sentences.map((_, idx) => {
    if (idx === 0) return 1.5; // First sentence bonus
    if (idx === sentences.length - 1) return 1.2; // Last sentence bonus
    if (idx < sentences.length * 0.2) return 1.1; // Early sentences
    return 1.0;
  });

  // Look for sentences with important keywords
  const importantPatterns = [
    /\b(important|key|main|critical|essential|significant|crucial)\b/i,
    /\b(conclusion|summary|result|finding|決定|決めた)\b/i,
    /\b(must|need to|have to|should|required|necessary)\b/i,
    /\b(goal|objective|purpose|aim|target)\b/i,
    /\b(problem|issue|challenge|solution|resolve)\b/i,
    /\b(first|second|third|finally|lastly|in conclusion)\b/i
  ];

  const keywordScores = sentences.map(sentence => {
    let score = 1.0;
    importantPatterns.forEach(pattern => {
      if (pattern.test(sentence)) score += 0.3;
    });
    return score;
  });

  // Combine scores
  const combinedScores = sentences.map((sentence, idx) => ({
    sentence,
    index: idx,
    score: tfidfScores[idx] * positionScores[idx] * keywordScores[idx],
    isAction: /\b(need to|have to|must|should|will|going to|plan to|todo|task|action|deadline|by|until|before)\b/i.test(sentence)
  }));

  // Sort by score
  const rankedSentences = [...combinedScores].sort((a, b) => b.score - a.score);

  // Select top sentences for summary (aim for ~30% compression or max 5 sentences)
  const targetSentences = Math.min(Math.max(2, Math.ceil(sentenceCount * 0.3)), 5);
  const selectedIndices = new Set();
  const summaryParts = [];

  for (const item of rankedSentences) {
    if (summaryParts.length >= targetSentences) break;
    selectedIndices.add(item.index);
    summaryParts.push({ index: item.index, sentence: item.sentence });
  }

  // Sort selected sentences by original order for coherent reading
  summaryParts.sort((a, b) => a.index - b.index);
  const summary = summaryParts.map(p => p.sentence).join('. ').replace(/\.\./g, '.');

  // Extract key points (top scored sentences not in summary)
  const keyPoints = rankedSentences
    .filter(item => !selectedIndices.has(item.index))
    .slice(0, 5)
    .map(item => item.sentence);

  // Add summary sentences as key points if we don't have enough
  if (keyPoints.length < 3) {
    summaryParts.forEach(p => {
      if (keyPoints.length < 5 && !keyPoints.includes(p.sentence)) {
        keyPoints.push(p.sentence);
      }
    });
  }

  // Extract action items
  const actionItems = combinedScores
    .filter(item => item.isAction)
    .slice(0, 5)
    .map(item => item.sentence);

  return {
    keyPoints,
    summary: summary || cleanText.substring(0, 200) + '...',
    actionItems,
    wordCount,
    sentenceCount,
    compressionRatio: Math.round((summary.split(/\s+/).length / wordCount) * 100)
  };
}

// ============================================
// ENHANCED NOTES ALGORITHM
// ============================================

function generateEnhancedNotes(existingNotes, transcription) {
  // Parse existing notes into lines
  const noteLines = existingNotes
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  // Extract key topics from existing notes
  const noteTopics = new Map(); // topic -> count
  noteLines.forEach(line => {
    const words = getContentWords(line);
    words.forEach(word => {
      if (word.length > 3) {
        noteTopics.set(word, (noteTopics.get(word) || 0) + 1);
      }
    });
  });

  // Get top topics from notes
  const topTopics = new Set(
    Array.from(noteTopics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word)
  );

  // Process transcription
  const transcriptSentences = splitIntoSentences(transcription);
  const transcriptSummary = generateAdvancedSummary(transcription);

  // Find sentences that relate to note topics
  const relatedInfo = [];
  const newInfo = [];

  transcriptSentences.forEach(sentence => {
    const sentenceWords = new Set(getContentWords(sentence));
    const matchingTopics = [...sentenceWords].filter(word => topTopics.has(word));

    // Check similarity with existing notes
    const isDuplicate = noteLines.some(line => {
      const similarity = jaccardSimilarity(
        new Set(getContentWords(line)),
        sentenceWords
      );
      return similarity > 0.4;
    });

    if (!isDuplicate && sentence.length > 20) {
      if (matchingTopics.length >= 1) {
        relatedInfo.push({ sentence, matchCount: matchingTopics.length, topics: matchingTopics });
      } else {
        newInfo.push(sentence);
      }
    }
  });

  // Sort related info by relevance
  relatedInfo.sort((a, b) => b.matchCount - a.matchCount);

  // Build enhanced document
  let enhanced = '# Enhanced Notes\n\n';

  // Original notes
  enhanced += '## Original Notes\n';
  noteLines.forEach(line => {
    if (line.startsWith('-') || line.startsWith('*') || /^\d+\./.test(line)) {
      enhanced += line + '\n';
    } else {
      enhanced += '- ' + line + '\n';
    }
  });
  enhanced += '\n';

  // Expanded details from recording (related to your notes)
  if (relatedInfo.length > 0) {
    enhanced += '## Expanded Details from Recording\n';
    enhanced += '_Information from the recording that relates to your notes:_\n\n';
    relatedInfo.slice(0, 6).forEach(item => {
      enhanced += '- ' + item.sentence + '\n';
    });
    enhanced += '\n';
  }

  // New topics from recording
  if (newInfo.length > 0) {
    enhanced += '## New Information from Recording\n';
    enhanced += '_Additional topics discussed that weren\'t in your original notes:_\n\n';
    newInfo.slice(0, 5).forEach(sentence => {
      enhanced += '- ' + sentence + '\n';
    });
    enhanced += '\n';
  }

  // Key points
  if (transcriptSummary.keyPoints.length > 0) {
    enhanced += '## Key Points\n';
    transcriptSummary.keyPoints.slice(0, 5).forEach(point => {
      enhanced += '- ' + point + '\n';
    });
    enhanced += '\n';
  }

  // Action items
  if (transcriptSummary.actionItems.length > 0) {
    enhanced += '## Action Items\n';
    transcriptSummary.actionItems.forEach(item => {
      enhanced += '- [ ] ' + item + '\n';
    });
    enhanced += '\n';
  }

  // Summary
  enhanced += '## Recording Summary\n';
  enhanced += transcriptSummary.summary + '\n';

  return enhanced;
}

// Jaccard similarity between two sets
function jaccardSimilarity(set1, set2) {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
});
