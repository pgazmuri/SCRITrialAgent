# SCRI Clinical Trial Agent

An AI-powered browser extension that helps patients find relevant clinical trials on the Sarah Cannon Research Institute (SCRI) clinical trials portal.

## 🎯 Features

- **Conversational Interface**: Chat with an AI assistant to find trials by describing your situation
- **Smart Search**: Searches across 700+ active clinical trials
- **Location-Aware**: Filters trials by your location and travel preferences
- **Patient Profile**: Save your cancer type, location, and preferences for personalized recommendations
- **Seamless Integration**: Works directly on the SCRI trials website

## 📦 Installation

### Option 1: Download Release (Recommended)

1. Download the latest `scri-trial-agent-v*.zip` from [Releases](https://github.com/pgazmuri/SCRITrialAgent/releases) or the repo root
2. **Extract the ZIP** to a folder (e.g., `scri-trial-agent`)
3. Open Chrome and navigate to `chrome://extensions`
4. Enable **Developer mode** (toggle in top right)
5. Click **Load unpacked**
6. Select the **extracted folder** (not the ZIP file)

### Option 2: Build from Source

**Prerequisites:** Node.js 18+ and npm

```bash
# Clone the repository
git clone https://github.com/pgazmuri/SCRITrialAgent.git
cd SCRITrialAgent

# Install dependencies
npm install

# Build the extension
npm run build
```

Then load in Chrome:
1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `dist` folder from this project

### Configure API Key

On first use, the extension will prompt you to enter your OpenAI API key directly in the chat interface. You can get an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).

## 🚀 Usage

### Basic Usage

1. Navigate to [https://trials.scri.com](https://trials.scri.com)
2. Look for the chat widget in the bottom-right corner
3. Click to open the AI assistant
4. Start asking questions about clinical trials!

### Example Conversations

**Finding trials by cancer type:**
> "What lung cancer trials are available?"

**Location-based search:**
> "I'm in Nashville, TN. What breast cancer trials are near me?"

**Specific trial lookup:**
> "Tell me more about trial NCT05748834"

**Understanding eligibility:**
> "Are there any Phase 2 trials for HER2+ breast cancer?"

### Setting Up Patient Profile

1. Click the extension icon
2. Fill in your details:
   - Cancer type
   - ZIP code
   - Travel radius
   - Age and stage (optional)
   - Previous treatments (optional)
3. Click **Save Profile**

The assistant will use this information to provide more relevant recommendations.

## 🏗️ Architecture

This extension uses a sophisticated architecture:

```
┌─────────────────────────────────────────────────────┐
│                 Browser Extension                    │
├──────────────┬──────────────┬──────────────────────┤
│   Popup      │   Content    │   Background         │
│  (Settings)  │   Script     │   Worker             │
│              │  (Chat UI)   │  (OpenAI + State)    │
└──────────────┴──────────────┴──────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │     OpenAI Responses API     │
        │   (Function Calling Agent)   │
        └──────────────────────────────┘
```

For detailed technical documentation, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## 🛠️ Development

### Project Structure

```
src/
├── background/       # Service worker (OpenAI API, storage)
├── content/          # Injected chat widget
├── popup/            # Extension popup UI
├── services/         # Core business logic
│   ├── agent.ts      # AI agent with function calling
│   └── scri-api.ts   # SCRI API client
├── types/            # TypeScript definitions
└── manifest.json     # Extension manifest
```

### Scripts

```bash
# Development build with watch mode
npm run build:watch

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck
```

### Testing

We use Vitest for unit testing. Tests follow TDD principles:

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/scri-api.test.ts

# Watch mode
npm test -- --watch
```

## 🔒 Security & Privacy

- **API Key Security**: Your OpenAI API key is stored locally in Chrome's secure extension storage
- **No Data Collection**: Patient profiles are stored locally only
- **No External Tracking**: The extension doesn't send data to any third parties (except OpenAI for chat)
- **Open Source**: All code is auditable

## 📋 API Reference

### SCRI API Endpoints (Discovered)

| Endpoint | Description |
|----------|-------------|
| `/api/v1/uifilters/default` | Get cancer type filters |
| `/api/v1/trials/search/{filterId}/{type}/{page}` | Search trials |
| `/api/v1/trials/{studyId}` | Get trial details |

### Agent Tools

The AI agent has access to these tools:

- `search_trials` - Search by cancer type and location
- `get_trial_details` - Get detailed trial information
- `get_available_cancer_types` - List searchable cancer types
- `lookup_nct_trial` - Find trial by NCT number

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

## ⚠️ Disclaimer

This tool is for informational purposes only. Always consult with your healthcare provider before making decisions about clinical trial participation. The AI assistant provides information but does not provide medical advice.

## 🙏 Acknowledgments

- [Sarah Cannon Research Institute](https://www.scri.com/) for their clinical trial portal
- [OpenAI](https://openai.com/) for the Responses API
- All the patients and caregivers who inspired this project
