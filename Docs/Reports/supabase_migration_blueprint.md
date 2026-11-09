# Supabase → Kenyan Sovereign Cloud: Master Migration Blueprint

> [!IMPORTANT]
> **Compliance Anchor:** Every architectural decision below is constrained by the Kenya Data Protection Act (DPA 2019, Sections 48–50). Zero bytes of user PII, session state, transaction logs, or telemetry may egress Kenyan sovereign territory. All TLS termination, DNS resolution (authoritative), certificate issuance (via local ACME or purchased certs), and time synchronization (NTP) must resolve to in-country endpoints or be self-hosted within the target data center.

---

## 1. Architecture Diagram

```mermaid
graph TD
    subgraph CLIENT_LAYER["Client Layer"]
        direction LR

        subgraph CHROME_EXT["Chrome Extension (Manifest V3)"]
            CE_POPUP["Popup UI<br/>(React/Preact)"]
            CE_SW["Background Service Worker<br/>(chrome.runtime)"]
            CE_CS["Content Script<br/>(DOM Injection)"]
            CE_STORAGE["chrome.storage.session<br/>+ chrome.storage.local<br/>(JWT + Refresh Token)"]
            CE_POPUP -->|"user action"| CE_SW
            CE_CS -->|"message passing"| CE_SW
            CE_SW -->|"persist tokens"| CE_STORAGE
        end

        subgraph MOBILE_APP["Mobile App (React Native / Flutter)"]
            MA_UI["App UI Layer"]
            MA_AUTH["Auth State Manager<br/>(Zustand / Riverpod)"]
            MA_SEC["Secure Storage<br/>(Keychain iOS /<br/>EncryptedSharedPrefs Android)"]
            MA_WS["WebSocket Client<br/>(socket.io-client /<br/>web_socket_channel)"]
            MA_UI -->|"auth events"| MA_AUTH
            MA_AUTH -->|"persist tokens"| MA_SEC
            MA_UI -->|"subscribe"| MA_WS
        end

        subgraph FUTURE_WEB["Future Web Companion"]
            WEB_SPA["SPA (Next.js / Vite)"]
            WEB_STORE["httpOnly Secure Cookie<br/>+ sessionStorage"]
            WEB_SPA -->|"auth state"| WEB_STORE
        end
    end

    subgraph NETWORK_INGRESS["Network Ingress Layer — Kenyan DC Edge"]
        direction TB

        DNS["Authoritative DNS<br/>(Cloudflare KE PoP /<br/>Self-hosted BIND9)<br/>api.yourdomain.co.ke"]
        NGINX["Nginx Reverse Proxy<br/>(SSL/TLS Termination)<br/>Let's Encrypt ACME<br/>or KENIC-issued Cert"]
        CORS_ENGINE["CORS Policy Engine<br/>(Nginx headers_more)"]
        RATE_LIMIT["Rate Limiter<br/>(nginx limit_req_zone<br/>+ fail2ban)"]
        WAF["ModSecurity / NAXSI<br/>WAF Layer"]

        DNS -->|"A/AAAA record<br/>resolves to DC IP"| NGINX
        NGINX --> CORS_ENGINE
        NGINX --> RATE_LIMIT
        NGINX --> WAF
    end

    subgraph KENYAN_COMPUTE["Kenyan Compute Zone — Application Tier"]
        direction TB

        subgraph API_GATEWAY["Node.js API Gateway (Fastify + TypeScript)"]
            ROUTER["Route Handler<br/>/api/v1/*"]
            AUTH_MW["Auth Middleware<br/>(JWT Verify + RBAC)"]
            PAYMENT_CTRL["Payment Controller<br/>(M-Pesa / Paystack)"]
            USER_CTRL["User Controller<br/>(CRUD + Profile)"]
            PRODUCT_CTRL["Product / Feature<br/>Controller"]
            SUBSCRIPTION_CTRL["Subscription &<br/>Tier Controller"]
            ROUTER --> AUTH_MW
            AUTH_MW --> USER_CTRL
            AUTH_MW --> PRODUCT_CTRL
            AUTH_MW --> PAYMENT_CTRL
            AUTH_MW --> SUBSCRIPTION_CTRL
        end

        subgraph AUTH_ENGINE["Local Auth Engine"]
            JWT_ISSUER["JWT Issuer<br/>(jsonwebtoken / jose)<br/>RS256 w/ local keypair"]
            REFRESH_STORE["Refresh Token Store<br/>(PostgreSQL table:<br/>auth.refresh_tokens)"]
            BCRYPT["Password Hashing<br/>(bcrypt / argon2)"]
            OTP_ENGINE["OTP / 2FA Engine<br/>(speakeasy / otplib)"]
            JWT_ISSUER --> REFRESH_STORE
        end

        subgraph REALTIME_ENGINE["Realtime Engine"]
            WS_SERVER["Socket.io Server<br/>(attached to Fastify)"]
            PG_LISTEN["pg LISTEN/NOTIFY<br/>Channel Subscriber"]
            EVENT_BUS["In-Process Event Bus<br/>(EventEmitter / Redis Pub/Sub)"]
            PG_LISTEN -->|"DB change event"| EVENT_BUS
            EVENT_BUS -->|"broadcast"| WS_SERVER
        end

        subgraph PAYMENT_NODES["Payment Processing Nodes"]
            DARAJA_CLIENT["Daraja API Client<br/>(axios → Safaricom<br/>api.safaricom.co.ke)"]
            PAYSTACK_CLIENT["Paystack Client<br/>(api.paystack.co)"]
            WEBHOOK_INGRESS["Webhook Ingress<br/>/api/v1/webhooks/mpesa<br/>/api/v1/webhooks/paystack"]
            IDEMPOTENCY["Idempotency Guard<br/>(txn_id dedup table)"]
            WEBHOOK_INGRESS --> IDEMPOTENCY
        end

        AUTH_MW -->|"validate"| JWT_ISSUER
        PAYMENT_CTRL -->|"STK Push"| DARAJA_CLIENT
        PAYMENT_CTRL -->|"charge"| PAYSTACK_CLIENT
    end

    subgraph PRIVATE_STORAGE["Private Storage Zone — Data Tier"]
        direction TB

        subgraph PG_CLUSTER["PostgreSQL 16 Cluster"]
            PG_PRIMARY["Primary Node<br/>(Read/Write)"]
            PG_REPLICA["Streaming Replica<br/>(Read-Only / HA Failover)"]
            PG_WAL["WAL Archiving<br/>(pg_basebackup +<br/>wal-g to local NAS)"]
            RLS["Row-Level Security<br/>Policies (migrated 1:1<br/>from Supabase)"]
            PG_PRIMARY -->|"streaming replication"| PG_REPLICA
            PG_PRIMARY -->|"WAL segments"| PG_WAL
        end

        subgraph SCHEMAS["Database Schema Layout"]
            S_PUBLIC["public schema<br/>(app tables, views)"]
            S_AUTH["auth schema<br/>(users, refresh_tokens,<br/>sessions, mfa_factors)"]
            S_STORAGE["storage schema<br/>(file metadata,<br/>bucket refs)"]
            S_PAYMENTS["payments schema<br/>(transactions, callbacks,<br/>subscriptions, tiers)"]
        end

        REDIS["Redis 7 (Local)<br/>(Session cache,<br/>rate-limit counters,<br/>pub/sub fan-out)"]
        LOCAL_OBJSTORE["MinIO / Local NFS<br/>(Object Storage —<br/>replaces Supabase Storage)"]
        BACKUP_NAS["Encrypted Backup NAS<br/>(AES-256, on-prem)"]

        PG_WAL -->|"encrypted archive"| BACKUP_NAS
    end

    %% Cross-subgraph connections
    CE_SW -->|"HTTPS POST/GET<br/>(Bearer JWT)"| NGINX
    MA_UI -->|"HTTPS POST/GET<br/>(Bearer JWT)"| NGINX
    WEB_SPA -->|"HTTPS POST/GET<br/>(httpOnly cookie)"| NGINX
    MA_WS -->|"WSS upgrade<br/>(token in handshake)"| NGINX

    NGINX -->|"proxy_pass :3000"| ROUTER
    NGINX -->|"proxy_pass :3001<br/>(ws upgrade)"| WS_SERVER

    ROUTER -->|"SQL queries<br/>(pg / Knex / Drizzle)"| PG_PRIMARY
    REFRESH_STORE -->|"R/W"| PG_PRIMARY
    IDEMPOTENCY -->|"R/W"| PG_PRIMARY
    PG_LISTEN -->|"LISTEN on channels"| PG_PRIMARY
    AUTH_MW -->|"session cache lookup"| REDIS
    WS_SERVER -->|"pub/sub fan-out"| REDIS
    PRODUCT_CTRL -->|"file ops"| LOCAL_OBJSTORE

    DARAJA_CLIENT -->|"HTTPS outbound<br/>(KE-only route)"| SAFARICOM_API["Safaricom Daraja API<br/>(api.safaricom.co.ke)<br/>🇰🇪 Kenya-hosted"]
    PAYSTACK_CLIENT -->|"HTTPS outbound"| PAYSTACK_API["Paystack API<br/>(api.paystack.co)"]
    SAFARICOM_API -->|"callback POST<br/>(IP-whitelisted)"| WEBHOOK_INGRESS
    PAYSTACK_API -->|"webhook POST<br/>(signature verified)"| WEBHOOK_INGRESS

    WEBHOOK_INGRESS -->|"update txn status"| PG_PRIMARY
    WEBHOOK_INGRESS -->|"emit payment.confirmed"| EVENT_BUS

    WS_SERVER -->|"push to Chrome Ext"| CE_SW
    WS_SERVER -->|"push to Mobile"| MA_WS

    classDef clientNode fill:#1a1a2e,stroke:#e94560,color:#eee
    classDef networkNode fill:#0f3460,stroke:#16213e,color:#eee
    classDef computeNode fill:#533483,stroke:#2b2d42,color:#eee
    classDef storageNode fill:#1b4332,stroke:#2d6a4f,color:#eee
    classDef externalNode fill:#7f5539,stroke:#9c6644,color:#eee

    class CE_POPUP,CE_SW,CE_CS,CE_STORAGE,MA_UI,MA_AUTH,MA_SEC,MA_WS,WEB_SPA,WEB_STORE clientNode
    class DNS,NGINX,CORS_ENGINE,RATE_LIMIT,WAF networkNode
    class ROUTER,AUTH_MW,PAYMENT_CTRL,USER_CTRL,PRODUCT_CTRL,SUBSCRIPTION_CTRL,JWT_ISSUER,REFRESH_STORE,BCRYPT,OTP_ENGINE,WS_SERVER,PG_LISTEN,EVENT_BUS,DARAJA_CLIENT,PAYSTACK_CLIENT,WEBHOOK_INGRESS,IDEMPOTENCY computeNode
    class PG_PRIMARY,PG_REPLICA,PG_WAL,RLS,S_PUBLIC,S_AUTH,S_STORAGE,S_PAYMENTS,REDIS,LOCAL_OBJSTORE,BACKUP_NAS storageNode
    class SAFARICOM_API,PAYSTACK_API externalNode
```

