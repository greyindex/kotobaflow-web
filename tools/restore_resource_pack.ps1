[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({
      if (-not (Test-Path -LiteralPath $_ -PathType Container)) {
        throw "Pack root does not exist: $_"
      }
      $true
    })]
  [string]$PackRoot,

  [ValidateSet('runtime', 'archive', 'model', 'all')]
  [string]$Pack = 'runtime',

  [string]$DestinationRoot = (Join-Path $PSScriptRoot '..')
)

$ErrorActionPreference = 'Stop'

$resolvedPackRoot = (Resolve-Path -LiteralPath $PackRoot).Path
$resolvedDestinationRoot = (Resolve-Path -LiteralPath $DestinationRoot).Path

if (-not (Test-Path -LiteralPath (Join-Path $resolvedDestinationRoot 'package.json') -PathType Leaf)) {
  throw "DestinationRoot is not the project root: $resolvedDestinationRoot"
}
if (-not (Test-Path -LiteralPath (Join-Path $resolvedDestinationRoot 'tools/resource_audit.js') -PathType Leaf)) {
  throw "DestinationRoot is missing tools/resource_audit.js: $resolvedDestinationRoot"
}
if ($resolvedPackRoot -eq $resolvedDestinationRoot) {
  throw 'PackRoot and DestinationRoot must be different directories.'
}

$pathsByPack = @{
  runtime = @(
    'data/gcloud_chirp3_vocab12528_female_aoede_v1',
    'data/gcloud_chirp3_vocab6127_female_aoede_v1',
    'data/gcloud_chirp3_dialogue_sections_v1',
    'data/qwen_reading_sections_manual_clean132_context_punctpause_v1',
    'data/gcloud_chirp3_vocab12000_female_aoede_v1_source_manifest.jsonl',
    'data/gcloud_chirp3_vocab12528_female_aoede_v1_source_manifest.jsonl'
  )
  archive = @(
    'data/gcloud_chirp3_vocab6127_male_charon_v1',
    'data/qwen_reading_sections_manual_clean132_context_v1'
  )
  model = @('local/tts/qwen')
}

$selectedPacks = if ($Pack -eq 'all') { @('runtime', 'archive', 'model') } else { @($Pack) }
$selectedPaths = foreach ($selectedPack in $selectedPacks) { $pathsByPack[$selectedPack] }
$restoredAny = $false

foreach ($relativePath in $selectedPaths) {
  $sourcePath = Join-Path $resolvedPackRoot ($relativePath -replace '/', '\')
  $destinationPath = Join-Path $resolvedDestinationRoot ($relativePath -replace '/', '\')
  if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Missing $selectedPack resource in pack root: $relativePath"
  }
  $destinationParent = Split-Path -Parent $destinationPath
  if (-not (Test-Path -LiteralPath $destinationParent)) {
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
  }
  if ($PSCmdlet.ShouldProcess($destinationPath, "Restore $relativePath")) {
    if (Test-Path -LiteralPath $sourcePath -PathType Container) {
      New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
      Get-ChildItem -LiteralPath $sourcePath -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Recurse -Force
      }
    } else {
      Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }
    $restoredAny = $true
  }
}

if ($WhatIfPreference -or -not $restoredAny) {
  Write-Host 'Preview only; no resource files were copied.'
  exit 0
}

$validationArguments = @('run', 'validate:resources', '--')
if ($selectedPacks -contains 'runtime') { $validationArguments += '--include-local-audio' }
if ($selectedPacks -contains 'archive') { $validationArguments += '--include-archive' }
if ($selectedPacks -contains 'model') { $validationArguments += '--include-models' }

Push-Location $resolvedDestinationRoot
try {
  & npm @validationArguments
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Host 'Resource pack restored and validated.'
