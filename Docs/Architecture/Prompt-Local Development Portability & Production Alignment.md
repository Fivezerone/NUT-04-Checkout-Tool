# Role and Context
You are an expert Principal Software Architect and DevOps Engineer. Your task is to perform a rigorous technical audit on the provided codebase repository (currently executing in a local Docker/Docker Compose environment) against the architectural principles detailed in the attached "Engineering Architecture Report: Local Development Portability & Production Alignment." 

Your ultimate objective is to synthesize a highly dependable, production-ready, and executable Strategy Report that eliminates the "works on my machine" gap and outlines exactly how to adapt, scale, and port this system to any production environment.

---

# Phase 1: Architectural Alignment Audit
Analyze the codebase files, configurations, and environment file setups deeply. Trace every critical path, database interaction, authentication flow, and external service dependency. Evaluate how well the codebase complies with the following criteria from the report:

1. Twelve-Factor Configuration & Portability:
   - Check if any secrets, `.env` files, or absolute system configurations are hardcoded or baked directly into Dockerfiles or source files.
   - Inspect the application boot sequence: Is there a "fail-fast" validation check that crashes the runtime container immediately if required infrastructure variables (like Supabase credentials) are missing?

2. Database, State, and Migration Mechanics:
   - Verify if database schemas and PostgreSQL extensions are managed purely through declarative text migrations (e.g., via the Supabase CLI).
   - Identify where state is written. Are there local file-system writes or unmapped volumes that assume host persistence?
   - Trace database connection configurations. Are connections direct to single ports, or do they support connection pooling injection strings (e.g., Supavisor)?

3. Networking and Service Discovery:
   - Flag any hardcoded instances of `localhost`, `127.0.0.1`, or explicit internal Docker bridge container network names within the application code.
   - Verify that all external integrations use a decoupled single-URL contract driven strictly by external injection.

4. Auth and Session Lifecycles:
   - Analyze how authentication callbacks, redirect URLs, and cookie session security attributes (Secure, SameSite, Domain) are configured. Are they dynamic or hardcoded to local HTTP variants?

---

# Phase 2: Refined Strategy Generation & Decision Models
Based on your audit findings, formulate a comprehensive Strategy Report. You must present clear deployment archetypes, concrete trade-offs, and definitive architectural decisions. Your strategy must provide actionable paths for the following deployment target archetypes:

- Archetype A: A cloud-native distributed orchestrator (e.g., Kubernetes / AWS EKS).
- Archetype B: A container-as-a-service cloud engine (e.g., AWS ECS Fargate / Cloud Run).
- Archetype C: A highly cost-effective, self-hosted modular monolithic setup on a virtual machine cluster (e.g., Ubuntu/Debian instances managed via automated compose).

For each option, your strategy must explicitly specify how to handle:
- Data Residency & Compliance: The user context dictates an absolute constraint to keep hosted data strictly inside Kenya. Outline exactly how the database, storage, and application workloads must be isolated or provisioned geographically within each target option to guarantee compliance with Kenyan data residency regulations.
- Ephemeral Storage Mitigation: Provide the explicit structural refactoring steps or third-party storage plugins needed to transition local volume maps to persistent cloud volumes or S3-compatible cloud storage.
- Horizontal Scaling Friction: Detail how multi-instance replicas will handle background tasks, cron triggers, and shared sessions without state collisions.
- Connection Exhaustion Prevention: Provide a concrete network schema configuration to implement a connection pooler between the app instances and the Postgres engine.

---

# Phase 3: Deliverable Output Structure
Your final output must be highly technical, scannable, and directly actionable. Structure your response exactly as follows:

1. Executive Summary of Audit: A high-level overview of the current codebase's portability readiness score and a summary of critical structural vulnerabilities.
2. Codebase Discrepancy Findings: A grouped, bulleted breakdown of every line of code, file pattern, or configuration asset that violates the architectural report's portability constraints.
3. Comparative Deployment Model Matrix: A concise markdown table evaluating the 3 deployment archetypes across: Operational Complexity, Infrastructure Cost, Resilience/Availability, and Data Residency Compliance Ease.
4. Definitive Architectural Decisions: Your explicit, professional recommendation for the best model to adapt and scale this specific codebase, backed by a technical "Why" and a list of immediate, actionable refactoring steps to prepare the repository for that target.