---

## 2. M-Pesa STK Push → Realtime Client Notification: Complete Lifecycle

```mermaid
sequenceDiagram
    participant Client as Client (Ext / App)
    participant Nginx as Nginx Proxy
    participant API as Fastify API Gateway
    participant Daraja as Safaricom Daraja API
    participant Webhook as Webhook Ingress Node
    participant PG as PostgreSQL
    participant EventBus as Event Bus
    participant WS as Socket.io Server

    Client->>+Nginx: POST /api/v1/payments/mpesa/initiate<br/>(Bearer JWT, phone, amount, tier)
    Nginx->>+API: proxy_pass → :3000
    API->>API: Validate JWT, extract user_id
    API->>PG: INSERT payments.transactions<br/>(status='pending', idempotency_key)
    API->>+Daraja: POST /mpesa/stkpush/v1/processrequest<br/>(BusinessShortCode, Password,<br/>Timestamp, PhoneNumber, Amount,<br/>CallbackURL=https://api.yourdomain.co.ke<br/>/api/v1/webhooks/mpesa)
    Daraja-->>-API: 200 OK {CheckoutRequestID}
    API->>PG: UPDATE transactions SET<br/>checkout_request_id, status='stk_sent'
    API-->>-Nginx: 202 Accepted {txn_id, checkout_request_id}
    Nginx-->>-Client: 202 Accepted

    Note over Daraja,Webhook: ⏱ User confirms on SIM Toolkit (5–30s)

    Daraja->>+Nginx: POST /api/v1/webhooks/mpesa<br/>(Safaricom callback, IP-whitelisted)
    Nginx->>+Webhook: proxy_pass → :3000
    Webhook->>Webhook: Verify Safaricom IP whitelist<br/>+ validate callback payload structure
    Webhook->>PG: SELECT * FROM payments.transactions<br/>WHERE checkout_request_id = $1
    Webhook->>Webhook: Idempotency check (dedup guard)
    
    alt ResultCode == 0 (Success)
        Webhook->>PG: BEGIN TRANSACTION<br/>UPDATE transactions SET status='confirmed'<br/>UPDATE subscriptions SET tier='premium',<br/>expires_at=NOW()+INTERVAL '30 days'<br/>COMMIT
        Webhook->>EventBus: emit('payment.confirmed',<br/>{user_id, tier, txn_id})
    else ResultCode != 0 (Failed/Cancelled)
        Webhook->>PG: UPDATE transactions<br/>SET status='failed', reason=$1
        Webhook->>EventBus: emit('payment.failed',<br/>{user_id, reason})
    end

    Webhook-->>-Nginx: 200 OK
    Nginx-->>-Daraja: 200 OK

    EventBus->>WS: Broadcast to user_id room
    WS->>Client: WSS push {event: 'subscription.updated',<br/>payload: {tier: 'premium', features: [...]}}
    Client->>Client: Update local state,<br/>unlock premium UI
```

