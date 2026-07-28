[CmdletBinding()]
param(
    [string]$ProjectRoot = "D:\Project Intelligence Hub NextJS",
    [string]$OutputRoot = "",
    [ValidateSet("Auto","Codex","Claude","Gemini","None")]
    [string]$Agent = "Auto",
    [switch]$RunAgent,
    [switch]$RunNpmInstall,
    [switch]$RunTests,
    [switch]$RunBuild,
    [switch]$RunNpmAudit,
    [switch]$IncludeSourceSnapshot,
    [switch]$OpenOutput
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host ("=" * 88) -ForegroundColor DarkCyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host ("=" * 88) -ForegroundColor DarkCyan
}

function Write-JsonFile {
    param(
        [Parameter(Mandatory)]$Object,
        [Parameter(Mandatory)][string]$Path,
        [int]$Depth = 20
    )
    $Object | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Get-RelativePathSafe {
    param([string]$BasePath, [string]$FullPath)
    try {
        return [System.IO.Path]::GetRelativePath($BasePath, $FullPath)
    } catch {
        $baseUri = [System.Uri]((Resolve-Path -LiteralPath $BasePath).Path.TrimEnd('\') + '\')
        $fileUri = [System.Uri](Resolve-Path -LiteralPath $FullPath).Path
        return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($fileUri).ToString()).Replace('/','\')
    }
}

function Test-IsExcludedPath {
    param([string]$RelativePath)
    $p = "\" + $RelativePath.Replace('/','\').TrimStart('\') + "\"
    $excluded = @(
        "\node_modules\",
        "\.next\",
        "\.git\",
        "\dist\",
        "\build\",
        "\coverage\",
        "\out\",
        "\.turbo\",
        "\.cache\",
        "\AI_Report_Package_"
    )
    foreach ($item in $excluded) {
        if ($p -like "*$item*") { return $true }
    }
    return $false
}

function Redact-Text {
    param([string]$Text)
    if ($null -eq $Text) { return "" }

    $result = $Text
    $patterns = @(
        '(?im)^(\s*[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|PRIVATE|CREDENTIAL)[A-Z0-9_]*\s*=\s*).+$',
        '(?i)(sk-[A-Za-z0-9_\-]{16,})',
        '(?i)(gh[pousr]_[A-Za-z0-9]{20,})',
        '(?i)(Bearer\s+)[A-Za-z0-9\-\._~\+\/]+=*',
        '(?i)(postgres(?:ql)?://[^:\s]+:)[^@\s]+(@)',
        '(?i)(mongodb(?:\+srv)?://[^:\s]+:)[^@\s]+(@)'
    )
    $replacements = @(
        '$1[REDACTED]',
        '[REDACTED_OPENAI_KEY]',
        '[REDACTED_GITHUB_TOKEN]',
        '$1[REDACTED]',
        '$1[REDACTED]$2',
        '$1[REDACTED]$2'
    )

    for ($i = 0; $i -lt $patterns.Count; $i++) {
        $result = [regex]::Replace($result, $patterns[$i], $replacements[$i])
    }
    return $result
}

function Invoke-LoggedCommand {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Command,
        [Parameter(Mandatory)][string]$LogPath,
        [switch]$ContinueOnError
    )

    Write-Host "Running: $Name" -ForegroundColor Yellow
    $start = Get-Date
    try {
        $output = & $Command 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode) { $exitCode = 0 }

        @"
Command: $Name
Started: $($start.ToString("s"))
Finished: $((Get-Date).ToString("s"))
ExitCode: $exitCode

$output
"@ | Set-Content -LiteralPath $LogPath -Encoding UTF8

        if ($exitCode -ne 0 -and -not $ContinueOnError) {
            throw "$Name failed with exit code $exitCode. See: $LogPath"
        }

        return [pscustomobject]@{
            Name = $Name
            ExitCode = $exitCode
            LogPath = $LogPath
            Success = ($exitCode -eq 0)
        }
    }
    catch {
        $_ | Out-String | Add-Content -LiteralPath $LogPath -Encoding UTF8
        if (-not $ContinueOnError) { throw }
        return [pscustomobject]@{
            Name = $Name
            ExitCode = -1
            LogPath = $LogPath
            Success = $false
            Error = $_.Exception.Message
        }
    }
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "Project folder does not exist: $ProjectRoot"
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path (Split-Path -Parent $ProjectRoot) "Project_Intelligence_Hub_Comprehensive_Report_$timestamp"
}

$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)

$folders = [ordered]@{
    Root          = $OutputRoot
    Evidence      = Join-Path $OutputRoot "01_Evidence"
    Inventory     = Join-Path $OutputRoot "01_Evidence\Inventory"
    Git           = Join-Path $OutputRoot "01_Evidence\Git"
    Dependencies  = Join-Path $OutputRoot "01_Evidence\Dependencies"
    Config        = Join-Path $OutputRoot "01_Evidence\Configuration_Redacted"
    Logs          = Join-Path $OutputRoot "01_Evidence\Execution_Logs"
    Metrics       = Join-Path $OutputRoot "01_Evidence\Metrics"
    Prompt        = Join-Path $OutputRoot "02_AI_Agent_Prompt"
    Deliverables  = Join-Path $OutputRoot "03_Report_Deliverables"
    English       = Join-Path $OutputRoot "03_Report_Deliverables\English"
    Arabic        = Join-Path $OutputRoot "03_Report_Deliverables\Arabic_RTL"
    Technical     = Join-Path $OutputRoot "03_Report_Deliverables\Technical_Handover"
    Presentation  = Join-Path $OutputRoot "03_Report_Deliverables\Board_Presentation"
    PlanningDept  = Join-Path $OutputRoot "03_Report_Deliverables\Planning_Department"
    Appendices    = Join-Path $OutputRoot "03_Report_Deliverables\Appendices"
    Snapshot      = Join-Path $OutputRoot "04_Source_Snapshot"
}

foreach ($folder in $folders.Values) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
}

Write-Step "1/10 - Collecting project inventory"

$allFiles = Get-ChildItem -LiteralPath $ProjectRoot -File -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object {
        $relative = Get-RelativePathSafe -BasePath $ProjectRoot -FullPath $_.FullName
        -not (Test-IsExcludedPath -RelativePath $relative)
    }

$fileInventory = foreach ($file in $allFiles) {
    $relative = Get-RelativePathSafe -BasePath $ProjectRoot -FullPath $file.FullName
    $extension = if ($file.Extension) { $file.Extension.ToLowerInvariant() } else { "[no extension]" }
    $hash = $null
    try {
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256 -ErrorAction Stop).Hash
    } catch {}

    [pscustomobject]@{
        RelativePath = $relative
        Extension = $extension
        SizeBytes = $file.Length
        SizeKB = [math]::Round($file.Length / 1KB, 2)
        Created = $file.CreationTime.ToString("s")
        Modified = $file.LastWriteTime.ToString("s")
        SHA256 = $hash
    }
}

$fileInventory | Sort-Object RelativePath |
    Export-Csv -LiteralPath (Join-Path $folders.Inventory "file_inventory.csv") -NoTypeInformation -Encoding UTF8
Write-JsonFile -Object $fileInventory -Path (Join-Path $folders.Inventory "file_inventory.json")

$extensionSummary = $fileInventory |
    Group-Object Extension |
    ForEach-Object {
        [pscustomobject]@{
            Extension = $_.Name
            FileCount = $_.Count
            TotalBytes = ($_.Group | Measure-Object SizeBytes -Sum).Sum
            TotalMB = [math]::Round((($_.Group | Measure-Object SizeBytes -Sum).Sum / 1MB), 2)
        }
    } | Sort-Object FileCount -Descending

$extensionSummary | Export-Csv -LiteralPath (Join-Path $folders.Inventory "extension_summary.csv") -NoTypeInformation -Encoding UTF8

