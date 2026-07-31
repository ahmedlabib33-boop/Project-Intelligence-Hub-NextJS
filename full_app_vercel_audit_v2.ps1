#requires -Version 5.1
<#
.SYNOPSIS
  Read-only end-to-end audit for a Next.js application before applying changes.

.DESCRIPTION
  Checks:
  - Real application root
  - Source tree and current modification state
  - Output Studio and download-button implementation
  - Import resolution
  - JSX placement indicators
  - npm scripts and installed dependency state
  - Production build
  - Running Next.js watcher/dev processes
  - Listening ports and local URLs
  - Git repository, branch, status, and remote
  - Vercel project linkage and configuration
  - Vercel CLI availability and authentication status
  - Vercel environment-variable names only
  - Local versus Vercel deployment readiness
  - Existing backups and rollback points
  - Final comprehensive Markdown, JSON, CSV, and HTML report

  This script is READ-ONLY toward application source.
  It creates reports only under:
    <app>\_PRE_APPLY_FULL_AUDIT

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\full_app_vercel_audit.ps1" `
    -ProjectRoot "D:\Project Intelligence Hub NextJS" `
    -OpenReport
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = $PSScriptRoot,
    [switch]$OpenReport,
    [switch]$SkipBuild,
    [int]$BuildTimeoutSeconds = 420
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Stage {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 80) -ForegroundColor DarkCyan
    Write-Host ("  " + $Text) -ForegroundColor Cyan
    Write-Host ("=" * 80) -ForegroundColor DarkCyan
}

function Ok {
    param([string]$Text)
    Write-Host "[OK] $Text" -ForegroundColor Green
}

function WarnLine {
    param([string]$Text)
    Write-Host "[WARN] $Text" -ForegroundColor Yellow
}

function FailLine {
    param([string]$Text)
    Write-Host "[FAIL] $Text" -ForegroundColor Red
}

function ReadText {
    param([string]$Path)
    try {
        return [System.IO.File]::ReadAllText($Path)
    }
    catch {
        return ""
    }
}

function SafeProp {
    param(
        [object]$Object,
        [string]$Name,
        [object]$Default = $null
    )

    if ($null -eq $Object) {
        return $Default
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $Default
    }

    return $property.Value
}

function IsNextApp {
    param([string]$Folder)

    $packagePath = Join-Path $Folder "package.json"
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        return $false
    }

    try {
        $packageJson = (ReadText -Path $packagePath) | ConvertFrom-Json
    }
    catch {
        return $false
    }

    $dependencies = SafeProp -Object $packageJson -Name "dependencies"
    $devDependencies = SafeProp -Object $packageJson -Name "devDependencies"

    $hasNext =
        ($null -ne $dependencies -and $null -ne $dependencies.PSObject.Properties["next"]) -or
        ($null -ne $devDependencies -and $null -ne $devDependencies.PSObject.Properties["next"])

    $hasRouter =
        (Test-Path -LiteralPath (Join-Path $Folder "src\app") -PathType Container) -or
        (Test-Path -LiteralPath (Join-Path $Folder "app") -PathType Container) -or
        (Test-Path -LiteralPath (Join-Path $Folder "pages") -PathType Container) -or
        (Test-Path -LiteralPath (Join-Path $Folder "src\pages") -PathType Container)

    return $hasNext -and $hasRouter
}

function ResolveAppRoot {
    param([string]$StartPath)

    $resolved = (Resolve-Path -LiteralPath $StartPath).Path

    if (IsNextApp -Folder $resolved) {
        return $resolved
    }

    $website = Join-Path $resolved "website"
    if (IsNextApp -Folder $website) {
        return $website
    }

    $candidates = @(
        Get-ChildItem -LiteralPath $resolved -Filter package.json -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '\\(\.git|\.tmp|node_modules|\.next|dist|build|coverage|\.turbo|\.vercel|out|_PRE_APPLY_FULL_AUDIT)(\\|$)'
        }
    )

    foreach ($candidate in $candidates) {
        if (IsNextApp -Folder $candidate.Directory.FullName) {
            return $candidate.Directory.FullName
        }
    }

    throw "No valid Next.js app found under: $resolved"
}

function RunCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory,
        [int]$TimeoutSeconds = 120
    )

    $stdoutFile = Join-Path $env:TEMP ("audit_stdout_" + [guid]::NewGuid().ToString("N") + ".txt")
    $stderrFile = Join-Path $env:TEMP ("audit_stderr_" + [guid]::NewGuid().ToString("N") + ".txt")

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $escapedArguments = @(
        foreach ($argument in $Arguments) {
            if ($null -eq $argument) {
                '""'
            }
            elseif ($argument -match '[\s"]') {
                '"' + ($argument -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
            }
            else {
                $argument
            }
        }
    )

    $psi.Arguments = ($escapedArguments -join " ")

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi

    try {
        [void]$process.Start()

        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()

        $finished = $process.WaitForExit($TimeoutSeconds * 1000)

        if (-not $finished) {
            try { $process.Kill($true) } catch {}
            return [pscustomobject]@{
                ExitCode = -1
                TimedOut = $true
                StdOut = ""
                StdErr = "Command timed out after $TimeoutSeconds seconds."
            }
        }

        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()

        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            TimedOut = $false
            StdOut = $stdout
            StdErr = $stderr
        }
    }
    catch {
        return [pscustomobject]@{
            ExitCode = -2
            TimedOut = $false
            StdOut = ""
            StdErr = $_.Exception.Message
        }
    }
    finally {
        Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    }
}

function Html {
    param([AllowNull()][string]$Text)
    if ($null -eq $Text) { return "" }
    return [System.Net.WebUtility]::HtmlEncode($Text)
}

Stage "1/12 Resolving application"

$AppRoot = ResolveAppRoot -StartPath $ProjectRoot
$AuditRoot = Join-Path $AppRoot "_PRE_APPLY_FULL_AUDIT"
New-Item -ItemType Directory -Path $AuditRoot -Force | Out-Null

Ok "Application root: $AppRoot"
Ok "Audit folder: $AuditRoot"

Stage "2/12 Reading application metadata"

$packagePath = Join-Path $AppRoot "package.json"
$packageJson = (ReadText -Path $packagePath) | ConvertFrom-Json

$appName = [string](SafeProp -Object $packageJson -Name "name" -Default (Split-Path $AppRoot -Leaf))
$appVersion = [string](SafeProp -Object $packageJson -Name "version" -Default "Not declared")

$scripts = @()
$scriptsObject = SafeProp -Object $packageJson -Name "scripts"
if ($null -ne $scriptsObject) {
    foreach ($property in @($scriptsObject.PSObject.Properties)) {
        $scripts += [pscustomobject]@{
            Name = $property.Name
            Command = [string]$property.Value
        }
    }
}

$dependencies = @()
foreach ($groupName in @("dependencies", "devDependencies")) {
    $group = SafeProp -Object $packageJson -Name $groupName
    if ($null -ne $group) {
        foreach ($property in @($group.PSObject.Properties)) {
            $dependencies += [pscustomobject]@{
                Type = $groupName
                Package = $property.Name
                Version = [string]$property.Value
            }
        }
    }
}

Ok "Application: $appName"
Ok "Version: $appVersion"
Ok "Scripts: $(@($scripts).Count)"
Ok "Dependencies: $(@($dependencies).Count)"

Stage "3/12 Inspecting Output Studio implementation"

$pagePath = Join-Path $AppRoot "src\app\page.tsx"
$componentPath = Join-Path $AppRoot "src\components\OutputStudioDownloadButton.tsx"

$pageExists = Test-Path -LiteralPath $pagePath -PathType Leaf
$componentExists = Test-Path -LiteralPath $componentPath -PathType Leaf

$pageContent = if ($pageExists) { ReadText -Path $pagePath } else { "" }
$componentContent = if ($componentExists) { ReadText -Path $componentPath } else { "" }

$downloadImportMatches = @(
    [regex]::Matches(
        $pageContent,
        '(?m)^\s*import\s+OutputStudioDownloadButton\s+from\s+["'']([^"'']+)["''];?\s*$'
    )
)

$downloadRenderMatches = @(
    [regex]::Matches(
        $pageContent,
        '<OutputStudioDownloadButton\s*/>'
    )
)

$viewerMatches = @(
    [regex]::Matches(
        $pageContent,
        '<(iframe|object|embed)\b',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
)

$importPath = if ($downloadImportMatches.Count -gt 0) {
    $downloadImportMatches[0].Groups[1].Value
}
else {
    ""
}

$resolvedImportPath = ""
$importResolves = $false

if (-not [string]::IsNullOrWhiteSpace($importPath)) {
    if ($importPath.StartsWith("@/")) {
        $resolvedImportPath = Join-Path (Join-Path $AppRoot "src") ($importPath.Substring(2).Replace("/", "\"))
    }
    elseif ($importPath.StartsWith(".")) {
        $resolvedImportPath = [System.IO.Path]::GetFullPath(
            (Join-Path (Split-Path -Parent $pagePath) $importPath.Replace("/", "\"))
        )
    }

    foreach ($extension in @("", ".tsx", ".ts", ".jsx", ".js")) {
        if (Test-Path -LiteralPath ($resolvedImportPath + $extension) -PathType Leaf) {
            $importResolves = $true
            $resolvedImportPath = $resolvedImportPath + $extension
            break
        }
    }
}

$jsxSiblingRisk = [bool](
    $pageContent -match '(?ms)\?\s*\(\s*<OutputStudioDownloadButton\s*/>\s*<(iframe|object|embed)\b'
)

$outputStudioChecks = @(
    [pscustomobject]@{ Check = "Main page exists"; Passed = $pageExists; Detail = $pagePath },
    [pscustomobject]@{ Check = "Download component exists"; Passed = $componentExists; Detail = $componentPath },
    [pscustomobject]@{ Check = "Exactly one component import"; Passed = ($downloadImportMatches.Count -eq 1); Detail = "Count=$($downloadImportMatches.Count); Path=$importPath" },
    [pscustomobject]@{ Check = "Import path resolves"; Passed = $importResolves; Detail = $resolvedImportPath },
    [pscustomobject]@{ Check = "Download component rendered"; Passed = ($downloadRenderMatches.Count -gt 0); Detail = "Render count=$($downloadRenderMatches.Count)" },
    [pscustomobject]@{ Check = "Report viewer exists"; Passed = ($viewerMatches.Count -gt 0); Detail = "Viewer count=$($viewerMatches.Count)" },
    [pscustomobject]@{ Check = "No unwrapped JSX sibling pattern"; Passed = (-not $jsxSiblingRisk); Detail = "Conditional sibling risk=$jsxSiblingRisk" }
)

foreach ($check in $outputStudioChecks) {
    if ($check.Passed) { Ok "$($check.Check): $($check.Detail)" }
    else { FailLine "$($check.Check): $($check.Detail)" }
}

Stage "4/12 Inspecting rollback and backups"

$backupFolders = @(
    Get-ChildItem -LiteralPath $AppRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "_OUTPUT_STUDIO_BACKUP_*" } |
    Sort-Object LastWriteTime -Descending
)

$pageBackupFiles = @(
    Get-ChildItem -LiteralPath (Split-Path -Parent $pagePath) -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "page.tsx.before-jsx-fix-*.bak" } |
    Sort-Object LastWriteTime -Descending
)

Ok "Output Studio backup folders: $(@($backupFolders).Count)"
Ok "Direct page backup files: $(@($pageBackupFiles).Count)"

Stage "5/12 Checking Git state"

$gitAvailable = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
$gitRoot = ""
$gitBranch = ""
$gitStatus = ""
$gitRemote = ""
$gitTrackedChanges = @()

if ($gitAvailable) {
    $gitRootResult = RunCommand -FilePath "git" -Arguments @("rev-parse", "--show-toplevel") -WorkingDirectory $AppRoot
    if ($gitRootResult.ExitCode -eq 0) {
        $gitRoot = $gitRootResult.StdOut.Trim()

        $branchResult = RunCommand -FilePath "git" -Arguments @("branch", "--show-current") -WorkingDirectory $AppRoot
        $statusResult = RunCommand -FilePath "git" -Arguments @("status", "--short") -WorkingDirectory $AppRoot
        $remoteResult = RunCommand -FilePath "git" -Arguments @("remote", "-v") -WorkingDirectory $AppRoot

        $gitBranch = $branchResult.StdOut.Trim()
        $gitStatus = $statusResult.StdOut.Trim()
        $gitRemote = $remoteResult.StdOut.Trim()

        if (-not [string]::IsNullOrWhiteSpace($gitStatus)) {
            $gitTrackedChanges = @($gitStatus -split "`r?`n")
        }

        Ok "Git root: $gitRoot"
        Ok "Git branch: $gitBranch"

        if ($gitTrackedChanges.Count -gt 0) {
            WarnLine "Git working tree has $($gitTrackedChanges.Count) changed/untracked entries."
        }
        else {
            Ok "Git working tree is clean."
        }
    }
    else {
        WarnLine "App is not inside a readable Git repository."
    }
}
else {
    WarnLine "Git command is not available."
}

Stage "6/12 Checking watcher and local runtime"

$nodeProcesses = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -match '^(node|npm|npx)\.exe$' -or
        $_.CommandLine -match '(?i)(next\s+dev|next-server|turbopack)'
    } |
    Select-Object ProcessId, Name, CommandLine
)

$listeners = @()
try {
    $listeners = @(
        Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $_.LocalPort -in @(3000, 3001, 3002, 8755, 6543) } |
        Select-Object LocalAddress, LocalPort, OwningProcess, State
    )
}
catch {
    WarnLine "Could not query listening TCP ports."
}

$localHttpResults = @()
foreach ($port in @($listeners.LocalPort | Sort-Object -Unique)) {
    $url = "http://localhost:$port"
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
        $localHttpResults += [pscustomobject]@{
            Url = $url
            Reachable = $true
            StatusCode = [int]$response.StatusCode
            TitleDetected = [bool]($response.Content -match '<title>.*?</title>')
        }
        Ok "Local URL reachable: $url ($($response.StatusCode))"
    }
    catch {
        $localHttpResults += [pscustomobject]@{
            Url = $url
            Reachable = $false
            StatusCode = 0
            TitleDetected = $false
        }
        WarnLine "Local URL not reachable: $url"
    }
}

Ok "Node/Next watcher processes: $(@($nodeProcesses).Count)"
Ok "Known listening ports: $(@($listeners).Count)"

Stage "7/12 Checking node_modules and package lock"

$nodeModulesExists = Test-Path -LiteralPath (Join-Path $AppRoot "node_modules") -PathType Container
$packageLockExists = Test-Path -LiteralPath (Join-Path $AppRoot "package-lock.json") -PathType Leaf
$nextBinaryExists =
    (Test-Path -LiteralPath (Join-Path $AppRoot "node_modules\.bin\next.cmd") -PathType Leaf) -or
    (Test-Path -LiteralPath (Join-Path $AppRoot "node_modules\.bin\next") -PathType Leaf)

if ($nodeModulesExists) { Ok "node_modules exists." } else { WarnLine "node_modules is missing." }
if ($packageLockExists) { Ok "package-lock.json exists." } else { WarnLine "package-lock.json is missing." }
if ($nextBinaryExists) { Ok "Local Next.js binary exists." } else { WarnLine "Local Next.js binary is missing." }

Stage "8/12 Running production build"

$buildResult = [pscustomobject]@{
    ExitCode = 999
    TimedOut = $false
    StdOut = ""
    StdErr = "Build skipped."
}

if ($SkipBuild) {
    WarnLine "Production build skipped by request."
}
elseif (-not $nodeModulesExists) {
    WarnLine "Production build skipped because node_modules is missing."
}
else {
    $buildResult = RunCommand `
        -FilePath "cmd.exe" `
        -Arguments @("/d", "/s", "/c", "npm run build") `
        -WorkingDirectory $AppRoot `
        -TimeoutSeconds $BuildTimeoutSeconds

    Set-Content -LiteralPath (Join-Path $AuditRoot "build_stdout.txt") -Value $buildResult.StdOut -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $AuditRoot "build_stderr.txt") -Value $buildResult.StdErr -Encoding UTF8

    if ($buildResult.ExitCode -eq 0) {
        Ok "Production build passed."
    }
    elseif ($buildResult.TimedOut) {
        FailLine "Production build timed out."
    }
    else {
        FailLine "Production build failed with exit code $($buildResult.ExitCode)."
    }
}

Stage "9/12 Checking Vercel configuration and linkage"

$vercelJsonPath = Join-Path $AppRoot "vercel.json"
$vercelProjectPath = Join-Path $AppRoot ".vercel\project.json"
$vercelJsonExists = Test-Path -LiteralPath $vercelJsonPath -PathType Leaf
$vercelProjectExists = Test-Path -LiteralPath $vercelProjectPath -PathType Leaf

$vercelProject = $null
$vercelProjectId = ""
$vercelOrgId = ""

if ($vercelProjectExists) {
    try {
        $vercelProject = (ReadText -Path $vercelProjectPath) | ConvertFrom-Json
        $vercelProjectId = [string](SafeProp -Object $vercelProject -Name "projectId" -Default "")
        $vercelOrgId = [string](SafeProp -Object $vercelProject -Name "orgId" -Default "")
    }
    catch {
        WarnLine ".vercel\project.json exists but could not be parsed."
    }
}

if ($vercelJsonExists) { Ok "vercel.json exists." } else { WarnLine "vercel.json is missing." }
if ($vercelProjectExists) { Ok "Local Vercel project link exists." } else { WarnLine ".vercel\project.json is missing." }

$vercelAvailable = $null -ne (Get-Command vercel -ErrorAction SilentlyContinue)
$vercelVersion = ""
$vercelWhoAmI = ""
$vercelProjectInspect = ""
$vercelEnvNames = @()

if ($vercelAvailable) {
    $versionResult = RunCommand -FilePath "vercel" -Arguments @("--version") -WorkingDirectory $AppRoot
    $vercelVersion = ($versionResult.StdOut + "`n" + $versionResult.StdErr).Trim()

    $whoResult = RunCommand -FilePath "vercel" -Arguments @("whoami") -WorkingDirectory $AppRoot
    $vercelWhoAmI = ($whoResult.StdOut + "`n" + $whoResult.StdErr).Trim()

    if ($whoResult.ExitCode -eq 0) {
        Ok "Vercel CLI authenticated as: $vercelWhoAmI"
    }
    else {
        WarnLine "Vercel CLI is installed but authentication was not confirmed."
    }

    $inspectResult = RunCommand -FilePath "vercel" -Arguments @("inspect", "--scope", $vercelOrgId) -WorkingDirectory $AppRoot -TimeoutSeconds 60
    $vercelProjectInspect = ($inspectResult.StdOut + "`n" + $inspectResult.StdErr).Trim()

    $envResult = RunCommand -FilePath "vercel" -Arguments @("env", "ls") -WorkingDirectory $AppRoot -TimeoutSeconds 60
    $envText = ($envResult.StdOut + "`n" + $envResult.StdErr)

    foreach ($line in @($envText -split "`r?`n")) {
        if ($line -match '^\s*([A-Z][A-Z0-9_]+)\s+') {
            $vercelEnvNames += $Matches[1]
        }
    }

    $vercelEnvNames = @($vercelEnvNames | Sort-Object -Unique)
    Ok "Vercel CLI version: $vercelVersion"
    Ok "Vercel environment names detected: $(@($vercelEnvNames).Count)"
}
else {
    WarnLine "Vercel CLI is not installed or not available in PATH."
}