---

## 3. Multi-Client Authentication Flow

```mermaid
sequenceDiagram
    participant User as User
    participant Client as Client (Ext / App / Web)
    participant Nginx as Nginx Proxy
    participant API as Fastify API
    participant Auth as Auth Engine
    participant PG as PostgreSQL (auth schema)
    participant Redis as Redis (session cache)

    User->>Client: Enter credentials (email + password)
    Client->>+Nginx: POST /api/v1/auth/login<br/>{email, password}
    Nginx->>+API: proxy_pass
    API->>+Auth: authenticate(email, password)
    Auth->>PG: SELECT * FROM auth.users<br/>WHERE email = $1
    Auth->>Auth: bcrypt.compare(password, hash)
    
    alt Valid Credentials
        Auth->>Auth: Generate RS256 JWT access_token<br/>(exp: 15min, sub: user_id,<br/>role: user, iss: api.yourdomain.co.ke)
        Auth->>Auth: Generate opaque refresh_token<br/>(crypto.randomBytes(64))
        Auth->>PG: INSERT auth.refresh_tokens<br/>(token_hash, user_id, device_id,<br/>expires_at=NOW()+30days,<br/>ip_address, user_agent)
        Auth->>Redis: SET session:{user_id}:{device_id}<br/>{access_token_jti} EX 900
        Auth-->>-API: {access_token, refresh_token, user}
        API-->>-Nginx: 200 OK + Set-Cookie (web)<br/>or JSON body (ext/mobile)
        Nginx-->>-Client: 200 OK
        
        alt Chrome Extension
            Client->>Client: chrome.storage.session.set<br/>({accessToken}) — memory-only
            Client->>Client: chrome.storage.local.set<br/>({refreshToken}) — encrypted at rest
        else Mobile App
            Client->>Client: Keychain.set(accessToken)<br/>EncryptedSharedPrefs.set(refreshToken)
        else Web
            Client->>Client: httpOnly Secure SameSite=Strict<br/>cookie set by server
        end
    else Invalid Credentials
        Auth-->>API: 401 Unauthorized
        API-->>Nginx: 401
        Nginx-->>Client: 401
    end

    Note over Client,API: ⏱ 15 minutes later — access_token expired

    Client->>+Nginx: POST /api/v1/auth/refresh<br/>{refresh_token}
    Nginx->>+API: proxy_pass
    API->>+Auth: refreshSession(token)
    Auth->>PG: SELECT * FROM auth.refresh_tokens<br/>WHERE token_hash = hash($1)<br/>AND revoked = false<br/>AND expires_at > NOW()
    Auth->>Auth: Rotate: revoke old, issue new pair
    Auth->>PG: UPDATE refresh_tokens SET revoked=true<br/>INSERT new refresh_token row
    Auth-->>-API: {new_access_token, new_refresh_token}
    API-->>-Nginx: 200 OK
    Nginx-->>-Client: 200 OK
    Client->>Client: Overwrite stored tokens
```

