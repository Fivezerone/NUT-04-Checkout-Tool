# Blueprint deviations and engineering judgements

| ID | Phase | Deviation / judgement | Reason | Owner / disposition |
| --- | --- | --- | --- | --- |
| D-001 | 0 | The implementation branch starts from `feat/cad-only-identity` / `refactor/repo-cleanup` baseline rather than the older `main` tip. | The blueprint explicitly builds on the shipped CAD identity inventory; `main` predates that implementation and would make the required keep/move/replace inventory unavailable. | Staff Engineering; documented baseline tag `pre-cad-backend-blueprint`. |
| D-002 | 0 | The named SOP and rollback final report were not restored under `Reports/`. | Only the controlling blueprint, Agent Prompt, CAD live testing guide, and plans are available in the workspace. No behaviour will be inferred solely from a missing document. | Kibet to restore if a conflicting historical detail matters. |
| D-003 | 2 | Option 2: remove the application-level `role` claim in the coordinated claim-adapter cutover. | Kibet selected Option 2 after mandatory trigger OQ-001. The Supabase database role remains unmodified; application authorization uses `app_role` only. | Implement in Phase 2. |
| D-004 | 3 | A tenant administrator may suspend (but not create, reactivate, or role-change) a commercial stakeholder within its own tenant. | D1 preserves this narrow leaver safeguard from SOP §5.2 while reserving onboarding, reactivation, and role transitions for `super_admin`. | Implement in Phase 3. |
| D-005 | 3 | Commercial stakeholders are bound to exactly one tenant selected by the super administrator. | D1 assumption O1 keeps the tenant wall and k≥5 suppression intact. | Kibet confirmation still required before any multi-tenant partner feature. |
| D-006 | 3 | Platform auditors have cross-tenant audit metadata/proofs only, not clinical content. | Blueprint §4.5 narrows D3’s general wording and takes precedence. | Implement in Phase 5. |

