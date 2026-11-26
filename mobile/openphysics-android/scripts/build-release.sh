#!/usr/bin/env bash
set -euo pipefail
: "${OPENPHYSICS_ANDROID_KEYSTORE_PATH:?Set your own keystore path}"
: "${OPENPHYSICS_ANDROID_STORE_PASSWORD:?Set your own keystore password}"
: "${OPENPHYSICS_ANDROID_KEY_ALIAS:?Set your own key alias}"
: "${OPENPHYSICS_ANDROID_KEY_PASSWORD:?Set your own key password}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}/.."
./gradlew :app:assembleRelease "$@"