---

## 4. Nginx Configuration: CORS, SSL, Proxy

```nginx
# /etc/nginx/sites-enabled/api.yourdomain.co.ke

upstream fastify_api {
    server 127.0.0.1:3000;
    keepalive 64;
}

upstream websocket_server {
    server 127.0.0.1:3001;
}

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api_general:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=auth_endpoints:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=webhook_zone:10m rate=10r/s;

server {
    listen 443 ssl http2;
    server_name api.yourdomain.co.ke;

    # TLS Configuration — local cert or ACME
    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.co.ke/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.co.ke/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_stapling on;
    ssl_stapling_verify on;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # === CORS Configuration ===
    # Allowed origins: Chrome Extension, Mobile deep-link, Web companion
    set $cors_origin "";
    if ($http_origin ~* "^chrome-extension://[a-z]{32}$") {
        set $cors_origin $http_origin;
    }
    if ($http_origin ~* "^https://(app|www)\.yourdomain\.co\.ke$") {
        set $cors_origin $http_origin;
    }
    # Capacitor/Ionic mobile origins
    if ($http_origin ~* "^capacitor://localhost$") {
        set $cors_origin $http_origin;
    }

    add_header Access-Control-Allow-Origin $cors_origin always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Request-ID, X-Device-ID" always;
    add_header Access-Control-Allow-Credentials "true" always;
    add_header Access-Control-Max-Age 86400 always;

    # Preflight
    if ($request_method = OPTIONS) {
        return 204;
    }

    # === API Routes ===
    location /api/ {
        limit_req zone=api_general burst=50 nodelay;
        proxy_pass http://fastify_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
    }

    # Auth endpoints — stricter rate limit
    location /api/v1/auth/ {
        limit_req zone=auth_endpoints burst=10 nodelay;
        proxy_pass http://fastify_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Webhook endpoints — Safaricom IP whitelist
    location /api/v1/webhooks/mpesa {
        limit_req zone=webhook_zone burst=20 nodelay;
        # Safaricom production IP ranges (verify with Safaricom docs)
        allow 196.201.214.0/24;
        allow 196.201.213.0/24;
        deny all;
        proxy_pass http://fastify_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket upgrade
    location /socket.io/ {
        proxy_pass http://websocket_server;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name api.yourdomain.co.ke;
    return 301 https://$host$request_uri;
}
```