Stage "10/12 Checking deployment reflection requirements"

$deploymentChecks = @(
    [pscustomobject]@{
        Check = "Production build passes"
        Passed = ($buildResult.ExitCode -eq 0)
        RequiredForVercel = $true
        Detail = "ExitCode=$($buildResult.ExitCode)"
    },
    [pscustomobject]@{
        Check = "Output Studio import resolves"
        Passed = $importResolves
        RequiredForVercel = $true
        Detail = $resolvedImportPath
    },
    [pscustomobject]@{
        Check = "No known JSX sibling parse risk"
        Passed = (-not $jsxSiblingRisk)
        RequiredForVercel = $true
        Detail = "Risk=$jsxSiblingRisk"
    },
    [pscustomobject]@{
        Check = "Vercel project locally linked"
        Passed = $vercelProjectExists
        RequiredForVercel = $true
        Detail = "ProjectId=$vercelProjectId; OrgId=$vercelOrgId"
    },
    [pscustomobject]@{
        Check = "Vercel CLI authenticated"
        Passed = ($vercelAvailable -and -not [string]::IsNullOrWhiteSpace($vercelWhoAmI) -and $vercelWhoAmI -notmatch '(?i)(error|not authenticated|login)')
        RequiredForVercel = $false
        Detail = $vercelWhoAmI
    },
    [pscustomobject]@{
        Check = "Git repository detected"
        Passed = (-not [string]::IsNullOrWhiteSpace($gitRoot))
        RequiredForVercel = $false
        Detail = $gitRoot
    },
    [pscustomobject]@{
        Check = "Rollback backup exists"
        Passed = (@($backupFolders).Count -gt 0 -or @($pageBackupFiles).Count -gt 0)
        RequiredForVercel = $false
        Detail = "BackupFolders=$(@($backupFolders).Count); PageBackups=$(@($pageBackupFiles).Count)"
    }
)

