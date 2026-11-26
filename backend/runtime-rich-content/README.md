# Backend rich-content runtime

This manifest installs only the Node packages needed by the existing shared
renderer. Both direct versions are pinned to the student lockfile's versions.
Update these pins and this lockfile together with renderer dependency changes;
the deployment-contract tests detect drift.

The backend Dockerfile installs this package at `/frontend/student`, not at its
repository location. It still copies the canonical source to `/frontend/shared`
and invokes the unchanged command:

```text
npm run render-rich-content --silent -- --server
```

`tsx` is deliberately a production dependency: the current Python bridge runs
the TypeScript CLI directly. No new bundler, renderer, protocol, cache, timeout,
or API implementation is introduced. The student Web package is unchanged.

Static contract checks, without installing packages or connecting to services:

```bash
python3 -m unittest backend.tests.test_rich_content_runtime -v
```

The same test file additionally checks exact old/new JSON-lines output, invalid
input recovery, single-shot behavior, and the Python bridge when both of these
environment variables identify preinstalled packages in isolated trees:

```text
OPENPHYSICS_RENDERER_REFERENCE_DIR=/reference/frontend/student
OPENPHYSICS_RENDERER_RUNTIME_DIR=/frontend/student
```

Each tree must retain a sibling `shared/math` directory. The reference uses the
student package; the runtime uses this package. Run these integration checks in
the backend Python environment, with repository sources available for the static
checks. They do not install dependencies, call APIs, or access a database.

When testing a built image with repository sources mounted separately, use
`PYTHONPATH=/app` and pytest's `--import-mode=importlib`. This keeps the Python
bridge under test in the image and avoids accidentally selecting a host
`frontend/student/node_modules` directory with binaries for another platform.
