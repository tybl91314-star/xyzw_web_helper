param(
    [string]$UpstreamRemote = "upstream",
    [string]$UpstreamBranch = "main",
    [switch]$SkipFetch
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..")).Path
$baselineFile = Join-Path $repositoryRoot ".upstream-baseline"

if (-not (Test-Path -LiteralPath $baselineFile)) {
    throw "Missing upstream baseline file: $baselineFile"
}

$baseline = (Get-Content -LiteralPath $baselineFile -Raw).Trim()
$upstreamRef = "$UpstreamRemote/$UpstreamBranch"

Push-Location $repositoryRoot
try {
    if (-not $SkipFetch) {
        git fetch $UpstreamRemote --prune
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to fetch $UpstreamRemote"
        }
    }

    git cat-file -e "$baseline^{commit}"
    if ($LASTEXITCODE -ne 0) {
        throw "Recorded baseline commit does not exist locally: $baseline"
    }

    $latest = (git rev-parse $upstreamRef).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to resolve $upstreamRef"
    }

    $range = "$baseline..$latest"
    $commitCount = (git rev-list --count $range).Trim()
    $mainlineCount = (git rev-list --first-parent --count $range).Trim()

    Write-Host "Recorded baseline : $baseline"
    Write-Host "Latest upstream   : $latest"
    Write-Host "All new commits   : $commitCount"
    Write-Host "Mainline updates  : $mainlineCount"

    if ($baseline -eq $latest) {
        Write-Host "`nUpstream has no updates after the recorded baseline."
        exit 0
    }

    Write-Host "`nMainline update history:"
    git log --first-parent --date=short --pretty=format:"%h %ad %s" $range

    Write-Host "`n`nComplete commit history:"
    git log --date=short --pretty=format:"%h %ad %s" $range

    Write-Host "`n`nChanged-file summary:"
    git diff --stat $baseline $latest
}
finally {
    Pop-Location
}