$blockingChecks = @(
    $deploymentChecks |
    Where-Object { $_.RequiredForVercel -and -not $_.Passed }
)

if ($blockingChecks.Count -eq 0) {
    Ok "No blocking local/Vercel readiness checks failed."
}
else {
    FailLine "$($blockingChecks.Count) blocking readiness checks failed."
}

Stage "11/12 Writing comprehensive reports"

$outputStudioChecks | Export-Csv -LiteralPath (Join-Path $AuditRoot "Output_Studio_Checks.csv") -NoTypeInformation -Encoding UTF8
$deploymentChecks | Export-Csv -LiteralPath (Join-Path $AuditRoot "Deployment_Readiness_Checks.csv") -NoTypeInformation -Encoding UTF8
$nodeProcesses | Export-Csv -LiteralPath (Join-Path $AuditRoot "Watcher_Processes.csv") -NoTypeInformation -Encoding UTF8
$listeners | Export-Csv -LiteralPath (Join-Path $AuditRoot "Listening_Ports.csv") -NoTypeInformation -Encoding UTF8
$localHttpResults | Export-Csv -LiteralPath (Join-Path $AuditRoot "Local_HTTP_Checks.csv") -NoTypeInformation -Encoding UTF8
$dependencies | Export-Csv -LiteralPath (Join-Path $AuditRoot "Dependencies.csv") -NoTypeInformation -Encoding UTF8
$scripts | Export-Csv -LiteralPath (Join-Path $AuditRoot "NPM_Scripts.csv") -NoTypeInformation -Encoding UTF8

$generatedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$reportObject = [ordered]@{
    generatedAt = $generatedAt
    application = @{
        root = $AppRoot
        name = $appName
        version = $appVersion
    }
    outputStudio = @{
        pagePath = $pagePath
        componentPath = $componentPath
        importPath = $importPath
        resolvedImportPath = $resolvedImportPath
        importResolves = $importResolves
        renderCount = $downloadRenderMatches.Count
        viewerCount = $viewerMatches.Count
        jsxSiblingRisk = $jsxSiblingRisk
        checks = @($outputStudioChecks)
    }
    watcher = @{
        processCount = @($nodeProcesses).Count
        processes = @($nodeProcesses)
        listeners = @($listeners)
        localHttp = @($localHttpResults)
    }
    git = @{
        available = $gitAvailable
        root = $gitRoot
        branch = $gitBranch
        status = $gitStatus
        remote = $gitRemote
    }
    build = @{
        skipped = [bool]$SkipBuild
        exitCode = $buildResult.ExitCode
        timedOut = $buildResult.TimedOut
        stdoutFile = "build_stdout.txt"
        stderrFile = "build_stderr.txt"
    }
    vercel = @{
        configExists = $vercelJsonExists
        projectLinkExists = $vercelProjectExists
        projectId = $vercelProjectId
        orgId = $vercelOrgId
        cliAvailable = $vercelAvailable
        cliVersion = $vercelVersion
        whoami = $vercelWhoAmI
        environmentVariableNames = @($vercelEnvNames)
        inspect = $vercelProjectInspect
    }
    backups = @{
        backupFolders = @($backupFolders | ForEach-Object { $_.FullName })
        pageBackups = @($pageBackupFiles | ForEach-Object { $_.FullName })
    }
    deploymentReadiness = @{
        blockingFailureCount = $blockingChecks.Count
        checks = @($deploymentChecks)
    }
}

