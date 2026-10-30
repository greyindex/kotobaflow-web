$ErrorActionPreference = 'Stop'

$nodeScript = Join-Path $PSScriptRoot 'generate_gemini_application_audio.cjs'
$hadExistingKey = -not [string]::IsNullOrWhiteSpace($env:GEMINI_API_KEY)
$secureKey = $null
$keyPointer = [IntPtr]::Zero
$plainKey = $null
$exitCode = 1

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

    node $nodeScript --rate-per-minute 4
    $exitCode = $LASTEXITCODE
}
catch {
    Write-Error $_
    $exitCode = 1
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

exit $exitCode