---

## 5. Migration Execution Steps

### Phase 0: Pre-Migration Audit & Environment Provisioning

- **Inventory Supabase surface area**: Enumerate all tables, views, functions, triggers, RLS policies, storage buckets, Edge Functions, and Auth providers in use. Export the full schema with:
  ```bash
  # From a machine with psql access to Supabase's direct connection string
  pg_dump --schema-only --no-owner --no-acl \
    -d "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
    > supabase_schema_full.sql
  ```
- **Inventory client SDK calls**: Grep the Chrome Extension and Mobile App codebases for every `supabase.` call. Categorize into: `auth.*`, `from('table').*`, `rpc(*)`, `storage.*`, `channel(*)`, `realtime.*`. This produces your **API surface contract** — every call here becomes a Fastify route.
- **Provision Kenyan DC**: Procure bare-metal or VM at target facility (Servercore NBO1 / Angani / Lineserve). Minimum spec: 8 vCPU, 32 GB RAM, 500 GB NVMe SSD, 1 Gbps unmetered link. Install Ubuntu 22.04 LTS or Debian 12.
- **Provision PostgreSQL 16**: Install from official APT repo. Configure `postgresql.conf` with: `wal_level = replica`, `max_wal_senders = 3`, `archive_mode = on`, `ssl = on`. Create database, apply `supabase_schema_full.sql`.
- **Provision Redis 7**: Bind to `127.0.0.1`, set `requirepass`, disable `CONFIG` command remotely.
- **Provision MinIO**: Local object storage to replace Supabase Storage. Configure with TLS, create buckets mirroring Supabase bucket names.

### Phase 1: Database Migration (Zero Data Mutation)

- **Full data export from Supabase**:
  ```bash
  pg_dump --data-only --no-owner --no-acl \
    --exclude-schema=_supabase --exclude-schema=supabase_migrations \
    --exclude-schema=_realtime --exclude-schema=_analytics \
    -d "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
    > supabase_data_full.sql
  ```
- **Migrate the `auth` schema manually**: Supabase's `auth.users` table has Supabase-specific columns (`instance_id`, `aud`, `confirmation_token`, etc.). Create a mapping table:
  - Copy `id` (UUID), `email`, `encrypted_password` (bcrypt hash — directly compatible), `email_confirmed_at`, `created_at`, `updated_at`, `raw_user_meta_data` → into your local `auth.users` table.
  - Discard `instance_id`, `aud`, `confirmation_token`, `recovery_token`, `invite_token` — these are Supabase platform internals with no local equivalent.
  - **Passwords require zero re-hashing**: Supabase uses bcrypt. Your local auth engine using `bcrypt.compare()` will validate existing hashes directly. Users log in with their existing passwords on day one.
- **Restore data into local PostgreSQL**:
  ```bash
  psql -U app_admin -d yourdb -f supabase_data_full.sql
  ```
- **Re-apply RLS policies**: Copy all `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` statements from the schema dump. Adapt the policies to use your JWT claims extraction function:
  ```sql
  -- Supabase used: auth.uid() and auth.jwt()
  -- Replace with a local function that reads from a session variable:
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $$ LANGUAGE sql STABLE;
  ```
  In the Fastify API layer, set this session variable per-request before executing queries:
  ```typescript
  // Per-request: set JWT claims into the PostgreSQL session
  await pool.query("SET LOCAL request.jwt.claim.sub = $1", [decoded.sub]);
  ```
