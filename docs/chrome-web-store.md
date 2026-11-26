# Chrome Web Store listing

Copy these into the developer dashboard (https://chrome.google.com/webstore/devconsole, one time $5 registration).
Upload `kokoro-reader-extension-<version>.zip` from the Releases page.

## Store listing

**Name:** Kokoro Reader

**Summary (max 132 chars):** Read any web page or Google Doc aloud with a free local AI voice and word highlight. Private, no subscription.

**Category:** Productivity

**Language:** English

**Description:**

Kokoro Reader reads any web page or Google Doc aloud with a natural AI voice and highlights each word on the page as it is spoken. Select text to read just that, or click the icon (Alt+Shift+L) to read the main article. It is a free, private alternative to paid read aloud tools.

Everything runs on your own computer. Your documents are never sent to the cloud, and there is no account or subscription.

Features
- Natural voices from the open Kokoro model, running locally
- Word highlight plus a soft sentence highlight, in six colors
- Voice picker with preview, speed from 0.8x to 3x, seek bar, auto scroll
- Alt+click any word to start reading from there
- Works on any site, on long documents, at any zoom level, in light and dark pages

You need the free local voice server for this extension to work. Install it with the one line command or the Mac and Windows installers at https://github.com/hareesh-r/kokoro-reader

## Privacy tab

**Single purpose:** Read the current page or Google Doc aloud with a local text to speech server and highlight the spoken words on the page.

**Permission justifications**
- `activeTab`: after the user clicks the toolbar icon or presses the shortcut, lets the extension read the selected text or main article of that one tab and draw the highlight on it. It has no access to other tabs and does nothing until the user acts.
- `scripting`: loads the reader into the tab the user chose, after that click or shortcut.
- `storage`: saves the user's settings (voice, speed, colors, server address).
- `https://docs.google.com/*`: reads the text of the open document and draws the highlight on the page.
- `https://*.googleusercontent.com/*`: loads document resources needed to match the page.
- `http://localhost/*` and `http://127.0.0.1/*`: sends the text to the user's own local voice server and receives audio.

**Remote code:** No.

**Data usage:** Does not collect or transmit user data off the device. Select none of the collection categories, and tick all three certifications.

**Privacy policy URL:** https://github.com/hareesh-r/kokoro-reader/blob/main/PRIVACY.md

## Images

Screenshots (1280x800) are in `docs/store/`. Icon 128x128 is `extension/icon128.png`.
