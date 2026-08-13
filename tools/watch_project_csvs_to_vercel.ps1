<#
Synchronize the user-owned project CSV folder to this clean publisher checkout,
then validate, generate, commit, and push it to the Vercel production branch.

Vercel cannot read D:\ files directly.  This watcher is the explicit bridge:
CSV save -> controlled Git commit -> Vercel build -> public project payload.
It never pushes when validation or the production build fails.
#>
[CmdletBinding()]
param(
    [string]$SourceProjectsRoot = 'D:\Project Intelligence Hub NextJS\projects',
    [string]$PublisherRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$ProductionBranch = 'main',
    [int]$DebounceSeconds = 8
)

$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath $SourceProjectsRoot).Path
$publisherRoot = (Resolve-Path -LiteralPath $PublisherRoot).Path
$logDirectory = Join-Path $publisherRoot '12-logs'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$logPath = Join-Path $logDirectory 'csv-vercel-sync.log'

function Write-SyncLog([string]$Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $Message"
    Add-Content -LiteralPath $logPath -Value $line
    Write-Host $line
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$Label) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

function Invoke-ProjectPublish {
    Write-SyncLog 'Detected project CSV/project-manifest update. Starting controlled Vercel publish.'
    # Copy only the two explicitly controlled project-input areas plus project
    # identity. Application code, reports, contracts, and unrelated local work
    # remain outside this automatic publish path.
    Get-ChildItem -LiteralPath $sourceRoot -Filter 'project_manifest.json' -Recurse -File | ForEach-Object {
        $sourceProject = $_.Directory
        $relativeProject = $sourceProject.FullName.Substring($sourceRoot.Length).TrimStart('\')
        $targetProject = Join-Path (Join-Path $publisherRoot 'projects') $relativeProject
        New-Item -ItemType Directory -Force -Path $targetProject | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $targetProject 'project_manifest.json') -Force
        foreach ($controlledRelative in @('01-data\import_templates', '02-delay_analysis\unified_tia_csv')) {
            $controlledSource = Join-Path $sourceProject $controlledRelative
            if (Test-Path -LiteralPath $controlledSource) {
                $controlledTarget = Join-Path $targetProject $controlledRelative
                New-Item -ItemType Directory -Force -Path $controlledTarget | Out-Null
                Get-ChildItem -LiteralPath $controlledSource -File -Recurse | ForEach-Object {
                    $relativeFile = $_.FullName.Substring($controlledSource.Length).TrimStart('\')
                    $targetFile = Join-Path $controlledTarget $relativeFile
                    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetFile) | Out-Null
                    Copy-Item -LiteralPath $_.FullName -Destination $targetFile -Force
                }
            }
        }
    }

    Push-Location $publisherRoot
    try {
        Invoke-Checked 'python' @('tools\generate_nextjs_website_data.py') 'Project website data generation'
        Invoke-Checked 'python' @('tools\validate_project_input_minimization_parity.py') 'Project-output parity validation'
        Invoke-Checked 'python' @('tools\validate_streamlit_vercel_pipeline.py') 'Production pipeline validation'
        Invoke-Checked 'npm' @('--prefix', 'website', 'run', 'build') 'Next.js production build'

        & git add -- projects website/public 11-outputs
        if ($LASTEXITCODE -ne 0) { throw 'Git staging failed.' }
        & git diff --cached --quiet
        if ($LASTEXITCODE -eq 0) {
            Write-SyncLog 'No publishable project-data change was produced.'
            return
        }
        if ($LASTEXITCODE -ne 1) { throw 'Unable to determine staged Git changes.' }
        Invoke-Checked 'git' @('commit', '-m', 'chore(data): publish controlled project CSV update') 'Git commit'
        Invoke-Checked 'git' @('push', 'origin', "HEAD:$ProductionBranch") 'Git push to production branch'
        Write-SyncLog "Pushed controlled project update to $ProductionBranch. Vercel deployment has been triggered."
    }
    catch {
        Write-SyncLog "BLOCKED - nothing was pushed: $($_.Exception.Message)"
    }
    finally {
        Pop-Location
    }
}

$watcher = [System.IO.FileSystemWatcher]::new($sourceRoot, '*')
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, LastWrite, Size'
$null = Register-ObjectEvent -InputObject $watcher -EventName Changed -SourceIdentifier 'PIH.CsvChanged'
$null = Register-ObjectEvent -InputObject $watcher -EventName Created -SourceIdentifier 'PIH.CsvCreated'
$null = Register-ObjectEvent -InputObject $watcher -EventName Renamed -SourceIdentifier 'PIH.CsvRenamed'

Write-SyncLog "Watching $sourceRoot. CSV saves and project_manifest.json changes will publish through $publisherRoot."
while ($true) {
    $event = Wait-Event -Timeout 1
    if (-not $event) { continue }
    $fullPath = [string]$event.SourceEventArgs.FullPath
    Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue
    $name = [IO.Path]::GetFileName($fullPath)
    if ([IO.Path]::GetExtension($fullPath).ToLowerInvariant() -ne '.csv' -and $name -ne 'project_manifest.json') { continue }
    Start-Sleep -Seconds $DebounceSeconds
    while ($pending = Get-Event -ErrorAction SilentlyContinue) { Remove-Event -EventIdentifier $pending.EventIdentifier -ErrorAction SilentlyContinue }
    Invoke-ProjectPublish
}
