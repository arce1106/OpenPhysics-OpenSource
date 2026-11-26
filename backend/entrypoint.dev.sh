#!/bin/bash
set -e

if [[ -d /opt/learning-content-pane/dist ]]; then
  mkdir -p /app/panes/learning-content-pane/dist
  cp -R /opt/learning-content-pane/dist/. /app/panes/learning-content-pane/dist/
fi

echo "Running database migrations..."
alembic upgrade head

echo "Starting dev server with hot reload..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
