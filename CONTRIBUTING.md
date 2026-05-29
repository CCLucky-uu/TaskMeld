# Contributing to TaskMeld

Thanks for showing up. TaskMeld is maintained primarily by [@CCLucky-uu](https://github.com/CCLucky-uu); PRs are welcome, but read this first so the round-trip is short.

## Setup

```sh
git clone https://github.com/CCLucky-uu/TaskMeld.git
cd TaskMeld
npm install
npm run dev:cli      # tsx src/cli/index.ts — live source
npm run dev:web      # Vite HMR frontend
```

Node ≥ 18, OpenClaw ≥ 5.20. No global install needed during development.

## Proposing changes

- **Bug fixes** — go ahead and open a PR. Include steps to reproduce.
- **New features / behavior changes** — open an issue first to align on scope. TaskMeld is still in early testing; breaking changes need discussion.
- **Docs / README fixes** — always welcome, no issue needed.

## Code rules

### Comments — default is none

Write a comment ONLY when **why** is non-obvious and removing the comment would confuse a future reader.

Don't write what the code does — names already say it. Don't write file headers, section banners, or conversation history.

### TypeScript

- Strict mode. No `any` without a reason.
- Prefer functional style, avoid classes.
- kebab-case file names, async/await for async operations.
- CommonJS modules.

### Errors / fallbacks

- Don't add try/catch for internal errors — trust your own code.
- Boundary code (user input, network, FS) validates; everything else trusts.
- No silent fallback masking bugs. Log + crash > silent wrong output.

### Files

- One responsibility per file.
- Don't create new `*.md` documentation files unless asked.

### Git / commits

Format: `<type>(<optional-scope>): <description>`

| Type | Use for |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code change, no behavior change |
| `docs` | Documentation only |
| `chore` | Build, config, deps |
| `test` | Tests only |

One logical change per commit. `npm run verify` must pass before pushing.

## PR expectations

- Branch off `main`. One logical change per PR.
- `npm run build && npm test` must pass.
- Don't touch `CHANGELOG.md` — the maintainer writes release notes.

## Releasing (maintainers)

1. Bump `package.json` version.
2. Update `CHANGELOG.md` with changes since the prior tag.
3. `chore(release): X.Y.Z` commit.
4. `git tag -a vX.Y.Z -m "vX.Y.Z"`, push commit + tag.
5. `npm publish`.
