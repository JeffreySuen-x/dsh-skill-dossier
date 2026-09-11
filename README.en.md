# dsh-skill-dossier

English · [中文](./README.md)

> Downloaded a hundred skills and still can't find the right one when it matters?
> Sitting on hundreds of skills but no longer remember what any of them does?

A **skill dossier + work report** plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH). It turns the skills scattered across `~/.dsh/skills`, `.dsh/skills` and `~/.agents/skills` into a dossier you can read, verify and keep fresh — and rolls your daily engineering briefs into daily / monthly / retrospective views.

One package, three panels:

| Panel | What it does |
|---|---|
| **Skills** | Browse, search, **filter by direction category** (same axis as the dossier panel), read details, one-click `/name` into the composer; **disable** (reversible trash) · reinstall · **delete** (one step, confirmed) |
| **Dossier** | Per-skill profile: direction (10 categories), use scope, capability boundaries, scenarios, origin, call stats, **observed load success/failure**, **catalog token cost**, freshness review |
| **Report** | Three read-only views — **daily** (detail), **weekly** (Mon–Sun) and **monthly** — over `reporter/brief/YYYY-MM-DD.md`. Weekly and monthly are a **contribution graph plus one-line status per project** |

> The report half is an **optional module**: `dataRoot` is configurable and defaults to `reporter/brief/` inside the workspace. Ignore it and it is just a panel nobody opens — the skill and dossier halves are unaffected.
>
> It deliberately has **no retrospective, no export, no run history**: a retrospective is the agent's job (let it read the briefs), export is what copy-paste already does, and run history existed to serve a scheduler that does not exist. The plugin only reads — no writes, no state, one less failure surface.
>
> **Weekly and monthly say three things only**: a contribution graph (which days you worked and how much), one status sentence per project, and its next steps and blockers. No day-by-day dump — that is what the daily view is for.

## Why a "dossier"

**Profiling has exactly one purpose: let both the AI and the human understand what each skill is for.**

A skill catalog carries only a name and a description — no boundaries, no scenarios, no freshness. Humans end up reading files; the model ends up guessing. This plugin writes a dossier per skill that both sides can read:

- **Humans**: filter by direction in the dossier panel; every card states use scope / capability boundaries / scenarios / origin / call history
- **The AI**: the model reads a dossier by name with the `skill_dossier` tool — **before** committing to load a skill's full text

Comparable plugins stop at "list them, toggle them". This one goes one step further: **it profiles each skill and verifies it with observation instead of the model's own claim.**

- **Profile fields**: direction / use scope / capability boundaries / scenarios / origin (self · external · system · unmarked) / authored at / reviewed at / content hash
- **Observed outcomes**: subscribes to DSH's official `tools/result` event; a `skill` load that succeeds is recorded ✅, a failure ❌ with its error — not "the model says it is useful" but "did it actually load"
- **Catalog cost**: estimates ≈tokens each skill's name+description occupies in the system prompt, answering "who is eating the context"
- **Freshness review**: ranks by "volatile direction + long unused + long unreviewed", telling the model or the human exactly which skills to revisit

## Install

Requires Node `^22.19.0 || >=24.0.0` and an installed DSH (`npx @deepseek-ai/dsh web` once is enough).

```sh
# npm
dsh plugin --profile web add dsh-skill-dossier

# GitHub
dsh plugin --profile web add github:JeffreySuen-x/dsh-skill-dossier

# local directory (development)
dsh plugin --profile web add link:/absolute/path/dsh-skill-dossier
```

The repository **commits its `lib/` build artifacts**, so a git install works as-is with no build-script authorization.

## Model-facing tools

| Tool | Purpose |
|---|---|
| `skill_dossier` | **Read** one skill's dossier (direction / scope / boundaries / scenarios / usage and observed outcomes); use it before loading a skill's full text |
| `skill_archive` | Write a skill profile (direction / use scope / boundaries / scenarios / origin) |
| `skill_review` | List skills due for review (freshness ranking) |

> The earlier `skill_match` / `skill_route` / `skill_usage` / `skill_eval` tools were removed: DSH already puts the skill catalog (name + description) into the system prompt and lets the model choose, so a lexical router on top showed no measured benefit (8 weeks on the author's machine: 233 `skill` calls vs 0 `skill_match` and 1 `skill_route`). The data is still recorded — it just no longer has its own panel and tools.

## Configuration

Every config key has a default; not configuring anything equals the previous behaviour. Override it in the profile's `cordis.patch.yml` under `id: skill-dossier`:

```yaml
- id: skill-dossier
  config:
    report:
      dataRoot: reporter   # report data root
      briefDir: brief      # daily brief directory
```

Note: DSH's patch layer **replaces** the whole config rather than merging, so restate the keys you care about (unlisted keys fall back to the code defaults).

## Build from source

```sh
pnpm install        # build tooling + type dependencies (@deepseek-ai/* are public packages)
pnpm run build      # tsc emits lib/types, tsdown bundles lib/index.js and lib/client.js
pnpm run test       # unit + integration tests
node qa/gates.mjs   # test / typecheck / build / pack gates
```

After editing `src/`, run `pnpm run build` and commit `lib/` — CI enforces `git diff --exit-code -- lib` so the two never drift.

## Platform support

Windows / Linux / macOS. Lifecycle file operations emit pwsh (Windows, native `MoveFileExW`) or bash (POSIX) commands; `tests/windows-runtime.spec.ts` exercises the real Windows syscall on a Windows runner.

## Known boundaries

- **Web profile only**: the host half hard-depends on the `webServer` service and cannot be installed headless.
- **Call stats are observational**: only calls made while the plugin is running are counted; historical calls cannot be reconstructed. A failed stats write never interrupts a skill, but it is **no longer silent** — the panel shows the failure and its reason.
- **Delete wraps two steps, it is not a second path**: move into trash, then remove recursively — both steps keep their own path checks and failure rollback, and a failed `rm` leaves the skill restorable in trash. Non-filesystem skills are refused.
- **Lifecycle moves require one filesystem**: a skill entry and its trash directory on different mounts are refused safely before any file changes; there is no non-atomic copy-delete.
- **Windows/Linux regressions are wired into CI** but only count as "actually run" once GitHub Actions is green.

## License

MIT
