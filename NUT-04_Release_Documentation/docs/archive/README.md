# Archive

Documents moved here on 2026-10-07 because they describe the earlier build (retailer datasets bundled in the extension package, no accounts or backend) or are product and coursework records rather than release documentation. Nothing was deleted. Markdown files carry an `ARCHIVED` banner at the top; binary files are unchanged.

## Superseded technical documents

| File | Disposition | Replaced by |
|---|---|---|
| `01_PRD_NUT-04.md` | Background only | `README.md`, `API_REFERENCE.md` |
| `02_System_Architecture_NUT-04.md` | Merged | `README.md`, `API_REFERENCE.md` |
| `03_API_Reference_NUT-04.md` | Merged | `API_REFERENCE.md` |
| `04_Engineering_Runbook_NUT-04.md` | Merged | `INSTALL.md`, `CONTRIBUTING.md`, `ROLLBACK_RUNBOOK.md` |
| `05_Help_Center_NUT-04.md` | Kept, needs rewrite for accounts, Premium and catalog sync | none yet |
| `06_Technical_Design_Document_NUT-04.md` | Merged | `README.md`, `API_REFERENCE.md` |
| `NutriScore_Component_Diagram_v1.0.md` | Merged | Mermaid diagrams in `README.md`, `API_REFERENCE.md`, `ROLLBACK_RUNBOOK.md` |

## Product and research records

| File | Note |
|---|---|
| `NutriScore_Requirements_v2_Evidence_Linked.md` | Requirements linked to evidence; status columns predate the thin-client release |
| `NUT04_User_Personas_Evidence_Grounded.md` | Persona research; still valid background |

## Coursework deliverables (JKUAT)

Presentations, PDFs and addenda for Assignments 1, 2, 3 and Session 5, kept in their original sub-folders: `Assignment 1 &2 files/`, `Assignment 3 files/`, `assignment 5 files/`. They are not part of the release.

## What the archived technical documents get wrong today

- They describe no Supabase backend, accounts, plans, payments or signed catalog.
- Several still describe Firebase or Firestore as active.
- Several describe an alternatives engine (ranked substitute products) as implemented; no such code exists in the shipped build.
- They describe the earlier IndexedDB layout and bundled datasets.
