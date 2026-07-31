#requires -Version 5.1
<#
.SYNOPSIS
    Full Application Understanding Scanner for Next.js / Vercel applications.

.DESCRIPTION
    Read-only repository scanner. It:
    - Auto-detects the real Next.js app folder.
    - Ignores temporary and generated folders.
    - Maps pages, API routes, components, dependencies, integrations, and features.
    - Lists environment-variable names only, never values.
    - Detects risks, mock data, TODOs, and incomplete implementation signals.
    - Generates Markdown, CSV, JSON, and HTML reports.

    It does NOT:
    - Modify application source files.
    - Install packages.
    - Run npm commands.
    - Expose secret values.
    - Delete project data.

.EXAMPLE
    .\understand_app.ps1 -ProjectRoot "D:\Project Intelligence Hub NextJS" -OpenReport

.EXAMPLE
    .\understand_app.ps1 -ProjectRoot "D:\Project Intelligence Hub NextJS\website" -OpenReport
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = $PSScriptRoot,
    [string]$OutputFolderName = "_APP_UNDERSTANDING_REPORT",
    [switch]$OpenReport
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Stage {
    param([string]$Message)
    Write-Host ""
    Write-Host ("=" * 78) -ForegroundColor DarkCyan
    Write-Host ("  " + $Message) -ForegroundColor Cyan
    Write-Host ("=" * 78) -ForegroundColor DarkCyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host ("[OK] " + $Message) -ForegroundColor Green
}

function Write-WarnLine {
    param([string]$Message)
    Write-Host ("[WARN] " + $Message) -ForegroundColor Yellow
}

