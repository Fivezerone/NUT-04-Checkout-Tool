Engineering Architecture Report: Local Development Portability & Production Alignment
This report compiles the core technical alignment and structural strategies discussed regarding local containerization (Docker Desktop), distributed orchestration (Kubernetes), and environment-agnostic development using the Supabase stack. Additionally, it explicitly defines the boundaries and out-of-scope architectural criteria needed to complement this foundation.

1. Executive Summary & Core Definitions

Developing scalable applications demands an absolute structural boundary between local execution environments and production production orchestrators. Docker Desktop cannot be classified as a descaled version of Kubernetes (k8s). They serve fundamentally distinct purposes in the application lifecycle:
• Docker Desktop: A local client-server single-host runtime application focused on building, packaging, and executing individual isolated workloads.
• Kubernetes: A distributed multi-node clustering framework focused on fleet management, automated scaling, ingress routing, and service self-healing.

2. The "Works on My Machine" Gap: Replicated vs. Divergent Attributes

While containerization guarantees an identical code runtime environment and localized file systems, it does not guarantee architectural behavior at scale.

Replicated Attributes

• System binaries, language dependencies, and engine runtimes.
• Internal container configurations and explicit dependency trees.

Divergent Attributes in Production Environments

• Networking Architecture: Local environments utilize seamless localhost bridge networks. Production uses complex internal cluster DNS, multi-layer load balancers, and ingress controllers.
• Workload Ephemerality & State: Local containers often run indefinitely with persistent storage mapped directly to host drives. Production orchestration rotates, scales, and kills worker nodes at will, making unmapped local states fatal.
• Horizontal Scalability: Moving from one isolated instance to multiple concurrent tasks introduces session collisions, distributed race conditions, and duplicate background tasks.
• Resource Caps: Local computers allocate generous CPU and RAM cycles. Production introduces strict CPU throttling metrics and immediate Out-Of-Memory (OOM) termination thresholds.

3. Structural Framework: Agnostic App & Supabase Development

To maintain absolute deployment flexibility when the final production environment is undecided, development must follow a strict decoupled utility design pattern.

Database & Migration Layer

• Decoupled Schema Strategy: Treat database states as transient assets managed explicitly through declarative text migrations using the Supabase CLI. Database extensions (e.g., pgvector) must be hardcoded inside standard migration steps.
• Connection Lifecycle: Eliminate direct single-port PostgreSQL mappings (5432). Implement an abstracted configuration layer that accommodates connection pooling managers (like Supavisor) from inception.

Service Discovery & Configuration

• The Single-URL Contract: The application container must interact with external resources solely via generic environment variables (SUPABASE_URL, SUPABASE_ANON_KEY).
• Strict Twelve-Factor Compliance: Environment files (.env) must never be baked into images. The codebase must implement a "fail-fast" boot validation script that forcefully crashes the runtime container immediately if necessary external infrastructure environment variables are absent.

Auth & Session Mechanics

• Abstract Cookie Domains: Ensure session metadata properties (Secure, SameSite, Domain attributes) are dynamic variables. This allows the application to fall back gracefully to unsecured HTTP for local testing while immediately enforcing explicit secure subdomains in production environments.

4. Complementary Additions: Out-of-Scope Architectural Criteria

To fully safeguard this architectural approach, the following components are explicitly designated as Out of Scope for this specific development layer. These must be independently resolved once a production platform is officially selected:

Data Residency & Compliance Constraints

• Local Residency Enforcement: While the core app structure is agnostic, if the project is strictly required to comply with local data privacy acts (such as keeping hosted data within Kenya), this responsibility falls entirely onto the infra provisioning team. Managing physical geographic region selections or setting up local bare-metal cloud host configurations falls outside the container image logic. [1] (https://mail.google.com/mail/?extsrc=sync&client=h&plid=ACUX6DP5cBoIQtjpLouQ9Qw12JHy6YiZuRhc9TA)

Target Platform Configurations

• Orchestrator-Specific Manifests: Writing concrete Kubernetes deployment manifests (deployment.yaml), Helm charts, AWS ECS Task Definitions, or serverless infrastructure-as-code scripts (Terraform/OpenTofu) is excluded until the target platform is decided.
• Production Ingress & SSL Termination: Setting up live edge firewalls, reverse proxy configurations, and real SSL/TLS certificate handling (e.g., Let's Encrypt automated configurations) is strictly out of scope.

CI/CD and Secret Distribution

• Deployment Pipeline Pipelines: Building live automation runners (GitHub Actions, GitLab CI) that authenticate with live registries and orchestrators is excluded.
• Production Secret Vault Integration: Connecting applications directly to localized cloud hardware modules (like AWS Secrets Manager or HashiCorp Vault) is an infrastructure task, decoupled from the core application’s environment-variable contract.