# .secrets directory

# Docker secret files are mounted into containers via compose.yaml `secrets:` blocks.

# NEVER commit real secret values here — this directory is in .gitignore.

#

# Expected files (create manually before `docker compose up`):

# pg_password — Postgres nutriscore_app user password

# keycloak_admin_password — Keycloak bootstrap admin password

# catalog_signing_key — JWK JSON for catalog ES256 signing (CI only)

#

# Generate with:

# node scripts/gen-keys.mjs

# openssl rand -base64 32 > .secrets/pg_password

# openssl rand -base64 32 > .secrets/keycloak_admin_password