- **Validate data integrity**: Run row counts against Supabase source and local target for every table. Compute checksums on critical tables with:
  ```sql
  SELECT md5(string_agg(t::text, '' ORDER BY id)) FROM public.your_table t;
  ```

### Phase 2: Build the Node.js API Layer (Supabase SDK Replacement)

- **Create a Fastify server with TypeScript** structured as:
  ```
  src/
  ├── server.ts              # Fastify bootstrap, plugin registration
  ├── plugins/
  │   ├── auth.ts            # JWT verification, token issuance
  │   ├── cors.ts            # Runtime CORS (backup to Nginx)
  │   ├── database.ts        # pg Pool, Drizzle ORM or Knex
  │   ├── redis.ts           # ioredis client
  │   ├── websocket.ts       # Socket.io attach
  │   └── storage.ts         # MinIO S3-compatible client
  ├── routes/
  │   ├── auth/
  │   │   ├── login.ts       # POST /api/v1/auth/login
  │   │   ├── register.ts    # POST /api/v1/auth/register
  │   │   ├── refresh.ts     # POST /api/v1/auth/refresh
  │   │   ├── logout.ts      # POST /api/v1/auth/logout
  │   │   └── me.ts          # GET /api/v1/auth/me
  │   ├── payments/
  │   │   ├── mpesa.ts       # POST /api/v1/payments/mpesa/initiate
  │   │   └── paystack.ts    # POST /api/v1/payments/paystack/initiate
  │   ├── webhooks/
  │   │   ├── mpesa.ts       # POST /api/v1/webhooks/mpesa (callback)
  │   │   └── paystack.ts    # POST /api/v1/webhooks/paystack (callback)
  │   └── resources/         # Your app-specific CRUD routes
  │       ├── products.ts
  │       ├── subscriptions.ts
  │       └── ...
  ├── middleware/
  │   ├── authenticate.ts    # preHandler hook: verify JWT
  │   ├── rateLimit.ts       # per-route rate limiting
  │   └── validateBody.ts    # Zod/Typebox schema validation
  ├── services/
  │   ├── authService.ts     # Token generation, refresh rotation
  │   ├── mpesaService.ts    # Daraja API client encapsulation
  │   ├── paystackService.ts
  │   └── realtimeService.ts # pg LISTEN/NOTIFY → Socket.io bridge
  └── lib/
      ├── errors.ts          # Standardized error classes
      ├── logger.ts          # Pino logger
      └── config.ts          # Env-based config (dotenv)
  ```
- **Map every `supabase-js` call to a Fastify route**: This is the critical regression-prevention step:

  | `supabase-js` Client Call | Replacement Fastify Route | Method |
  |---|---|---|
  | `supabase.auth.signInWithPassword()` | `/api/v1/auth/login` | POST |
  | `supabase.auth.signUp()` | `/api/v1/auth/register` | POST |
  | `supabase.auth.signOut()` | `/api/v1/auth/logout` | POST |
  | `supabase.auth.getSession()` | `/api/v1/auth/me` | GET |
  | `supabase.auth.refreshSession()` | `/api/v1/auth/refresh` | POST |
  | `supabase.from('table').select()` | `/api/v1/resources/{table}` | GET |
  | `supabase.from('table').insert()` | `/api/v1/resources/{table}` | POST |
  | `supabase.from('table').update().eq()` | `/api/v1/resources/{table}/:id` | PATCH |
  | `supabase.from('table').delete().eq()` | `/api/v1/resources/{table}/:id` | DELETE |
  | `supabase.rpc('function_name')` | `/api/v1/rpc/{function_name}` | POST |
  | `supabase.storage.from('bucket').upload()` | `/api/v1/storage/{bucket}/upload` | POST |
  | `supabase.storage.from('bucket').getPublicUrl()` | `/api/v1/storage/{bucket}/:path` | GET |
  | `supabase.channel('room').on()` | `socket.io client → subscribe('room')` | WSS |

### Phase 3: Client-Side SDK Swap (Minimal State Machine Regression)

