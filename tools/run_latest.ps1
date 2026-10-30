<#
Serves the most recently committed branch for run.bat.

The branch is checked out (detached) in a dedicated preview worktree next to
the main checkout, "<repo>-preview". The main checkout and every other
worktree are never modified: this script only fetches, reads refs and writes
inside the preview folder. Treat that folder as read-only; each run discards
edits made there.

Local-only folders under data/ (generated audio, ignored by Git) are linked
from the main checkout as junctions, and the main checkout's progress file is
shared, so the preview shows real audio and real learning records. When the
branch's serve.py supports it, the preview runs with --no-service-worker so a
cached older version is cleared instead of shown. Remove the
preview with "git worktree remove --force <repo>-preview", not a recursive
delete, so the junction targets are left alone.

  run.bat                  newest local or origin branch (dependabot excluded)
  run.bat <branch>         a specific branch, tag or commit
  run.bat --here           this folder as-is, the previous behaviour
  Other arguments (--port 8090, --no-browser, ...) are passed to serve.py.
#>
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ArgList)

$ErrorActionPreference = 'Continue'
# A standalone launcher outside the repo runs a copy of this script and names
# the checkout through KOTOBAFLOW_REPO.
$here = if ($env:KOTOBAFLOW_REPO) { $env:KOTOBAFLOW_REPO } else { Split-Path -Parent $PSScriptRoot }
if (-not $ArgList) { $ArgList = @() }

$python = $null
foreach ($candidate in 'py', 'python') {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) { $python = $candidate; break }
}
if (-not $python) {
    Write-Host 'Python 3 not found.'
    Write-Host 'Please install Python or ensure py / python is in PATH.'
    exit 1
}

function Start-Serve([string]$root, [string[]]$extra) {
    Write-Host "Serving $root"
    & $python (Join-Path $root 'serve.py') @extra
    exit $LASTEXITCODE
}

$requested = $null
$serveArgs = @()
$useHere = $false
foreach ($arg in $ArgList) {
    if ($arg -eq '--here') { $useHere = $true }
    elseif (-not $requested -and $serveArgs.Count -eq 0 -and -not $arg.StartsWith('-')) { $requested = $arg }
    else { $serveArgs += $arg }
}
if ($useHere) { Start-Serve $here $serveArgs }

function Fail([string]$message) {
    Write-Host "Could not prepare the newest branch: $message"
    Write-Host 'Serving this folder instead.'
    Start-Serve $here $serveArgs
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git not found' }
$common = git -C $here rev-parse --path-format=absolute --git-common-dir
if ($LASTEXITCODE -or -not $common) { Fail 'not inside a Git repository' }
$repo = Split-Path -Parent ([string]$common).Trim()
$preview = "$repo-preview"

Write-Host 'Fetching origin ...'
git -C $here fetch --quiet --prune origin
if ($LASTEXITCODE) { Write-Host 'Fetch failed; using the branches already on this computer.' }

if ($requested) {
    $ref = $requested
} else {
    $ref = git -C $here for-each-ref --sort=-committerdate --count=1 --format='%(refname:short)' `
        --exclude='refs/remotes/origin/HEAD' --exclude='refs/remotes/origin/dependabot/*' `
        refs/heads refs/remotes/origin
    if ($LASTEXITCODE -or -not $ref) { Fail 'no branch found' }
    $ref = ([string]$ref).Trim()
}
$commit = git -C $here rev-parse --verify --quiet "$ref^{commit}"
if ($LASTEXITCODE -or -not $commit) { Fail "unknown branch or commit '$ref'" }
$commit = ([string]$commit).Trim()
Write-Host ("Newest branch: $ref  (" + (git -C $here log -1 --format='%h, %cr: %s' $commit) + ')')

if (Test-Path -LiteralPath (Join-Path $preview '.git')) {
    git -C $preview checkout --quiet --detach --force $commit
} else {
    git -C $here worktree prune
    git -C $here worktree add --quiet --detach $preview $commit
}
if ($LASTEXITCODE) { Fail "checkout into $preview failed" }

Write-Host 'Syncing large files (Git LFS) ...'
git -C $preview lfs pull
if ($LASTEXITCODE) { git -C $preview lfs checkout }

$mainData = Join-Path $repo 'data'
$previewData = Join-Path $preview 'data'
if ((Test-Path -LiteralPath $mainData) -and (Test-Path -LiteralPath $previewData)) {
    foreach ($dir in Get-ChildItem -LiteralPath $mainData -Directory) {
        $link = Join-Path $previewData $dir.Name
        if (Test-Path -LiteralPath $link) { continue }
        git -C $preview check-ignore -q "data/$($dir.Name)/"
        if ($LASTEXITCODE -ne 0) { continue }
        New-Item -ItemType Junction -Path $link -Target $dir.FullName | Out-Null
    }
}

# A cached service worker would keep showing the previous shell; branches whose
# serve.py knows the preview flag retire it so every run shows this checkout.
if (Select-String -LiteralPath (Join-Path $preview 'serve.py') -SimpleMatch -Quiet 'no-service-worker') {
    $serveArgs = @('--no-service-worker') + $serveArgs
}

$progressChosen =$serveArgs | Where-Object { $_ -like '--progress-file*' -or $_ -eq '--temporary-progress' }
if (-not $progressChosen) {
    $serveArgs = @('--progress-file', (Join-Path $mainData 'user_progress.json')) + $serveArgs
}
Start-Serve $preview $serveArgs
