#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ANDROID_ROOT}/../.." && pwd)"
KATEX_DIST="${REPO_ROOT}/frontend/student/node_modules/katex/dist"
TARGET_DIR="${ANDROID_ROOT}/app/src/main/assets/katex"

if [[ ! -d "${KATEX_DIST}" ]]; then
  echo "KaTeX dist not found: ${KATEX_DIST}" >&2
  echo "Run first: cd frontend/student && npm install" >&2
  exit 1
fi

if [[ ! -f "${KATEX_DIST}/katex.min.css" || ! -d "${KATEX_DIST}/fonts" ]]; then
  echo "KaTeX dist is incomplete: expected katex.min.css and fonts/" >&2
  exit 1
fi

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"
cp "${KATEX_DIST}/katex.min.css" "${TARGET_DIR}/katex.min.css"
cp -R "${KATEX_DIST}/fonts" "${TARGET_DIR}/fonts"

file_count="$(find "${TARGET_DIR}" -type f | wc -l | tr -d ' ')"
total_size="$(du -sh "${TARGET_DIR}" | awk '{print $1}')"

echo "Synced KaTeX assets to ${TARGET_DIR}"
echo "Files: ${file_count}"
echo "Total size: ${total_size}"
