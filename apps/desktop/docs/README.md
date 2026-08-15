# dsh-desktop docs

English | [中文](README.zh.md)

Planning and implementation docs for the desktop shell (`apps/desktop`). These are desktop-only records, independent of the repository-root `docs/` governance.

## Index

| File | Content |
|---|---|
| [size-analysis.md](size-analysis.md) | Measured install-size analysis: which parts cost what, and the root cause |
| [optimization-plan.md](optimization-plan.md) | The full optimization plan: payload trimming (Part A) + startup splash (Part B) |
| [operating-constraints.md](operating-constraints.md) | Runtime environment and process-occupation constraints (read before touching anything) |

## ⚠️ Most important constraint

**The running environment is built on this repository's working directory (`J:\Projects\deepseek-harness`).**

Any operation that triggers a build, reinstalls dependencies, cleans `node_modules`, replaces `.runtime/deploy`, runs the dev server, or runs `tauri build` can collide with files the running environment holds open (Windows file locks / `EBUSY` / `EPERM`).

On any process-occupation error, **stop immediately — do not retry or work around it** — then follow the manual steps in [operating-constraints.md](operating-constraints.md) to prompt the user.
