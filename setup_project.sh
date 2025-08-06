#!/bin/bash
# setup_project.sh
#
# This script automates the setup of the Facebook Marketplace notifier project.
# It installs Node dependencies, including packages added for eBay and price
# estimation support, and optionally processes the Mercari Price Suggestion
# dataset to compute average sale prices per category.

set -e

echo "[fb-notifier setup] Starting project setup..."

# Ensure Node.js and npm are available
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is not installed. Please install Node.js (v18+ recommended) and re-run this script." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed. Please install npm and re-run this script." >&2
  exit 1
fi

echo "[fb-notifier setup] Installing Node dependencies..."
npm install

# Optionally process the Mercari dataset if present
MERCARI_FILE="train.tsv"
if [ -f "$MERCARI_FILE" ]; then
  echo "[fb-notifier setup] Detected $MERCARI_FILE. Computing average prices per category..."
  node -e "require('./mercari_ratio_loader').computeAveragePriceByCategory('$MERCARI_FILE').then(res => require('fs').writeFileSync('categoryAvgPrice.json', JSON.stringify(res, null, 2)))"
  echo "[fb-notifier setup] Wrote categoryAvgPrice.json"
else
  echo "[fb-notifier setup] Mercari dataset ($MERCARI_FILE) not found. Skipping category average computation."
fi

echo "[fb-notifier setup] Setup complete."
echo "Next steps:\n  • Set up your Gmail app password and export EMAIL_USER and EMAIL_PASS as environment variables.\n  • Register an eBay developer account and set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.\n  • Run the notifier using node improved_fb_notifier_images.js"