$treeLines = New-Object System.Collections.Generic.List[string]
$treeLines.Add((Split-Path -Leaf $ProjectRoot))
foreach ($item in (Get-ChildItem -LiteralPath $ProjectRoot -Recurse -Force -ErrorAction SilentlyContinue | Sort-Object FullName)) {
    $relative = Get-RelativePathSafe -BasePath $ProjectRoot -FullPath $item.FullName
    if (Test-IsExcludedPath -RelativePath $relative) { continue }
    $depth = ($relative -split '[\\/]').Count - 1
    $prefix = ("  " * $depth) + "|-- "
    $suffix = if ($item.PSIsContainer) { "\" } else { "" }
    $treeLines.Add("$prefix$($item.Name)$suffix")
}
$treeLines | Set-Content -LiteralPath (Join-Path $folders.Inventory "project_tree.txt") -Encoding UTF8

Write-Step "2/10 - Calculating codebase metrics"

$codeExtensions = @(
    ".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",
    ".css",".scss",".sass",".less",".html",".md",".mdx",
    ".py",".ps1",".sql",".prisma",".yml",".yaml",
    ".sh",".bat",".cmd",".xml",".toml"
)

$codeMetrics = foreach ($file in $allFiles | Where-Object { $codeExtensions -contains $_.Extension.ToLowerInvariant() }) {
    $relative = Get-RelativePathSafe -BasePath $ProjectRoot -FullPath $file.FullName
    try {
        $lines = Get-Content -LiteralPath $file.FullName -ErrorAction Stop
        $lineCount = @($lines).Count
        $nonBlank = @($lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
        $commentLike = @($lines | Where-Object { $_ -match '^\s*(//|#|/\*|\*|<!--)' }).Count
        $functionCount = @($lines | Where-Object {
            $_ -match '\b(function|def)\s+[A-Za-z_][A-Za-z0-9_]*' -or
            $_ -match '\b(const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*(async\s*)?\(' -or
            $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*\{'
        }).Count
        $classCount = @($lines | Where-Object { $_ -match '\bclass\s+[A-Za-z_][A-Za-z0-9_]*' }).Count
        $todoCount = @($lines | Where-Object { $_ -match '(?i)\b(TODO|FIXME|HACK|XXX)\b' }).Count

        [pscustomobject]@{
            RelativePath = $relative
            Extension = $file.Extension.ToLowerInvariant()
            Lines = $lineCount
            NonBlankLines = $nonBlank
            CommentLikeLines = $commentLike
            ApproxFunctions = $functionCount
            ApproxClasses = $classCount
            TodoFixmeCount = $todoCount
        }
    } catch {
        [pscustomobject]@{
            RelativePath = $relative
            Extension = $file.Extension.ToLowerInvariant()
            Lines = 0
            NonBlankLines = 0
            CommentLikeLines = 0
            ApproxFunctions = 0
            ApproxClasses = 0
            TodoFixmeCount = 0
            ReadError = $_.Exception.Message
        }
    }
}

$codeMetrics | Export-Csv -LiteralPath (Join-Path $folders.Metrics "code_metrics_by_file.csv") -NoTypeInformation -Encoding UTF8

$metricSummary = [pscustomobject]@{
    ProjectRoot = $ProjectRoot
    GeneratedAt = (Get-Date).ToString("s")
    TotalFiles = @($fileInventory).Count
    TotalSizeMB = [math]::Round((($fileInventory | Measure-Object SizeBytes -Sum).Sum / 1MB), 2)
    CodeFiles = @($codeMetrics).Count
    TotalLines = ($codeMetrics | Measure-Object Lines -Sum).Sum
    NonBlankLines = ($codeMetrics | Measure-Object NonBlankLines -Sum).Sum
    ApproxFunctions = ($codeMetrics | Measure-Object ApproxFunctions -Sum).Sum
    ApproxClasses = ($codeMetrics | Measure-Object ApproxClasses -Sum).Sum
    TodoFixmeCount = ($codeMetrics | Measure-Object TodoFixmeCount -Sum).Sum
}
Write-JsonFile -Object $metricSummary -Path (Join-Path $folders.Metrics "codebase_summary.json")
$metricSummary | Format-List | Out-String | Set-Content -LiteralPath (Join-Path $folders.Metrics "codebase_summary.txt") -Encoding UTF8

Write-Step "3/10 - Capturing manifests, dependencies, and configuration safely"

$importantNames = @(
    "package.json","package-lock.json","npm-shrinkwrap.json","yarn.lock","pnpm-lock.yaml",
    "tsconfig.json","jsconfig.json","next.config.js","next.config.mjs","next.config.ts",
    "tailwind.config.js","tailwind.config.ts","postcss.config.js","postcss.config.mjs",
    "eslint.config.js","eslint.config.mjs",".eslintrc",".eslintrc.json",
    "prisma.schema","schema.prisma","dockerfile","docker-compose.yml","docker-compose.yaml",
    "vercel.json","README.md","README.MD","CHANGELOG.md","LICENSE"
)

$importantFiles = $allFiles | Where-Object {
    ($importantNames -contains $_.Name) -or
    ($_.Name -match '^\.env(?:\.|$)') -or
    ($_.Name -match '(?i)(config|settings|manifest|requirements|pyproject|compose)')
}

$configRegister = foreach ($file in $importantFiles) {
    $relative = Get-RelativePathSafe -BasePath $ProjectRoot -FullPath $file.FullName
    $safeName = ($relative -replace '[:\\\/]','__')
    $destination = Join-Path $folders.Config $safeName

    try {
        $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop
        $redacted = Redact-Text -Text $content
        $redacted | Set-Content -LiteralPath $destination -Encoding UTF8

        [pscustomobject]@{
            RelativePath = $relative
            RedactedCopy = Get-RelativePathSafe -BasePath $OutputRoot -FullPath $destination
            SizeBytes = $file.Length
            Status = "Copied with secret redaction"
        }
    } catch {
        [pscustomobject]@{
            RelativePath = $relative
            RedactedCopy = ""
            SizeBytes = $file.Length
            Status = "Could not read: $($_.Exception.Message)"
        }
    }
}
$configRegister | Export-Csv -LiteralPath (Join-Path $folders.Config "configuration_register.csv") -NoTypeInformation -Encoding UTF8

$packageJsonPath = Join-Path $ProjectRoot "package.json"
if (Test-Path -LiteralPath $packageJsonPath) {
    try {
        $pkg = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
        $dependencyRows = New-Object System.Collections.Generic.List[object]

        foreach ($propertyName in @("dependencies","devDependencies","peerDependencies","optionalDependencies")) {
            $collection = $pkg.$propertyName
            if ($null -ne $collection) {
                foreach ($p in $collection.PSObject.Properties) {
                    $dependencyRows.Add([pscustomobject]@{
                        Type = $propertyName
                        Package = $p.Name
                        RequestedVersion = [string]$p.Value
                    })
                }
            }
        }

        $dependencyRows | Sort-Object Type,Package |
            Export-Csv -LiteralPath (Join-Path $folders.Dependencies "package_dependencies.csv") -NoTypeInformation -Encoding UTF8

        $scriptRows = foreach ($p in $pkg.scripts.PSObject.Properties) {
            [pscustomobject]@{ Script = $p.Name; Command = [string]$p.Value }
        }
        $scriptRows | Export-Csv -LiteralPath (Join-Path $folders.Dependencies "npm_scripts.csv") -NoTypeInformation -Encoding UTF8
    } catch {
        $_ | Out-String | Set-Content -LiteralPath (Join-Path $folders.Logs "package_json_parse_error.txt") -Encoding UTF8
    }
}

Write-Step "4/10 - Capturing Git evidence"

$gitAvailable = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
$gitFolder = Join-Path $ProjectRoot ".git"

if ($gitAvailable -and (Test-Path -LiteralPath $gitFolder)) {
    Push-Location $ProjectRoot
    try {
        Invoke-LoggedCommand -Name "git status" -LogPath (Join-Path $folders.Git "git_status.txt") -ContinueOnError -Command { git status --short --branch } | Out-Null
        Invoke-LoggedCommand -Name "git log" -LogPath (Join-Path $folders.Git "git_log.txt") -ContinueOnError -Command { git log --date=iso --pretty=format:"%H`t%ad`t%an`t%ae`t%s" --all } | Out-Null
        Invoke-LoggedCommand -Name "git branches" -LogPath (Join-Path $folders.Git "git_branches.txt") -ContinueOnError -Command { git branch -a -vv } | Out-Null
        Invoke-LoggedCommand -Name "git remotes" -LogPath (Join-Path $folders.Git "git_remotes.txt") -ContinueOnError -Command { git remote -v } | Out-Null
        Invoke-LoggedCommand -Name "git tags" -LogPath (Join-Path $folders.Git "git_tags.txt") -ContinueOnError -Command { git tag --sort=-creatordate } | Out-Null
        Invoke-LoggedCommand -Name "git contributors" -LogPath (Join-Path $folders.Git "git_contributors.txt") -ContinueOnError -Command { git shortlog -sne --all } | Out-Null
        Invoke-LoggedCommand -Name "git file change history" -LogPath (Join-Path $folders.Git "git_numstat.txt") -ContinueOnError -Command { git log --numstat --date=iso --pretty=format:"COMMIT`t%H`t%ad`t%an`t%s" --all } | Out-Null
    } finally {
        Pop-Location
    }
} else {
    "Git evidence unavailable. git installed: $gitAvailable; .git exists: $(Test-Path -LiteralPath $gitFolder)" |
        Set-Content -LiteralPath (Join-Path $folders.Git "git_unavailable.txt") -Encoding UTF8
}

Write-Step "5/10 - Detecting architecture, routes, APIs, data access, and risk indicators"

$searchableExtensions = @(".ts",".tsx",".js",".jsx",".mjs",".cjs",".py",".prisma",".sql",".json",".yml",".yaml",".md")
$searchableFiles = $allFiles | Where-Object { $searchableExtensions -contains $_.Extension.ToLowerInvariant() }

$patterns = [ordered]@{
    RoutesAndPages = '(?i)(app[\\/].*(page|layout|route)\.(tsx?|jsx?)$|pages[\\/].*\.(tsx?|jsx?)$)'
    ApiRoutes = '(?i)(app[\\/]api[\\/]|pages[\\/]api[\\/]|export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE))'
    Database = '(?i)(prisma|mongoose|mongodb|postgres|supabase|sqlite|mysql|mssql|drizzle|sequelize|typeorm)'
    Authentication = '(?i)(nextauth|auth\.js|clerk|supabase.*auth|firebase.*auth|jwt|bcrypt|session)'
    AIIntegration = '(?i)(openai|anthropic|claude|gemini|ollama|langchain|llamaindex|embedding|vector)'
    Reporting = '(?i)(pdf|docx|excel|xlsx|powerbi|report|dashboard|chart|recharts|plotly)'
    ProjectControls = '(?i)(primavera|p6|xer|schedule|baseline|earned.?value|delay.?analysis|time.?impact|critical.?path|float|wbs)'
    SecurityRisk = '(?i)(eval\s*\(|new\s+Function\s*\(|dangerouslySetInnerHTML|child_process|exec\s*\(|spawn\s*\(|password\s*=|secret\s*=|api[_-]?key\s*=)'
    TodoFixme = '(?i)\b(TODO|FIXME|HACK|XXX)\b'
    HardCodedWindowsPath = '(?i)[A-Z]:\\[^"''\r\n]+'
}

foreach ($category in $patterns.Keys) {
    $rows = New-Object System.Collections.Generic.List[object]
    $regex = $patterns[$category]

    foreach ($file in $searchableFiles) {
        $relative = Get-RelativePathSafe -BasePath $ProjectRoot -FullPath $file.FullName
        try {
            $lineNo = 0
            foreach ($line in (Get-Content -LiteralPath $file.FullName -ErrorAction Stop)) {
                $lineNo++
                if ($line -match $regex) {
                    $safeLine = Redact-Text -Text $line.Trim()
                    if ($safeLine.Length -gt 500) { $safeLine = $safeLine.Substring(0,500) }
                    $rows.Add([pscustomobject]@{
                        File = $relative
                        Line = $lineNo
                        Evidence = $safeLine
                    })
                }
            }
        } catch {}
    }

    $rows | Export-Csv -LiteralPath (Join-Path $folders.Evidence "$category.csv") -NoTypeInformation -Encoding UTF8
}

Write-Step "6/10 - Running optional validation commands"

$commandResults = New-Object System.Collections.Generic.List[object]
$npmAvailable = $null -ne (Get-Command npm -ErrorAction SilentlyContinue)

if ($npmAvailable -and (Test-Path -LiteralPath $packageJsonPath)) {
    Push-Location $ProjectRoot
    try {
        Invoke-LoggedCommand -Name "node --version" -LogPath (Join-Path $folders.Logs "node_version.txt") -ContinueOnError -Command { node --version } | Out-Null
        Invoke-LoggedCommand -Name "npm --version" -LogPath (Join-Path $folders.Logs "npm_version.txt") -ContinueOnError -Command { npm --version } | Out-Null
        $commandResults.Add((Invoke-LoggedCommand -Name "npm list --depth=0" -LogPath (Join-Path $folders.Dependencies "npm_list_depth_0.txt") -ContinueOnError -Command { npm list --depth=0 }))

        if ($RunNpmInstall) {
            if (Test-Path -LiteralPath (Join-Path $ProjectRoot "package-lock.json")) {
                $commandResults.Add((Invoke-LoggedCommand -Name "npm ci" -LogPath (Join-Path $folders.Logs "npm_ci.txt") -ContinueOnError -Command { npm ci }))
            } else {
                $commandResults.Add((Invoke-LoggedCommand -Name "npm install" -LogPath (Join-Path $folders.Logs "npm_install.txt") -ContinueOnError -Command { npm install }))
            }
        }

        if ($RunNpmAudit) {
            $commandResults.Add((Invoke-LoggedCommand -Name "npm audit --json" -LogPath (Join-Path $folders.Dependencies "npm_audit.json") -ContinueOnError -Command { npm audit --json }))
        }

        if ($RunTests) {
            $commandResults.Add((Invoke-LoggedCommand -Name "npm test" -LogPath (Join-Path $folders.Logs "npm_test.txt") -ContinueOnError -Command { npm test -- --runInBand }))
        }

        if ($RunBuild) {
            $commandResults.Add((Invoke-LoggedCommand -Name "npm run build" -LogPath (Join-Path $folders.Logs "npm_build.txt") -ContinueOnError -Command { npm run build }))
        }
    } finally {
        Pop-Location
    }
} else {
    "npm validation unavailable. npm installed: $npmAvailable; package.json exists: $(Test-Path -LiteralPath $packageJsonPath)" |
        Set-Content -LiteralPath (Join-Path $folders.Logs "npm_unavailable.txt") -Encoding UTF8
}

if ($commandResults.Count -gt 0) {
    $commandResults | Export-Csv -LiteralPath (Join-Path $folders.Logs "command_results.csv") -NoTypeInformation -Encoding UTF8
}

Write-Step "7/10 - Creating optional safe source snapshot"

if ($IncludeSourceSnapshot) {
    $snapshotExtensions = @(
        ".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",
        ".css",".scss",".html",".md",".mdx",".py",".ps1",
        ".sql",".prisma",".yml",".yaml",".xml",".toml"
    )

    foreach ($file in $allFiles | Where-Object { $snapshotExtensions -contains $_.Extension.ToLowerInvariant() }) {
        $relative = Get-RelativePathSafe -BasePath $ProjectRoot -FullPath $file.FullName

        if ($file.Name -match '^\.env(?:\.|$)' -or $relative -match '(?i)(secret|credential|private.?key)') {
            continue
        }

        $dest = Join-Path $folders.Snapshot $relative
        $destDir = Split-Path -Parent $dest
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null

        try {
            $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop
            Redact-Text -Text $content | Set-Content -LiteralPath $dest -Encoding UTF8
        } catch {}
    }
}

Write-Step "8/10 - Creating report workspace and templates"

$deliverableFiles = @(
    "English\01_Executive_Plain_Language_Report_EN.md",
    "English\02_Application_History_and_Effort_EN.md",
    "English\03_Feature_Benefit_Analysis_EN.md",
    "Arabic_RTL\01_Executive_Plain_Language_Report_AR.md",
    "Arabic_RTL\02_Application_History_and_Effort_AR.md",
    "Arabic_RTL\03_Feature_Benefit_Analysis_AR.md",
    "Technical_Handover\01_Technical_Architecture.md",
    "Technical_Handover\02_Data_Map_and_Dictionary.md",
    "Technical_Handover\03_Pipelines_and_Workflows.md",
    "Technical_Handover\04_API_and_Integration_Register.md",
    "Technical_Handover\05_Configuration_Register.md",
    "Technical_Handover\06_Security_Governance_and_Controls.md",
    "Technical_Handover\07_Test_Strategy_and_Acceptance_Criteria.md",
    "Technical_Handover\08_AI_Agent_Implementation_Specification.md",
    "Technical_Handover\09_Development_Backlog.csv",
    "Technical_Handover\10_Failure_Register.csv",
    "Board_Presentation\Board_Presentation_Content_EN_AR.md",
    "Planning_Department\SAMCO_Planning_Department_Plan_EN.md",
    "Planning_Department\SAMCO_Planning_Department_Plan_AR.md",
    "Planning_Department\Department_Budget_Model.csv",
    "Planning_Department\Department_KPI_Dictionary.csv",
    "Planning_Department\Department_Risk_Register.csv",
    "Planning_Department\Implementation_Roadmap.csv",
    "Appendices\Evidence_Register.csv",
    "Appendices\Management_Decision_Register.csv",
    "Appendices\Subscription_Register.csv"
)

foreach ($relative in $deliverableFiles) {
    $path = Join-Path $folders.Deliverables $relative
    if (-not (Test-Path -LiteralPath $path)) {
        $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
        if ($ext -eq ".csv") {
            "ID,Title,Status,Owner,Evidence,Recommendation" | Set-Content -LiteralPath $path -Encoding UTF8
        } else {
            "# Pending AI-generated content`r`n" | Set-Content -LiteralPath $path -Encoding UTF8
        }
    }
}

$readme = @"
# Project Intelligence Hub — Comprehensive Report Package

Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Project: $ProjectRoot

## Purpose
This package contains evidence, metrics, redacted configuration, Git history, dependency information,
validation logs, the complete bilingual master prompt, and structured report output folders.

## Main folders
- 01_Evidence: factual evidence collected from the repository.
- 02_AI_Agent_Prompt: the final agent instruction and execution request.
- 03_Report_Deliverables: target English, Arabic, technical, presentation, and department-plan outputs.
- 04_Source_Snapshot: optional redacted source snapshot when -IncludeSourceSnapshot is used.

## Security
Actual secret values are intentionally excluded or redacted. Review the package before sharing externally.

## Recommended command
PowerShell:
.\Generate-PIH-Comprehensive-Report.ps1 -RunTests -RunBuild -RunNpmAudit -IncludeSourceSnapshot -RunAgent

Use -Agent Codex, -Agent Claude, or -Agent Gemini to select a specific installed CLI.
"@
$readme | Set-Content -LiteralPath (Join-Path $OutputRoot "README.md") -Encoding UTF8

Write-Step "9/10 - Writing the complete AI-agent prompt"

$masterPrompt = @'
# MASTER PROMPT

## Comprehensive Application Intelligence Report, Technical Handover, Board Presentation, and SAMCO Planning Department Establishment Plan

Act as a multidisciplinary senior consulting team combining the expertise of:

* Chief Executive Officer
* Chief Operating Officer
* Chief Information Officer
* Chief Technology Officer
* Enterprise Solution Architect
* Senior Software Engineer
* AI and Data Engineering Lead
* Cybersecurity and Governance Specialist
* Product Manager
* Business Analyst
* Project Controls Director
* Planning Director
* Cost Control Director
* Commercial and Contracts Director
* PMO Director
* Organizational Development Consultant
* Financial Analyst
* Change Management Consultant
* Corporate Strategy Consultant
* Technical Writer
* Board Presentation Designer

Your assignment is to inspect, understand, evaluate, document, and professionally present the entire application provided to you.

The final result must be sufficiently complete that:

1. A person with no programming knowledge can understand the application, its history, value, limitations, and strategic importance.
2. A programmer or AI coding agent can understand the architecture, data structures, workflows, dependencies, failures, and development priorities and can immediately start fixing or improving the application.
3. Senior management and board members can assess the application's strategic and financial value.
4. A new technical team can take over the application without depending on its original developer.
5. SAMCO can use the application as a foundation for establishing a professional Planning and Project Controls Department.
6. The report clearly demonstrates the effort, iterations, technical work, business thinking, and continuous improvement invested by Eng. Ahmed Labib.
7. The deliverables are professional enough for submission to the CEO, board members, investors, technical consultants, department heads, and prospective development partners.

---

# 1. NON-NEGOTIABLE WORKING RULES

You must not produce a generic report.

Before preparing the report, inspect all available project materials, including where available:

* Source-code files
* Application folders
* Configuration files
* Environment files
* Databases
* Data files
* Uploaded documents
* User manuals
* Screenshots
* Previous versions
* Backup versions
* Git history
* Commit history
* Changelogs
* Test files
* Reports generated by the application
* Templates
* Prompts
* API integrations
* AI integrations
* Streamlit or web application files
* Python modules
* JavaScript or TypeScript files
* CSS and HTML files
* Requirements files
* Package files
* Deployment files
* Logs
* Error messages
* User feedback
* Development notes
* Readme files
* Diagrams
* Sample outputs
* External service configurations
* Cloud-service integrations
* Subscription-dependent features

Do not claim that a feature exists unless you find evidence for it.

For every important finding, classify it as one of the following:

* Verified and functional
* Verified but partially functional
* Present in code but not proven operational
* Designed but not implemented
* Planned or described only
* Broken or failing
* Dependent on missing data
* Dependent on configuration
* Dependent on a paid subscription
* Dependent on an external API
* Dependent on infrastructure or deployment
* Unable to verify

Clearly distinguish:

* Existing functionality
* Partially implemented functionality
* Proposed functionality
* Aspirational vision
* Technical assumptions
* Confirmed failures
* Potential risks

Never exaggerate, invent, or conceal weaknesses.

Where evidence is incomplete, state:

* What was inspected
* What could not be verified
* What evidence is missing
* How the point can be verified
* The business impact of the uncertainty

---

# 2. REQUIRED OUTPUT LANGUAGES AND AUDIENCE LEVELS

Produce the complete deliverables in both:

## Language A: Professional English

Use clear international business English suitable for:

* Board members
* CEOs
* Department heads
* Investors
* Managers
* Non-technical stakeholders
* International consultants
* Software engineers
* AI coding agents

## Language B: Modern Standard Arabic

The Arabic version must:

* Use professional Modern Standard Arabic.
* Be written fully from right to left.
* Use correct Arabic business, engineering, planning, contractual, financial, and technical terminology.
* Avoid informal dialect.
* Preserve technical terms in English between parentheses where useful.
* Maintain the same structure and depth as the English version.
* Not be a shortened summary of the English report.
* Use Arabic-first tables and right-to-left column ordering.

For each language, provide two interpretation layers:

### Layer 1 — Plain-Language Business Explanation

This layer is for readers who have no programming or software-development background.

Explain:

* What the application does
* Why it was created
* What problems it solves
* How users interact with it
* What value it creates
* What currently works
* What does not work
* What requires improvement
* Why the application matters to the organization

Avoid unexplained technical jargon.

When technical terminology is necessary, immediately explain it in simple language.

### Layer 2 — Technical and Machine-Actionable Specification

This layer is for:

* Software developers
* Data engineers
* AI coding agents
* DevOps engineers
* Technical consultants
* Cybersecurity specialists
* Database administrators
* Solution architects

Use accurate technical terminology, structured specifications, tables, file references, pseudocode, schemas, dependency maps, interface descriptions, and implementation instructions.

The technical layer must be detailed enough for another programmer or AI agent to begin development without requiring verbal explanation from the original developer.

---

# 3. REQUIRED DELIVERABLE PACKAGE

Prepare the following outputs:

1. Executive application report
2. Plain-language application guide
3. Detailed technical architecture report
4. Development history and effort report
5. Feature catalogue and benefit analysis
6. Failure, gap, and limitation register
7. Subscription and paid-service assessment
8. Complete data map
9. Complete pipeline and workflow map
10. Technical handover manual
11. Software improvement roadmap
12. Governance, security, and control framework
13. Board-level business case
14. Application valuation and replacement-cost estimate
15. Professional board presentation content
16. SAMCO Planning Department establishment plan
17. Integration plan between the application and the Planning Department
18. Ninety-day, one-year, and three-year implementation roadmap
19. Management decision register
20. Appendices with evidence, diagrams, inventories, and technical specifications

---

# 4. REPORT TITLE

Use a professional title such as:

**Enterprise Application Intelligence, Technical Handover, Strategic Value, and Planning Department Transformation Report**

Subtitle:

**Prepared for SAMCO Executive Management and Board Members**

Prepared by:

**Eng. Ahmed Labib**
**Planning Engineer | Project Controls and Digital Transformation**

Add the date, application name, version, confidentiality classification, and document revision.

---

# 5. EXECUTIVE SUMMARY

Prepare a board-level executive summary that explains:

* What the application is
* Why it was created
* The business problem it addresses
* The vision behind it
* The current maturity level
* The strongest existing capabilities
* The major limitations
* The value already created
* The future potential
* The critical decisions required from management
* The funding, subscriptions, resources, and governance required
* How the application can support SAMCO’s growth
* How it can become the digital operating platform of the proposed Planning Department
* Why the application represents a substantial amount of accumulated work, domain expertise, and intellectual capital

Include a one-page management verdict using:

* Strategic value
* Operational value
* Financial value
* Technical maturity
* Scalability
* Data readiness
* Security readiness
* User readiness
* Management readiness
* Implementation urgency

Use a rating from 1 to 5 and explain each score.

---

# 6. APPLICATION HISTORY AND DEVELOPMENT EFFORT

Reconstruct the application’s history as accurately as possible.

Document:

* Original business problem
* Initial concept
* First prototype
* Early design decisions
* Major development stages
* Significant revisions
* Architecture changes
* Interface improvements
* Data-processing improvements
* AI-related improvements
* Reporting improvements
* Testing rounds
* User feedback incorporated
* Failures encountered
* Corrective actions taken
* Current development stage
* Planned future stages

Create a chronological timeline with:

| Stage | Approximate Date | Version | Main Objective | Features Added | Problems Solved | Problems Remaining | Evidence |
| ----- | ---------------- | ------- | -------------- | -------------- | --------------- | ------------------ | -------- |

Show the effort invested through measurable indicators, where evidence permits:

* Number of source files
* Lines of code
* Number of modules
* Number of functions
* Number of classes
* Number of interfaces
* Number of data pipelines
* Number of reports
* Number of templates
* Number of development iterations
* Number of identified and corrected failures
* Number of integrated data sources
* Number of supported file types
* Number of screens or dashboards
* Number of business workflows supported
* Number of technical dependencies
* Number of documented business rules

Do not use lines of code as the only measure of effort.

Also assess:

* Domain knowledge embedded in the application
* Planning and project-controls knowledge embedded in the application
* Contract and claims knowledge embedded in the application
* Data engineering effort
* Reporting design effort
* User-experience effort
* Prompt-engineering effort
* Testing and debugging effort
* Research and process-design effort

Clearly show that the application is not merely a software interface, but a structured accumulation of operational knowledge, technical logic, management methodology, and project-controls intelligence.

---

# 7. APPLICATION VISION AND BUSINESS PURPOSE

Explain the intended vision of the application.

Separate the following:

* Current reality
* Intended future state
* Business vision
* Technical vision
* Organizational vision
* Data vision
* AI vision
* Governance vision
* Reporting vision

Create a vision-to-capability traceability table:

| Vision Objective | Required Capability | Current Status | Existing Evidence | Main Gap | Recommended Action |
| ---------------- | ------------------- | -------------- | ----------------- | -------- | ------------------ |

Identify which failures or limitations currently prevent the full vision from being achieved.

---

# 8. COMPLETE FEATURE CATALOGUE

Identify every major and minor application feature.

For each feature, document:

* Feature name
* Business description
* Plain-language explanation
* Intended users
* Business problem solved
* Inputs
* Processing logic
* Outputs
* Dependencies
* Data source
* Current status
* Current reliability
* Current limitations
* Business importance
* Technical importance
* Financial value
* Risk if unavailable
* Improvement priority
* Recommended enhancement
* Evidence location in the code or files

Use a feature matrix:

| ID | Feature | Purpose | User | Input | Output | Status | Business Value | Limitation | Priority |
| -- | ------- | ------- | ---- | ----- | ------ | ------ | -------------- | ---------- | -------- |

Group features under relevant categories, such as:

* Data ingestion
* Document processing
* Data validation
* Schedule analysis
* Project controls
* Progress monitoring
* Cost control
* Earned value management
* Delay analysis
* Contract analysis
* Evidence management
* Claims support
* Reporting
* Dashboards
* AI assistance
* Search
* Knowledge management
* Workflow management
* Notifications
* Approval controls
* User management
* Security
* Audit trail
* Export
* Integration
* Administration
* Configuration
* Backup and recovery

For each feature, explain how it supports the company in:

* Reducing time
* Improving accuracy
* Reducing dependency on individuals
* Standardizing procedures
* Supporting decisions
* Preserving institutional knowledge
* Reducing claims exposure
* Increasing commercial recovery
* Improving project visibility
* Improving resource utilization
* Improving schedule reliability
* Improving compliance
* Improving executive control

---

# 9. FAILURES, LIMITATIONS, AND VISION BLOCKERS

Conduct a comprehensive failure and gap analysis.

Inspect for:

* Application crashes
* Broken pages
* Non-functional buttons
* Missing modules
* Invalid imports
* Missing dependencies
* Hard-coded paths
* Hard-coded passwords or credentials
* Incomplete workflows
* Dead code
* Duplicate code
* Unused functions
* Inconsistent naming
* Poor error handling
* Missing validation
* Missing database constraints
* Missing tests
* Slow performance
* Memory problems
* CPU or GPU limitations
* API failures
* Subscription limitations
* Deployment failures
* Permission problems
* Security weaknesses
* Data-loss risks
* Inaccurate outputs
* Unsupported file formats
* Incomplete user experience
* Missing audit trail
* Missing access control
* Missing logging
* Missing version control
* Missing documentation
* Missing backup procedures
* Scalability problems
* Vendor lock-in
* Manual processes that should be automated
* Features that appear functional but are not fully connected
* Features dependent on sample data
* Features dependent on the developer’s local computer

Create a failure register:

| ID | Failure or Gap | Category | Evidence | Root Cause | Business Impact | Technical Impact | Severity | Probability | Recommended Fix | Estimated Effort |
| -- | -------------- | -------- | -------- | ---------- | --------------- | ---------------- | -------- | ----------- | --------------- | ---------------- |

Use severity levels:

* Critical
* High
* Medium
* Low

For each critical or high-severity failure, provide:

1. Problem statement
2. Root-cause analysis
3. Affected files or modules
4. Reproduction method
5. Expected behavior
6. Actual behavior
7. Immediate containment action
8. Permanent correction
9. Required testing
10. Acceptance criteria

Identify the top ten blockers preventing the original application vision from being fully implemented.

---

# 10. SUBSCRIPTION AND PAID-SERVICE ASSESSMENT

Identify all features that are currently restricted, degraded, simulated, slow, or unavailable due to free plans or missing subscriptions.

Review possible dependencies such as:

* AI model subscriptions
* OpenAI API
* Anthropic API
* Google APIs
* Microsoft Azure
* AWS
* Cloud hosting
* Database hosting
* Vector databases
* OCR services
* Document-processing APIs
* Email services
* SMS services
* WhatsApp services
* Cloud storage
* GitHub services
* Monitoring services
* Authentication services
* PDF-processing services
* Mapping services
* Power BI
* Microsoft 365
* Primavera integrations
* ERP integrations
* Project-management platforms
* Cybersecurity tools
* Backup services

For each service, provide:

| Service | Current Plan | Current Limitation | Feature Affected | Paid Option | Expected Improvement | Monthly Cost | Annual Cost | Priority | Alternative |
| ------- | ------------ | ------------------ | ---------------- | ----------- | -------------------- | ------------ | ----------- | -------- | ----------- |

Costs must be clearly classified as:

* Verified current price
* Estimated price
* Budget allowance
* Requires vendor quotation

Explain:

* What becomes functional after payment
* What becomes faster
* What becomes more accurate
* What becomes more scalable
* What becomes more secure
* What remains dependent on custom development
* What payment will not solve
* Which subscriptions are essential
* Which subscriptions are optional
* Which subscriptions should be deferred

Create three subscription scenarios:

1. Minimum viable professional setup
2. Recommended company setup
3. Enterprise-scale setup

Include monthly and annual cost estimates for each scenario.

---

# 11. COMPLETE DATA MAPPING

Create a comprehensive data inventory.

Identify all data objects, including where relevant:

* Projects
* Users
* Organizations
* Contracts
* Activities
* Work breakdown structures
* Calendars
* Resources
* Costs
* Budgets
* Baselines
* Updates
* Progress records
* Milestones
* Risks
* Issues
* Delays
* Events
* Claims
* Notices
* Letters
* RFIs
* IFC drawings
* IRs
* MIRs
* Variations
* Change orders
* Payment certificates
* Procurement records
* Material deliveries
* Subcontractors
* Equipment
* Manpower
* Productivity
* KPIs
* Evidence files
* Reports
* Dashboards
* AI prompts
* AI responses
* System logs
* Configuration settings

For each data object, provide:

| Object | Description | Source | Format | Key Fields | Primary Key | Relationships | Validation | Owner | Sensitivity | Retention |
| ------ | ----------- | ------ | ------ | ---------- | ----------- | ------------- | ---------- | ----- | ----------- | --------- |

Create:

* Entity relationship description
* Data dictionary
* Field dictionary
* Data ownership matrix
* Data classification matrix
* Data-retention matrix
* Data-quality rules
* Master-data management rules
* Data lineage
* Source-to-target mapping
* Import and export mapping
* Duplicate-handling rules
* Error-handling rules
* Missing-data rules
* Data-validation rules

Where possible, generate:

* SQL-style table definitions
* JSON schemas
* Pydantic models
* API payload examples
* CSV column templates
* Database relationship maps
* Mermaid entity relationship diagrams

---

# 12. PIPELINE AND WORKFLOW UNDERSTANDING

Document every major application pipeline.

For each pipeline, explain:

* Trigger
* Input
* Preprocessing
* Validation
* Transformation
* Business logic
* AI processing
* Database operation
* Output generation
* User review
* Approval
* Export
* Archiving
* Error handling
* Audit logging

Use this table:

| Pipeline | Trigger | Input | Processing Steps | Output | Dependencies | Failure Points | Recovery Method |
| -------- | ------- | ----- | ---------------- | ------ | ------------ | -------------- | --------------- |

Prepare diagrams for:

* System context
* User journey
* Data ingestion
* Document analysis
* AI processing
* Schedule analysis
* Delay-analysis workflow
* Contract-analysis workflow
* Evidence-analysis workflow
* Reporting workflow
* Approval workflow
* Export workflow
* Authentication and authorization
* Backup and recovery
* External integrations

Use Mermaid syntax for all diagrams so they can be edited.

Example:

```mermaid
flowchart LR
    A[User Uploads File] --> B[File Validation]
    B --> C[Data Extraction]
    C --> D[Business Rule Processing]
    D --> E[AI Analysis]
    E --> F[Quality Check]
    F --> G[Dashboard and Report]
```

Do not use this example as a substitute for analyzing the actual application.

---

# 13. SOFTWARE ARCHITECTURE AND CODEBASE HANDOVER

Prepare a full technical handover package.

Include:

## 13.1 Repository Structure

Document every important folder and file:

| Path | Type | Purpose | Main Dependencies | Used By | Status | Recommended Action |
| ---- | ---- | ------- | ----------------- | ------- | ------ | ------------------ |

## 13.2 Architecture

Identify:

* Architecture pattern
* Frontend framework
* Backend framework
* Database
* AI services
* Authentication
* File storage
* API layer
* Reporting engine
* Configuration management
* Logging
* Testing
* Deployment
* Monitoring

## 13.3 Module Inventory

For every major module, provide:

* Responsibility
* Inputs
* Outputs
* Public functions
* Public classes
* Dependencies
* Side effects
* Known errors
* Test coverage
* Refactoring recommendation

## 13.4 Function and Class Catalogue

Provide a machine-readable catalogue:

| File | Function or Class | Purpose | Parameters | Return Value | Called By | Risk | Notes |
| ---- | ----------------- | ------- | ---------- | ------------ | --------- | ---- | ----- |

## 13.5 Environment and Installation

Provide exact instructions for:

* Required operating system
* Required Python or runtime version
* Virtual environment
* Dependency installation
* Environment variables
* Database setup
* API keys
* Folder permissions
* Application startup
* Test execution
* Production deployment
* Backup
* Recovery
* Troubleshooting

## 13.6 Configuration Register

| Variable | Purpose | Required | Default | Sensitive | Example | Validation |
| -------- | ------- | -------- | ------- | --------- | ------- | ---------- |

Never expose actual secret values.

## 13.7 Dependency Analysis

Identify:

* Direct dependencies
* Indirect dependencies
* Outdated packages
* Vulnerable packages
* Unused packages
* Version conflicts
* Licensing issues
* Replacement recommendations

## 13.8 API and Integration Catalogue

| API | Direction | Endpoint | Authentication | Input | Output | Error Handling | Status |
| --- | --------- | -------- | -------------- | ----- | ------ | -------------- | ------ |

## 13.9 Testing Strategy

Assess:

* Unit testing
* Integration testing
* End-to-end testing
* Performance testing
* Security testing
* User acceptance testing
* Regression testing
* Data-quality testing

Provide missing test cases and acceptance criteria.

---

# 14. MACHINE-ACTIONABLE DEVELOPMENT SPECIFICATION

Create a section specifically for another AI coding agent.

The section must include:

* System objective
* Current architecture
* Required target architecture
* Repository map
* Priority defects
* Priority enhancements
* Coding standards
* Naming standards
* Error-handling standards
* Logging standards
* Security requirements
* Data contracts
* API contracts
* Testing requirements
* Definition of done
* Release criteria
* Prohibited changes
* Backward-compatibility requirements
* Migration requirements

Create a prioritized development backlog:

| Epic | User Story | Technical Task | Priority | Dependency | Acceptance Criteria | Estimated Complexity |
| ---- | ---------- | -------------- | -------- | ---------- | ------------------- | -------------------- |

Use priorities:

* P0 — Immediate critical correction
* P1 — Essential for stable use
* P2 — Important enhancement
* P3 — Future optimization

Provide implementation-ready instructions rather than general recommendations.

For each P0 and P1 item, state:

* Files likely to be modified
* New files required
* Functions affected
* Database changes
* User-interface changes
* Tests required
* Deployment risks
* Rollback plan

---

# 15. SECURITY, GOVERNANCE, AND CONTROL

Evaluate the application against professional enterprise controls.

Assess:

* Authentication
* Role-based access control
* Permissions
* Segregation of duties
* Password handling
* Secret management
* Data encryption
* File security
* Database security
* API security
* Input validation
* Malicious-file handling
* Logging
* Audit trail
* Data privacy
* Backup
* Disaster recovery
* Business continuity
* Change management
* Release management
* Version control
* User administration
* Incident management
* Third-party risk
* AI governance
* Model-output validation
* Human approval controls

Create:

* Role and permission matrix
* RACI matrix
* Risk register
* Control register
* Audit checklist
* Business continuity plan
* Backup and restoration plan
* Incident-response workflow
* Change-control workflow
* Release-approval workflow

Propose user roles such as:

* Board Viewer
* CEO
* COO
* Planning Director
* Project Manager
* Planning Manager
* Planning Engineer
* Cost Control Engineer
* Contracts Manager
* Commercial Manager
* Document Controller
* Department Administrator
* Data Analyst
* IT Administrator
* Auditor
* Read-Only User

---

# 16. NEXT MOVE FOR FULL ORGANIZATIONAL CONTROL

Develop a realistic operating model showing how the organization can use the application to obtain full visibility and control.

Address:

* Centralized project data
* Standardized reporting
* Project portfolio visibility
* Schedule governance
* Baseline approval
* Progress measurement
* Cost control
* Forecasting
* Resource planning
* Delay management
* Claims management
* Contract administration
* Risk management
* Procurement visibility
* Executive dashboards
* Department accountability
* Document control
* Audit trails
* Decision tracking
* Lessons learned
* Organizational knowledge retention

Define:

* What must be centralized
* What can remain project-specific
* What must be approved
* Who owns each dataset
* Who validates each report
* Who has authority to change data
* What reports management must receive
* How frequently reports must be issued
* What escalation thresholds must apply
* What data-quality controls are required

Create a governance structure covering:

* Board
* CEO
* COO
* PMO or Project Controls
* Planning Department
* Project Managers
* Commercial Department
* Contracts Department
* Finance
* Procurement
* Technical Office
* Quality
* HSE
* IT
* Document Control

---

# 17. PROFESSIONAL BOARD DOCUMENT

Prepare a professional Word-report specification suitable for executive presentation.

The Word document must include:

* Professional cover page
* Confidentiality notice
* Document-control table
* Table of contents
* Executive summary
* Management dashboard
* Application history
* Application vision
* Feature overview
* Value to SAMCO
* Failure and gap analysis
* Subscription assessment
* Technical architecture
* Data and workflow diagrams
* Strategic roadmap
* Financial analysis
* Application valuation
* Planning Department proposal
* Implementation plan
* Management decisions required
* Conclusion
* Appendices

Design requirements:

* Clean corporate visual identity
* Professional construction and project-controls theme
* Consistent headers and footers
* High-quality tables
* KPI cards
* Timelines
* Process diagrams
* Heat maps
* Risk matrices
* Roadmaps
* Organization charts
* Financial charts
* Callout boxes
* Executive conclusions
* Page numbers
* Version control
* English left-to-right layout
* Arabic right-to-left layout
* Correct Arabic table direction

Suggested footer:

Left:
**SAMCO | Egypt**

Right:
**Prepared by Eng. Ahmed Labib**

Do not overcrowd pages.

Every page must have a clear management message.

---

# 18. BOARD PRESENTATION CONTENT

Prepare a 20–30 slide board presentation.

Suggested structure:

1. Title
2. Executive message
3. Business problem
4. Application vision
5. Development journey
6. Effort and intellectual capital invested
7. Current system overview
8. Main features
9. Operational benefits
10. Strategic benefits
11. Financial benefits
12. Current limitations
13. Critical failures
14. Subscription impact
15. Architecture overview
16. Data-flow overview
17. Management-control model
18. Application value and replacement cost
19. Why SAMCO should protect and develop the application
20. Planning Department vision
21. Proposed organization structure
22. Department processes
23. Application and department integration
24. Required people and competencies
25. Required budget
26. Implementation roadmap
27. Key risks and controls
28. Decisions required from the board
29. Recommended next steps
30. Closing statement

For every slide, provide:

* Slide title
* Main message
* Recommended visual
* Slide content
* Speaker notes
* Board question anticipated
* Recommended answer

The presentation must demonstrate value factually and professionally.

Do not use unsupported statements such as “the best application ever.”

Instead, prove importance through:

* Capabilities
* Cost avoidance
* Time savings
* Risk reduction
* Knowledge captured
* Integration potential
* Replacement cost
* Strategic fit
* Scalability
* Operational dependency
* Competitive advantage

---

# 19. APPLICATION VALUE AND REPLACEMENT-COST ASSESSMENT

Estimate what another organization would need to spend to create a comparable application.

Use multiple valuation methods:

## 19.1 Replacement-Cost Method

Estimate:

* Business analysis
* Planning and project-controls design
* Software architecture
* Frontend development
* Backend development
* Data engineering
* AI integration
* Document processing
* Reporting design
* Quality assurance
* Cybersecurity
* Deployment
* Documentation
* Training
* Project management
* Support and maintenance

## 19.2 Development-Effort Method

Estimate roles, person-months, and professional rates.

## 19.3 Commercial Software Comparison

Compare the application concept with combinations of commercial tools that would otherwise be required.

## 19.4 Strategic-Value Method

Assess:

* Reduced reporting effort
* Faster management decisions
* Reduced claims leakage
* Improved schedule recovery
* Better forecasting
* Reduced reliance on individual employees
* Improved auditability
* Improved organizational knowledge retention

Use conservative, realistic assumptions.

Express estimates as ranges, not false precision.

Clearly classify all values as:

* Evidence-based
* Market-based estimate
* Internal assumption
* Requires quotation

Provide low, expected, and high scenarios.

---

# 20. COMPLETE SAMCO PLANNING DEPARTMENT ESTABLISHMENT PLAN

Prepare a comprehensive, detailed, and fully professional plan to establish a Planning and Project Controls Department at SAMCO.

The department must reflect the maturity, discipline, and governance associated with leading global organizations while remaining practical for:

* SAMCO’s size
* Egyptian construction-market conditions
* International contracting requirements
* SAMCO’s available resources
* Existing organizational culture
* Current management maturity
* Existing project types
* Expected future growth
* Local labor-market capabilities
* Legal and contractual requirements
* Client and consultant expectations

Use leading organizations such as Apple, Lockheed Martin, BlackRock, major EPC contractors, international consultants, and global construction companies only as references for governance, disciplined execution, data-driven management, quality assurance, innovation, risk control, and accountability.

Do not copy their organizational structures blindly.

Translate relevant principles into a realistic construction and project-controls operating model for SAMCO.

---

# 21. PLANNING DEPARTMENT BUSINESS CASE

Explain:

* Why SAMCO needs the department
* Problems caused by not having a formal Planning Department
* Current risks
* Direct financial losses
* Indirect financial losses
* Claims and contractual risks
* Delay exposure
* Forecasting weaknesses
* Resource-control weaknesses
* Management-information weaknesses
* Reputational risks
* Client-confidence risks
* Tendering weaknesses
* Lessons-learned weaknesses
* Organizational dependency on individuals

Quantify where possible:

* Delay-cost exposure
* Lost productivity
* Unrecovered claims
* Poor resource allocation
* Weak cash-flow visibility
* Late decision-making
* Reporting labor
* Schedule slippage
* Procurement delays
* Subcontractor delays
* Rework
* Idle resources
* Penalties
* Lost opportunities

Explain the department’s expected contribution to:

* Revenue protection
* Cost avoidance
* Claims recovery
* Margin improvement
* Cash-flow improvement
* Tender competitiveness
* Client confidence
* Project delivery
* Resource efficiency
* Organizational scalability
* Corporate valuation
* Joint-venture readiness
* International prequalification

---

# 22. DEPARTMENT VISION, MISSION, AND MANDATE

Prepare:

* Vision
* Mission
* Strategic objectives
* Department charter
* Authority statement
* Scope
* Interfaces with other departments
* Services catalogue
* Management expectations
* Success criteria

The department mandate should cover:

* Tender planning
* Baseline planning
* Progress updating
* Cost loading
* Resource loading
* Schedule risk
* Delay analysis
* Extension-of-time support
* Productivity analysis
* Progress measurement
* Forecasting
* Cash flow
* Earned value
* Procurement planning
* Subcontractor planning
* Recovery planning
* Management reporting
* Portfolio reporting
* Data governance
* Lessons learned
* Planning standards
* Schedule assurance
* Training
* System administration
* Digital transformation

---

# 23. ORGANIZATION STRUCTURE

Develop scalable organization structures for three maturity stages:

## Stage 1 — Establishment

Suitable for immediate launch with limited budget.

## Stage 2 — Controlled Growth

Suitable for several active projects.

## Stage 3 — Enterprise Project Controls

Suitable for portfolio-level and international operations.

Consider positions such as:

* Planning and Project Controls Director
* Planning Manager
* Senior Planning Engineer
* Planning Engineer
* Junior Planning Engineer
* Cost Control Manager
* Cost Control Engineer
* Delay and Claims Planning Specialist
* Risk Engineer
* Reporting and BI Analyst
* Data Engineer
* Project Controls Systems Administrator
* Department Coordinator
* Document and Evidence Analyst

For every role, provide:

* Role purpose
* Responsibilities
* Authority
* Required experience
* Qualifications
* Technical competencies
* Behavioral competencies
* Software competencies
* KPIs
* Reporting line
* Interfaces
* Estimated staffing timing

Clearly identify Eng. Ahmed Labib as the proposed department founder and implementation lead, subject to management approval.

Define his proposed mandate, responsibilities, authority, initial objectives, performance indicators, and support required from management.

---

# 24. DEPARTMENT PROCESSES AND PROCEDURES

Design complete procedures for:

* Tender schedule preparation
* Contract schedule review
* Baseline development
* Baseline approval
* Schedule coding
* WBS standards
* Calendar standards
* Activity naming
* Logic review
* Constraint control
* Resource loading
* Cost loading
* Progress measurement
* Weekly updating
* Monthly updating
* Schedule narrative
* Look-ahead planning
* Recovery planning
* What-if analysis
* Forecasting
* Delay-event identification
* Delay notices
* Time-impact analysis
* Windows analysis
* Extension-of-time submissions
* Concurrency review
* Productivity analysis
* Earned value management
* Cash-flow forecasting
* Procurement schedule
* Engineering schedule
* Subcontractor control
* Risk management
* Executive reporting
* Portfolio reporting
* Data validation
* Report approval
* Change control
* Lessons learned
* Schedule archiving
* Closeout planning

For each procedure, define:

| Procedure | Trigger | Owner | Inputs | Steps | Output | Approval | Frequency | KPI | System Support |
| --------- | ------- | ----- | ------ | ----- | ------ | -------- | --------- | --- | -------------- |

---

# 25. PLANNING STANDARDS AND GOVERNANCE

Develop department standards covering:

* Primavera P6
* Schedule levels
* WBS
* OBS
* Activity codes
* Project codes
* Calendars
* Baseline management
* Data dates
* Progress methods
* Critical path
* Float
* Constraints
* Lags
* Open ends
* Relationship quality
* Resource loading
* Cost loading
* Schedule health
* DCMA-style checks
* Schedule narratives
* Recovery schedules
* Delay analysis
* Claims support
* Document retention
* Schedule version control
* Approval workflow

Specify:

* Minimum acceptable schedule quality
* Required update frequency
* Mandatory review checks
* Approval authority
* Escalation thresholds
* Non-compliance actions

---

# 26. REPORTING FRAMEWORK

Define all reports required from the Planning Department.

Include:

* Daily dashboard
* Weekly progress report
* Two-week look-ahead
* Four-week look-ahead
* Monthly progress report
* Executive dashboard
* Portfolio dashboard
* Critical-path report
* Milestone report
* Delay-event register
* Procurement report
* Engineering report
* Resource report
* Manpower histogram
* Equipment histogram
* Productivity report
* Cost report
* Cash-flow report
* Earned-value report
* Risk report
* Claims-status report
* Recovery-plan report
* Management-action tracker

For each report:

| Report | Audience | Purpose | Frequency | Owner | Data Source | KPIs | Approval | Application Support |
| ------ | -------- | ------- | --------- | ----- | ----------- | ---- | -------- | ------------------- |

Explain how each report benefits:

* CEO
* COO
* Project Director
* Project Manager
* Finance
* Commercial
* Contracts
* Procurement
* Technical Office
* Quality
* HSE
* Client
* Consultant

---

# 27. KPI FRAMEWORK

Design department and project KPIs, including:

* Schedule performance index
* Cost performance index
* Planned versus actual progress
* Forecast completion variance
* Milestone compliance
* Critical-path movement
* Total-float trend
* Delay-notification timeliness
* Procurement compliance
* Engineering-deliverable compliance
* Resource productivity
* Schedule-update timeliness
* Schedule-quality score
* Recovery-plan effectiveness
* Claim-notice compliance
* Change incorporation time
* Report submission compliance
* Forecast accuracy
* Data-quality score
* Management-action closure
* Application adoption

For each KPI, provide:

* Definition
* Formula
* Data source
* Owner
* Frequency
* Target
* Warning threshold
* Critical threshold
* Required management action

---

# 28. DEPARTMENT BUDGET

Prepare a realistic budget with three scenarios:

1. Lean establishment
2. Recommended professional department
3. Enterprise project-controls function

Include:

* Salaries
* Recruitment
* Training
* Certifications
* Primavera licenses
* Microsoft 365
* Power BI
* Cloud hosting
* AI subscriptions
* Database services
* Hardware
* Monitors
* Server or cloud infrastructure
* Backup
* Cybersecurity
* Document management
* Consulting
* Office setup
* Travel
* Contingency
* Annual maintenance
* Application development
* Application support

Show:

* One-time establishment cost
* Monthly operating cost
* Annual operating cost
* Three-year cost
* Cost per active project
* Cost per employee
* Budget assumptions
* Low, expected, and high estimates

Use Egyptian pounds where local budgeting is required.

Use US dollars only where international software or services are normally priced in US dollars.

Do not convert currencies unless exchange-rate evidence is available.

---

# 29. FINANCIAL RETURN AND EXPECTED INCOME

Explain that the department may not operate as a direct sales department, but it creates measurable economic value.

Calculate potential return through:

* Avoided liquidated damages
* Improved claim recovery
* Reduced idle resources
* Reduced reporting effort
* Improved procurement timing
* Improved cash-flow forecasting
* Reduced rework
* Earlier risk identification
* Better tender pricing
* Improved project selection
* Improved subcontractor control
* Improved variation recovery
* Improved management decisions
* Reduced project overruns

Develop:

* Conservative case
* Expected case
* Optimistic case

For each case, show:

* Annual department cost
* Estimated cost avoidance
* Estimated recoverable entitlement
* Estimated productivity benefit
* Net benefit
* Return on investment
* Payback period

All assumptions must be transparent and editable.

---

# 30. TRAINING AND COMPETENCY DEVELOPMENT

Create a training plan for:

* Department founder
* Planning Manager
* Planning Engineers
* Cost Control Engineers
* Project Managers
* Department heads
* Senior management
* Application users

Cover:

* Primavera P6
* Advanced planning
* Schedule quality
* Cost control
* Earned value
* Delay analysis
* FIDIC
* Claims
* Contract administration
* Power BI
* Excel and Power Query
* Data analysis
* AI usage
* Cybersecurity
* Reporting
* Presentation skills
* Leadership
* Change management

For each course, state:

* Target role
* Purpose
* Priority
* Suggested certification
* Delivery method
* Estimated duration
* Estimated cost category
* Expected competency outcome

---

# 31. APP AND PLANNING DEPARTMENT INTEGRATION

Explain exactly how the application will support the department.

Map application modules to department processes:

| Department Process | Application Feature | Current Status | Required Improvement | Business Benefit |
| ------------------ | ------------------- | -------------- | -------------------- | ---------------- |

The application should potentially support:

* Standard templates
* Schedule import
* Schedule health checks
* Progress analysis
* Delay-event tracking
* Evidence linkage
* Contract-clause retrieval
* Notice preparation
* Claims support
* Executive dashboards
* Portfolio reporting
* Resource analysis
* Cost analysis
* Forecasting
* Data validation
* Management action tracking
* Lessons learned
* Department procedures
* User training
* Knowledge management

Define the application’s role as:

* Department operating platform
* Knowledge-management platform
* Reporting platform
* Decision-support platform
* Evidence repository
* Project-controls intelligence system
* AI-assisted analysis layer

Clearly identify which capabilities are currently available and which require development.

---

# 32. IMPLEMENTATION ROADMAP

Develop phased roadmaps for:

## First 30 Days

* Governance
* Management approval
* Initial application stabilization
* Current-project assessment
* Templates
* Basic reporting
* Staffing
* Data collection

## First 60 Days

* Procedures
* Baseline reviews
* Reporting cycle
* Training
* Application pilot
* Data-quality controls
* Portfolio dashboard

## First 90 Days

* Full department launch
* Approved governance
* Standard reporting
* Application-controlled workflows
* KPI monitoring
* Management review

## First Year

* Department maturity
* Application improvements
* Portfolio control
* Claims and delay capability
* Cost control
* Digital integration
* Audit readiness

## Three Years

* Enterprise project controls
* Predictive analytics
* AI-supported forecasting
* Full project portfolio management
* International joint-venture readiness
* Integrated commercial, planning, finance, and procurement data

For each phase, provide:

| Action | Owner | Start | Finish | Dependency | Cost | Deliverable | Acceptance Criteria |
| ------ | ----- | ----- | ------ | ---------- | ---- | ----------- | ------------------- |

---

# 33. CHANGE MANAGEMENT AND COMPANY CULTURE

Analyze likely cultural and organizational challenges, including:

* Resistance to transparency
* Resistance to formal reporting
* Incomplete data
* Departmental silos
* Lack of accountability
* Manual working habits
* Weak schedule ownership
* Late data submission
* Fear of performance measurement
* Dependence on individuals
* Lack of management enforcement
* Conflict between site teams and head office
* Limited technical skills
* Misunderstanding of the Planning Department’s role

Provide a change-management plan covering:

* Executive sponsorship
* Stakeholder mapping
* Communication
* Training
* Pilot projects
* Quick wins
* Incentives
* Accountability
* Adoption measurement
* Escalation
* Feedback
* Continuous improvement

Adapt the model to Egyptian company culture while maintaining international professional standards.

---

# 34. RISK REGISTER FOR DEPARTMENT ESTABLISHMENT

Create a detailed risk register:

| ID | Risk | Cause | Effect | Probability | Impact | Rating | Mitigation | Owner | Early Warning |
| -- | ---- | ----- | ------ | ----------- | ------ | ------ | ---------- | ----- | ------------- |

Include risks related to:

* Management support
* Budget
* Recruitment
* Data availability
* Software licensing
* Application reliability
* Cybersecurity
* User adoption
* Department authority
* Project-team cooperation
* Reporting quality
* Client requirements
* Contractual requirements
* Staff turnover
* Overdependence on one person
* Change resistance
* Incomplete procedures
* Unrealistic implementation speed

---

# 35. MANAGEMENT DECISIONS REQUIRED

Conclude with a precise decision paper.

List the decisions required from the board or CEO, such as:

* Approve Planning Department establishment
* Appoint department implementation lead
* Approve initial authority and reporting line
* Approve pilot projects
* Approve budget
* Approve recruitment
* Approve required subscriptions
* Approve application stabilization
* Approve data-governance rules
* Approve standard reporting cycle
* Approve department procedures
* Approve training plan
* Approve implementation timeline

For each decision, state:

| Decision | Reason | Cost | Benefit | Risk of Delay | Recommended Deadline |
| -------- | ------ | ---- | ------- | ------------- | -------------------- |

---

# 36. FINAL RECOMMENDATION

Provide a clear, evidence-based conclusion addressing:

* Whether the application should be continued
* Whether it should be stabilized before expansion
* Whether it should be refactored
* Whether it should be professionally deployed
* Whether subscriptions should be purchased
* Which features should be prioritized
* Whether the Planning Department should be approved
* Why Eng. Ahmed Labib is positioned to lead the establishment
* What authority and resources he would need
* What management must do immediately
* What can reasonably be achieved within 90 days
* What long-term value SAMCO can obtain

The conclusion must be strong but not exaggerated.

It must prove value through evidence, analysis, cost, risk, capability, and strategic alignment.

---

# 37. REQUIRED APPENDICES

Include:

* Application file inventory
* Folder tree
* Dependency list
* Feature register
* Failure register
* Subscription register
* Data dictionary
* Data map
* Pipeline diagrams
* Architecture diagrams
* User-role matrix
* Permission matrix
* API register
* Configuration register
* Risk register
* Development backlog
* Test plan
* Acceptance criteria
* Department organization chart
* Job descriptions
* Procedures register
* Reports register
* KPI dictionary
* Budget assumptions
* Financial model assumptions
* Training matrix
* Implementation schedule
* Management decision register
* Glossary of technical terms
* Glossary of planning and project-controls terms

---

# 38. QUALITY-CONTROL CHECK BEFORE SUBMISSION

Before finalizing the deliverables, perform a quality review.

Confirm that:

* Every feature is supported by evidence.
* Existing and proposed functionality are clearly separated.
* Technical claims reference files, modules, functions, or test evidence.
* Financial assumptions are transparent.
* Costs are labeled as verified or estimated.
* English and Arabic versions have equivalent depth.
* Arabic formatting is correctly right-to-left.
* Diagrams match the actual application.
* All tables are complete.
* No confidential credentials are exposed.
* The report can be understood by non-technical readers.
* The technical section can be used by developers and AI coding agents.
* The Planning Department plan is realistic for SAMCO.
* The report clearly presents both benefits and weaknesses.
* Recommendations are prioritized.
* Responsibilities are assigned.
* Acceptance criteria are measurable.
* The Word-document structure is executive-ready.
* The board-presentation structure is persuasive and evidence-based.
* The final report identifies missing information rather than inventing it.

Provide a final quality score for:

* Completeness
* Accuracy
* Technical usefulness
* Management usefulness
* Financial credibility
* Presentation quality
* Handover readiness
* Implementation readiness

---

# 39. FINAL OUTPUT FORMAT

Deliver the result in this order:

## Part I — English Executive and Plain-Language Report

Written for non-technical management and board members.

## Part II — English Technical and Machine-Actionable Report

Written for programmers, solution architects, and AI coding agents.

## Part III — Arabic Executive and Plain-Language Report

Full Modern Standard Arabic, right-to-left.

## Part IV — Arabic Technical Report

Full Modern Standard Arabic with English technical terms where appropriate.

## Part V — SAMCO Planning Department Establishment Plan in English

## Part VI — خطة تأسيس إدارة التخطيط والتحكم بالمشروعات في شركة سامكو باللغة العربية

## Part VII — Board Presentation Content

English and Arabic.

## Part VIII — Technical Handover Package

## Part IX — Development Backlog and Implementation Roadmap

## Part X — Appendices and Evidence Register

Do not shorten the report merely to reduce output size.

Where output limits prevent delivery in one response, divide it into numbered volumes while maintaining one unified table of contents and avoiding repetition.

---

# 40. FIRST ACTIONS

Before writing the report:

1. Inspect all available application files.
2. Create an inventory of received and missing materials.
3. Reconstruct the application structure.
4. Identify the application entry point.
5. Identify the main modules.
6. Identify the data sources.
7. Identify the primary workflows.
8. Run or inspect available tests.
9. Identify confirmed failures.
10. Identify subscription dependencies.
11. Identify security risks.
12. Identify unsupported claims.
13. Prepare an evidence register.
14. Then generate the complete deliverables.

Begin your response with:

**Application Inspection and Evidence Summary**

State:

* Materials received
* Materials successfully inspected
* Materials unavailable
* Application execution status
* Evidence confidence
* Critical information still missing

Then proceed with the full report.

'@

$reportExecutionContext = @"
# PROJECT-SPECIFIC EXECUTION CONTEXT

Application project folder:
$ProjectRoot

Evidence package:
$($folders.Evidence)

Required output folder:
$($folders.Deliverables)

Generated repository evidence includes:
- File inventory and SHA-256 hashes
- Project folder tree
- Codebase metrics
- Dependency and npm script registers
- Redacted configuration copies
- Git history, status, branches, tags, remotes, and contributors where available
- Architecture and integration evidence searches
- Optional npm test, build, and audit logs
- Optional redacted source snapshot

MANDATORY EXECUTION RULES:
1. Inspect the actual project repository directly at the project folder above.
2. Use the evidence package as an index, not as a replacement for source inspection.
3. Never reveal API keys, credentials, tokens, passwords, private keys, connection strings, or secrets.
4. Separate verified functionality, partially functional functionality, code-only functionality, proposals, assumptions, and unverified claims.
5. Cite exact relative file paths and line numbers for material technical conclusions whenever possible.
6. Do not state that a feature is functional merely because a UI component or function exists.
7. Run or inspect available tests and build evidence before assigning a functional status.
8. Write all requested deliverables into the Required output folder.
9. Create both English and full Modern Standard Arabic versions. Arabic documents must be structured for RTL presentation.
10. Complete the report in volumes when necessary; do not replace detailed sections with summaries.
11. Produce editable Mermaid diagrams and machine-actionable CSV/JSON registers.
12. Treat all market prices and subscription prices as requiring current verification unless evidence is supplied.
13. Start with “Application Inspection and Evidence Summary”.
14. End with an evidence-based management decision paper and quality-control scorecard.

# MASTER REPORT REQUIREMENTS

"@

$finalPromptPath = Join-Path $folders.Prompt "MASTER_AI_AGENT_PROMPT.md"
($reportExecutionContext + $masterPrompt) | Set-Content -LiteralPath $finalPromptPath -Encoding UTF8

$agentInstruction = @"
Read and execute the complete instruction file:
$finalPromptPath

Inspect the repository:
$ProjectRoot

Write every requested output into:
$($folders.Deliverables)

Do not only reply with a summary. Create the actual files in the output directories.
"@
$agentInstructionPath = Join-Path $folders.Prompt "AGENT_EXECUTION_INSTRUCTION.txt"
$agentInstruction | Set-Content -LiteralPath $agentInstructionPath -Encoding UTF8

$manifest = [ordered]@{
    PackageVersion = "1.0.0"
    GeneratedAt = (Get-Date).ToString("o")
    ProjectRoot = $ProjectRoot
    OutputRoot = $OutputRoot
    MasterPrompt = $finalPromptPath
    AgentInstruction = $agentInstructionPath
    FileCount = @($fileInventory).Count
    CodeMetrics = $metricSummary
    Options = [ordered]@{
        RunNpmInstall = [bool]$RunNpmInstall
        RunTests = [bool]$RunTests
        RunBuild = [bool]$RunBuild
        RunNpmAudit = [bool]$RunNpmAudit
        IncludeSourceSnapshot = [bool]$IncludeSourceSnapshot
        RunAgent = [bool]$RunAgent
        Agent = $Agent
    }
}
Write-JsonFile -Object $manifest -Path (Join-Path $OutputRoot "package_manifest.json")

Write-Step "10/10 - Optional AI-agent execution"

function Resolve-AgentCommand {
    param([string]$RequestedAgent)

    if ($RequestedAgent -eq "None") { return $null }

    $candidates = if ($RequestedAgent -eq "Auto") {
        @(
            [pscustomobject]@{ Name = "Codex"; Command = "codex" },
            [pscustomobject]@{ Name = "Claude"; Command = "claude" },
            [pscustomobject]@{ Name = "Gemini"; Command = "gemini" }
        )
    } else {
        @([pscustomobject]@{ Name = $RequestedAgent; Command = $RequestedAgent.ToLowerInvariant() })
    }

    foreach ($candidate in $candidates) {
        if (Get-Command $candidate.Command -ErrorAction SilentlyContinue) {
            return $candidate
        }
    }

    return $null
}

if ($RunAgent) {
    $resolvedAgent = Resolve-AgentCommand -RequestedAgent $Agent

    if ($null -eq $resolvedAgent) {
        Write-Warning "No supported AI CLI was found. The package and prompt were still created successfully."
        Write-Warning "Supported auto-detection: codex, claude, gemini."
    } else {
        Write-Host "Launching $($resolvedAgent.Name)..." -ForegroundColor Green
        Push-Location $ProjectRoot
        try {
            $instructionText = Get-Content -LiteralPath $agentInstructionPath -Raw

            switch ($resolvedAgent.Name) {
                "Codex" {
                    & codex exec --full-auto $instructionText 2>&1 |
                        Tee-Object -FilePath (Join-Path $folders.Logs "agent_codex_execution.txt")
                }
                "Claude" {
                    & claude -p $instructionText 2>&1 |
                        Tee-Object -FilePath (Join-Path $folders.Logs "agent_claude_execution.txt")
                }
                "Gemini" {
                    & gemini -p $instructionText 2>&1 |
                        Tee-Object -FilePath (Join-Path $folders.Logs "agent_gemini_execution.txt")
                }
            }
        } finally {
            Pop-Location
        }
    }
}

$summaryText = @"
PACKAGE CREATED SUCCESSFULLY

Project:
$ProjectRoot

Output:
$OutputRoot

Master AI prompt:
$finalPromptPath

File count:
$(@($fileInventory).Count)

Approximate code lines:
$($metricSummary.TotalLines)

Run the AI agent later:
powershell -ExecutionPolicy Bypass -File "$($MyInvocation.MyCommand.Path)" -ProjectRoot "$ProjectRoot" -OutputRoot "$OutputRoot" -RunAgent

Recommended full validation:
powershell -ExecutionPolicy Bypass -File "$($MyInvocation.MyCommand.Path)" -ProjectRoot "$ProjectRoot" -RunTests -RunBuild -RunNpmAudit -IncludeSourceSnapshot -RunAgent
"@

$summaryText | Set-Content -LiteralPath (Join-Path $OutputRoot "COMPLETION_SUMMARY.txt") -Encoding UTF8
Write-Host $summaryText -ForegroundColor Green

if ($OpenOutput) {
    Start-Process explorer.exe $OutputRoot
}
