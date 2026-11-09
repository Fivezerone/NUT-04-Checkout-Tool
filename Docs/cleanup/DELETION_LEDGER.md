# Deletion Ledger

> Every code or file deletion during the refactor is recorded here.
> **Rule of two:** a deletion needs at least two of three evidence types
> (static, dynamic, historical) unless it is dead by an explicit project decision.
>
> `ID | path/symbol | cause | static evidence | dynamic evidence | historical evidence | risk | decision | commit`

## Format

| ID | Path / Symbol | Cause (§4.1) | Static Evidence | Dynamic Evidence | Historical Evidence | Risk | Decision | Commit |
|---|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — | — |

## Cause codes (§4.1)

| Code | Meaning |
|---|---|
| JIC | Just-in-case / speculative design |
| FFP | Feature-factory pressure |
| MDD | Migration / dependency drift |
| POF | Pivot / orphaned feature |
| KF | Knowledge fragmentation |
| EXP | Explicit project decision (cite decision #) |

## Status

Ledger initialised on 2026-11-10 — Phase 0 scaffold.  
Entries will be populated during Stage A analysis (§4.2–§4.5).

