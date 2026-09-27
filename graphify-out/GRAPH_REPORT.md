# Graph Report - rack-up-hi-lo  (2026-09-28)

## Corpus Check
- Corpus is ~10,182 words - fits in a single context window. You may not need a graph.

## Summary
- 294 nodes · 459 edges · 24 communities (15 shown, 3 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Game & Admin UI Components
- Faucet API & Challenge Relayer
- Development Tasks & Rollout Log
- Game Contracts & State Hooks
- Project Metadata & Test Suites
- App Shell & Auth Providers
- TypeScript Build Configuration
- Development & Testing Tooling
- NPM Build & Test Scripts
- Core Web3 & UI Dependencies
- App Routing & Manifest Metadata
- Base Sepolia Deployment Tracker
- Project Architecture & Documentation
- Contract Outcome Enumerations
- Foundry Smart Contract Docs
- Next.js Agent Guidelines
- Graphify Knowledge Graph Rules
- Next.js TypeScript Declaration

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 16 edges
2. `GameRoom()` - 12 edges
3. `scripts` - 11 edges
4. `POST()` - 10 edges
5. `AdminConsole()` - 10 edges
6. `viem` - 9 edges
7. `Phase` - 9 edges
8. `errorMessage()` - 9 edges
9. `FaucetConfigurationError` - 9 edges
10. `react` - 8 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `errorMessage()`  [EXTRACTED]
  src/components/admin-console.tsx → src/lib/format.ts
- `useGameSnapshot()` --calls--> `buildClaimBatch()`  [EXTRACTED]
  src/hooks/use-game.ts → src/lib/claims.ts
- `POST()` --calls--> `createFaucetChallenge()`  [EXTRACTED]
  src/app/api/faucet/challenge/route.ts → src/lib/server/faucet-auth.ts
- `POST()` --calls--> `getFaucetAuthSecret()`  [EXTRACTED]
  src/app/api/faucet/challenge/route.ts → src/lib/server/faucet-auth.ts
- `POST()` --calls--> `sealFaucetChallenge()`  [EXTRACTED]
  src/app/api/faucet/challenge/route.ts → src/lib/server/faucet-auth.ts

## Import Cycles
- None detected.

## Communities (24 total, 3 thin omitted)

### Community 0 - "Game & Admin UI Components"
Cohesion: 0.13
Nodes (29): react, @testing-library/react, vitest, AdminConsole(), endGame(), run(), Countdown(), Feedback (+21 more)

### Community 1 - "Faucet API & Challenge Relayer"
Cohesion: 0.12
Nodes (34): viem, POST(), readAddress(), runtime, clearChallenge(), POST(), readClaim(), runtime (+26 more)

### Community 2 - "Development Tasks & Rollout Log"
Cohesion: 0.06
Nodes (33): Changed, Changed, Changed, Changed, Follow-ups, Follow-ups, Follow-ups, Follow-ups (+25 more)

### Community 3 - "Game Contracts & State Hooks"
Cohesion: 0.11
Nodes (23): GameFunction, buildClaimBatch(), Bet, contractsConfigured, faucetAbi, faucetAddress, gameAddress, hiLoGameAbi (+15 more)

### Community 4 - "Project Metadata & Test Suites"
Cohesion: 0.08
Nodes (22): name, overrides, decode-uri-component, uuid, ws, private, version, eslint (+14 more)

### Community 5 - "App Shell & Auth Providers"
Cohesion: 0.12
Nodes (16): @privy-io/react-auth, @privy-io/wagmi, @tanstack/react-query, wagmi, body, display, metadata, viewport (+8 more)

### Community 6 - "TypeScript Build Configuration"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 7 - "Development & Testing Tooling"
Cohesion: 0.12
Nodes (17): devDependencies, eslint, eslint-config-next, jsdom, @playwright/test, @testing-library/dom, @testing-library/jest-dom, @testing-library/react (+9 more)

### Community 8 - "NPM Build & Test Scripts"
Cohesion: 0.18
Nodes (11): scripts, build, contracts:build, contracts:test, dev, lint, start, test (+3 more)

### Community 9 - "Core Web3 & UI Dependencies"
Cohesion: 0.22
Nodes (9): dependencies, next, @privy-io/react-auth, @privy-io/wagmi, react, react-dom, @tanstack/react-query, viem (+1 more)

### Community 10 - "App Routing & Manifest Metadata"
Cohesion: 0.25
Nodes (3): nextConfig, next, metadata

### Community 11 - "Base Sepolia Deployment Tracker"
Cohesion: 0.25
Nodes (8): Base Sepolia deployment, Changed, Follow-ups, Plan, Review, Risks, Verification, Verified

### Community 12 - "Project Architecture & Documentation"
Cohesion: 0.29
Nodes (6): Base Sepolia setup, Game lifecycle, Local development, Rack Up, Security boundaries, What is included

### Community 13 - "Contract Outcome Enumerations"
Cohesion: 0.40
Nodes (5): Outcome, Hi, Lo, Pending, Refund

### Community 14 - "Foundry Smart Contract Docs"
Cohesion: 0.50
Nodes (3): Commands, Contracts, Hi-Lo contracts

## Knowledge Gaps
- **147 isolated node(s):** `nextConfig`, `name`, `version`, `private`, `dev` (+142 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 172 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `viem` connect `Faucet API & Challenge Relayer` to `Game & Admin UI Components`, `Game Contracts & State Hooks`, `Project Metadata & Test Suites`?**
  _High betweenness centrality (0.180) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Development & Testing Tooling` to `Project Metadata & Test Suites`?**
  _High betweenness centrality (0.074) - this node is a cross-community bridge._
- **Why does `react` connect `Game & Admin UI Components` to `Game Contracts & State Hooks`, `Project Metadata & Test Suites`, `App Shell & Auth Providers`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `nextConfig`, `name`, `version` to the rest of the system?**
  _147 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Game & Admin UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.12560975609756098 - nodes in this community are weakly interconnected._
- **Should `Faucet API & Challenge Relayer` be split into smaller, more focused modules?**
  _Cohesion score 0.11951219512195121 - nodes in this community are weakly interconnected._
- **Should `Development Tasks & Rollout Log` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._