#!/bin/bash
# Reset memory script for supply chain graph

echo "Wiping SQLite database and Cognee caches..."

# Remove application support runtime database and Cognee files
rm -rf "/Users/adityarajpanjiyara/Library/Application Support/com.adityarajpanjiyara.hackathon-app/supply_chain.db"
rm -rf "/Users/adityarajpanjiyara/Library/Application Support/com.adityarajpanjiyara.hackathon-app/cognee_data"

# Remove local project-level build/test artifacts
rm -rf "./src-tauri/cognee.db"
rm -rf "./src-tauri/.data_storage"

echo "Success! Database and Cognee memory have been reset to a clean state."
