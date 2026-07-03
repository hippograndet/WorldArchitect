# Contributing to WorldArchitect

Thanks for considering a contribution. This is a small, actively-developed project — issues and pull requests are welcome, but please open an issue to discuss anything beyond a small fix before spending time on a large change.

## Development setup

Requirements: Node.js 20+, npm.

```bash
npm install
npm run dev              # server :3001 + client :5173
```

Useful commands:

```bash
npm run typecheck         # both workspaces
npm run build             # both workspaces
npm test                  # both workspaces
npm run dev:server        # server only
npm run dev:client        # client only
```

The app runs in local mode (`APP_MODE=local`, no login, SQLite) by default — this is the setup almost all contributions should be developed and tested against. See [DEPLOY.md](DEPLOY.md) only if your change specifically touches hosted mode (`APP_MODE=hosted`, Postgres, Clerk auth).

## Before opening a pull request

- Run `npm run typecheck` and `npm test` — both must pass.
- Keep changes scoped to what the PR describes. Avoid drive-by refactors mixed into a bug fix or feature PR.
- Match the existing code style: no comments unless they explain a non-obvious *why*, no new abstractions for a single call site, prefer the patterns already used in the file you're editing over introducing new ones.
- If you're touching the World layer (`articles`, `article_versions`, `world_bible_entries`) or the database schema, see `dev-docs/engineering/practices.md`'s safe-expansion principles first — this layer is intentionally conservative.

## Reporting bugs / requesting features

Use the issue templates. For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead of opening a public issue.
