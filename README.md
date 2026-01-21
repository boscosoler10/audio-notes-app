# Audio Notes - Live Transcription & Note Summarization

A web application that provides real-time audio transcription using AssemblyAI API, automatic note summarization, and document enhancement capabilities.

## Features

- **Live Audio Transcription**: Record audio directly from your browser and see real-time transcription
- **Note Summarization**: Automatically extract key points, action items, and generate summaries
- **Document Enhancement**: Upload existing notes and enhance them with audio transcription content
- **Audio Visualization**: Real-time audio level visualization during recording
- **Export Options**: Copy enhanced notes to clipboard or download as Markdown

## Tech Stack

- **Frontend**: React 18 with Vite
- **Backend**: Node.js with Express
- **Real-time Communication**: WebSocket (ws)
- **Transcription**: AssemblyAI Real-time API
- **Styling**: Custom CSS with modern design

## Prerequisites

- Node.js 18+
- npm or yarn
- AssemblyAI API key
- Modern web browser with microphone support

## Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd audio-notes-app
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

### 3. Install Frontend Dependencies

```bash
cd ../frontend
npm install
```

### 4. Configure Environment

The API key is already configured in the server. If you want to use your own key:

1. Create a `.env` file in the `backend` directory:
```bash
cp .env.example .env
```

2. Update the `.env` file with your AssemblyAI API key:
```
ASSEMBLYAI_API_KEY=your_api_key_here
```

3. Modify `backend/server.js` to use the environment variable:
```javascript
const assemblyClient = new AssemblyAI({
  apiKey: process.env.ASSEMBLYAI_API_KEY
});
```

## Running the Application

### Development Mode

You need to run both the backend and frontend servers:

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```
The backend server will start on `http://localhost:3001`

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```
The frontend will start on `http://localhost:3000`

### Production Mode

**Build the frontend:**
```bash
cd frontend
npm run build
```

**Start the backend:**
```bash
cd backend
npm start
```

## Usage

### Live Recording Tab

1. Click the **Start Recording** button
2. Allow microphone access when prompted
3. Speak clearly - transcription appears in real-time
4. Click **Stop Recording** when finished
5. Click **Generate Summary** to analyze the transcript

### Enhance Notes Tab

1. **Upload existing notes**:
   - Drag and drop a `.txt`, `.md`, or `.json` file
   - Or click to browse and select a file
   - Or type/paste notes directly

2. **Add transcription**:
   - Use transcript from a recording session
   - Or paste transcription text manually

3. Click **Enhance Notes** to generate enhanced documentation

4. **Export options**:
   - Copy to clipboard
   - Download as Markdown file

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check endpoint |
| `/api/transcribe` | POST | Transcribe uploaded audio file |
| `/api/summarize` | POST | Summarize text into notes |
| `/api/enhance-notes` | POST | Enhance existing notes with transcription |
| `/api/upload-document` | POST | Upload document with notes |
| `/ws` | WebSocket | Real-time audio transcription |

### API Usage Examples

**Summarize Text:**
```bash
curl -X POST http://localhost:3001/api/summarize \
  -H "Content-Type: application/json" \
  -d '{"text": "Your text to summarize here..."}'
```

**Enhance Notes:**
```bash
curl -X POST http://localhost:3001/api/enhance-notes \
  -H "Content-Type: application/json" \
  -d '{
    "existingNotes": "Your existing notes...",
    "transcription": "The transcribed audio content..."
  }'
```

## Project Structure

```
audio-notes-app/
├── backend/
│   ├── server.js          # Express server with AssemblyAI integration
│   ├── package.json       # Backend dependencies
│   ├── .env.example       # Environment variables template
│   └── uploads/           # Temporary file uploads (auto-created)
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                    # Main application component
│   │   ├── main.jsx                   # React entry point
│   │   ├── index.css                  # Global styles
│   │   └── components/
│   │       ├── AudioRecorder.jsx      # Audio recording & WebSocket
│   │       ├── TranscriptDisplay.jsx  # Live transcript display
│   │       ├── NotesEnhancer.jsx      # Document upload & enhancement
│   │       └── Notification.jsx       # Toast notifications
│   ├── index.html         # HTML template
│   ├── vite.config.js     # Vite configuration
│   └── package.json       # Frontend dependencies
│
└── README.md              # This file
```

## Summarization Algorithm

The summarization engine:

1. **Splits text into sentences** for analysis
2. **Identifies key points** using importance indicators (important, key, critical, must, etc.)
3. **Extracts action items** by detecting action phrases (need to, have to, should, etc.)
4. **Generates summary** combining key points with representative sentences
5. **Calculates statistics** (word count, sentence count, key points count)

## Note Enhancement Algorithm

The enhancement process:

1. **Analyzes existing notes** to identify key topics
2. **Processes transcription** to find related new information
3. **Filters duplicates** using text similarity (Jaccard similarity)
4. **Generates structured output** with:
   - Original notes
   - Additional information from recording
   - Key points
   - Action items
   - Summary

## Browser Compatibility

- Chrome 74+
- Firefox 66+
- Safari 14.1+
- Edge 79+

## Troubleshooting

### Microphone Access Denied
- Ensure your browser has permission to access the microphone
- Check browser settings for microphone permissions
- Try using HTTPS in production (required for some browsers)

### WebSocket Connection Failed
- Verify the backend server is running on port 3001
- Check for firewall or proxy restrictions
- Ensure the frontend is configured to connect to the correct port

### No Transcription Appearing
- Check browser console for errors
- Verify AssemblyAI API key is valid
- Ensure stable internet connection for real-time API

## License

MIT

## Acknowledgments

- [AssemblyAI](https://www.assemblyai.com/) for the transcription API
- [React](https://reactjs.org/) for the frontend framework
- [Vite](https://vitejs.dev/) for the build tool