- **Create a thin API client module** to replace `supabase-js`. This is the single abstraction layer that both the Chrome Extension and Mobile App import:

  ```typescript
  // src/lib/apiClient.ts — drop-in replacement for supabase-js
  
  const BASE_URL = 'https://api.yourdomain.co.ke/api/v1';
  
  class ApiClient {
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
  
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(this.accessToken && { Authorization: `Bearer ${this.accessToken}` }),
      };
      const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
      if (res.status === 401) {
        await this.refresh();
        // Retry once with new token
        headers.Authorization = `Bearer ${this.accessToken}`;
        const retry = await fetch(`${BASE_URL}${path}`, { ...options, headers });
        return retry.json();
      }
      if (!res.ok) throw new ApiError(res.status, await res.json());
      return res.json();
    }
  
    // Auth methods — direct replacements
    auth = {
      signIn: (email: string, password: string) =>
        this.request('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        }),
      signUp: (email: string, password: string) =>
        this.request('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        }),
      signOut: () => this.request('/auth/logout', { method: 'POST' }),
      getSession: () => this.request('/auth/me'),
      refresh: () => this.refresh(),
    };
  
    // Data methods — direct replacements for supabase.from()
    from(table: string) {
      return new QueryBuilder(this, table);
    }
  
    // RPC — direct replacement for supabase.rpc()
    rpc(functionName: string, params?: Record<string, unknown>) {
      return this.request(`/rpc/${functionName}`, {
        method: 'POST',
        body: JSON.stringify(params ?? {}),
      });
    }
  
    private async refresh(): Promise<void> {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });
      const data = await res.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      // Persist to platform-specific storage (injected via constructor)
      await this.storage.setTokens(data.access_token, data.refresh_token);
    }
  }
  ```

- **Chrome Extension token lifecycle**:
  - `accessToken` → `chrome.storage.session` (memory-only, survives service worker restarts within a session, cleared on browser close).
  - `refreshToken` → `chrome.storage.local` (persisted, encrypted at rest by Chrome).
  - On service worker wake: check `chrome.storage.session` for `accessToken`. If absent, read `refreshToken` from `chrome.storage.local` and call `/auth/refresh`. This is a **3-line change** from the Supabase `onAuthStateChange` listener.

- **Mobile App token lifecycle**:
  - iOS: `accessToken` + `refreshToken` → Keychain Services (hardware-backed encryption).
  - Android: `refreshToken` → `EncryptedSharedPreferences` (AES-256-SIV). `accessToken` → in-memory state (Zustand/Riverpod).
  - On app cold start: read `refreshToken` from secure storage → call `/auth/refresh` → populate in-memory access token. Identical to how the Supabase client's `autoRefreshToken` worked, but now explicit.

- **Find-and-replace strategy for client code**:
  ```diff
  // BEFORE (supabase-js)
  - import { supabase } from './supabaseClient';
  - const { data, error } = await supabase.from('products').select('*');
  - const { data: { session } } = await supabase.auth.getSession();
  
  // AFTER (local API client)
  + import { api } from './apiClient';
  + const data = await api.from('products').select('*');
  + const session = await api.auth.getSession();
  ```
  The `QueryBuilder` class in the API client mirrors the Supabase fluent query builder interface (`.select()`, `.eq()`, `.order()`, `.limit()`, `.single()`), translating them into query parameters sent to the Fastify REST routes. **The client-side state machine (Zustand stores, React Query cache keys, Redux slices) does not change** — only the import path and the underlying transport.

### Phase 4: Realtime Migration (Supabase Channels → Socket.io + pg LISTEN/NOTIFY)

- **Server-side**: In PostgreSQL, create triggers on tables that previously used Supabase Realtime:
  ```sql
  CREATE OR REPLACE FUNCTION notify_table_change() RETURNS trigger AS $$
  BEGIN
    PERFORM pg_notify(
      'table_changes',
      json_build_object(
        'table', TG_TABLE_NAME,
        'op', TG_OP,
        'row', CASE WHEN TG_OP = 'DELETE' THEN row_to_json(OLD) ELSE row_to_json(NEW) END,
        'timestamp', now()
      )::text
    );
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  
  -- Apply to each table that had Realtime enabled in Supabase
  CREATE TRIGGER products_change_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.products
    FOR EACH ROW EXECUTE FUNCTION notify_table_change();
  ```
- **Server-side bridge** (Fastify `realtimeService.ts`):
  ```typescript
  import { Client } from 'pg';
  import { Server as SocketServer } from 'socket.io';
  
  export function startRealtimeBridge(io: SocketServer) {
    const listener = new Client({ connectionString: process.env.DATABASE_URL });
    listener.connect();
    listener.query('LISTEN table_changes');
  
    listener.on('notification', (msg) => {
      const payload = JSON.parse(msg.payload!);
      // Emit to room named after the table — mirrors Supabase channel names
      io.to(`table:${payload.table}`).emit('db_change', payload);
    });
  }
  ```
