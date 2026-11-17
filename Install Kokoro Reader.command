#!/bin/bash
# Double click this file on macOS to install the voice server.
cd "$(dirname "$0")"
bash ./install.sh
echo
read -n 1 -s -r -p "Press any key to close this window."
