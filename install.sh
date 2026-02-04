#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

echo "Building..."
npm run build

echo "Installing Playwright browser..."
npx playwright install chromium

echo "Adding to Claude Code..."
claude mcp add --transport stdio forager -- node "$PWD/dist/src/index.js"

echo ""
echo "Done! Restart Claude Code to use the forager MCP server."
echo "Try: \"Find Wegmans stores in New York\""