- **Client-side replacement**:
  ```diff
  // BEFORE
  - supabase.channel('products')
  -   .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, handler)
  -   .subscribe();
  
  // AFTER
  + import { io } from 'socket.io-client';
  + const socket = io('wss://api.yourdomain.co.ke', { auth: { token: accessToken } });
  + socket.emit('subscribe', { room: 'table:products' });
  + socket.on('db_change', handler);  // handler signature unchanged
  ```

### Phase 5: Payment Integration Wiring

- **Daraja API setup**: Register app at [developer.safaricom.co.ke](https://developer.safaricom.co.ke). Obtain Consumer Key/Secret for sandbox, then production. Set callback URL to `https://api.yourdomain.co.ke/api/v1/webhooks/mpesa`.
- **Idempotency table**:
  ```sql
  CREATE TABLE payments.idempotency_keys (
    key TEXT PRIMARY KEY,
    checkout_request_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    response JSONB
  );
  ```
- **Paystack setup**: Set webhook URL to `https://api.yourdomain.co.ke/api/v1/webhooks/paystack`. Verify every webhook with HMAC-SHA512 signature against your Paystack secret key.
- **Both webhook handlers** must:
  1. Validate origin (IP whitelist for M-Pesa, signature for Paystack).
  2. Check idempotency (reject duplicate `CheckoutRequestID` / `reference`).
  3. Wrap transaction status update + subscription tier change in a single PostgreSQL transaction.
  4. Emit event to the realtime bus on success/failure.
  5. Return `200 OK` to the payment provider within 5 seconds (Safaricom timeout).

### Phase 6: Security Hardening & DPA 2019 Compliance

- **Encryption at rest**: Enable PostgreSQL TDE or use LUKS full-disk encryption on the data volume. MinIO: enable server-side encryption (SSE-S3 with local KMS).
- **Encryption in transit**: TLS 1.2+ everywhere — Nginx ↔ clients, Nginx ↔ Fastify (if not on loopback), Fastify ↔ PostgreSQL (`sslmode=verify-full`), Fastify ↔ Redis (TLS tunnel or stunnel).
- **Audit logging**: Log every auth event, data access, and payment transaction to a separate `audit.logs` table with: `timestamp`, `user_id`, `action`, `resource`, `ip_address`, `user_agent`, `request_id`. This satisfies DPA 2019 Section 41 (data processing records).
- **Data Subject Rights API**: Build endpoints for:
  - `GET /api/v1/privacy/export` — full data export per DPA 2019 Section 26(e).
  - `DELETE /api/v1/privacy/delete-account` — right to erasure per DPA 2019 Section 26(d).
  - `GET /api/v1/privacy/consent-log` — consent records per DPA 2019 Section 32.
- **Firewall**: `ufw` or `iptables` — allow only ports 80, 443, 22 (key-only SSH). PostgreSQL (5432), Redis (6379), MinIO (9000) listen only on `127.0.0.1`.
- **No egress to foreign telemetry**: Audit all outbound connections. Block all egress except: Safaricom API IPs, Paystack API IPs, ACME CA for cert renewal. Use `iptables` OUTPUT chain or a transparent proxy to enforce.
- **Backup**: `wal-g` continuous archiving to encrypted local NAS. Daily `pg_basebackup` to a second physical disk or secondary cabinet within the same DC. Test restore monthly.

### Phase 7: Cutover & Rollback Strategy

- **Blue-green deployment**: Run the new stack in parallel with Supabase for ≥7 days. Client apps ship with a **feature flag** (`USE_LOCAL_API = true/false`) controlling which backend they target.
- **DNS cutover**: Switch `api.yourdomain.co.ke` from Supabase to the Kenyan DC IP. TTL should be lowered to 60s 24 hours before cutover.
- **Rollback trigger**: If error rate exceeds 2% or p99 latency exceeds 500ms within the first 48 hours post-cutover, flip the feature flag back to Supabase. Data written to the local DB during the window is reconciled via a sync script.
- **Supabase decommission**: After 30 days of stable local operation with zero Supabase traffic, export a final backup, delete all data from Supabase, and terminate the project. This completes the sovereign data migration.

---

> [!CAUTION]
> **Before decommissioning Supabase**, verify that the ODPC (Office of the Data Protection Commissioner, Kenya) registration is complete for your local data processing operations. DPA 2019 Section 18 requires registration of data controllers processing personal data.
