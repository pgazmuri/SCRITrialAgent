# Installing SCRI Trial Agent

## Quick Install (For Users)

### Step 1: Download the Extension

1. Go to the [Releases page](https://github.com/pgazmuri/SCRITrialAgent/releases)
2. Download the latest `scri-trial-agent-vX.X.X.zip` file
3. Extract the ZIP to a folder (remember where you put it!)

### Step 2: Load in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** ON (switch in the top-right corner)
3. Click **Load unpacked**
4. Navigate to the folder where you extracted the ZIP
5. Click **Select Folder**

You should see "SCRI Trial Agent" appear in your extensions list!

### Step 3: Add Your OpenAI API Key

1. Click the puzzle piece icon (🧩) in Chrome's toolbar
2. Click **SCRI Trial Agent** to open the popup
3. Enter your OpenAI API key ([Get one here](https://platform.openai.com/api-keys))
4. Click **Save**

> **Note**: Your API key is stored locally and never sent anywhere except OpenAI.

### Step 4: Start Using

1. Navigate to [https://trials.scri.com](https://trials.scri.com)
2. You'll see two tabs at the top: **AI Assistant** and **Search**
3. Click **AI Assistant** and start chatting!

---

## Building from Source (For Developers)

If you want to build the extension yourself:

```bash
# Clone the repository
git clone https://github.com/pgazmuri/SCRITrialAgent.git
cd SCRITrialAgent

# Install dependencies
npm install

# Build the extension
npm run build
```

Then load the `dist` folder in Chrome as described above.

### Creating a Release ZIP

```bash
# On Windows (PowerShell)
.\scripts\package.ps1

# On Mac/Linux
./scripts/package.sh
```

This creates a versioned ZIP in the `releases` folder.

---

## Troubleshooting

### "This extension may have been corrupted"
Re-download and re-extract the ZIP file. Make sure to extract all files.

### Extension doesn't appear on trials.scri.com
Make sure the extension is enabled in `chrome://extensions`. Try refreshing the page.

### "Invalid API key" error
Double-check your OpenAI API key in the extension popup. Make sure it starts with `sk-`.

### Chat is slow or unresponsive
The AI takes a few seconds to search and respond. If it's stuck, try refreshing the page.

---

## Updating the Extension

The extension includes an `update_url` in its manifest that points to GitHub. However, for **unpacked extensions loaded in developer mode**, Chrome does not automatically check for updates.

**To update manually:**

1. Download the new version from [Releases](https://github.com/pgazmuri/SCRITrialAgent/releases)
2. Extract to the **same folder** (overwriting old files) or a new folder
3. Go to `chrome://extensions`
4. Click the **Reload** button (🔄) on the SCRI Trial Agent card

Your API key and settings will be preserved.
