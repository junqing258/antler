# Repository Guidelines

## Project Structure & Module Organization

Antler is a pnpm workspace with two packages. `app/` contains the React/Vite UI: components in `src/components`, browser services in `src/lib`, styles in `src/styles`, and static assets in `public`. Its Tauri/Rust wrapper is in `app/src-tauri/`. `backend/` is the Fastify/TypeScript service, organized by routes, agent runtime, skills, knowledge, and persistence. Prisma files live in `backend/prisma/`; architecture material and deployment utilities are in `docs/` and `scripts/`.

## Build, Test, and Development Commands

Run commands from the repository root with pnpm 10:

- `pnpm install` installs all workspace dependencies.
- `pnpm dev` runs the web UI and backend; use `pnpm dev:web` or `pnpm dev:server` for one.
- `pnpm dev:app` starts the Tauri desktop application.
- `pnpm check` type-checks both TypeScript packages.
- `pnpm test` runs all Vitest suites; `pnpm test:watch` reruns on changes.
- `pnpm test:coverage` writes V8 text and HTML coverage reports.
- `pnpm build:app` builds the server and packaged desktop app.
- `pnpm --filter @antler/server db:migrate -- --name <name>` creates a Prisma migration after schema changes.

## Coding Style & Naming Conventions

Use strict TypeScript, ES modules, two-space indentation, semicolons, and trailing commas in multiline code. Use `camelCase` for functions and variables, `PascalCase` for components and types, and kebab-case filenames such as `directory-picker.tsx`. Prefer the `@/` app import alias. No repository-wide formatter or linter is configured; preserve surrounding conventions. Run `cargo fmt` for Rust changes.

## Testing Guidelines

Vitest is used throughout; frontend tests use jsdom and Testing Library, while backend tests use Node. Co-locate tests with source as `*.test.ts` or `*.test.tsx`. Add regression coverage for behavior changes, especially routes, run transitions, persistence, and UI interactions. No coverage threshold is enforced; avoid reducing meaningful coverage.

## Commit & Pull Request Guidelines

History follows Conventional Commits with scopes: `feat(backend): ...`, `fix(commit): ...`, or `docs(knowledge-base): ...`. Keep subjects concise; Chinese subjects are customary. PRs should explain intent and verification, link issues/design docs, note schema or environment changes, and include screenshots for UI work. Before review, run `pnpm check` and `pnpm test`; commit Prisma migrations with schema changes.

## Security & Configuration

Keep API keys and deployment secrets out of Git. Use environment variables such as `OPENAI_API_KEY`, `DATABASE_URL`, and `ANTLER_*`; document new variables and provide safe defaults. Treat public backend deployments as unauthenticated unless an external access control layer is configured.
