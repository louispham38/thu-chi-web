#!/usr/bin/env bash
# Build script cho Render.com
set -e

echo "=== [1/2] Frontend build ==="
cd frontend
npm ci --silent
npm run build
cd ..

echo "=== [2/2] Backend deps ==="
cd backend
pip install -r requirements.txt
cd ..

echo "=== Build OK ==="