$reportObject |
    ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath (Join-Path $AuditRoot "Full_Audit.json") -Encoding UTF8

$md = @"
# Full Application, Watcher, Build, Git, and Vercel Audit

**Generated:** $generatedAt  
**Application:** $appName  
**Root:** ``$AppRoot``  
**Version:** $appVersion

## Executive conclusion

$(if ($blockingChecks.Count -eq 0) {
    "**No blocking readiness checks failed.** The application is eligible for a controlled apply/deploy step, subject to reviewing non-blocking warnings."
} else {
    "**Do not apply or deploy yet.** $($blockingChecks.Count) blocking readiness checks failed."
})

## Blocking issues

$(if ($blockingChecks.Count -gt 0) {
    ($blockingChecks | ForEach-Object {
        "- **$($_.Check)** — $($_.Detail)"
    }) -join "`r`n"
} else {
    "- None."
})

## Output Studio

| Check | Passed | Detail |
|---|---|---|
$(($outputStudioChecks | ForEach-Object {
    "| $($_.Check) | $($_.Passed) | $($_.Detail.Replace('|','/')) |"
}) -join "`r`n")

## Production build

- Exit code: **$($buildResult.ExitCode)**
- Timed out: **$($buildResult.TimedOut)**
- Standard output: ``build_stdout.txt``
- Standard error: ``build_stderr.txt``

