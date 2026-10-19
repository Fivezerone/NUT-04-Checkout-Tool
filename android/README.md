# NutriScore Kenya - Standalone Native Android Application

Welcome to the standalone native Android application repository for the **NutriScore Kenya** ecosystem (Naivas, Carrefour, Quickmart).

---

## 1. Multi-Module Architecture

This codebase enforces a decoupled, 3-tier modular architecture:

- `:core:model` - Pure Kotlin domain models, NutriScore grade calculation, canonical schemas. Zero Android framework dependencies.
- `:core:designsystem` - Jetpack Compose design tokens, WCAG AAA/AA accessible Grade A–E colors, typography, shapes, and `GradeBadge` primitive.
- `:core:database` - Room ORM (`NutriScoreDatabase`, `CartItemEntity`, `CartDao`) with reactive `Flow` queries.
- `:core:network` - Retrofit 2 + OkHttp 4 client with Brotli/Gzip compression, timeouts, and KotlinX Serialization.
- `:core:datastore` - Jetpack DataStore preferences for reactive medical preset toggles and custom nutrient thresholds.
- `:feature:cart` - Smart Cart hub, sticky analytics dashboard, and quantity controls.
- `:feature:search` - Real-time multi-retailer registry search and category filtering.
- `:feature:settings` - User identity pairing and health profile matrix.
- `:app` - Application entry point, Hilt dependency aggregation, and R8 full mode release packaging.

---

## 2. Phase 1 Implementation Status

- [x] **Multi-Module Gradle Scaffolding**: Gradle Kotlin DSL (`.kts`), Version Catalog (`gradle/libs.versions.toml`), parallel builds, configuration caching.
- [x] **Design Tokens Porting**: WCAG Grade A–E palette matching `src/extension/adapters/grade-colors.js`, Retailer brand colors, launcher mipmap icons.
- [x] **Database Schema & Room ORM**: `CartItemEntity` with composite index `[retailer, product_id]`, reactive `CartDao`, Hilt `DatabaseModule`.
- [x] **API Gateway Integration**: Retrofit `NutriScoreApiService` for search, product details, and live price resolution with Brotli interceptor.
- [x] **DataStore Preferences**: `UserPreferencesDataStore` for medical presets (Diabetes, Hypertension, Renal, Obesity) and custom nutrient thresholds.
- [x] **Unit Test Coverage**: Unit tests for domain models, salt fallback calculations, entity mappings, and network deserialization.

---

## 3. Building and Testing

### Prerequisites

- JDK 17 (Eclipse Temurin or OpenJDK 17)
- Android SDK (API Level 34, Build Tools 34.0.0)

### Running Unit Tests

```bash
./gradlew test
```

To run module-specific unit tests:

```bash
# Core Model Tests (Salt fallback, Grade enums)
./gradlew :core:model:test

# Core Database Tests (Entity-to-Domain mapping)
./gradlew :core:database:test

# Core Network Tests (JSON deserialization)
./gradlew :core:network:test
```

### Assembling APKs

```bash
# Debug APK
./gradlew :app:assembleDebug

# Release APK (R8 Full Mode Enabled)
./gradlew :app:assembleRelease
```
