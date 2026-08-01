param(
    [ValidateSet("Watch", "Once", "Test", "DryRun")]
    [string]$Mode = "Watch",
    [int]$IntervalSeconds = 30,
    [string]$PublicUrl = ""
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$websiteRoot = Join-Path $root "website"
$canonicalRoot = $root
if (-not [string]::IsNullOrWhiteSpace($env:PIH_SOURCE_ROOT)) {
    $canonicalRoot = (Resolve-Path $env:PIH_SOURCE_ROOT).Path
}
elseif (Test-Path -LiteralPath "D:\one drive data\OneDrive\Documents\Project Intelligence Hub\projects") {
    # Local delivery default. CI and other machines retain the repository copy.
    $canonicalRoot = (Resolve-Path "D:\one drive data\OneDrive\Documents\Project Intelligence Hub").Path
}
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
$script:WatchHashCache = @{}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath), (Split-Path -Parent $statePath) | Out-Null

foreach ($requiredPath in @($websiteRoot, $generatorPath, $validatorPath, $chartPayloadPath, $reportArtifactsPath, $chartCatalogPath, $githubSyncPath, $vercelProjectPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required pipeline path is missing: $requiredPath"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $canonicalRoot "projects"))) {
    throw "Canonical project source is missing its projects folder: $canonicalRoot"
}

if ($IntervalSeconds -lt 10) {
    $IntervalSeconds = 10
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
    $relative = Get-RelativePath $FullName
    $lower = $relative.ToLowerInvariant()
    if ($lower -match '(^|/)(\.git|\.next|node_modules|\.vercel|11-outputs|12-logs|backups|\.sync_state|__pycache__)(/|$)') { return $false }
    if ($lower -match '^website/public/(data|generated)(/|$)') { return $false }
    if ($lower -match '^website/src/generated(/|$)') { return $false }
    if ($lower -eq 'website/next-env.d.ts') { return $false }
    # Local preview logs and TypeScript build state are generated artifacts, not source changes.
    if ($lower -match '\.(log|tsbuildinfo)$') { return $false }
    if ($lower -match '(^|/)(\.env|\.env\.local)$') { return $false }
    return $true
}

function Get-WatchedItems {
    $items = New-Object System.Collections.Generic.List[object]
    $watchRoots = @(
        (Join-Path $canonicalRoot "projects"),
        (Join-Path $canonicalRoot "src"),
        (Join-Path $canonicalRoot "dashboard.py"),
        (Join-Path $websiteRoot "src"),
        (Join-Path $websiteRoot "public"),
        $generatorPath,
        $validatorPath,
        $chartPayloadPath,
        $reportArtifactsPath,
        $chartCatalogPath,
        (Join-Path $PSScriptRoot "pih_data_guardrails.py"),
        $PSCommandPath,
        (Join-Path $root "analytics\requirements-advanced.txt"),
        $githubSyncPath,
        (Join-Path $PSScriptRoot "github_sync_config.json"),
        (Join-Path $websiteRoot "package.json"),
        (Join-Path $websiteRoot "package-lock.json"),
        (Join-Path $websiteRoot "next.config.js"),
        (Join-Path $websiteRoot "vercel.json")
    )

    foreach ($watchRoot in $watchRoots) {
        if (-not (Test-Path -LiteralPath $watchRoot)) { continue }
        $item = Get-Item -LiteralPath $watchRoot
        if ($item.PSIsContainer) {
            foreach ($directory in (Get-ChildItem -LiteralPath $item.FullName -Recurse -Directory -Force -ErrorAction SilentlyContinue)) {
                if (Test-TrackedPath $directory.FullName) {
                    $items.Add([PSCustomObject]@{ Type = 'D'; FullName = $directory.FullName; RelativePath = Get-RelativePath $directory.FullName; Length = 0; Modified = $directory.LastWriteTimeUtc.Ticks })
                }
            }
            foreach ($file in (Get-ChildItem -LiteralPath $item.FullName -Recurse -File -Force -ErrorAction SilentlyContinue)) {
                if (Test-TrackedPath $file.FullName) {
                    $items.Add([PSCustomObject]@{ Type = 'F'; FullName = $file.FullName; RelativePath = Get-RelativePath $file.FullName; Length = $file.Length; Modified = $file.LastWriteTimeUtc.Ticks })
                }
            }
        }
        elseif (Test-TrackedPath $item.FullName) {
            $items.Add([PSCustomObject]@{ Type = 'F'; FullName = $item.FullName; RelativePath = Get-RelativePath $item.FullName; Length = $item.Length; Modified = $item.LastWriteTimeUtc.Ticks })
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

function Get-WatchedFingerprint {
    $lines = Get-WatchedItems | ForEach-Object {
        if ($_.Type -eq 'D') {
            # Directory timestamps change when an unrelated child is touched. Path presence is the useful signal.
            return "D|$($_.RelativePath)"
        }
        return "F|$($_.RelativePath)|$(Get-WatchedFileHash $_)"
    }
    $content = [System.Text.Encoding]::UTF8.GetBytes([string]::Join("`n", [string[]]$lines))
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return -join ($sha256.ComputeHash($content) | ForEach-Object { $_.ToString('x2') })
    }
    finally {
        $sha256.Dispose()
    }
}

function Invoke-PipelineStep(
    [string]$Label,
    [string]$Executable,
    [string[]]$Arguments,
    [string]$WorkingDirectory
) {
    Write-PipelineLog "$Label"
    Push-Location $WorkingDirectory
    try {
        $global:LASTEXITCODE = 0
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & $Executable @Arguments 2>&1 | ForEach-Object {
                $line = Protect-SensitiveText ([string]$_)
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

function Test-WatcherDetection {
    $before = Get-WatchedFingerprint
    $probeDirectory = Join-Path $canonicalRoot "projects\_pipeline_watcher_probe"
    $probeFile = Join-Path $probeDirectory "probe.txt"
    try {
        New-Item -ItemType Directory -Force -Path $probeDirectory | Out-Null
        [System.IO.File]::WriteAllText($probeFile, "Pipeline watcher probe $(Get-Date -Format o)", [System.Text.UTF8Encoding]::new($false))
        $during = Get-WatchedFingerprint
        if ($before -eq $during) {
            throw "Pipeline watcher did not detect a new project-folder file."
        }
    }
    finally {
        if (Test-Path -LiteralPath $probeDirectory) {
            Remove-Item -LiteralPath $probeDirectory -Recurse -Force
        }
    }
    $after = Get-WatchedFingerprint
    if ($before -ne $after) {
        throw "Pipeline watcher probe did not restore the original workspace fingerprint."
    }
    Write-PipelineLog "PASS watcher detection test: new project-folder files and folders are detected."
}

function Invoke-PublishPipeline {
    param(
        [int]$StabilityAttempt = 1
    )
    $fingerprintBefore = Get-WatchedFingerprint
    Invoke-PipelineStep "Generating project-scoped Next.js data" $pythonExecutable @($generatorPath) $root
    Invoke-PipelineStep "Validating Streamlit to Next.js source parity" $pythonExecutable @($validatorPath) $root
    Invoke-PipelineStep "Building Next.js production application" "npm.cmd" @("run", "build") $websiteRoot
    Invoke-PipelineStep "Publishing validated workspace changes to GitHub without Git CLI" "powershell.exe" @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $githubSyncPath,
        "-Mode", "Once", "-IntervalSeconds", [string]$IntervalSeconds,
        "-Message", "Publish validated Next.js project pipeline"
    ) $root
    Invoke-PipelineStep "Deploying validated production build to Vercel" "npx.cmd" @("vercel", "--prod", "--yes") $websiteRoot

    $verified = $false
    for ($attempt = 1; $attempt -le 8; $attempt++) {
        try {
            Invoke-PipelineStep "Verifying public Vercel project data (attempt $attempt of 8)" $pythonExecutable @($validatorPath, "--public-url", $PublicUrl) $root
            $verified = $true
            break
        }
        catch {
            if ($attempt -eq 8) { throw }
            Write-PipelineLog "Public Vercel data is still propagating. Retrying in 10 seconds."
            Start-Sleep -Seconds 10
        }
    }
    if (-not $verified) {
        throw "Public Vercel verification did not complete."
    }

    $fingerprintAfter = Get-WatchedFingerprint
    if ($fingerprintBefore -ne $fingerprintAfter) {
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
            if ($stateMatchesWorkspace) {
                Write-PipelineLog "Using the last verified deployment state; no unchanged startup rebuild is required."
            }
            else {
                $lastFingerprint = Invoke-PublishPipeline
            }
            Write-PipelineLog "Watcher active. Polling tracked code and project folders every $IntervalSeconds seconds."
            while ($true) {
                Start-Sleep -Seconds $IntervalSeconds
                $currentFingerprint = Get-WatchedFingerprint
                if ($currentFingerprint -eq $lastFingerprint) { continue }
                Write-PipelineLog "Change detected in tracked project or website source. Starting validated publish pipeline."
                try {
                    $lastFingerprint = Invoke-PublishPipeline
                }
                catch {
                    Write-PipelineLog "Pipeline failed: $($_.Exception.Message)"
                    Write-PipelineLog "The watcher will retry on the next polling cycle."
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
    if ($null -ne $script:WatchMutex) {
        $script:WatchMutex.ReleaseMutex() | Out-Null
        $script:WatchMutex.Dispose()
    }
}