## Watcher and local runtime

- Node/Next processes: **$(@($nodeProcesses).Count)**
- Known listening ports: **$(@($listeners).Count)**
- Reachable local URLs: **$(@($localHttpResults | Where-Object Reachable).Count)**

## Git

- Available: **$gitAvailable**
- Root: ``$gitRoot``
- Branch: ``$gitBranch``
- Changed/untracked entries: **$(@($gitTrackedChanges).Count)**

### Git status

````text
$gitStatus
````

### Git remotes

````text
$gitRemote
````

## Vercel

- vercel.json exists: **$vercelJsonExists**
- Local project link exists: **$vercelProjectExists**
- Project ID: ``$vercelProjectId``
- Organization ID: ``$vercelOrgId``
- CLI available: **$vercelAvailable**
- CLI version: ``$vercelVersion``
- CLI account: ``$vercelWhoAmI``
- Environment-variable names detected: **$(@($vercelEnvNames).Count)**

### Vercel environment names

$(if (@($vercelEnvNames).Count -gt 0) {
    ($vercelEnvNames | ForEach-Object { "- ``$_``" }) -join "`r`n"
} else {
    "- None detected or CLI access unavailable."
})

## Backups and rollback

### Backup folders

$(if (@($backupFolders).Count -gt 0) {
    ($backupFolders | ForEach-Object { "- ``$($_.FullName)``" }) -join "`r`n"
} else {
    "- None detected."
})

