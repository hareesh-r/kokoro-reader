Kokoro Reader

1. Double click "Install Kokoro Reader". It sets up the voice server and downloads the voice model (about 330 MB).
2. When it finishes, Chrome opens chrome://extensions. Turn on Developer mode, click Load unpacked, and choose the folder "Kokoro Reader/extension" in your home folder.
3. Open any web page or Google Doc and press Alt+Shift+L (or click the extension icon).

If double clicking does nothing, or macOS says it cannot verify the developer (this build is not notarized):

  A. Open System Settings > Privacy & Security, scroll down, and click Open Anyway next to Install Kokoro Reader. Then open the app again.
  B. Or open Terminal and run this once, then double click the app again:
       xattr -dr com.apple.quarantine "/Volumes/Kokoro Reader/Install Kokoro Reader.app"
  C. Or skip the app: open Terminal and run
       curl -fsSL https://raw.githubusercontent.com/hareesh-r/kokoro-reader/main/install.sh | bash

If something fails, the log is at ~/Library/Logs/KokoroReaderInstaller.log

Check that the voice server works: open http://localhost:8880/web
Manage the server later with the kokoro-reader command (status, start, stop, logs, uninstall).
