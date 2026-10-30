param(
    [string]$FfmpegPath = '',
    [ValidateRange(1, 32)]
    [int]$ThrottleLimit = 12,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot

if (-not $FfmpegPath) {
    $ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($ffmpegCommand) {
        $FfmpegPath = $ffmpegCommand.Source
    }
}

if (-not $FfmpegPath -or -not (Test-Path -LiteralPath $FfmpegPath -PathType Leaf)) {
    throw 'FFmpeg was not found. Pass -FfmpegPath with an absolute path to ffmpeg.exe.'
}

$resourceSets = @(
    @{
        Label = 'main vocabulary'
        Root = 'data/gcloud_chirp3_vocab12528_female_aoede_v1'
        Filter = '*.wav'
    },
    @{
        Label = 'textbook vocabulary'
        Root = 'data/gcloud_chirp3_vocab6127_female_aoede_v1'
        Filter = '*.wav'
    },
    @{
        Label = 'textbook dialogue finals'
        Root = 'data/gemini38_flash_tts_dialogue_sections_candidate_v1'
        Filter = '*_dialogue.wav'
    },
    @{
        Label = 'textbook reading finals'
        Root = 'data/gemini38_flash_tts_reading_sections_candidate_v1'
        Filter = '*_reading.wav'
    }
)

$jobs = [System.Collections.Generic.List[object]]::new()
$expectedBySet = @{}

foreach ($resourceSet in $resourceSets) {
    $sourceRoot = Join-Path $repositoryRoot $resourceSet.Root
    if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
        throw "Missing source audio directory: $sourceRoot"
    }

    $sourceFiles = @(Get-ChildItem -LiteralPath $sourceRoot -Filter $resourceSet.Filter -File -Recurse)
    $expectedBySet[$resourceSet.Label] = $sourceFiles.Count

    foreach ($sourceFile in $sourceFiles) {
        $outputPath = [System.IO.Path]::ChangeExtension($sourceFile.FullName, '.ogg')
        if (-not $Force -and (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
            continue
        }

        $jobs.Add([pscustomobject]@{
            Label = $resourceSet.Label
            Input = $sourceFile.FullName
            Output = $outputPath
        })
    }
}

Write-Host "Encoding $($jobs.Count) files with $ThrottleLimit workers..."

$jobs | ForEach-Object -Parallel {
    $job = $_
    & $using:FfmpegPath `
        -y `
        -hide_banner `
        -loglevel error `
        -i $job.Input `
        -map_metadata -1 `
        -vn `
        -ac 1 `
        -ar 24000 `
        -c:a libopus `
        -b:a 20k `
        -vbr on `
        -compression_level 10 `
        -application voip `
        -frame_duration 60 `
        $job.Output

    if ($LASTEXITCODE -ne 0) {
        throw "FFmpeg failed for $($job.Input)"
    }
} -ThrottleLimit $ThrottleLimit

$results = foreach ($resourceSet in $resourceSets) {
    $sourceRoot = Join-Path $repositoryRoot $resourceSet.Root
    $outputs = @(Get-ChildItem -LiteralPath $sourceRoot -Filter ([System.IO.Path]::ChangeExtension($resourceSet.Filter, '.ogg')) -File -Recurse)
    $emptyOutputs = @($outputs | Where-Object Length -le 0)
    $expected = $expectedBySet[$resourceSet.Label]

    if ($outputs.Count -ne $expected -or $emptyOutputs.Count -ne 0) {
        throw "$($resourceSet.Label): expected $expected non-empty Ogg files, found $($outputs.Count), empty $($emptyOutputs.Count)"
    }

    [pscustomobject]@{
        Resource = $resourceSet.Label
        Files = $outputs.Count
        Bytes = ($outputs | Measure-Object Length -Sum).Sum
    }
}

$results | Format-Table -AutoSize
Write-Host 'Web audio build complete. WAV masters were not modified.'