### Direct page backups

$(if (@($pageBackupFiles).Count -gt 0) {
    ($pageBackupFiles | ForEach-Object { "- ``$($_.FullName)``" }) -join "`r`n"
} else {
    "- None detected."
})

## Deployment readiness

| Check | Passed | Required for Vercel | Detail |
|---|---|---|---|
$(($deploymentChecks | ForEach-Object {
    "| $($_.Check) | $($_.Passed) | $($_.RequiredForVercel) | $($_.Detail.Replace('|','/')) |"
}) -join "`r`n")

## Controlled next step

Do not run an apply or Vercel deployment until this report shows:

1. Production build passes.
2. Output Studio import resolves.
3. JSX has no parse-risk pattern.
4. Vercel project linkage is confirmed.
5. A rollback backup exists.
"@

$mdPath = Join-Path $AuditRoot "00_READ_FIRST_Full_Audit.md"
Set-Content -LiteralPath $mdPath -Value $md -Encoding UTF8

$checksHtml = ($deploymentChecks | ForEach-Object {
    $statusClass = if ($_.Passed) { "pass" } else { "fail" }
    "<tr><td>$(Html $_.Check)</td><td class='$statusClass'>$($_.Passed)</td><td>$($_.RequiredForVercel)</td><td><code>$(Html $_.Detail)</code></td></tr>"
}) -join "`r`n"