function Get-RelativePathSafe {
    param(
        [string]$BasePath,
        [string]$TargetPath
    )
    try {
        $baseUri = New-Object System.Uri(($BasePath.TrimEnd('\') + '\'))
        $targetUri = New-Object System.Uri($TargetPath)
        return [System.Uri]::UnescapeDataString(
            $baseUri.MakeRelativeUri($targetUri).ToString().Replace('/', '\')
        )
    }
    catch {
        return $TargetPath
    }
}

function Read-TextSafe {
    param([string]$Path)
    try {
        return [System.IO.File]::ReadAllText($Path)
    }
    catch {
        return ""
    }
}

function ConvertTo-HtmlSafe {
    param([AllowNull()][string]$Text)
    if ($null -eq $Text) { return "" }
    return [System.Net.WebUtility]::HtmlEncode($Text)
}

function Get-PropertyValueSafe {
    param(
        [object]$Object,
        [string]$PropertyName,
        [object]$DefaultValue = $null
    )
    if ($null -eq $Object) { return $DefaultValue }

    $property = $Object.PSObject.Properties[$PropertyName]
    if ($null -eq $property) { return $DefaultValue }

    return $property.Value
}

function Convert-RouteSegment {
    param([string]$Segment)

    if ($Segment -match '^\[\.\.\.(.+)\]$') { return ":$($Matches[1])*" }
    if ($Segment -match '^\[\[(?:\.\.\.)?(.+)\]\]$') { return ":$($Matches[1])?" }
    if ($Segment -match '^\[(.+)\]$') { return ":$($Matches[1])" }
    if ($Segment -match '^\(.+\)$') { return "" }
    if ($Segment -match '^@.+$') { return "" }

    return $Segment
}

function Normalize-Route {
    param([string[]]$Segments)

    $result = @()
    foreach ($segment in @($Segments)) {
        $converted = Convert-RouteSegment -Segment $segment
        if (-not [string]::IsNullOrWhiteSpace($converted)) {
            $result += $converted
        }
    }

    if (@($result).Count -eq 0) { return "/" }
    return "/" + ($result -join "/")
}

function Test-IsRealNextApp {
    param([string]$Folder)

    $packagePath = Join-Path $Folder "package.json"
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
        return $false
    }

    try {
        $package = (Read-TextSafe -Path $packagePath) | ConvertFrom-Json
    }
    catch {
        return $false
    }

    $dependencies = Get-PropertyValueSafe -Object $package -PropertyName "dependencies"
    $devDependencies = Get-PropertyValueSafe -Object $package -PropertyName "devDependencies"

    $nextDependency = $null
    if ($null -ne $dependencies) {
        $nextDependency = $dependencies.PSObject.Properties["next"]
    }
    if ($null -eq $nextDependency -and $null -ne $devDependencies) {
        $nextDependency = $devDependencies.PSObject.Properties["next"]
    }

    $hasNextConfig =
        (Test-Path -LiteralPath (Join-Path $Folder "next.config.js")) -or
        (Test-Path -LiteralPath (Join-Path $Folder "next.config.mjs")) -or
        (Test-Path -LiteralPath (Join-Path $Folder "next.config.ts"))

    $hasRouter =
        (Test-Path -LiteralPath (Join-Path $Folder "app") -PathType Container) -or
        (Test-Path -LiteralPath (Join-Path $Folder "src\app") -PathType Container) -or
        (Test-Path -LiteralPath (Join-Path $Folder "pages") -PathType Container) -or
        (Test-Path -LiteralPath (Join-Path $Folder "src\pages") -PathType Container)

    return (($null -ne $nextDependency) -or $hasNextConfig) -and $hasRouter
}

function Resolve-ApplicationRoot {
    param([string]$StartPath)

    $resolvedStart = (Resolve-Path -LiteralPath $StartPath).Path

    if (Test-IsRealNextApp -Folder $resolvedStart) {
        return $resolvedStart
    }

    $preferredWebsite = Join-Path $resolvedStart "website"
    if (Test-IsRealNextApp -Folder $preferredWebsite) {
        return $preferredWebsite
    }

    $candidatePackageFiles = Get-ChildItem `
        -LiteralPath $resolvedStart `
        -Filter "package.json" `
        -File `
        -Recurse `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch '\\(\.git|\.tmp|node_modules|\.next|dist|build|coverage|\.turbo|\.vercel|out|__pycache__|\.cache)(\\|$)'
        }

    $validCandidates = @()
    foreach ($candidate in @($candidatePackageFiles)) {
        if (Test-IsRealNextApp -Folder $candidate.Directory.FullName) {
            $validCandidates += $candidate.Directory.FullName
        }
    }

    $validCandidates = @($validCandidates | Sort-Object -Unique)

    if (@($validCandidates).Count -eq 0) {
        throw "No real Next.js application was found under: $resolvedStart"
    }

    if (@($validCandidates).Count -eq 1) {
        return $validCandidates[0]
    }

    $preferred = @($validCandidates | Where-Object {
        $_ -match '\\website$' -or
        $_ -match '\\app$' -or
        $_ -match '\\frontend$'
    } | Select-Object -First 1)

    if (@($preferred).Count -gt 0) {
        return $preferred[0]
    }

    return $validCandidates[0]
}

Write-Stage "1/10 Resolving the real Next.js application"

$ApplicationRoot = Resolve-ApplicationRoot -StartPath $ProjectRoot
Write-Ok "Application root: $ApplicationRoot"

$packagePath = Join-Path $ApplicationRoot "package.json"
$packageRaw = Read-TextSafe -Path $packagePath
$packageJson = $packageRaw | ConvertFrom-Json

$appName = [string](Get-PropertyValueSafe -Object $packageJson -PropertyName "name" -DefaultValue (Split-Path $ApplicationRoot -Leaf))
$appVersion = [string](Get-PropertyValueSafe -Object $packageJson -PropertyName "version" -DefaultValue "Not declared")
$appDescription = [string](Get-PropertyValueSafe -Object $packageJson -PropertyName "description" -DefaultValue "Not declared")

if ([string]::IsNullOrWhiteSpace($appName)) { $appName = Split-Path $ApplicationRoot -Leaf }
if ([string]::IsNullOrWhiteSpace($appVersion)) { $appVersion = "Not declared" }
if ([string]::IsNullOrWhiteSpace($appDescription)) { $appDescription = "Not declared" }

$outputRoot = Join-Path $ApplicationRoot $OutputFolderName
if (Test-Path -LiteralPath $outputRoot) {
    $previousPath = Join-Path $ApplicationRoot ($OutputFolderName + "_Previous_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
    Move-Item -LiteralPath $outputRoot -Destination $previousPath -Force
    Write-WarnLine "Previous report moved to: $previousPath"
}
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

Write-Stage "2/10 Reading dependencies and scripts"

$dependencies = @()
foreach ($groupName in @("dependencies", "devDependencies")) {
    $groupObject = Get-PropertyValueSafe -Object $packageJson -PropertyName $groupName
    if ($null -ne $groupObject) {
        foreach ($property in @($groupObject.PSObject.Properties)) {
            $dependencies += [pscustomobject]@{
                Type = if ($groupName -eq "dependencies") { "Runtime" } else { "Development" }
                Package = $property.Name
                Version = [string]$property.Value
            }
        }
    }
}

$scripts = @()
$scriptsObject = Get-PropertyValueSafe -Object $packageJson -PropertyName "scripts"
if ($null -ne $scriptsObject) {
    foreach ($property in @($scriptsObject.PSObject.Properties)) {
        $scripts += [pscustomobject]@{
            Name = $property.Name
            Command = [string]$property.Value
        }
    }
}

$dependencyNames = @($dependencies | ForEach-Object { $_.Package.ToLowerInvariant() })

Write-Ok "Application: $appName"
Write-Ok "Dependencies: $(@($dependencies).Count)"
Write-Ok "Scripts: $(@($scripts).Count)"

Write-Stage "3/10 Inventorying the full application"

$excludedPattern = '\\(\.git|\.tmp|node_modules|\.next|dist|build|coverage|\.turbo|\.vercel|out|__pycache__|\.pytest_cache|\.cache|_APP_UNDERSTANDING_REPORT[^\\]*)(\\|$)'
$sourceExtensions = @(
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
    ".json", ".md", ".mdx", ".css", ".scss", ".sass",
    ".html", ".yml", ".yaml", ".toml", ".sql", ".py"
)

$allFiles = @(
    Get-ChildItem -LiteralPath $ApplicationRoot -Recurse -File -Force |
    Where-Object {
        $_.FullName -notmatch $excludedPattern -and
        $_.FullName -notlike "$outputRoot*"
    }
)

$sourceCorpus = @()
foreach ($file in $allFiles) {
    if (($sourceExtensions -contains $file.Extension.ToLowerInvariant()) -and $file.Length -lt 4MB) {
        $content = Read-TextSafe -Path $file.FullName
        if (-not [string]::IsNullOrWhiteSpace($content)) {
            $sourceCorpus += [pscustomobject]@{
                RelativePath = Get-RelativePathSafe -BasePath $ApplicationRoot -TargetPath $file.FullName
                FullPath = $file.FullName
                Extension = $file.Extension.ToLowerInvariant()
                Content = $content
                SizeKB = [math]::Round($file.Length / 1KB, 2)
                LastModified = $file.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
            }
        }
    }
}

$fileInventory = @(
    $allFiles | ForEach-Object {
        [pscustomobject]@{
            RelativePath = Get-RelativePathSafe -BasePath $ApplicationRoot -TargetPath $_.FullName
            Extension = $_.Extension.ToLowerInvariant()
            SizeKB = [math]::Round($_.Length / 1KB, 2)
            LastModified = $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
        }
    }
)

Write-Ok "Files inventoried: $(@($allFiles).Count)"
Write-Ok "Source/configuration files analyzed: $(@($sourceCorpus).Count)"

Write-Stage "4/10 Mapping pages, API routes, layouts, and components"

$appDirectories = @(
    (Join-Path $ApplicationRoot "app"),
    (Join-Path $ApplicationRoot "src\app")
) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }

$pagesDirectories = @(
    (Join-Path $ApplicationRoot "pages"),
    (Join-Path $ApplicationRoot "src\pages")
) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }

$componentDirectories = @(
    (Join-Path $ApplicationRoot "components"),
    (Join-Path $ApplicationRoot "src\components")
) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }

$routeRecords = @()
$layoutRecords = @()

foreach ($appDirectory in @($appDirectories)) {
    foreach ($file in @(Get-ChildItem -LiteralPath $appDirectory -Recurse -File)) {
        if ($file.Name -match '^page\.(js|jsx|ts|tsx|mdx)$') {
            $relativeDirectory = Get-RelativePathSafe -BasePath $appDirectory -TargetPath $file.DirectoryName
            $segments = if ($relativeDirectory -eq "." -or [string]::IsNullOrWhiteSpace($relativeDirectory)) {
                @()
            }
            else {
                $relativeDirectory -split '\\'
            }

            $routeRecords += [pscustomobject]@{
                Type = "Page"
                Router = "App Router"
                Route = Normalize-Route -Segments $segments
                Methods = ""
                File = Get-RelativePathSafe -BasePath $ApplicationRoot -TargetPath $file.FullName
            }
        }
        elseif ($file.Name -match '^route\.(js|jsx|ts|tsx)$') {
            $relativeDirectory = Get-RelativePathSafe -BasePath $appDirectory -TargetPath $file.DirectoryName
            $segments = if ($relativeDirectory -eq "." -or [string]::IsNullOrWhiteSpace($relativeDirectory)) {
                @()
            }
            else {
                $relativeDirectory -split '\\'
            }

            $content = Read-TextSafe -Path $file.FullName
            $methods = @()
            foreach ($method in @("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD")) {
                if (
                    $content -match "(?m)\bexport\s+(async\s+)?function\s+$method\b" -or
                    $content -match "(?m)\bexport\s+const\s+$method\b"
                ) {
                    $methods += $method
                }
            }

            $routeRecords += [pscustomobject]@{
                Type = "API"
                Router = "App Router"
                Route = Normalize-Route -Segments $segments
                Methods = ($methods -join ", ")
                File = Get-RelativePathSafe -BasePath $ApplicationRoot -TargetPath $file.FullName
            }
        }
        elseif ($file.Name -match '^layout\.(js|jsx|ts|tsx)$') {
            $layoutRecords += [pscustomobject]@{
                File = Get-RelativePathSafe -BasePath $ApplicationRoot -TargetPath $file.FullName
                Directory = Get-RelativePathSafe -BasePath $ApplicationRoot -TargetPath $file.DirectoryName
            }
        }
    }
}

foreach ($pagesDirectory in @($pagesDirectories)) {
    foreach ($file in @(
        Get-ChildItem -LiteralPath $pagesDirectory -Recurse -File |
        Where-Object { $_.Extension -match '^\.(js|jsx|ts|tsx)$' }
    )) {
        if ($file.BaseName -in @("_app", "_document", "_error", "404", "500")) {
            continue
        }

        $relative = Get-RelativePathSafe -BasePath $pagesDirectory -TargetPath $file.FullName
        $withoutExtension = [System.IO.Path]::ChangeExtension($relative, $null)
        $segments = $withoutExtension -split '\\'

        if ($segments[0] -eq "api") {
            $routeRecords += [pscustomobject]@{
                Type = "API"
                Router = "Pages Router"
                Route = Normalize-Route -Segments $segments
                Methods = "Handler-defined"
                File = Get-RelativePathSafe -BasePath $ApplicationRoot -TargetPath $file.FullName
            }
        }
        else {
            if ($segments[-1] -eq "index") {
                if (@($segments).Count -eq 1) {
                    $segments = @()
                }
                else {
                    $segments = $segments[0..($segments.Count - 2)]
                }
            }

            $routeRecords += [pscustomobject]@{
                Type = "Page"
                Router = "Pages Router"
                Route = Normalize-Route -Segments $segments
                Methods = ""
                File = Get-RelativePathSafe -BasePath $ApplicationRoot -TargetPath $file.FullName
            }
        }
    }
}

$routeRecords = @($routeRecords | Sort-Object Type, Route, File -Unique)

$componentRecords = @()
foreach ($componentDirectory in @($componentDirectories)) {
    foreach ($file in @(
        Get-ChildItem -LiteralPath $componentDirectory -Recurse -File |
        Where-Object { $_.Extension -match '^\.(js|jsx|ts|tsx)$' }
    )) {
        $content = Read-TextSafe -Path $file.FullName
        $componentName = $file.BaseName

        if ($content -match '(?m)export\s+default\s+function\s+([A-Za-z0-9_]+)') {
            $componentName = $Matches[1]
        }
        elseif ($content -match '(?m)export\s+(?:const|function|class)\s+([A-Za-z0-9_]+)') {
            $componentName = $Matches[1]
        }

        $componentRecords += [pscustomobject]@{
            Name = $componentName
            File = Get-RelativePathSafe -BasePath $ApplicationRoot -TargetPath $file.FullName
        }
    }
}

Write-Ok "Pages: $(@($routeRecords | Where-Object Type -eq 'Page').Count)"
Write-Ok "APIs: $(@($routeRecords | Where-Object Type -eq 'API').Count)"
Write-Ok "Layouts: $(@($layoutRecords).Count)"
Write-Ok "Components: $(@($componentRecords).Count)"

Write-Stage "5/10 Detecting environment names and integrations"

$environmentNames = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)

$environmentFiles = @(
    $allFiles | Where-Object {
        $_.Name -match '^\.env(\..+)?$' -or
        $_.Name -in @("env.example", ".env.example")
    }
)

foreach ($environmentFile in @($environmentFiles)) {
    foreach ($line in @(Get-Content -LiteralPath $environmentFile.FullName -ErrorAction SilentlyContinue)) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
            [void]$environmentNames.Add($Matches[1])
        }
    }
}

foreach ($source in @($sourceCorpus)) {
    foreach ($match in [regex]::Matches(
        $source.Content,
        '(?:process\.env\.|import\.meta\.env\.)([A-Z][A-Z0-9_]+)'
    )) {
        [void]$environmentNames.Add($match.Groups[1].Value)
    }
}

$integrationDefinitions = @(
    @{ Name = "OpenAI"; Packages = @("openai"); Env = @("OPENAI_API_KEY"); Terms = @("openai") },
    @{ Name = "Groq"; Packages = @("groq-sdk"); Env = @("GROQ_API_KEY"); Terms = @("groq") },
    @{ Name = "Anthropic"; Packages = @("@anthropic-ai/sdk"); Env = @("ANTHROPIC_API_KEY"); Terms = @("anthropic") },
    @{ Name = "Google Gemini"; Packages = @("@google/generative-ai"); Env = @("GOOGLE_API_KEY", "GEMINI_API_KEY"); Terms = @("gemini") },
    @{ Name = "Supabase"; Packages = @("@supabase/supabase-js"); Env = @("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"); Terms = @("supabase") },
    @{ Name = "Firebase"; Packages = @("firebase", "firebase-admin"); Env = @("FIREBASE_PROJECT_ID"); Terms = @("firebase") },
    @{ Name = "PostgreSQL"; Packages = @("pg", "@vercel/postgres"); Env = @("DATABASE_URL", "POSTGRES_URL"); Terms = @("postgres") },
    @{ Name = "MongoDB"; Packages = @("mongodb", "mongoose"); Env = @("MONGODB_URI"); Terms = @("mongodb", "mongoose") },
    @{ Name = "Prisma"; Packages = @("prisma", "@prisma/client"); Env = @("DATABASE_URL"); Terms = @("prisma") },
    @{ Name = "Vercel Blob"; Packages = @("@vercel/blob"); Env = @("BLOB_READ_WRITE_TOKEN"); Terms = @("vercel/blob") },
    @{ Name = "Vercel KV"; Packages = @("@vercel/kv"); Env = @("KV_REST_API_URL", "KV_REST_API_TOKEN"); Terms = @("vercel/kv") },
    @{ Name = "Resend"; Packages = @("resend"); Env = @("RESEND_API_KEY"); Terms = @("resend") },
    @{ Name = "SendGrid"; Packages = @("@sendgrid/mail"); Env = @("SENDGRID_API_KEY"); Terms = @("sendgrid") },
    @{ Name = "Sentry"; Packages = @("@sentry/nextjs"); Env = @("SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"); Terms = @("sentry") },
    @{ Name = "LangChain"; Packages = @("langchain", "@langchain/core"); Env = @(); Terms = @("langchain") },
    @{ Name = "Pinecone"; Packages = @("@pinecone-database/pinecone"); Env = @("PINECONE_API_KEY"); Terms = @("pinecone") }
)

$integrationRecords = @()
foreach ($definition in $integrationDefinitions) {
    $packageMatches = @(
        $definition.Packages | Where-Object {
            $dependencyNames -contains $_.ToLowerInvariant()
        }
    )

    $environmentMatches = @(
        $definition.Env | Where-Object {
            $environmentNames.Contains($_)
        }
    )

    $evidenceFiles = @()
    foreach ($source in @($sourceCorpus)) {
        foreach ($term in $definition.Terms) {
            if ($source.Content.IndexOf($term, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $evidenceFiles += $source.RelativePath
                break
            }
        }
    }

    $evidenceFiles = @($evidenceFiles | Sort-Object -Unique)

    if (
        @($packageMatches).Count -gt 0 -or
        @($environmentMatches).Count -gt 0 -or
        @($evidenceFiles).Count -gt 0
    ) {
        $integrationRecords += [pscustomobject]@{
            Integration = $definition.Name
            Status = if (
                @($packageMatches).Count -gt 0 -and
                @($evidenceFiles).Count -gt 0
            ) {
                "Integrated evidence"
            }
            elseif (@($evidenceFiles).Count -gt 0) {
                "Code evidence"
            }
            else {
                "Configuration evidence"
            }
            Packages = ($packageMatches -join "; ")
            EnvironmentNames = ($environmentMatches -join "; ")
            EvidenceFiles = ($evidenceFiles | Select-Object -First 12) -join "; "
        }
    }
}

Write-Ok "Environment-variable names: $($environmentNames.Count)"
Write-Ok "Integrations: $(@($integrationRecords).Count)"

Write-Stage "6/10 Detecting business and technical features"

$featureDefinitions = @(
    @{
        Name = "AI Assistant / Chat"
        Category = "Artificial Intelligence"
        Keywords = @("openai", "anthropic", "groq", "gemini", "chatbot", "assistant", "useChat", "langchain", "ai sdk")
        Packages = @("openai", "groq-sdk", "@anthropic-ai/sdk", "ai", "langchain")
        Value = "Conversational assistance, intelligent analysis, and tool-supported workflows."
    },
    @{
        Name = "Document Intelligence"
        Category = "Artificial Intelligence"
        Keywords = @("document analysis", "pdf", "ocr", "citation", "extract text", "mammoth", "tesseract")
        Packages = @("pdf-parse", "pdfjs-dist", "mammoth", "tesseract.js")
        Value = "Reads, extracts, analyzes, and retrieves evidence from documents."
    },
    @{
        Name = "Authentication and User Access"
        Category = "Platform"
        Keywords = @("nextauth", "signIn", "signOut", "clerk", "supabase.auth", "jwt", "session")
        Packages = @("next-auth", "@clerk/nextjs", "jsonwebtoken", "bcryptjs")
        Value = "Controls user identity, sessions, and protected access."
    },
    @{
        Name = "Database and Persistent Storage"
        Category = "Platform"
        Keywords = @("prisma", "drizzle", "mongoose", "mongodb", "postgres", "supabase", "database")
        Packages = @("@prisma/client", "prisma", "drizzle-orm", "mongoose", "pg", "@supabase/supabase-js")
        Value = "Stores project records, users, workflows, and operational data."
    },
    @{
        Name = "File Upload and Processing"
        Category = "Data"
        Keywords = @('type="file"', "FormData", "multipart", "upload", "dropzone", "FileReader", "arrayBuffer")
        Packages = @("react-dropzone", "multer", "formidable", "@vercel/blob")
        Value = "Accepts and processes project documents, datasets, and evidence."
    },
    @{
        Name = "Dashboard and KPI Analytics"
        Category = "Analytics"
        Keywords = @("dashboard", "kpi", "metric", "variance", "performance", "analytics", "summary card")
        Packages = @("recharts", "chart.js", "apexcharts", "echarts", "plotly.js")
        Value = "Provides management KPIs, status, trends, and summaries."
    },
    @{
        Name = "Charts and Visualization"
        Category = "Analytics"
        Keywords = @("LineChart", "BarChart", "PieChart", "AreaChart", "ResponsiveContainer", "plotly", "chart")
        Packages = @("recharts", "chart.js", "react-chartjs-2", "apexcharts")
        Value = "Transforms project data into visual decision-support outputs."
    },
    @{
        Name = "Project Planning and Scheduling"
        Category = "Project Controls"
        Keywords = @("baseline", "primavera", "p6", "activity", "wbs", "milestone", "critical path", "float", "xer")
        Packages = @()
        Value = "Supports baseline review, schedule monitoring, and critical-path intelligence."
    },
    @{
        Name = "Delay Analysis and Claims"
        Category = "Project Controls"
        Keywords = @("delay analysis", "time impact", "tia", "fragnet", "eot", "extension of time", "concurrency", "claim")
        Packages = @()
        Value = "Supports delay-event analysis, concurrency, entitlement, and EOT assessment."
    },
    @{
        Name = "Contract and FIDIC Intelligence"
        Category = "Contracts"
        Keywords = @("fidic", "contract clause", "sub-clause", "notice", "entitlement", "variation order", "contractor claim")
        Packages = @()
        Value = "Supports contract interpretation, notices, claims, and clause evidence."
    },
    @{
        Name = "Cost Control and Earned Value"
        Category = "Project Controls"
        Keywords = @("earned value", "evm", "cpi", "spi", "cost variance", "eac", "etc", "forecast cost")
        Packages = @()
        Value = "Supports earned-value analysis, cost control, and forecasting."
    },
    @{
        Name = "Reports and Export"
        Category = "Reporting"
        Keywords = @("download", "export", "report", "xlsx", "csv", "docx", "pptx", "jspdf")
        Packages = @("xlsx", "exceljs", "jspdf", "pdf-lib", "docx", "pptxgenjs", "file-saver")
        Value = "Produces downloadable reports, spreadsheets, documents, and presentations."
    },
    @{
        Name = "Meetings, Recorder, and MOM"
        Category = "Communication"
        Keywords = @("minutes of meeting", "mom", "recorder", "transcription", "speech to text", "MediaRecorder", "microphone")
        Packages = @()
        Value = "Supports recordings, transcripts, actions, and minutes of meeting."
    },
    @{
        Name = "Knowledge Search and RAG"
        Category = "Knowledge"
        Keywords = @("embedding", "vector", "semantic", "retrieval", "rag", "pinecone", "qdrant", "weaviate")
        Packages = @("@pinecone-database/pinecone", "@qdrant/js-client-rest", "langchain")
        Value = "Retrieves relevant records, documents, and evidence."
    },
    @{
        Name = "Role-Based Access Control"
        Category = "Security"
        Keywords = @("rbac", "permission", "authorize", "protected route", "user role")
        Packages = @()
        Value = "Restricts features and data according to user role."
    },
    @{
        Name = "Vercel Deployment"
        Category = "Deployment"
        Keywords = @("vercel", "edge runtime", "serverless", "maxDuration")
        Packages = @("@vercel/analytics", "@vercel/blob", "@vercel/kv", "@vercel/postgres")
        Value = "Uses Vercel deployment, edge, storage, or analytics services."
    },
    @{
        Name = "Responsive and Mobile Experience"
        Category = "User Experience"
        Keywords = @("responsive", "mobile", "sm:", "md:", "lg:", "viewport", "pwa", "manifest.json")
        Packages = @("next-pwa")
        Value = "Supports desktop, tablet, and mobile use."
    },
    @{
        Name = "Testing and Quality Assurance"
        Category = "Engineering"
        Keywords = @("describe(", "it(", "test(", "expect(", "playwright", "cypress", "vitest", "jest")
        Packages = @("jest", "vitest", "@playwright/test", "cypress", "@testing-library/react")
        Value = "Provides automated quality and regression protection."
    },
    @{
        Name = "Observability and Monitoring"
        Category = "Engineering"
        Keywords = @("sentry", "logger", "logging", "telemetry", "error boundary")
        Packages = @("@sentry/nextjs", "winston", "pino", "@vercel/analytics")
        Value = "Tracks errors, application health, and operational behavior."
    },
    @{
        Name = "Arabic, RTL, and Localization"
        Category = "User Experience"
        Keywords = @("rtl", "arabic", "locale", "translation", "i18n")
        Packages = @("next-intl", "react-i18next", "i18next")
        Value = "Supports localization and right-to-left interfaces."
    }
)

$featureRecords = @()

foreach ($definition in $featureDefinitions) {
    $packageEvidence = @(
        $definition.Packages | Where-Object {
            $dependencyNames -contains $_.ToLowerInvariant()
        }
    )

    $evidenceFiles = New-Object System.Collections.Generic.List[string]
    $evidenceTerms = New-Object System.Collections.Generic.List[string]

    foreach ($source in @($sourceCorpus)) {
        $matchedFile = $false

        foreach ($keyword in $definition.Keywords) {
            if ($source.Content.IndexOf($keyword, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                if (-not $matchedFile) {
                    [void]$evidenceFiles.Add($source.RelativePath)
                    $matchedFile = $true
                }

                if (-not $evidenceTerms.Contains($keyword)) {
                    [void]$evidenceTerms.Add($keyword)
                }
            }
        }
    }

    $score =
        [math]::Min(45, $evidenceFiles.Count * 8) +
        [math]::Min(35, $evidenceTerms.Count * 7) +
        [math]::Min(20, @($packageEvidence).Count * 10)

    $score = [math]::Min(100, $score)

    $status = if ($score -ge 65) {
        "Strongly Evidenced"
    }
    elseif ($score -ge 35) {
        "Evidenced"
    }
    elseif ($score -gt 0) {
        "Possible / Partial"
    }
    else {
        "Not Evidenced"
    }

    $confidence = if ($score -ge 65) {
        "High"
    }
    elseif ($score -ge 35) {
        "Medium"
    }
    else {
        "Low"
    }

    $featureRecords += [pscustomobject]@{
        Feature = $definition.Name
        Category = $definition.Category
        Status = $status
        Confidence = $confidence
        Score = $score
        BusinessValue = $definition.Value
        PackageEvidence = ($packageEvidence -join "; ")
        KeywordEvidence = ($evidenceTerms | Select-Object -First 12) -join "; "
        EvidenceFileCount = $evidenceFiles.Count
        EvidenceFiles = ($evidenceFiles | Select-Object -First 15) -join "; "
        VerificationNeeded = if ($status -eq "Strongly Evidenced") {
            "Demonstrate end-to-end and validate the output."
        }
        elseif ($status -eq "Evidenced") {
            "Verify the complete UI-to-output workflow."
        }
        elseif ($status -eq "Possible / Partial") {
            "Confirm whether this is connected, functional, or only planned."
        }
        else {
            "No repository evidence was detected."
        }
    }
}

$featureRecords = @(
    $featureRecords |
    Sort-Object `
        @{ Expression = "Score"; Descending = $true }, `
        @{ Expression = "Category"; Descending = $false }, `
        @{ Expression = "Feature"; Descending = $false }
)

Write-Ok "Features classified: $(@($featureRecords).Count)"

Write-Stage "7/10 Detecting risks, gaps, and readiness"

$riskDefinitions = @(
    @{
        Risk = "Hardcoded credential pattern"
        Severity = "Critical"
        Pattern = '(?im)(api[_-]?key|secret|password|token)\s*[:=]\s*["''][^"'']{8,}["'']'
        Recommendation = "Move secrets to environment variables and rotate exposed credentials."
    },
    @{
        Risk = "TODO or unfinished implementation"
        Severity = "Medium"
        Pattern = '(?im)\b(TODO|FIXME|HACK|PLACEHOLDER)\b'
        Recommendation = "Classify unfinished items before presenting features as complete."
    },
    @{
        Risk = "Mock, dummy, or simulated data"
        Severity = "High"
        Pattern = '(?im)\b(mockData|mock data|dummy data|fake data|simulated|placeholder data)\b'
        Recommendation = "Label demonstrations clearly and verify the production data flow."
    },
    @{
        Risk = "Dangerous HTML rendering"
        Severity = "High"
        Pattern = 'dangerouslySetInnerHTML'
        Recommendation = "Confirm that all rendered HTML is sanitized."
    },
    @{
        Risk = "Weak random identifier generation"
        Severity = "Medium"
        Pattern = 'Math\.random\s*\('
        Recommendation = "Use secure identifiers for sensitive or persistent records."
    },
    @{
        Risk = "Console debugging statements"
        Severity = "Low"
        Pattern = '(?m)\bconsole\.(log|debug|warn|error)\s*\('
        Recommendation = "Remove unnecessary debugging or route it through controlled logging."
    }
)

$riskRecords = @()

foreach ($risk in $riskDefinitions) {
    $matchedFiles = @()

    foreach ($source in @($sourceCorpus)) {
        if ($source.RelativePath -match '(?i)(\.env|lock\.json$|package-lock|pnpm-lock|yarn\.lock)') {
            continue
        }

        if ([regex]::IsMatch($source.Content, $risk.Pattern)) {
            $matchedFiles += $source.RelativePath
        }
    }

    $matchedFiles = @($matchedFiles | Sort-Object -Unique)

    if (@($matchedFiles).Count -gt 0) {
        $riskRecords += [pscustomobject]@{
            Risk = $risk.Risk
            Severity = $risk.Severity
            EvidenceCount = @($matchedFiles).Count
            EvidenceFiles = ($matchedFiles | Select-Object -First 20) -join "; "
            Recommendation = $risk.Recommendation
        }
    }
}

$testFiles = @(
    $allFiles | Where-Object {
        $_.Name -match '(\.test\.|\.spec\.)' -or
        $_.FullName -match '\\(__tests__|tests|test|e2e)\\'
    }
)

$documentationFiles = @(
    $allFiles | Where-Object {
        $_.Extension -in @(".md", ".mdx") -or
        $_.Name -match '(?i)(readme|architecture|guide|report|documentation)'
    }
)

$strongFeatures = @($featureRecords | Where-Object Status -eq "Strongly Evidenced")
$evidencedFeatures = @($featureRecords | Where-Object Status -eq "Evidenced")
$partialFeatures = @($featureRecords | Where-Object Status -eq "Possible / Partial")

$pageCount = @($routeRecords | Where-Object Type -eq "Page").Count
$apiCount = @($routeRecords | Where-Object Type -eq "API").Count

$readinessScore = 0
$readinessScore += [math]::Min(25, @($routeRecords).Count * 2)
$readinessScore += [math]::Min(25, @($strongFeatures).Count * 5)
$readinessScore += [math]::Min(15, @($evidencedFeatures).Count * 3)
$readinessScore += if (@($testFiles).Count -gt 0) { 15 } else { 0 }
$readinessScore += if (@($documentationFiles).Count -gt 2) { 10 } elseif (@($documentationFiles).Count -gt 0) { 5 } else { 0 }
$readinessScore += if (@($riskRecords).Count -eq 0) { 10 } elseif (@($riskRecords | Where-Object Severity -eq "Critical").Count -eq 0) { 5 } else { 0 }
$readinessScore = [math]::Min(100, $readinessScore)

$readinessLabel = if ($readinessScore -ge 80) {
    "High evidence readiness"
}
elseif ($readinessScore -ge 60) {
    "Moderate evidence readiness"
}
elseif ($readinessScore -ge 40) {
    "Partial evidence readiness"
}
else {
    "Low evidence readiness"
}

Write-Ok "Presentation readiness: $readinessScore/100 — $readinessLabel"

Write-Stage "8/10 Generating complete understanding reports"

$generatedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$featureRecords | Export-Csv -LiteralPath (Join-Path $outputRoot "Feature_Matrix.csv") -NoTypeInformation -Encoding UTF8
$routeRecords | Export-Csv -LiteralPath (Join-Path $outputRoot "Routes_and_APIs.csv") -NoTypeInformation -Encoding UTF8
$componentRecords | Export-Csv -LiteralPath (Join-Path $outputRoot "Components.csv") -NoTypeInformation -Encoding UTF8
$layoutRecords | Export-Csv -LiteralPath (Join-Path $outputRoot "Layouts.csv") -NoTypeInformation -Encoding UTF8
$dependencies | Export-Csv -LiteralPath (Join-Path $outputRoot "Dependencies.csv") -NoTypeInformation -Encoding UTF8
$integrationRecords | Export-Csv -LiteralPath (Join-Path $outputRoot "Integrations.csv") -NoTypeInformation -Encoding UTF8
$riskRecords | Export-Csv -LiteralPath (Join-Path $outputRoot "Risks_and_Gaps.csv") -NoTypeInformation -Encoding UTF8
$fileInventory | Export-Csv -LiteralPath (Join-Path $outputRoot "File_Inventory.csv") -NoTypeInformation -Encoding UTF8

$executiveSummary = @"
# $appName — Complete Application Understanding

**Generated:** $generatedAt  
**Application root:** ``$ApplicationRoot``  
**Version:** $appVersion  
**Presentation readiness:** **$readinessScore/100 — $readinessLabel**

## 1. What the application is

**Declared description:** $appDescription

This repository is a Next.js/Vercel application with:

| Indicator | Count |
|---|---:|
| Pages | $pageCount |
| API routes | $apiCount |
| Components | $(@($componentRecords).Count) |
| Layouts | $(@($layoutRecords).Count) |
| Dependencies | $(@($dependencies).Count) |
| Integrations | $(@($integrationRecords).Count) |
| Test files | $(@($testFiles).Count) |
| Documentation files | $(@($documentationFiles).Count) |

## 2. Strongest evidenced features

$(if (@($strongFeatures).Count -gt 0) {
    ($strongFeatures | Select-Object -First 15 | ForEach-Object {
        "- **$($_.Feature)** — $($_.BusinessValue) Evidence: ``$($_.EvidenceFiles)``"
    }) -join "`r`n"
} else {
    "- No feature reached the strong-evidence threshold."
})

## 3. Additional evidenced features

$(if (@($evidencedFeatures).Count -gt 0) {
    ($evidencedFeatures | Select-Object -First 15 | ForEach-Object {
        "- **$($_.Feature)** — $($_.BusinessValue)"
    }) -join "`r`n"
} else {
    "- None detected."
})

## 4. Partial features requiring live verification

$(if (@($partialFeatures).Count -gt 0) {
    ($partialFeatures | Select-Object -First 15 | ForEach-Object {
        "- **$($_.Feature)** — verify whether it is functional, connected, or only planned."
    }) -join "`r`n"
} else {
    "- None detected."
})

## 5. Integrations

$(if (@($integrationRecords).Count -gt 0) {
    ($integrationRecords | ForEach-Object {
        "- **$($_.Integration)** — $($_.Status)"
    }) -join "`r`n"
} else {
    "- No integration evidence was detected."
})

## 6. Recommended presentation structure

1. Explain the business problem.
2. Explain the application objective.
3. Present the architecture and main modules.
4. Demonstrate the strongest verified workflow.
5. Demonstrate AI or analytics with source evidence.
6. Demonstrate a report or export and open the generated file.
7. Present current risks and limitations honestly.
8. Close with management value and roadmap.

## 7. Important presentation rule

Static evidence proves that code, routes, packages, or configuration exist. It does not prove that the entire workflow works correctly. Every critical feature must be tested live before presentation.
"@

$architectureReport = @"
# $appName — Architecture and Feature Map

## Application

- Name: **$appName**
- Version: **$appVersion**
- Root: ``$ApplicationRoot``
- App Router detected: **$(if (@($appDirectories).Count -gt 0) { "Yes" } else { "No" })**
- Pages Router detected: **$(if (@($pagesDirectories).Count -gt 0) { "Yes" } else { "No" })**
- TypeScript configured: **$(if (Test-Path -LiteralPath (Join-Path $ApplicationRoot "tsconfig.json")) { "Yes" } else { "No" })**
- Vercel configuration: **$(if (Test-Path -LiteralPath (Join-Path $ApplicationRoot "vercel.json")) { "vercel.json detected" } else { "Default or external configuration" })**

## Pages and APIs

| Type | Router | Route | Methods | File |
|---|---|---|---|---|
$(($routeRecords | ForEach-Object {
    "| $($_.Type) | $($_.Router) | ``$($_.Route)`` | $($_.Methods) | ``$($_.File)`` |"
}) -join "`r`n")

## Components

$(if (@($componentRecords).Count -gt 0) {
    ($componentRecords | ForEach-Object {
        "- **$($_.Name)** — ``$($_.File)``"
    }) -join "`r`n"
} else {
    "- No dedicated components directory was detected."
})

## Environment-variable names

Only names are listed. Values are never exported.

$(if ($environmentNames.Count -gt 0) {
    (($environmentNames | Sort-Object | ForEach-Object { "- ``$_``" }) -join "`r`n")
} else {
    "- None detected."
})

## npm scripts

$(if (@($scripts).Count -gt 0) {
    ($scripts | ForEach-Object {
        "- ``$($_.Name)`` → ``$($_.Command)``"
    }) -join "`r`n"
} else {
    "- None detected."
})
"@

$presentationGuide = @"
# $appName — Features Presentation Guide

## Slide 1 — Executive title

**${appName}: Project Intelligence and Digital Control Platform**

## Slide 2 — Business problem

- Project information may be fragmented across files and communication channels.
- Management reporting may require manual consolidation.
- Evidence retrieval may be slow.
- Project controls, contracts, and reporting may not share one source of truth.
- Repetitive analysis consumes engineering and management time.

## Slide 3 — Application purpose

Present the application as a platform that centralizes project data, workflows, evidence, analysis, and management outputs.

## Slide 4 — Architecture

- Next.js / Vercel application
- $pageCount detected pages
- $apiCount detected API routes
- $(@($componentRecords).Count) detected components
- $(@($integrationRecords).Count) detected integrations

## Slide 5 — Main features

$(if ((@($strongFeatures).Count + @($evidencedFeatures).Count) -gt 0) {
    (($strongFeatures + $evidencedFeatures) | Select-Object -First 15 | ForEach-Object {
        "- **$($_.Feature)** — $($_.BusinessValue)"
    }) -join "`r`n"
} else {
    "- Complete live verification before listing final features."
})

## Slide 6 — User journey

1. User enters or selects project information.
2. The application validates the input.
3. The application processes data or documents.
4. The user receives analysis, evidence, dashboards, or recommendations.
5. The application generates a report or export.
6. The user validates and shares the final output.

## Slide 7 — Management value

- Faster access to project intelligence
- Reduced manual consolidation
- Improved evidence traceability
- More consistent reporting
- Earlier risk visibility
- Better management decisions
- Scalable organizational knowledge
- Controlled workflows

## Slide 8 — Readiness

- Score: **$readinessScore/100**
- Level: **$readinessLabel**
- Strong features: **$(@($strongFeatures).Count)**
- Evidenced features: **$(@($evidencedFeatures).Count)**
- Partial features: **$(@($partialFeatures).Count)**
- Test files: **$(@($testFiles).Count)**

## Slide 9 — Risks and limitations

$(if (@($riskRecords).Count -gt 0) {
    ($riskRecords | ForEach-Object {
        "- **[$($_.Severity)] $($_.Risk)** — $($_.Recommendation)"
    }) -join "`r`n"
} else {
    "- Complete manual security, functional, and data-quality verification."
})

## Slide 10 — Recommended live demo

1. Open the application.
2. Explain the main dashboard.
3. Demonstrate the strongest end-to-end workflow.
4. Demonstrate one AI or analytics capability.
5. Validate the result against evidence.
6. Generate and open a downloadable output.
7. Show one controlled error case.
8. Close with roadmap and governance.

## Slide 11 — Roadmap

1. Verify partial features.
2. Add automated tests to critical workflows.
3. Strengthen citations, audit logs, and governance.
4. Improve access control and role management.
5. Establish controlled deployment and monitoring.
"@

Set-Content -LiteralPath (Join-Path $outputRoot "01_Executive_Understanding.md") -Value $executiveSummary -Encoding UTF8
Set-Content -LiteralPath (Join-Path $outputRoot "02_Architecture_Map.md") -Value $architectureReport -Encoding UTF8
Set-Content -LiteralPath (Join-Path $outputRoot "03_Features_Presentation_Guide.md") -Value $presentationGuide -Encoding UTF8

$inventoryObject = [ordered]@{
    generatedAt = $generatedAt
    scanner = @{
        name = "Complete App Understanding Scanner"
        version = "1.0.0"
        mode = "Read-only static repository analysis"
    }
    application = @{
        name = $appName
        version = $appVersion
        description = $appDescription
        root = $ApplicationRoot
        readinessScore = $readinessScore
        readinessLabel = $readinessLabel
    }
    statistics = @{
        totalFiles = @($allFiles).Count
        analyzedSourceFiles = @($sourceCorpus).Count
        pages = $pageCount
        apiRoutes = $apiCount
        components = @($componentRecords).Count
        layouts = @($layoutRecords).Count
        dependencies = @($dependencies).Count
        integrations = @($integrationRecords).Count
        tests = @($testFiles).Count
        documentationFiles = @($documentationFiles).Count
    }
    environmentVariableNames = @($environmentNames | Sort-Object)
    routes = @($routeRecords)
    layouts = @($layoutRecords)
    components = @($componentRecords)
    dependencies = @($dependencies)
    scripts = @($scripts)
    integrations = @($integrationRecords)
    features = @($featureRecords)
    risks = @($riskRecords)
}

$inventoryObject |
    ConvertTo-Json -Depth 12 |
    Set-Content -LiteralPath (Join-Path $outputRoot "Application_Inventory.json") -Encoding UTF8

Write-Stage "9/10 Generating executive HTML report"

$featureRowsHtml = ($featureRecords | ForEach-Object {
    $className = if ($_.Status -eq "Strongly Evidenced") {
        "good"
    }
    elseif ($_.Status -eq "Evidenced") {
        "medium"
    }
    elseif ($_.Status -eq "Possible / Partial") {
        "warning"
    }
    else {
        "muted"
    }

    "<tr>" +
    "<td>$(ConvertTo-HtmlSafe $_.Feature)</td>" +
    "<td>$(ConvertTo-HtmlSafe $_.Category)</td>" +
    "<td><span class='$className'>$(ConvertTo-HtmlSafe $_.Status)</span></td>" +
    "<td>$($_.Score)</td>" +
    "<td>$(ConvertTo-HtmlSafe $_.BusinessValue)</td>" +
    "<td><code>$(ConvertTo-HtmlSafe $_.EvidenceFiles)</code></td>" +
    "</tr>"
}) -join "`r`n"

$routeRowsHtml = ($routeRecords | ForEach-Object {
    "<tr>" +
    "<td>$(ConvertTo-HtmlSafe $_.Type)</td>" +
    "<td>$(ConvertTo-HtmlSafe $_.Router)</td>" +
    "<td><code>$(ConvertTo-HtmlSafe $_.Route)</code></td>" +
    "<td>$(ConvertTo-HtmlSafe $_.Methods)</td>" +
    "<td><code>$(ConvertTo-HtmlSafe $_.File)</code></td>" +
    "</tr>"
}) -join "`r`n"

$riskRowsHtml = if (@($riskRecords).Count -gt 0) {
    ($riskRecords | ForEach-Object {
        "<tr>" +
        "<td>$(ConvertTo-HtmlSafe $_.Severity)</td>" +
        "<td>$(ConvertTo-HtmlSafe $_.Risk)</td>" +
        "<td>$($_.EvidenceCount)</td>" +
        "<td>$(ConvertTo-HtmlSafe $_.Recommendation)</td>" +
        "</tr>"
    }) -join "`r`n"
}
else {
    "<tr><td colspan='4'>No configured pattern was detected. Manual review is still required.</td></tr>"
}

$executiveHtml = @"
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Application Understanding — $(ConvertTo-HtmlSafe $appName)</title>
<style>
:root{--brand:#103f73;--brand2:#1f68aa;--bg:#f4f7fb;--panel:#fff;--text:#172033;--muted:#667085;--line:#dbe3ed}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px "Segoe UI",Arial,sans-serif;line-height:1.5}
header{padding:44px 28px;color:white;background:linear-gradient(135deg,var(--brand),var(--brand2))}
header .inner,main{max-width:1360px;margin:auto}
h1{margin:0 0 6px;font-size:34px}
main{padding:26px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;margin-bottom:20px;box-shadow:0 4px 14px rgba(21,48,84,.06)}
.kpi{font-size:30px;font-weight:800;color:var(--brand)}
.label{font-size:12px;color:var(--muted)}
.readiness{font-size:48px;font-weight:800;color:var(--brand)}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--brand);color:white}
code{font:11px Consolas,monospace;overflow-wrap:anywhere}
.good,.medium,.warning,.muted{display:inline-block;padding:3px 8px;border-radius:20px;font-weight:650}
.good{background:#d9f5e8;color:#075e3c}
.medium{background:#fff0c7;color:#795000}
.warning{background:#ffe0d7;color:#8a2d17}
.muted{background:#e9edf3;color:#4d596b}
.note{border-left:5px solid var(--brand2);background:#edf5ff;padding:14px;border-radius:8px}
</style>
</head>
<body>
<header>
<div class="inner">
<h1>$(ConvertTo-HtmlSafe $appName)</h1>
<div>Complete Application Understanding and Presentation Readiness</div>
<div>Generated $generatedAt</div>
</div>
</header>
<main>
<div class="card">
<h2>Executive Readiness</h2>
<div class="readiness">$readinessScore/100</div>
<strong>$(ConvertTo-HtmlSafe $readinessLabel)</strong>
<p>This score measures static evidence readiness. Critical workflows must still be executed live before being presented as verified.</p>
</div>

<div class="grid">
<div class="card"><div class="kpi">$(@($allFiles).Count)</div><div class="label">Repository files</div></div>
<div class="card"><div class="kpi">$pageCount</div><div class="label">Pages</div></div>
<div class="card"><div class="kpi">$apiCount</div><div class="label">API routes</div></div>
<div class="card"><div class="kpi">$(@($componentRecords).Count)</div><div class="label">Components</div></div>
<div class="card"><div class="kpi">$(@($strongFeatures).Count + @($evidencedFeatures).Count)</div><div class="label">Medium/high evidence features</div></div>
<div class="card"><div class="kpi">$(@($integrationRecords).Count)</div><div class="label">Integrations</div></div>
<div class="card"><div class="kpi">$(@($testFiles).Count)</div><div class="label">Test files</div></div>
<div class="card"><div class="kpi">$(@($riskRecords).Count)</div><div class="label">Risk categories</div></div>
</div>

<div class="card">
<h2>Presentation Principle</h2>
<div class="note">Present the application through verified end-to-end workflows: user input, controlled processing, evidence-based output, management value, and an opened downloadable result.</div>
</div>

<div class="card">
<h2>Feature Evidence</h2>
<div class="table-wrap">
<table>
<thead><tr><th>Feature</th><th>Category</th><th>Status</th><th>Score</th><th>Business Value</th><th>Evidence</th></tr></thead>
<tbody>$featureRowsHtml</tbody>
</table>
</div>
</div>

<div class="card">
<h2>Routes and APIs</h2>
<div class="table-wrap">
<table>
<thead><tr><th>Type</th><th>Router</th><th>Route</th><th>Methods</th><th>File</th></tr></thead>
<tbody>$routeRowsHtml</tbody>
</table>
</div>
</div>

<div class="card">
<h2>Risks and Gaps</h2>
<div class="table-wrap">
<table>
<thead><tr><th>Severity</th><th>Risk</th><th>Count</th><th>Recommendation</th></tr></thead>
<tbody>$riskRowsHtml</tbody>
</table>
</div>
</div>
</main>
</body>
</html>
"@

$htmlPath = Join-Path $outputRoot "00_Open_First_Executive_Report.html"
Set-Content -LiteralPath $htmlPath -Value $executiveHtml -Encoding UTF8

Write-Stage "10/10 Verifying generated outputs"

$requiredOutputs = @(
    "00_Open_First_Executive_Report.html",
    "01_Executive_Understanding.md",
    "02_Architecture_Map.md",
    "03_Features_Presentation_Guide.md",
    "Feature_Matrix.csv",
    "Routes_and_APIs.csv",
    "Components.csv",
    "Layouts.csv",
    "Dependencies.csv",
    "Integrations.csv",
    "Risks_and_Gaps.csv",
    "File_Inventory.csv",
    "Application_Inventory.json"
)

$missingOutputs = @(
    $requiredOutputs | Where-Object {
        -not (Test-Path -LiteralPath (Join-Path $outputRoot $_) -PathType Leaf)
    }
)

if (@($missingOutputs).Count -gt 0) {
    throw "Report generation was incomplete. Missing: $($missingOutputs -join ', ')"
}

Write-Ok "All reports were generated successfully."
Write-Host ""
Write-Host "APPLICATION ROOT:" -ForegroundColor Yellow
Write-Host $ApplicationRoot -ForegroundColor Cyan
Write-Host ""
Write-Host "REPORT FOLDER:" -ForegroundColor Yellow
Write-Host $outputRoot -ForegroundColor Cyan
Write-Host ""
Write-Host "OPEN THIS FIRST:" -ForegroundColor Yellow
Write-Host $htmlPath -ForegroundColor Cyan
Write-Host ""

if ($OpenReport) {
    Start-Process -FilePath $htmlPath
}
