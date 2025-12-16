import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync, readdirSync, renameSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'fs';

// Read API key from file if it exists (for development)
const getApiKey = () => {
  try {
    if (existsSync('openai.key')) {
      return readFileSync('openai.key', 'utf-8').trim();
    }
  } catch (e) {
    // Ignore errors
  }
  return '';
};

// Plugin to copy static files and fix paths after build
const copyStaticFiles = () => ({
  name: 'copy-static-files',
  closeBundle() {
    // Ensure dist directories exist
    if (!existsSync('dist/icons')) mkdirSync('dist/icons', { recursive: true });
    if (!existsSync('dist/content')) mkdirSync('dist/content', { recursive: true });
    if (!existsSync('dist/popup')) mkdirSync('dist/popup', { recursive: true });

    // Copy manifest
    copyFileSync('src/manifest.json', 'dist/manifest.json');

    // Copy icons if they exist
    if (existsSync('src/icons')) {
      readdirSync('src/icons').forEach((file) => {
        copyFileSync(`src/icons/${file}`, `dist/icons/${file}`);
      });
    }

    // Copy content styles
    if (existsSync('src/content/styles.css')) {
      copyFileSync('src/content/styles.css', 'dist/content/styles.css');
    }

    // Copy popup styles
    if (existsSync('src/popup/styles.css')) {
      copyFileSync('src/popup/styles.css', 'dist/popup/styles.css');
    }

    // Move popup HTML to correct location and fix paths
    if (existsSync('dist/src/popup/index.html')) {
      let html = readFileSync('dist/src/popup/index.html', 'utf-8');
      // Fix script and css paths (they could be in different formats)
      html = html.replace(/href="[^"]*popup\.css"/g, 'href="styles.css"');
      html = html.replace(/src="[^"]*popup\.js"/g, 'src="index.js"');
      html = html.replace(/href="\/popup\.css"/g, 'href="styles.css"');
      html = html.replace(/src="\/popup\.js"/g, 'src="index.js"');
      writeFileSync('dist/popup/index.html', html);
    }

    // Move popup.js to popup/index.js
    if (existsSync('dist/popup.js')) {
      copyFileSync('dist/popup.js', 'dist/popup/index.js');
    }

    // Clean up extra files
    try {
      if (existsSync('dist/popup.js')) unlinkSync('dist/popup.js');
      if (existsSync('dist/popup.css')) unlinkSync('dist/popup.css');
      if (existsSync('dist/src')) rmSync('dist/src', { recursive: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  },
});

export default defineConfig({
  define: {
    '__EMBEDDED_API_KEY__': JSON.stringify(getApiKey()),
  },
  plugins: [copyStaticFiles()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        popup: resolve(__dirname, 'src/popup/index.html'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background/index.js';
          if (chunkInfo.name === 'content') return 'content/index.js';
          return '[name].js';
        },
        chunkFileNames: 'shared/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) {
            return '[name][extname]';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