$htmlPath = Join-Path $AuditRoot "00_OPEN_FIRST_Full_Audit.html"
$htmlContent = @"
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Full App and Vercel Audit</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f4f7fb;color:#172033}
header{background:linear-gradient(135deg,#103f73,#1f68aa);color:#fff;padding:36px}
main{max-width:1250px;margin:auto;padding:24px}
.card{background:#fff;border:1px solid #dbe3ed;border-radius:14px;padding:20px;margin-bottom:18px}
h1,h2{margin-top:0}
table{width:100%;border-collapse:collapse}
th,td{padding:10px;border-bottom:1px solid #dbe3ed;text-align:left;vertical-align:top}
th{background:#103f73;color:#fff}
.pass{color:#087443;font-weight:700}
.fail{color:#b42318;font-weight:700}
code{font-family:Consolas,monospace;overflow-wrap:anywhere}
.big{font-size:34px;font-weight:800}
</style>
</head>
<body>
<header><h1>Full Application, Watcher, Build, Git, and Vercel Audit</h1><div>$generatedAt</div></header>
<main>
<div class="card">
<h2>Executive conclusion</h2>
<div class="big">$(if ($blockingChecks.Count -eq 0) { "READY FOR CONTROLLED NEXT STEP" } else { "DO NOT APPLY OR DEPLOY" })</div>
<p>Blocking failures: <strong>$($blockingChecks.Count)</strong></p>
</div>
<div class="card">
<h2>Application</h2>
<p><strong>Name:</strong> $(Html $appName)</p>
<p><strong>Root:</strong> <code>$(Html $AppRoot)</code></p>
<p><strong>Build exit code:</strong> $($buildResult.ExitCode)</p>
</div>
<div class="card">
<h2>Deployment readiness checks</h2>
<table>
<thead><tr><th>Check</th><th>Passed</th><th>Required</th><th>Detail</th></tr></thead>
<tbody>$checksHtml</tbody>
</table>
</div>
</main>
</body>
</html>
"@

Set-Content -LiteralPath $htmlPath -Value $htmlContent -Encoding UTF8

Stage "12/12 Final result"

if ($blockingChecks.Count -eq 0) {
    Ok "Audit completed: no blocking failures."
}
else {
    FailLine "Audit completed: $($blockingChecks.Count) blocking failures."
}

Write-Host ""
Write-Host "OPEN THIS FIRST:" -ForegroundColor Yellow
Write-Host $htmlPath -ForegroundColor Cyan
Write-Host ""
Write-Host "DETAILED REPORT:" -ForegroundColor Yellow
Write-Host $mdPath -ForegroundColor Cyan
Write-Host ""
Write-Host "NO APPLICATION SOURCE FILES WERE MODIFIED." -ForegroundColor Green

if ($OpenReport) {
    Start-Process -FilePath $htmlPath
}
