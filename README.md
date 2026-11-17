# Kokoro Reader

Read Google Docs aloud with a natural local AI voice, with word by word highlighting drawn directly on the document. A free, open source, private alternative to Speechify.

Everything runs on your own computer. Your documents never leave your machine and there is no subscription.

## What you get

- Natural voices from [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), running locally
- Word by word highlight on the Google Doc itself, plus a softer highlight on the sentence being read
- Six highlight themes: blue, pink, red, orange, green and purple, with a separate sentence color
- Voice dropdown with every installed voice, a Preview button, and a custom blend option
- Speed from 0.8x to 3x, previous and next sentence, a seek bar, and auto scroll that follows the reader
- Alt+click any word in the document to start reading from there
- Works on long documents with multiple pages, and at any Google Docs zoom level
- Plays in the background while you work in other tabs, with media key support

## Install

You need two parts: the voice server (one command) and the Chrome extension.

### 1. Voice server (macOS or Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/hareesh-r/kokoro-reader/main/install.sh | bash
```

Or clone the repo and double click `Install Kokoro Reader.command` on macOS, or run `./install.sh`.

The installer sets up Python with uv, downloads the Kokoro server and the voice model (about 330 MB), and starts the server at login so it is always ready. The first run takes a few minutes.

Manage it any time with the `kokoro-reader` command:

```
kokoro-reader status        is it running
kokoro-reader start | stop | restart
kokoro-reader logs          follow the server log
kokoro-reader autostart on|off
kokoro-reader uninstall     remove everything it installed
```

If the command is not found, add `~/.local/bin` to your PATH.

Windows is not supported by the installer. Use WSL, or run the Kokoro server with Docker (`docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu`) and point the extension at it in Settings.

### 2. Chrome extension

1. Download `kokoro-reader-extension-x.y.z.zip` from the Releases page and unzip it, or use the `extension` folder from this repo.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click Load unpacked and choose the extension folder.
4. Open a Google Doc and press Alt+Shift+L, or click the extension icon.

## Use

| Action | How |
| --- | --- |
| Open or close the panel | Alt+Shift+L |
| Play or pause | Alt+Shift+P, or Space inside the panel |
| Previous or next sentence | Left and Right arrows, or the panel buttons |
| Start from a word | Alt+click the word on the document |
| Change voice | Voice dropdown, then Preview to hear it |
| Change colors | Gear icon, Highlight and Sentence rows |

Shortcuts can be changed at `chrome://extensions/shortcuts`.

### Voices

The dropdown lists every voice your server has, grouped by accent and gender. The default is a blend of `af_heart` and `af_sarah`. To make your own blend choose Custom blend and join voices with a plus sign, for example `af_bella+af_nicole`. You can also weight them, for example `af_heart(2)+af_sarah(1)`.

### Light and dark mode

The highlight always matches the page on screen: a light Doc gets the normal colored highlight, a dark Doc gets a glowing one that keeps light text readable. The sun or moon button in the panel header only switches the panel itself. It starts out matching your Doc, and your choice is remembered.

### Small button

Press the shrink button in the header to turn the panel into a tiny pill with play and pause plus an expand button. Drag the pill, or drag the panel by its header, to put it anywhere on screen. The position is remembered.

### Themes

Pick a Highlight color for the current word and its matching sentence tint. In the Sentence row you can choose a different color, match the highlight, or turn the sentence highlight off.

## How it works

Google Docs draws its pages on canvas, so there is no text in the page to highlight. Kokoro Reader works in three steps:

1. It gets the document text through the official export endpoint, using your signed in session.
2. It sends the text to your local Kokoro server, which returns audio and a timestamp for every word.
3. It looks at the pixels of each rendered page, finds the lines and words, and matches them to the text using the Arial letter widths. The highlight is then drawn as a transparent layer on top of the page, aligned to those word boxes.

The layer follows scrolling and zoom changes. If the page match fails, the panel falls back to showing the text with highlighting inside the panel.

## Settings

Open the gear icon in the panel.

- Server: where the Kokoro server lives, default `http://localhost:8880`
- Auto-scroll, Start when opened, Highlight on the Google Doc, Show text in panel
- Reload document text, Check server, Check page match, and Copy debug report (copies a log of recent highlight events to your clipboard)

## Troubleshooting

- Panel says it cannot reach the server: run `kokoro-reader status`, then `kokoro-reader start`. Check `kokoro-reader logs` for errors.
- No highlight on the page but audio plays: press Check page match and open an issue with the line it prints, your Docs zoom level and whether your screen is retina.
- Highlight stopped after changing the Docs zoom: wait a second, the page is re-read automatically. If it does not recover, press Reload document text.
- Browser blocks audio: press the play button once. Chrome requires a click before it allows sound.
- Port 8880 is taken: set `KOKORO_PORT=9000` before installing, then change the Server in Settings.

## Reporting a problem

1. Reproduce it (for example change zoom or color while reading).
2. Open the gear in the panel and press Copy debug report.
3. Paste it into a GitHub issue, with your Docs zoom level and whether your screen is retina.

The report holds timings, match scores and counts of missed words. It has no document text and the doc id is truncated. Nothing is sent anywhere automatically.

## Limits

- Chrome only for now (Chromium browsers should work but are untested)
- Google Docs only
- Kokoro covers English best. It also has voices for Spanish, French, Hindi, Italian, Japanese, Portuguese and Chinese, but not Tamil
- Tables, images and text inside drawings are skipped or matched loosely
- Highlight placement is a visual match, so unusual fonts or heavy formatting can reduce accuracy

## Repository layout

```
extension/   Chrome extension (Manifest V3): overlay.js draws the highlight, log.js keeps the debug log
server/      kokoro-reader command: installs and manages the local voice server
install.sh   one line installer
scripts/     build-extension.sh creates a release zip
```

Build the release zip with `bash scripts/build-extension.sh`. Pushing a tag like `v0.3.8` publishes a release with the zip and installer through GitHub Actions.

## Privacy

The extension talks only to Google Docs (to read the document you are on) and to your local server. No analytics, no accounts, no cloud voice service.

## Credits

Voice model by [hexgrad](https://huggingface.co/hexgrad/Kokoro-82M). Server by [remsky/Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI). Kokoro Reader is not affiliated with Google or Speechify.

## License

MIT. See [LICENSE](LICENSE).
