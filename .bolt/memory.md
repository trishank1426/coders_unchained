# Project memory

## Product intent & audience

- Node.js server application (Express) serving both a website and an API from a single process.
- Deployed via Bolt's deployment pipeline, which requires standard npm scripts.

## Brand personality & voice

- No explicit brand context inferred yet.

## Visual design & UX direction

- No frontend design context inferred yet beyond that the app serves a website.

## Decisions, constraints & rationale

- Deployment requires a `"build"` script in root `package.json`; added as a no-op since this is a server-only app with no compilation step.
- `"start"` script launches the Express server that serves website + API.
- Bolt deployment expects root-level `package.json` with both `build` and `start` scripts.

## Open questions & assumptions

- Assuming no frontend build/bundling step is needed (website may be static or server-rendered by Express).
- Framework details, routes, and project structure not yet explored.