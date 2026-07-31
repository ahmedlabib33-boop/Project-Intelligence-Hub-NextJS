#requires -Version 5.1
<#
DR3 - Next.js / Vercel Application Intelligence Scanner
Read-only. It does not install packages, run npm scripts, modify source files,
or export secret values.

Default project:
D:\Project Intelligence Hub NextJS

Outputs:
_DR3_App_Intelligence_Report\
  Executive_Report.html
  Executive_Summary.md
  Presentation_Outline.md
  Technical_Architecture.md
  Feature_Matrix.csv
  Routes_and_APIs.csv
  Dependencies.csv
  Integrations.csv
  Risks_and_Gaps.csv
  Application_Inventory.json
#>

[CmdletBinding()]
param(
    [string]$ProjectRoot = $(if (Test-Path (Join-Path $PSScriptRoot "website\package.json")) { Join-Path $PSScriptRoot "website" } else { $PSScriptRoot }),
    [string]$OutputFolderName = "_DR3_App_Intelligence_Report",
    [switch]$OpenReport
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Stage([string]$Text) {
    Write-Host ""
    Write-Host ("=" * 76) -ForegroundColor DarkCyan
    Write-Host ("  " + $Text) -ForegroundColor Cyan
    Write-Host ("=" * 76) -ForegroundColor DarkCyan
}
function Ok([string]$Text) { Write-Host "[OK] $Text" -ForegroundColor Green }
function Warn([string]$Text) { Write-Host "[WARN] $Text" -ForegroundColor Yellow }

function Rel([string]$Base, [string]$Target) {
    try {
        $b = New-Object Uri(($Base.TrimEnd("\") + "\"))
        $t = New-Object Uri($Target)
        return [Uri]::UnescapeDataString($b.MakeRelativeUri($t).ToString().Replace("/", "\"))
    } catch { return $Target }
}

function ReadText([string]$Path) {
    try { return [IO.File]::ReadAllText($Path) } catch { return "" }
}

function Html([AllowNull()][string]$Text) {
    if ($null -eq $Text) { return "" }
    return [Net.WebUtility]::HtmlEncode($Text)
}

function RouteSegment([string]$Segment) {
    if ($Segment -match '^\[\.\.\.(.+)\]$') { return ":$($Matches[1])*" }
    if ($Segment -match '^\[\[(?:\.\.\.)?(.+)\]\]$') { return ":$($Matches[1])?" }
    if ($Segment -match '^\[(.+)\]$') { return ":$($Matches[1])" }
    if ($Segment -match '^\(.+\)$' -or $Segment -match '^@.+$') { return "" }
    return $Segment
}

function MakeRoute([string[]]$Segments) {
    $result = @()
    foreach ($s in $Segments) {
        $v = RouteSegment $s
        if (-not [string]::IsNullOrWhiteSpace($v)) { $result += $v }
    }
    if ($result.Count -eq 0) { return "/" }
    return "/" + ($result -join "/")
}

Stage "DR3 — Next.js / Vercel Application Intelligence"

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$packagePath = Join-Path $ProjectRoot "package.json"
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "package.json was not found in: $ProjectRoot"
}

$out = Join-Path $ProjectRoot $OutputFolderName
if (Test-Path $out) {
    $backup = Join-Path $ProjectRoot ($OutputFolderName + "_Previous_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
    Move-Item $out $backup -Force
    Warn "Previous report moved to $backup"
}
New-Item -ItemType Directory -Path $out -Force | Out-Null

Stage "1/8 Reading package metadata"

$package = (ReadText $packagePath) | ConvertFrom-Json

$appNameProperty = $package.PSObject.Properties["name"]
$appVersionProperty = $package.PSObject.Properties["version"]
$appDescriptionProperty = $package.PSObject.Properties["description"]

$appName = if ($null -ne $appNameProperty -and -not [string]::IsNullOrWhiteSpace([string]$appNameProperty.Value)) {
    [string]$appNameProperty.Value
} else {
    Split-Path $ProjectRoot -Leaf
}

$appVersion = if ($null -ne $appVersionProperty -and -not [string]::IsNullOrWhiteSpace([string]$appVersionProperty.Value)) {
    [string]$appVersionProperty.Value
} else {
    "Not declared"
}

$appDescription = if ($null -ne $appDescriptionProperty -and -not [string]::IsNullOrWhiteSpace([string]$appDescriptionProperty.Value)) {
    [string]$appDescriptionProperty.Value
} else {
    "Not declared"
}

$deps = @()
foreach ($group in @("dependencies","devDependencies")) {
    $groupProperty = $package.PSObject.Properties[$group]
    $obj = if ($null -ne $groupProperty) { $groupProperty.Value } else { $null }
    if ($null -ne $obj) {
        foreach ($p in $obj.PSObject.Properties) {
            $deps += [pscustomobject]@{
                Type = if ($group -eq "dependencies") { "Runtime" } else { "Development" }
                Package = $p.Name
                Version = [string]$p.Value
            }
        }
    }
}
$depNames = @($deps | ForEach-Object { $_.Package.ToLowerInvariant() })
Ok "Application: $appName"
Ok "Dependencies: $($deps.Count)"

Stage "2/8 Inventorying repository"

$exclude = '\\(\.git|\.tmp|node_modules|\.next|dist|build|coverage|\.turbo|\.vercel|out|__pycache__|\.cache|_DR3_App_Intelligence_Report[^\\]*)(\\|$)'
$extensions = @(".js",".jsx",".ts",".tsx",".mjs",".cjs",".json",".md",".mdx",".css",".scss",".html",".yml",".yaml",".toml",".sql",".py")
$files = Get-ChildItem -LiteralPath $ProjectRoot -Recurse -File -Force |
    Where-Object { $_.FullName -notmatch $exclude -and $_.FullName -notlike "$out*" }

$source = @()
foreach ($f in $files) {
    if ($extensions -contains $f.Extension.ToLowerInvariant() -and $f.Length -lt 3MB) {
        $text = ReadText $f.FullName
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            $source += [pscustomobject]@{
                File = Rel $ProjectRoot $f.FullName
                FullPath = $f.FullName
                Content = $text
            }
        }
    }
}
Ok "Files found: $($files.Count)"
Ok "Text/source files analyzed: $($source.Count)"

Stage "3/8 Detecting pages and APIs"

$routes = @()
$appDirs = @((Join-Path $ProjectRoot "app"), (Join-Path $ProjectRoot "src\app")) |
    Where-Object { Test-Path $_ -PathType Container }
$pagesDirs = @((Join-Path $ProjectRoot "pages"), (Join-Path $ProjectRoot "src\pages")) |
    Where-Object { Test-Path $_ -PathType Container }

foreach ($dir in $appDirs) {
    foreach ($f in Get-ChildItem $dir -Recurse -File) {
        if ($f.Name -match '^page\.(js|jsx|ts|tsx|mdx)$') {
            $relativeDir = Rel $dir $f.DirectoryName
            $segments = if ($relativeDir -eq "." -or [string]::IsNullOrWhiteSpace($relativeDir)) { @() } else { $relativeDir -split '\\' }
            $routes += [pscustomobject]@{
                Type="Page"; Router="App Router"; Route=(MakeRoute $segments)
                Methods=""; File=(Rel $ProjectRoot $f.FullName)
            }
        }
        elseif ($f.Name -match '^route\.(js|jsx|ts|tsx)$') {
            $relativeDir = Rel $dir $f.DirectoryName
            $segments = if ($relativeDir -eq "." -or [string]::IsNullOrWhiteSpace($relativeDir)) { @() } else { $relativeDir -split '\\' }
            $text = ReadText $f.FullName
            $methods = @()
            foreach ($m in @("GET","POST","PUT","PATCH","DELETE","OPTIONS","HEAD")) {
                if ($text -match "(?m)\bexport\s+(async\s+)?function\s+$m\b" -or $text -match "(?m)\bexport\s+const\s+$m\b") { $methods += $m }
            }
            $routes += [pscustomobject]@{
                Type="API"; Router="App Router"; Route=(MakeRoute $segments)
                Methods=($methods -join ", "); File=(Rel $ProjectRoot $f.FullName)
            }
        }
    }
}

foreach ($dir in $pagesDirs) {
    foreach ($f in Get-ChildItem $dir -Recurse -File | Where-Object { $_.Extension -match '^\.(js|jsx|ts|tsx)$' }) {
        if ($f.BaseName -in @("_app","_document","_error","404","500")) { continue }
        $relative = Rel $dir $f.FullName
        $withoutExt = [IO.Path]::ChangeExtension($relative, $null)
        $segments = $withoutExt -split '\\'
        $type = if ($segments[0] -eq "api") { "API" } else { "Page" }
        if ($type -eq "Page" -and $segments[-1] -eq "index") {
            $segments = if ($segments.Count -eq 1) { @() } else { $segments[0..($segments.Count-2)] }
        }
        $routes += [pscustomobject]@{
            Type=$type; Router="Pages Router"; Route=(MakeRoute $segments)
            Methods=if ($type -eq "API") { "Handler-defined" } else { "" }
            File=(Rel $ProjectRoot $f.FullName)
        }
    }
}
$routes = $routes | Sort-Object Type,Route,File -Unique
Ok "Pages: $(($routes | Where-Object Type -eq 'Page').Count)"
Ok "APIs: $(($routes | Where-Object Type -eq 'API').Count)"

Stage "4/8 Detecting application features"

$featureDefs = @(
    @("AI Assistant / Chat","Artificial Intelligence",@("openai","anthropic","groq","gemini","chatbot","assistant","useChat","langchain"),@("openai","groq-sdk","@anthropic-ai/sdk","ai","langchain"),"Conversational assistance, intelligent analysis, and tool-supported workflows."),
    @("Document Intelligence","Artificial Intelligence",@("document analysis","pdf","ocr","citation","extract text","mammoth","tesseract"),@("pdf-parse","pdfjs-dist","mammoth","tesseract.js"),"Reads, extracts, analyzes, or retrieves evidence from documents."),
    @("Authentication","Platform",@("nextauth","signIn","signOut","clerk","supabase.auth","jwt","session"),@("next-auth","@clerk/nextjs","jsonwebtoken","bcryptjs"),"Controls user identity, sessions, and protected access."),
    @("Database / Persistent Storage","Platform",@("prisma","drizzle","mongoose","mongodb","postgres","supabase","database"),@("@prisma/client","prisma","drizzle-orm","mongoose","pg","@supabase/supabase-js"),"Stores application records, users, projects, and operational data."),
    @("File Upload and Processing","Data",@('type="file"',"FormData","multipart","upload","dropzone","FileReader","arrayBuffer"),@("react-dropzone","multer","formidable","@vercel/blob"),"Accepts files and processes project data or evidence."),
    @("Dashboard and KPI Analytics","Analytics",@("dashboard","kpi","metric","variance","performance","analytics","summary card"),@("recharts","chart.js","apexcharts","echarts","plotly.js"),"Provides management KPIs, status, trends, and summaries."),
    @("Charts and Visualization","Analytics",@("LineChart","BarChart","PieChart","AreaChart","ResponsiveContainer","plotly","chart"),@("recharts","chart.js","react-chartjs-2","apexcharts"),"Transforms data into management-ready visual analysis."),
    @("Project Planning and Scheduling","Project Controls",@("baseline","primavera","p6","activity","wbs","milestone","critical path","float","xer"),@(),"Supports schedule monitoring, baseline review, and critical-path analysis."),
    @("Delay Analysis and Claims","Project Controls",@("delay analysis","time impact","tia","fragnet","eot","extension of time","concurrency","claim"),@(),"Supports delay-event analysis, entitlement, concurrency, and EOT assessment."),
    @("Contract and FIDIC Intelligence","Contracts",@("fidic","contract clause","sub-clause","notice","entitlement","variation order","contractor claim"),@(),"Supports contractual interpretation, notices, claims, and clause evidence."),
    @("Cost Control / Earned Value","Project Controls",@("earned value","evm","cpi","spi","cost variance","eac","etc","forecast cost"),@(),"Supports cost performance, earned value, and forecasting."),
    @("Reports and Export","Reporting",@("download","export","report","xlsx","csv","docx","pptx","jspdf"),@("xlsx","exceljs","jspdf","pdf-lib","docx","pptxgenjs","file-saver"),"Produces downloadable reports, spreadsheets, documents, and presentations."),
    @("Meetings / MOM / Recorder","Communication",@("minutes of meeting","mom","recorder","transcription","speech to text","MediaRecorder","microphone"),@(),"Supports recordings, transcripts, action items, and meeting minutes."),
    @("Knowledge Search / RAG","Knowledge",@("embedding","vector","semantic","retrieval","rag","pinecone","qdrant","weaviate"),@("@pinecone-database/pinecone","@qdrant/js-client-rest","langchain"),"Retrieves relevant records, documents, and evidence."),
    @("Role-Based Access Control","Security",@("rbac","permission","authorize","protected route","user role"),@(),"Restricts data and features according to role."),
    @("Vercel Deployment","Deployment",@("vercel","edge runtime","serverless","maxDuration"),@("@vercel/analytics","@vercel/blob","@vercel/kv","@vercel/postgres"),"Uses Vercel hosting, serverless, edge, storage, or analytics."),
    @("Responsive / Mobile Experience","User Experience",@("responsive","mobile","sm:","md:","lg:","viewport","pwa","manifest.json"),@("next-pwa"),"Supports desktop, tablet, and mobile use."),
    @("Testing and QA","Engineering",@("describe(","it(","test(","expect(","playwright","cypress","vitest","jest"),@("jest","vitest","@playwright/test","cypress","@testing-library/react"),"Provides automated quality and regression protection."),
    @("Observability / Monitoring","Engineering",@("sentry","logger","logging","telemetry","error boundary"),@("@sentry/nextjs","winston","pino","@vercel/analytics"),"Tracks errors, application health, and operational behavior."),
    @("Arabic / RTL / Localization","User Experience",@("rtl","arabic","locale","translation","i18n"),@("next-intl","react-i18next","i18next"),"Supports localized and right-to-left interfaces.")
)

$features = @()
foreach ($d in $featureDefs) {
    $name=$d[0]; $category=$d[1]; $keywords=$d[2]; $packages=$d[3]; $value=$d[4]
    $foundFiles = New-Object Collections.Generic.List[string]
    $foundTerms = New-Object Collections.Generic.List[string]
    $foundPkgs = @()

    foreach ($p in $packages) {
        if ($depNames -contains $p.ToLowerInvariant()) { $foundPkgs += $p }
    }
    foreach ($s in $source) {
        $matched=$false
        foreach ($k in $keywords) {
            if ($s.Content.IndexOf($k,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
                if (-not $matched) { [void]$foundFiles.Add($s.File); $matched=$true }
                if (-not $foundTerms.Contains($k)) { [void]$foundTerms.Add($k) }
            }
        }
    }
    $score=[Math]::Min(100,([Math]::Min(45,$foundFiles.Count*8)+[Math]::Min(35,$foundTerms.Count*7)+[Math]::Min(20,$foundPkgs.Count*10)))
    $status = if ($score -ge 65) {"Strongly Evidenced"} elseif ($score -ge 35) {"Evidenced"} elseif ($score -gt 0) {"Possible / Partial"} else {"Not Evidenced"}
    $confidence = if ($score -ge 65) {"High"} elseif ($score -ge 35) {"Medium"} else {"Low"}
    $features += [pscustomobject]@{
        Feature=$name; Category=$category; Status=$status; Confidence=$confidence; Score=$score
        BusinessValue=$value; PackageEvidence=($foundPkgs -join "; ")
        KeywordEvidence=($foundTerms | Select-Object -First 12) -join "; "
        EvidenceFileCount=$foundFiles.Count
        EvidenceFiles=($foundFiles | Select-Object -First 12) -join "; "
        VerificationNeeded=if($status -eq "Strongly Evidenced"){"Demonstrate end-to-end and validate output."}elseif($status -eq "Evidenced"){"Verify the complete UI-to-output workflow."}elseif($status -eq "Possible / Partial"){"Confirm whether connected, functional, or planned."}else{"No evidence detected."}
    }
}
$features = $features | Sort-Object -Property `
    @{ Expression = { $_.Score }; Descending = $true }, `
    @{ Expression = { $_.Category }; Descending = $false }, `
    @{ Expression = { $_.Feature }; Descending = $false }
Ok "Features classified: $($features.Count)"

Stage "5/8 Detecting integrations and environment names"

$envNames = New-Object Collections.Generic.HashSet[string] ([StringComparer]::OrdinalIgnoreCase)
foreach ($f in $files | Where-Object { $_.Name -match '^\.env(\..+)?$' -or $_.Name -eq "env.example" }) {
    foreach ($line in Get-Content $f.FullName -ErrorAction SilentlyContinue) {
        if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { [void]$envNames.Add($Matches[1]) }
    }
}
foreach ($s in $source) {
    foreach ($m in [regex]::Matches($s.Content,'(?:process\.env\.|import\.meta\.env\.)([A-Z][A-Z0-9_]+)')) {
        [void]$envNames.Add($m.Groups[1].Value)
    }
}

$integrationDefs = @(
    @("OpenAI",@("openai"),@("OPENAI_API_KEY"),@("openai")),
    @("Groq",@("groq-sdk"),@("GROQ_API_KEY"),@("groq")),
    @("Anthropic",@("@anthropic-ai/sdk"),@("ANTHROPIC_API_KEY"),@("anthropic")),
    @("Google Gemini",@("@google/generative-ai"),@("GOOGLE_API_KEY","GEMINI_API_KEY"),@("gemini")),
    @("Supabase",@("@supabase/supabase-js"),@("NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_ANON_KEY"),@("supabase")),
    @("Firebase",@("firebase","firebase-admin"),@("FIREBASE_PROJECT_ID"),@("firebase")),
    @("PostgreSQL",@("pg","@vercel/postgres"),@("DATABASE_URL","POSTGRES_URL"),@("postgres")),
    @("MongoDB",@("mongodb","mongoose"),@("MONGODB_URI"),@("mongodb","mongoose")),
    @("Prisma",@("prisma","@prisma/client"),@("DATABASE_URL"),@("prisma")),
    @("Vercel Blob",@("@vercel/blob"),@("BLOB_READ_WRITE_TOKEN"),@("vercel/blob")),
    @("Resend",@("resend"),@("RESEND_API_KEY"),@("resend")),
    @("Sentry",@("@sentry/nextjs"),@("SENTRY_DSN","NEXT_PUBLIC_SENTRY_DSN"),@("sentry")),
    @("LangChain",@("langchain","@langchain/core"),@(),@("langchain")),
    @("Pinecone",@("@pinecone-database/pinecone"),@("PINECONE_API_KEY"),@("pinecone"))
)

$integrations=@()
foreach($d in $integrationDefs){
    $name=$d[0];$pkgs=$d[1];$envs=$d[2];$terms=$d[3]
    $pkgFound=@($pkgs|Where-Object{$depNames -contains $_.ToLowerInvariant()})
    $envFound=@($envs|Where-Object{$envNames.Contains($_)})
    $codeFiles=@()
    foreach($s in $source){
        foreach($t in $terms){
            if($s.Content.IndexOf($t,[StringComparison]::OrdinalIgnoreCase)-ge 0){$codeFiles+=$s.File;break}
        }
    }
    $codeFiles=@($codeFiles|Select-Object -Unique)
    if($pkgFound.Count+$envFound.Count+$codeFiles.Count -gt 0){
        $integrations += [pscustomobject]@{
            Integration=$name
            Status=if($pkgFound.Count -gt 0 -and $codeFiles.Count -gt 0){"Integrated evidence"}elseif($codeFiles.Count -gt 0){"Code evidence"}else{"Configuration evidence"}
            Packages=($pkgFound -join "; ")
            EnvironmentNames=($envFound -join "; ")
            EvidenceFiles=($codeFiles|Select-Object -First 10)-join "; "
        }
    }
}
Ok "Integrations detected: $($integrations.Count)"

Stage "6/8 Detecting risks and readiness"

$riskDefs=@(
    @("Hardcoded credential pattern","Critical",'(?im)(api[_-]?key|secret|password|token)\s*[:=]\s*["''][^"'']{8,}["'']',"Move secrets to environment variables and rotate exposed credentials."),
    @("TODO / unfinished implementation","Medium",'(?im)\b(TODO|FIXME|HACK|PLACEHOLDER)\b',"Classify unfinished items before presenting features as complete."),
    @("Mock or simulated data","High",'(?im)\b(mockData|mock data|dummy data|fake data|simulated|placeholder data)\b',"Label demonstrations clearly and verify production data flow."),
    @("Dangerous HTML rendering","High",'dangerouslySetInnerHTML',"Confirm all rendered HTML is sanitized."),
    @("Weak random identifiers","Medium",'Math\.random\s*\(',"Use secure identifiers for sensitive records."),
    @("Console debug statements","Low",'(?m)\bconsole\.(log|debug|warn|error)\s*\(',"Remove unnecessary debug output or route through controlled logging.")
)
$risks=@()
foreach($r in $riskDefs){
    $matched=@()
    foreach($s in $source){
        if($s.File -match '(?i)(\.env|lock\.json$)'){continue}
        if([regex]::IsMatch($s.Content,$r[2])){$matched+=$s.File}
    }
    $matched=@($matched|Select-Object -Unique)
    if($matched.Count -gt 0){
        $risks += [pscustomobject]@{
            Risk=$r[0];Severity=$r[1];EvidenceCount=$matched.Count
            EvidenceFiles=($matched|Select-Object -First 15)-join "; "
            Recommendation=$r[3]
        }
    }
}

$testFiles=@($files|Where-Object{$_.Name -match '(\.test\.|\.spec\.)' -or $_.FullName -match '\\(__tests__|tests|e2e)\\'})
$docs=@($files|Where-Object{$_.Extension -in @(".md",".mdx")})
$strong=@($features|Where-Object Status -eq "Strongly Evidenced")
$medium=@($features|Where-Object Status -eq "Evidenced")
$partial=@($features|Where-Object Status -eq "Possible / Partial")

$score=0
$score += [Math]::Min(25,$routes.Count*2)
$score += [Math]::Min(25,$strong.Count*5)
$score += [Math]::Min(15,$medium.Count*3)
$score += if($testFiles.Count -gt 0){15}else{0}
$score += if($docs.Count -gt 2){10}elseif($docs.Count -gt 0){5}else{0}
$score += if($risks.Count -eq 0){10}elseif(@($risks|Where-Object Severity -eq "Critical").Count -eq 0){5}else{0}
$score=[Math]::Min(100,$score)
$readiness=if($score-ge80){"High evidence readiness"}elseif($score-ge60){"Moderate evidence readiness"}elseif($score-ge40){"Partial evidence readiness"}else{"Low evidence readiness"}
Ok "Presentation readiness: $score/100 — $readiness"

Stage "7/8 Writing reports"

$features|Export-Csv (Join-Path $out "Feature_Matrix.csv") -NoTypeInformation -Encoding UTF8
$routes|Export-Csv (Join-Path $out "Routes_and_APIs.csv") -NoTypeInformation -Encoding UTF8
$deps|Sort-Object Type,Package|Export-Csv (Join-Path $out "Dependencies.csv") -NoTypeInformation -Encoding UTF8
$integrations|Export-Csv (Join-Path $out "Integrations.csv") -NoTypeInformation -Encoding UTF8
$risks|Export-Csv (Join-Path $out "Risks_and_Gaps.csv") -NoTypeInformation -Encoding UTF8

$now=Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$executive=@"
# $appName — Executive Application Intelligence

**Generated:** $now  
**Project:** ``$ProjectRoot``  
**Version:** $appVersion  
**Presentation readiness:** **$score/100 — $readiness**

## Application understanding

$appDescription

This is an evidence-based static assessment of the Next.js/Vercel repository. Detected code, dependencies, routes, and configuration indicate possible capabilities; live execution is still required before a feature is presented as verified.

## Application footprint

| Indicator | Count |
|---|---:|
| Repository files | $($files.Count) |
| Source/config files analyzed | $($source.Count) |
| Pages | $(($routes|Where-Object Type -eq "Page").Count) |
| API routes | $(($routes|Where-Object Type -eq "API").Count) |
| Dependencies | $($deps.Count) |
| Integrations | $($integrations.Count) |
| Test files | $($testFiles.Count) |
| Risk categories | $($risks.Count) |

## Strongest demonstrable capabilities

$(if($strong.Count -gt 0){($strong|Select-Object -First 12|ForEach-Object{"- **$($_.Feature)** — $($_.BusinessValue) Evidence: ``$($_.EvidenceFiles)``"})-join"`r`n"}else{"- No feature reached the strong-evidence threshold."})

## Additional evidenced capabilities

$(if($medium.Count -gt 0){($medium|Select-Object -First 12|ForEach-Object{"- **$($_.Feature)** — $($_.BusinessValue)"})-join"`r`n"}else{"- None detected."})

## Capabilities requiring live proof

$(if($partial.Count -gt 0){($partial|Select-Object -First 12|ForEach-Object{"- **$($_.Feature)** — confirm whether it is connected, functional, or planned."})-join"`r`n"}else{"- None detected."})

## Recommended live presentation sequence

1. Explain the organizational problem and application objective.
2. Open the main dashboard and explain the primary KPIs.
3. Demonstrate the strongest end-to-end workflow.
4. Demonstrate AI or analytics using controlled source data.
5. Validate the result against project evidence.
6. Generate and open a report or export.
7. Demonstrate input validation or error handling.
8. Close with management value, governance, and roadmap.

## Presentation controls

- Do not call a feature complete until its full workflow has been executed.
- Open every generated report to prove it is valid.
- Clearly label mock, sample, or simulated data.
- Do not expose secret values.
- Separate implemented, conditional, and planned capabilities.
"@

$technical=@"
# $appName — Technical Architecture

## Runtime

- Application: **$appName**
- Version: **$appVersion**
- App Router: **$(if($appDirs.Count -gt 0){"Detected"}else{"Not detected"})**
- Pages Router: **$(if($pagesDirs.Count -gt 0){"Detected"}else{"Not detected"})**
- TypeScript: **$(if(Test-Path (Join-Path $ProjectRoot "tsconfig.json")){"Configured"}else{"Not detected"})**
- Vercel configuration: **$(if(Test-Path (Join-Path $ProjectRoot "vercel.json")){"vercel.json detected"}else{"Using defaults or external configuration"})**

## Routes and API handlers

| Type | Router | Route | Methods | File |
|---|---|---|---|---|
$(($routes|ForEach-Object{"| $($_.Type) | $($_.Router) | ``$($_.Route)`` | $($_.Methods) | ``$($_.File)`` |"})-join"`r`n")

## Integrations

| Integration | Status | Packages | Environment names | Evidence |
|---|---|---|---|---|
$(if($integrations.Count -gt 0){($integrations|ForEach-Object{"| $($_.Integration) | $($_.Status) | $($_.Packages) | $($_.EnvironmentNames) | $($_.EvidenceFiles) |"})-join"`r`n"}else{"| None detected | — | — | — | — |"})

## Environment-variable names

Secret values are not exported.

$(if($envNames.Count -gt 0){($envNames|Sort-Object|ForEach-Object{"- ``$_``"})-join"`r`n"}else{"- None detected."})

## Evidence interpretation

- A dependency proves availability, not successful integration.
- A route proves structure, not business correctness.
- Keyword evidence proves an implementation signal, not end-to-end completion.
- Live testing is mandatory before presenting a feature as verified.
"@

$presentation=@"
# $appName — Presentation Outline

## Slide 1 — Executive title
**${appName}: Project Intelligence and Digital Control Platform**

## Slide 2 — Business problem
- Fragmented project information
- Manual consolidation
- Slow evidence retrieval
- Inconsistent reporting
- Delayed management decisions

## Slide 3 — Application objective
Centralize information, workflows, analysis, evidence, and management outputs in one controlled platform.

## Slide 4 — Architecture
- Next.js application
- Vercel deployment target
- $(($routes|Where-Object Type -eq "Page").Count) detected pages
- $(($routes|Where-Object Type -eq "API").Count) detected APIs
- $($integrations.Count) detected integrations

## Slide 5 — Main capabilities
$(if(($strong.Count+$medium.Count)-gt 0){($strong+$medium|Select-Object -First 12|ForEach-Object{"- $($_.Feature): $($_.BusinessValue)"})-join"`r`n"}else{"- Complete live verification before listing capabilities."})

## Slide 6 — Demonstration journey
1. Enter or select project data.
2. Validate the input.
3. Run the primary analysis or workflow.
4. Review the dashboard or evidence.
5. Generate the management output.
6. Open and validate the final file.

## Slide 7 — Management value
- Faster project intelligence
- Reduced manual effort
- Improved traceability
- Consistent reporting
- Earlier risk visibility
- Better decision support

## Slide 8 — Readiness
- Score: **$score/100**
- Level: **$readiness**
- Strong features: **$($strong.Count)**
- Evidenced features: **$($medium.Count)**
- Partial features: **$($partial.Count)**
- Tests detected: **$($testFiles.Count)**

## Slide 9 — Risks and controls
$(if($risks.Count -gt 0){($risks|Select-Object -First 8|ForEach-Object{"- **[$($_.Severity)] $($_.Risk)** — $($_.Recommendation)"})-join"`r`n"}else{"- Complete manual security and functional review."})

## Slide 10 — Roadmap
1. Verify partial features.
2. Add automated tests to critical workflows.
3. Strengthen citations, audit logs, and governance.
4. Improve permissions and role control.
5. Establish controlled deployment and monitoring.
"@

Set-Content (Join-Path $out "Executive_Summary.md") $executive -Encoding UTF8
Set-Content (Join-Path $out "Technical_Architecture.md") $technical -Encoding UTF8
Set-Content (Join-Path $out "Presentation_Outline.md") $presentation -Encoding UTF8

$inventory=[ordered]@{
    generatedAt=$now
    scanner=@{name="DR3";version="1.0.0";mode="Read-only static analysis"}
    application=@{name=$appName;version=$appVersion;description=$appDescription;projectRoot=$ProjectRoot;readinessScore=$score;readinessLabel=$readiness}
    statistics=@{
        totalFiles=$files.Count;analyzedSourceFiles=$source.Count
        pages=@($routes|Where-Object Type -eq "Page").Count
        apiRoutes=@($routes|Where-Object Type -eq "API").Count
        dependencies=$deps.Count;integrations=$integrations.Count
        testFiles=$testFiles.Count;documentationFiles=$docs.Count
    }
    environmentVariableNames=@($envNames|Sort-Object)
    routes=@($routes);dependencies=@($deps);features=@($features)
    integrations=@($integrations);risks=@($risks)
}
$inventory|ConvertTo-Json -Depth 10|Set-Content (Join-Path $out "Application_Inventory.json") -Encoding UTF8

$featureRows=($features|ForEach-Object{
    $class=if($_.Status-eq"Strongly Evidenced"){"good"}elseif($_.Status-eq"Evidenced"){"medium"}elseif($_.Status-eq"Possible / Partial"){"warn"}else{"muted"}
    "<tr><td>$(Html $_.Feature)</td><td>$(Html $_.Category)</td><td><span class='$class'>$(Html $_.Status)</span></td><td>$($_.Score)</td><td>$(Html $_.BusinessValue)</td><td><code>$(Html $_.EvidenceFiles)</code></td></tr>"
})-join"`r`n"
$routeRows=($routes|ForEach-Object{"<tr><td>$(Html $_.Type)</td><td>$(Html $_.Router)</td><td><code>$(Html $_.Route)</code></td><td>$(Html $_.Methods)</td><td><code>$(Html $_.File)</code></td></tr>"})-join"`r`n"
$riskRows=if($risks.Count){($risks|ForEach-Object{"<tr><td>$(Html $_.Severity)</td><td>$(Html $_.Risk)</td><td>$($_.EvidenceCount)</td><td>$(Html $_.Recommendation)</td></tr>"})-join"`r`n"}else{"<tr><td colspan='4'>No configured pattern detected. Manual review is still required.</td></tr>"}

$html=@"
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DR3 - $(Html $appName)</title>
<style>
:root{--b:#103f73;--b2:#1f68aa;--bg:#f3f6fa;--p:#fff;--t:#172033;--m:#667085;--l:#dbe3ed}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--t);font:14px "Segoe UI",Arial,sans-serif;line-height:1.5}
header{padding:42px 28px;color:white;background:linear-gradient(135deg,var(--b),var(--b2))}header div,main{max-width:1320px;margin:auto}
h1{font-size:34px;margin:0 0 6px}main{padding:26px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
.card{background:var(--p);border:1px solid var(--l);border-radius:14px;padding:20px;margin-bottom:20px;box-shadow:0 4px 14px #1530540d}
.kpi{font-size:30px;font-weight:800;color:var(--b)}.label{font-size:12px;color:var(--m)}.ready{font-size:48px;font-weight:800;color:var(--b)}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:10px;border-bottom:1px solid var(--l);text-align:left;vertical-align:top}
th{background:var(--b);color:white}.wrap{overflow-x:auto}code{font:11px Consolas,monospace;overflow-wrap:anywhere}
.good,.medium,.warn,.muted{display:inline-block;padding:3px 8px;border-radius:20px;font-weight:650}.good{background:#d9f5e8;color:#075e3c}.medium{background:#fff0c7;color:#795000}.warn{background:#ffe0d7;color:#8a2d17}.muted{background:#e9edf3;color:#4d596b}
.note{border-left:5px solid var(--b2);background:#edf5ff;padding:14px;border-radius:8px}
</style></head>
<body><header><div><h1>$(Html $appName)</h1><div>DR3 Application Intelligence and Presentation Readiness</div><div>Generated $now</div></div></header>
<main>
<div class="card"><h2>Executive Readiness</h2><div class="ready">$score/100</div><strong>$(Html $readiness)</strong><p>Static evidence score. Execute critical workflows live before presenting them as verified.</p></div>
<div class="grid">
<div class="card"><div class="kpi">$($files.Count)</div><div class="label">Repository files</div></div>
<div class="card"><div class="kpi">$(($routes|Where-Object Type -eq "Page").Count)</div><div class="label">Pages</div></div>
<div class="card"><div class="kpi">$(($routes|Where-Object Type -eq "API").Count)</div><div class="label">API routes</div></div>
<div class="card"><div class="kpi">$($strong.Count+$medium.Count)</div><div class="label">Medium/high evidence features</div></div>
<div class="card"><div class="kpi">$($integrations.Count)</div><div class="label">Integrations</div></div>
<div class="card"><div class="kpi">$($testFiles.Count)</div><div class="label">Test files</div></div>
</div>
<div class="card"><h2>Presentation Principle</h2><div class="note">Present the platform through verified end-to-end workflows: user input, controlled processing, evidence-based result, management value, and opened downloadable output.</div></div>
<div class="card"><h2>Feature Evidence</h2><div class="wrap"><table><thead><tr><th>Feature</th><th>Category</th><th>Status</th><th>Score</th><th>Business Value</th><th>Evidence</th></tr></thead><tbody>$featureRows</tbody></table></div></div>
<div class="card"><h2>Routes and APIs</h2><div class="wrap"><table><thead><tr><th>Type</th><th>Router</th><th>Route</th><th>Methods</th><th>File</th></tr></thead><tbody>$routeRows</tbody></table></div></div>
<div class="card"><h2>Risks and Gaps</h2><div class="wrap"><table><thead><tr><th>Severity</th><th>Risk</th><th>Count</th><th>Recommendation</th></tr></thead><tbody>$riskRows</tbody></table></div></div>
</main></body></html>
"@
$htmlPath=Join-Path $out "Executive_Report.html"
Set-Content $htmlPath $html -Encoding UTF8

Stage "8/8 Verifying outputs"
$required=@("Executive_Report.html","Executive_Summary.md","Presentation_Outline.md","Technical_Architecture.md","Feature_Matrix.csv","Routes_and_APIs.csv","Dependencies.csv","Integrations.csv","Risks_and_Gaps.csv","Application_Inventory.json")
$missing=@($required|Where-Object{-not(Test-Path(Join-Path $out $_)-PathType Leaf)})
if($missing.Count -gt 0){throw "Missing outputs: $($missing -join ', ')"}
Ok "All reports generated successfully."
Write-Host ""
Write-Host "REPORT FOLDER:" -ForegroundColor Yellow
Write-Host $out -ForegroundColor Cyan
Write-Host ""
Write-Host "OPEN THIS FIRST:" -ForegroundColor Yellow
Write-Host $htmlPath -ForegroundColor Cyan
Write-Host ""

if($OpenReport){Start-Process $htmlPath}
