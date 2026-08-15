param(
    [ValidateSet("Watch", "Once", "Test", "DryRun")]
    [string]$Mode = "Watch",
    [int]$IntervalSeconds = 30,
    [string]$PublicUrl = "",
    [switch]$SkipInitialPublish
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$websiteRoot = Join-Path $root "website"
# This package is the single canonical source.  Do not publish from an
# external checkout: it can omit new projects and make Vercel stale.
$canonicalRoot = $root
$env:PIH_SOURCE_ROOT = $canonicalRoot
$generatorPath = Join-Path $PSScriptRoot "generate_nextjs_website_data.py"
$validatorPath = Join-Path $PSScriptRoot "validate_streamlit_vercel_pipeline.py"
$chartPayloadPath = Join-Path $PSScriptRoot "project_chart_payloads.py"
$reportArtifactsPath = Join-Path $PSScriptRoot "project_report_artifacts.py"
$chartCatalogPath = Join-Path $root "config\chart_catalog.json"
$githubSyncPath = Join-Path $PSScriptRoot "github_no_git_sync.ps1"
$vercelProjectPath = Join-Path $websiteRoot ".vercel\project.json"
$analyticsPython = Join-Path $root ".venv-analytics\Scripts\python.exe"
$pythonExecutable = "python"
if (Test-Path -LiteralPath $analyticsPython) {
    & $analyticsPython -c "import pandas, numpy, matplotlib, sklearn, spacy" 2>$null
    if ($LASTEXITCODE -eq 0) {
        $pythonExecutable = $analyticsPython
    }
}
$logPath = Join-Path $root "12-logs\vercel_project_pipeline.log"
$statePath = Join-Path $root ".sync_state\vercel_project_pipeline_state.json"
$script:WatchMutex = $null
$script:WatchMutexAcquired = $false
$script:WatchHashCache = @{}
$script:WorkspaceFileWatcher = $null

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath), (Split-Path -Parent $statePath) | Out-Null

foreach ($requiredPath in @($websiteRoot, $generatorPath, $validatorPath, $chartPayloadPath, $reportArtifactsPath, $chartCatalogPath, $githubSyncPath, $vercelProjectPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required pipeline path is missing: $requiredPath"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $canonicalRoot "projects"))) {
    throw "Canonical project source is missing its projects folder: $canonicalRoot"
}

if ($IntervalSeconds -lt 3) {
    $IntervalSeconds = 3
}

if ([string]::IsNullOrWhiteSpace($PublicUrl)) {
    $vercelProject = Get-Content -LiteralPath $vercelProjectPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace([string]$vercelProject.projectName)) {
        throw "Vercel project name is missing from $vercelProjectPath"
    }
    $PublicUrl = "https://$($vercelProject.projectName).vercel.app"
}

function Protect-SensitiveText([string]$Text) {
    $sanitized = $Text -replace 'github_pat_[A-Za-z0-9_]+', '[REDACTED_GITHUB_TOKEN]'
    $sanitized = $sanitized -replace 'gh[pousr]_[A-Za-z0-9_]+', '[REDACTED_GITHUB_TOKEN]'
    return $sanitized -replace 'gsk_[A-Za-z0-9_]+', '[REDACTED_GROQ_KEY]'
}

function Write-PipelineLog([string]$Text) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $(Protect-SensitiveText $Text)"
    Write-Host $line
    Add-Content -LiteralPath $logPath -Value $line
}

if ($pythonExecutable -eq $analyticsPython) {
    Write-PipelineLog "Using the project-local advanced analytics runtime: $analyticsPython"
}
else {
    Write-PipelineLog "Project-local analytics runtime is incomplete; using the validated fallback Python runtime."
}
Write-PipelineLog "Canonical source root: $canonicalRoot"

