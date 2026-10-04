#!/bin/bash
# Start Dagster from the correct directory with proper paths

echo "🔥 Starting Dagster with enhanced example..."
cd /Users/ericthomas/dg-vs-code/example

# Kill any existing Dagster processes
pkill -f dagster 2>/dev/null || true
sleep 2

# Set environment variables
export PYTHONPATH="/Users/ericthomas/dg-vs-code/example"
export DAGSTER_HOME="/Users/ericthomas/dg-vs-code/example/.dagster"

# Create DAGSTER_HOME directory if it doesn't exist
mkdir -p "$DAGSTER_HOME"

# Start Dagster
echo "📍 Working directory: $(pwd)"
echo "🐍 PYTHONPATH: $PYTHONPATH"
echo "🏠 DAGSTER_HOME: $DAGSTER_HOME"
echo ""

dagster dev -f dagster_example.py --port 3000
