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
    [string]$PublisherRoot = '',
    [string]$ProductionBranch = 'main',
    [int]$DebounceSeconds = 8
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($PublisherRoot)) {
    $PublisherRoot = Split-Path -Parent $PSScriptRoot
}
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

function Sync-CanonicalInputFolder([string]$SourceProject, [string]$TargetProject, [string]$RelativeFolder) {
    $sourceFolder = Join-Path $SourceProject $RelativeFolder
    $targetFolder = Join-Path $TargetProject $RelativeFolder
    if (-not (Test-Path -LiteralPath $sourceFolder)) { return }
    New-Item -ItemType Directory -Force -Path $targetFolder | Out-Null
    # Remove only retired canonical inputs from the publisher. Project reports,
    # approved controlled TIA packages, and all other project content remain intact.
    Get-ChildItem -LiteralPath $targetFolder -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
        $_.Extension -ieq '.csv' -or $_.Name -in @('payment_projection.json', '.gitkeep')
    } | ForEach-Object {
        $relative = $_.FullName.Substring($targetFolder.Length).TrimStart('\')
        if (-not (Test-Path -LiteralPath (Join-Path $sourceFolder $relative))) {
            Remove-Item -LiteralPath $_.FullName -Force
        }
    }
    Get-ChildItem -LiteralPath $sourceFolder -Recurse -File | Where-Object {
        $_.Extension -ieq '.csv' -or $_.Name -in @('payment_projection.json', '.gitkeep')
    } | ForEach-Object {
        $relative = $_.FullName.Substring($sourceFolder.Length).TrimStart('\')
        $destination = Join-Path $targetFolder $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
    }
}
function Invoke-ProjectPublish {
    Write-SyncLog 'Detected project CSV/project-manifest update. Starting controlled Vercel publish.'
    # Mirror project identity and every project-local CSV. This keeps a new
    # project and any CSV source used by a controlled generator in scope while
    # leaving application code and unrelated documents outside the publisher.
    $stageTargets = @()
    Get-ChildItem -LiteralPath $sourceRoot -Filter 'project_manifest.json' -Recurse -File | ForEach-Object {
        $sourceProject = $_.Directory
        $relativeProject = $sourceProject.FullName.Substring($sourceRoot.Length).TrimStart('\')
        $targetProject = Join-Path (Join-Path $publisherRoot 'projects') $relativeProject
        New-Item -ItemType Directory -Force -Path $targetProject | Out-Null
        foreach ($identityFile in @('project_manifest.json', 'project.json')) {
            $identitySource = Join-Path $sourceProject $identityFile
            if (Test-Path -LiteralPath $identitySource) {
                Copy-Item -LiteralPath $identitySource -Destination (Join-Path $targetProject $identityFile) -Force
            }
        }
        Sync-CanonicalInputFolder $sourceProject $targetProject '01-data\import_templates'
        Sync-CanonicalInputFolder $sourceProject $targetProject '02-delay_analysis\unified_tia_csv'
        $stageTargets += (Join-Path (Join-Path 'projects' $relativeProject) 'project_manifest.json')
        $stageTargets += (Join-Path (Join-Path 'projects' $relativeProject) '01-data\import_templates')
        $stageTargets += (Join-Path (Join-Path 'projects' $relativeProject) '02-delay_analysis\unified_tia_csv')
    }

    Push-Location $publisherRoot
    try {
        Invoke-Checked 'python' @('tools\generate_nextjs_website_data.py') 'Project website data generation'
        Invoke-Checked 'python' @('tools\validate_streamlit_vercel_pipeline.py') 'Production pipeline validation'
        Invoke-Checked 'npm' @('--prefix', 'website', 'run', 'build') 'Next.js production build'

        # Commit only the active canonical inputs and generated public payloads.
        # Never absorb unrelated local reports or documents from this dirty publisher worktree.
        $stageTargets = @($stageTargets | Select-Object -Unique)
        if ($stageTargets.Count -gt 0) {
            & git add -A -- $stageTargets
            if ($LASTEXITCODE -ne 0) { throw 'Canonical project-input staging failed.' }
        }
        & git add -- website/public/data
        if ($LASTEXITCODE -ne 0) { throw 'Public data staging failed.' }
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
$null = Register-ObjectEvent -InputObject $watcher -EventName Deleted -SourceIdentifier 'PIH.CsvDeleted'

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
