#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Installing dependencies..."
npm install

echo "Building..."
npm run build

echo "Adding to Claude Code..."
claude mcp add --transport stdio forager -- node "$PWD/dist/src/index.js"

echo "Installing meal planning skill..."
mkdir -p ~/.claude/skills
ln -sf "$PWD/.claude/skills/wegmans-meal-plan" ~/.claude/skills/wegmans-meal-plan

echo "Creating meal planning directories..."
mkdir -p ~/.claude/meal-planning/plans

echo ""
echo "Done! Restart Claude Code to use the forager MCP server."
echo ""
echo "Try:"
echo "  - \"Find Wegmans stores in New York\""
echo "  - \"Help me plan meals for this week\" (uses the wegmans-meal-plan skill)"
