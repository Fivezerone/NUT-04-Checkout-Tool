pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "NutriScore-Android"

// Core Infrastructure & Primitives Modules
include(":core:model")
include(":core:designsystem")
include(":core:database")
include(":core:network")
include(":core:datastore")

// Feature Modules
include(":feature:cart")
include(":feature:search")
include(":feature:settings")

// Main App Shell
include(":app")