function Get-RelativePath([string]$FullName) {
    $fullPath = [System.IO.Path]::GetFullPath($FullName)
    $basePath = $root
    $prefix = ""
    if ($canonicalRoot -ne $root -and $fullPath.StartsWith($canonicalRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
        $basePath = $canonicalRoot
        $prefix = "canonical/"
    }
    $rootUri = New-Object System.Uri(($basePath.TrimEnd('\') + '\'))
    $fileUri = New-Object System.Uri($fullPath)
    return $prefix + (([System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($fileUri).ToString())) -replace '\\', '/')
}

function Test-TrackedPath([string]$FullName) {
    # FileSystemWatcher can return an empty path for an overflow/error notification.
    # Reject it safely; the 60-second full scan remains the missed-event fallback.
    if ([string]::IsNullOrWhiteSpace($FullName)) { return $false }
    try {
        $resolved = [System.IO.Path]::GetFullPath($FullName)
    }
    catch {
        return $false
    }
    $workspacePrefix = $canonicalRoot.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $false }
    $relative = Get-RelativePath $resolved
    $lower = $relative.ToLowerInvariant()
    if ($lower -match '(^|/)(\.git|\.next|node_modules|\.vercel|\.venv|\.venv-analytics|venv|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tmp|\.pip-cache|\.pip-tmp|11-outputs|12-logs|backups|\.sync_state|out)(/|$)') { return $false }
    if ($lower -match '^website/public/(data|generated)(/|$)') { return $false }
    if ($lower -match '^website/src/generated(/|$)') { return $false }
    if ($lower -eq 'website/next-env.d.ts') { return $false }
    # The contract knowledge database is regenerated from project-local contracts and evidence.
    # Track those source files, not the derived SQLite write that occurs during generation.
    if ($lower -match '(^|/)05-contracts/contract_claims\.db$') { return $false }
    # Local preview logs and TypeScript build state are generated artifacts, not source changes.
    if ($lower -match '\.(log|tsbuildinfo)$') { return $false }
    $name = [System.IO.Path]::GetFileName($resolved)
    if ($name -like '.env*' -or $name -like '*.token' -or $name -like '*.secret' -or $name -like '*.pem' -or $name -like '*.key') { return $false }
    return $true
}

function Get-WatchedItems {
    $items = New-Object System.Collections.Generic.List[object]
    # Enumerate one directory at a time. Excluded generated folders are never
    # entered, so a three-second poll does not scan node_modules or Python venvs.
    $pending = New-Object System.Collections.Generic.Stack[string]
    $pending.Push($canonicalRoot)
    while ($pending.Count -gt 0) {
        $currentDirectory = $pending.Pop()
        try {
            $children = Get-ChildItem -LiteralPath $currentDirectory -Force -ErrorAction Stop
        }
        catch {
            Write-PipelineLog "Skipped unreadable directory while watching: $(Get-RelativePath $currentDirectory)"
            continue
        }
        foreach ($item in $children) {
            if (-not (Test-TrackedPath $item.FullName)) { continue }
            if ($item.PSIsContainer) {
                # Never follow junctions/symlinks outside the canonical workspace.
                if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
                $items.Add([PSCustomObject]@{ Type = 'D'; FullName = $item.FullName; RelativePath = Get-RelativePath $item.FullName; Length = 0; Modified = $item.LastWriteTimeUtc.Ticks })
                $pending.Push($item.FullName)
            }
            else {
                $items.Add([PSCustomObject]@{ Type = 'F'; FullName = $item.FullName; RelativePath = Get-RelativePath $item.FullName; Length = $item.Length; Modified = $item.LastWriteTimeUtc.Ticks })
            }
        }
    }
    return @($items | Sort-Object Type, RelativePath -Unique)
}

function Get-WatchedFileHash($Item) {
    $cacheKey = [string]$Item.FullName
    $stamp = "$($Item.Length)|$($Item.Modified)"
    $cached = $script:WatchHashCache[$cacheKey]
    if ($null -ne $cached -and $cached.stamp -eq $stamp) {
        return [string]$cached.hash
    }
    try {
        $hash = (Get-FileHash -LiteralPath $Item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    catch {
        # A locked file must remain visible to the watcher rather than being silently ignored.
        $hash = "unreadable:$stamp"
    }
    $script:WatchHashCache[$cacheKey] = @{ stamp = $stamp; hash = $hash }
    return $hash
}

function Get-WatchedSnapshot {
    $snapshot = [ordered]@{}
    Get-WatchedItems | ForEach-Object {
        if ($_.Type -eq 'D') {
            # Directory timestamps change when an unrelated child is touched. Path presence is the useful signal.
            $snapshot[$_.RelativePath] = "D"
            return
        }
        $snapshot[$_.RelativePath] = "F|$(Get-WatchedFileHash $_)"
    }
    return $snapshot
}

function Get-WatchedFingerprint([System.Collections.IDictionary]$Snapshot = $null) {
    if ($null -eq $Snapshot) { $Snapshot = Get-WatchedSnapshot }
    $lines = $Snapshot.Keys | Sort-Object | ForEach-Object { "$_|$($Snapshot[$_])" }
    $content = [System.Text.Encoding]::UTF8.GetBytes([string]::Join("`n", [string[]]$lines))
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return -join ($sha256.ComputeHash($content) | ForEach-Object { $_.ToString('x2') })
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-WatchedChangedPaths(
    [System.Collections.IDictionary]$Before,
    [System.Collections.IDictionary]$After
) {
    $paths = @($Before.Keys) + @($After.Keys) | Sort-Object -Unique
    return @($paths | Where-Object {
        $path = $_
        -not $Before.Contains($path) -or -not $After.Contains($path) -or $Before[$path] -ne $After[$path]
    })
}

function Invoke-PipelineStep(
    [string]$Label,
    [string]$Executable,
    [string[]]$Arguments,
    [string]$WorkingDirectory
) {
    Write-PipelineLog "$Label"
    $outputLines = New-Object System.Collections.Generic.List[string]
    Push-Location $WorkingDirectory
    try {
        $global:LASTEXITCODE = 0
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & $Executable @Arguments 2>&1 | ForEach-Object {
                $line = Protect-SensitiveText ([string]$_)
                $outputLines.Add($line)
                Write-Host $line
                Add-Content -LiteralPath $logPath -Value $line
            }
            $exitCode = $LASTEXITCODE
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }
        if ($exitCode -ne 0) {
            throw "$Label failed with exit code $exitCode."
        }
    }
    finally {
        Pop-Location
    }
    return @($outputLines)
}

function Write-PipelineState([string]$Fingerprint) {
    $state = [ordered]@{
        status = "PASS"
        updated_at = (Get-Date).ToUniversalTime().ToString("o")
        public_url = $PublicUrl
        source_fingerprint = $Fingerprint
        mode = $Mode
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8
}

function New-WorkspaceFileWatcher {
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $canonicalRoot
    $watcher.IncludeSubdirectories = $true
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::DirectoryName -bor [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Size
    $watcher.InternalBufferSize = 65536
    $watcher.EnableRaisingEvents = $true
    return $watcher
}

function Test-WatcherDetection {
    $before = Get-WatchedFingerprint
    $probeDirectory = Join-Path $canonicalRoot "_pipeline_watcher_probe"
    $probeFile = Join-Path $probeDirectory "probe.txt"
    try {
        New-Item -ItemType Directory -Force -Path $probeDirectory | Out-Null
        [System.IO.File]::WriteAllText($probeFile, "Pipeline watcher probe $(Get-Date -Format o)", [System.Text.UTF8Encoding]::new($false))
        $added = Get-WatchedFingerprint
        if ($before -eq $added) {
            throw "Pipeline watcher did not detect a new root-level folder and file."
        }
        [System.IO.File]::AppendAllText($probeFile, "`nchanged", [System.Text.UTF8Encoding]::new($false))
        $edited = Get-WatchedFingerprint
        if ($added -eq $edited) {
            throw "Pipeline watcher did not detect an in-file content change."
        }
    }
    finally {
        if (Test-Path -LiteralPath $probeDirectory) {
            $beforeDeletion = Get-WatchedFingerprint
            Remove-Item -LiteralPath $probeDirectory -Recurse -Force
            $afterDeletion = Get-WatchedFingerprint
            if ($beforeDeletion -eq $afterDeletion) {
                throw "Pipeline watcher did not detect removal of a root-level folder and file."
            }
        }
    }
    $after = Get-WatchedFingerprint
    if ($before -ne $after) {
        throw "Pipeline watcher probe did not restore the original workspace fingerprint."
    }
    Write-PipelineLog "PASS watcher detection test: root-level file/folder additions, in-file edits, and deletions are detected."
}

function Invoke-PublishPipeline {
    param(
        [int]$StabilityAttempt = 1
    )
    $watchSnapshotBefore = Get-WatchedSnapshot
    $fingerprintBefore = Get-WatchedFingerprint -Snapshot $watchSnapshotBefore
    [void](Invoke-PipelineStep "Generating project-scoped Next.js data" $pythonExecutable @($generatorPath) $root)
    [void](Invoke-PipelineStep "Validating Streamlit to Next.js source parity" $pythonExecutable @($validatorPath) $root)
    [void](Invoke-PipelineStep "Building Next.js production application" "npm.cmd" @("run", "build") $websiteRoot)
    [void](Invoke-PipelineStep "Publishing validated workspace changes to GitHub without Git CLI" "powershell.exe" @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $githubSyncPath,
        "-Mode", "Once", "-IntervalSeconds", [string]$IntervalSeconds,
        "-Message", "Publish validated Next.js project pipeline"
    ) $root)
    # GitHub is the sole deployment trigger.  Vercel is connected to the main
    # branch and deploys the pushed commit itself.  Do not run Vercel CLI here:
    # a second deployment path can race the GitHub deployment or publish a stale
    # local working tree.
    Write-PipelineLog "GitHub publish complete. Waiting for the GitHub-connected Vercel deployment."

    $verified = $false
    for ($attempt = 1; $attempt -le 8; $attempt++) {
        try {
            [void](Invoke-PipelineStep "Verifying GitHub-triggered Vercel deployment (attempt $attempt of 8)" $pythonExecutable @($validatorPath, "--public-url", $PublicUrl) $root)
            $verified = $true
            break
        }
        catch {
            if ($attempt -eq 8) { throw }
            Write-PipelineLog "GitHub-triggered Vercel deployment is still propagating. Retrying in 10 seconds."
            Start-Sleep -Seconds 10
        }
    }
    if (-not $verified) {
        throw "Public Vercel verification did not complete."
    }

    $watchSnapshotAfter = Get-WatchedSnapshot
    $fingerprintAfter = Get-WatchedFingerprint -Snapshot $watchSnapshotAfter
    if ($fingerprintBefore -ne $fingerprintAfter) {
        $changedPaths = Get-WatchedChangedPaths -Before $watchSnapshotBefore -After $watchSnapshotAfter
        $displayPaths = @($changedPaths | Select-Object -First 20)
        Write-PipelineLog "Tracked paths changed during publish: $($displayPaths -join '; ')$(if ($changedPaths.Count -gt $displayPaths.Count) { "; plus $($changedPaths.Count - $displayPaths.Count) more" })"
        if ($StabilityAttempt -lt 2) {
            Write-PipelineLog "Tracked file content changed while the pipeline was running. Re-running one verified stabilization pass."
            return Invoke-PublishPipeline -StabilityAttempt ($StabilityAttempt + 1)
        }
        throw "Tracked file content changed during two consecutive publish passes. Publish again after the source files stop changing."
    }
    Write-PipelineState $fingerprintAfter
    Write-PipelineLog "PASS full local-to-Vercel pipeline. Public URL: $PublicUrl"
    return $fingerprintAfter
}

try {
    switch ($Mode) {
        "DryRun" {
            Test-WatcherDetection
            Write-PipelineLog "DRY RUN: watcher paths, source roots, and public target are configured. No generation, publish, or deployment was run."
            Write-PipelineLog "Target: $PublicUrl"
            exit 0
        }
        "Test" {
            Test-WatcherDetection
            [void](Invoke-PublishPipeline)
            exit 0
        }
        "Once" {
            [void](Invoke-PublishPipeline)
            exit 0
        }
        "Watch" {
            $script:WatchMutex = New-Object System.Threading.Mutex($false, "Local\ProjectIntelligenceHubNextVercelPipeline")
            if (-not $script:WatchMutex.WaitOne(0, $false)) {
                Write-PipelineLog "A Project Intelligence Hub Vercel pipeline watcher is already running."
                exit 0
            }
            $script:WatchMutexAcquired = $true
            $lastFingerprint = Get-WatchedFingerprint
            $stateMatchesWorkspace = $false
            if (Test-Path -LiteralPath $statePath) {
                try {
                    $previousState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
                    $stateMatchesWorkspace = $previousState.status -eq "PASS" -and $previousState.source_fingerprint -eq $lastFingerprint
                }
                catch {
                    $stateMatchesWorkspace = $false
                }
            }
            if ($SkipInitialPublish) {
                Write-PipelineLog "Watcher starting from the current verified workspace state; initial publish skipped."
            }
            elseif ($stateMatchesWorkspace) {
                Write-PipelineLog "Using the last verified deployment state; no unchanged startup rebuild is required."
            }
            else {
                $lastFingerprint = Invoke-PublishPipeline
            }
            $script:WorkspaceFileWatcher = New-WorkspaceFileWatcher
            $lastSafetyScan = [DateTime]::UtcNow
            $safetyScanSeconds = [Math]::Max(3, $IntervalSeconds)
            Write-PipelineLog "Watcher active. Windows events trigger immediately when delivered; a $safetyScanSeconds-second complete pruned source scan guarantees detection if an event is missed."
            while ($true) {
                $change = $script:WorkspaceFileWatcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 1000)
                $publishRequired = $false
                if (-not $change.TimedOut -and (Test-TrackedPath $change.FullPath)) {
                    Write-PipelineLog "Filesystem event detected: $($change.ChangeType) $(Get-RelativePath $change.FullPath)"
                    $publishRequired = $true
                }
                if (-not $publishRequired -and (([DateTime]::UtcNow - $lastSafetyScan).TotalSeconds -ge $safetyScanSeconds)) {
                    $lastSafetyScan = [DateTime]::UtcNow
                    $currentFingerprint = Get-WatchedFingerprint
                    if ($currentFingerprint -ne $lastFingerprint) {
                        Write-PipelineLog "Safety scan detected a tracked source change."
                        $publishRequired = $true
                    }
                }
                if (-not $publishRequired) { continue }
                # Coalesce a save operation that produces several filesystem events.
                Start-Sleep -Milliseconds 750
                try {
                    $lastFingerprint = Invoke-PublishPipeline
                    $lastSafetyScan = [DateTime]::UtcNow
                }
                catch {
                    Write-PipelineLog "Pipeline failed: $($_.Exception.Message)"
                    Write-PipelineLog "The watcher will retry on the next source event or safety scan."
                }
            }
        }
    }
}
catch {
    Write-PipelineLog "Fatal pipeline failure: $($_.Exception.Message)"
    exit 1
}
finally {
    if ($null -ne $script:WorkspaceFileWatcher) {
        $script:WorkspaceFileWatcher.Dispose()
    }
    if ($null -ne $script:WatchMutex) {
        if ($script:WatchMutexAcquired) {
            $script:WatchMutex.ReleaseMutex() | Out-Null
        }
        $script:WatchMutex.Dispose()
    }
}
