$ErrorActionPreference = 'Stop'

$applicationScript = Join-Path $PSScriptRoot 'generate_gemini_application_audio.cjs'
$bodyScript = Join-Path $PSScriptRoot 'generate_gemini38_body_audio.cjs'
$vocabRepairScript = Join-Path $PSScriptRoot 'generate_gemini_vocab_audio_repairs.cjs'
$hadExistingKey = -not [string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)
$secureKey = $null
$keyPointer = [IntPtr]::Zero
$plainKey = $null
$applicationExit = 1
$bodyExit = 1
$vocabRepairExit = 1

try {
    if (-not $hadExistingKey) {
        $secureKey = Read-Host 'Enter your existing Gemini API key (input is hidden)' -AsSecureString
        if ($secureKey.Length -eq 0) {
            throw 'No API key was entered.'
        }
        $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
        $env:GEMINI_API_KEY = $plainKey
    }

    Write-Host 'Resuming remaining application paragraphs at 4 requests/minute.'
    node $applicationScript --rate-per-minute 4
    $applicationExit = $LASTEXITCODE

    Start-Sleep -Seconds 16

    Write-Host 'Resuming remaining body paragraphs at 4 requests/minute.'
    node $bodyScript --rate-per-minute 4 --max-requests-per-day 90
    $bodyExit = $LASTEXITCODE

    Start-Sleep -Seconds 16

    Write-Host 'Generating 20 verified vocabulary pronunciation candidates at 4 requests/minute.'
    node $vocabRepairScript --rate-per-minute 4 --max-requests-per-day 90
    $vocabRepairExit = $LASTEXITCODE

    Write-Host "Application exit code: $applicationExit; body exit code: $bodyExit; vocabulary repair exit code: $vocabRepairExit."
}
catch {
    Write-Error $_
    $applicationExit = 1
}
finally {
    if (-not $hadExistingKey) {
        Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue
    }
    if ($keyPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    if ($secureKey) {
        $secureKey.Dispose()
    }
    $plainKey = $null
}

if ($applicationExit -ne 0 -or $bodyExit -ne 0 -or $vocabRepairExit -ne 0) {
    exit 1
}
exit 0
