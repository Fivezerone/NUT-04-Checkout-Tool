#Requires -Version 5.1
<#
.SYNOPSIS
    PowerShell wrapper for Docker-based NUT-04 operations.
.DESCRIPTION
    Wraps docker compose and docker buildx commands so Windows users
    get the same verbs as bin/nut (POSIX).
.PARAMETER Verb
    up | down | ci | extension | e2e | db-reset | logs | shell
.EXAMPLE
    bin\nut.ps1 up
    bin\nut.ps1 ci
    bin\nut.ps1 shell toolchain
#>
param(
    [Parameter(Position = 0)]
    [string]$Verb = 'help',

    [Parameter(Position = 1, ValueFromRemainingArguments)]
    [string[]]$ExtraArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepoRoot

try {
    switch ($Verb) {
        'up' {
            docker compose --profile dev up --build @ExtraArgs
        }
        'down' {
            docker compose --profile dev down @ExtraArgs
        }
        'ci' {
            docker compose --profile ci run --rm ci @ExtraArgs
        }
        'extension' {
            $destArg = "type=local,dest=./dist/extension"
            docker buildx build --target extension-artifact --output $destArg @ExtraArgs .
        }
        'e2e' {
            docker compose --profile e2e run --rm e2e @ExtraArgs
        }
        'db-reset' {
            docker compose --profile dev run --rm migrate down
            docker compose --profile dev run --rm migrate up
        }
        'logs' {
            docker compose --profile dev logs -f @ExtraArgs
        }
        'shell' {
            $svc = if ($ExtraArgs.Count -gt 0) { $ExtraArgs[0] } else { 'toolchain' }
            $rest = if ($ExtraArgs.Count -gt 1) { $ExtraArgs[1..($ExtraArgs.Count-1)] } else { @() }
            docker compose --profile dev run --rm $svc bash @rest
        }
        default {
            Write-Host "Usage: bin\nut.ps1 <verb>" -ForegroundColor Cyan
            Write-Host "Verbs:"
            Write-Host "  up          Start dev stack"
            Write-Host "  down        Stop dev stack"
            Write-Host "  ci          Run all CI gates"
            Write-Host "  extension   Build the Chrome extension"
            Write-Host "  e2e         Run Playwright e2e suite"
            Write-Host "  db-reset    Drop and re-apply migrations"
            Write-Host "  logs        Tail service logs"
            Write-Host "  shell [svc] Open a shell in a service (default: toolchain)"
        }
    }
} finally {
    Pop-Location
}

