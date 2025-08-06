#!/bin/bash
# run_all.sh
#
# Convenience wrapper to install dependencies, process the Mercari dataset
# (if available) and start the Facebook Marketplace notifier.
#
# Usage: ./run_all.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[fb-notifier] Running full setup and starting notifier..."

# Run the setup script to install dependencies and compute averages
if [ -x ./setup_project.sh ]; then
  ./setup_project.sh
else
  echo "Error: setup_project.sh is missing or not executable." >&2
  exit 1
fi

# Start the notifier
echo "[fb-notifier] Starting the notifier..."
node improved_fb_notifier_images.js