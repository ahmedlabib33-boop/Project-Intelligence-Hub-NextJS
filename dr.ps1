param(
    [string]$ProjectPath = "C:\Users\pc\OneDrive\Documents\Project Intelligence Hub"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
    Write-Host "ERROR: Project folder was not found:" -ForegroundColor Red
    Write-Host $ProjectPath -ForegroundColor Yellow
    exit 1
}

$OutputFolder = Join-Path $ProjectPath "Report_Generator_Audit"
New-Item -ItemType Directory -Path $OutputFolder -Force | Out-Null

$CsvFile = Join-Path $OutputFolder "Report_Generator_Line_Map.csv"
$TxtFile = Join-Path $OutputFolder "Report_Generator_Analysis.txt"

$Extensions = @(
    ".py", ".js", ".jsx", ".ts", ".tsx",
    ".ps1", ".html", ".htm", ".json",
    ".yaml", ".yml", ".toml"
)

$ExcludedFolders = @(
    ".git", ".venv", "venv", "env",
    "node_modules", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".streamlit", "dist", "build",
    "site-packages", "Report_Generator_Audit"
)

$StrongPatterns = @(
    "Output Studio",
    "output_studio",
    "output studio",
    "generate_report",
    "create_report",
    "build_report",
    "render_report",
    "export_report",
    "report_generator",
    "report_type",
    "report_name",
    "report_title",
    "report_sections",
    "download_button",
    "download_link",
    "savefig",
    "write_html",
    "write_pdf",
    "to_excel",
    "to_csv",
    "Document\(",
    "Presentation\(",
    "Workbook\(",
    "PdfPages",
    "reportlab",
    "python-docx",
    "docxtpl",
    "openpyxl",
    "xlsxwriter",
    "python-pptx",
    "pptx",
    "weasyprint",
    "wkhtmltopdf",
    "pdfkit"
)

$OutputPatterns = @(
    "\.pdf",
    "\.docx",
    "\.xlsx",
    "\.xls",
    "\.pptx",
    "\.html",
    "\.htm",
    "\.csv",
    "\.svg",
    "\.png",
    "\.jpg",
    "\.jpeg",
    "output",
    "report"
)

function Test-ExcludedPath {
    param([string]$FullName)

    $Relative = $FullName.Substring($ProjectPath.Length).TrimStart("\")
    $Parts = $Relative -split "[\\/]"

    foreach ($Part in $Parts) {
        if ($ExcludedFolders -contains $Part) {
            return $true
        }
    }

    return $false
}

function Get-ContextText {
    param(
        [string[]]$Lines,
        [int]$LineIndex,
        [int]$Before = 3,
        [int]$After = 8
    )

    $Start = [Math]::Max(0, $LineIndex - $Before)
    $End = [Math]::Min($Lines.Count - 1, $LineIndex + $After)
    $Context = New-Object System.Collections.Generic.List[string]

    for ($i = $Start; $i -le $End; $i++) {
        $Context.Add(("{0,6}: {1}" -f ($i + 1), $Lines[$i]))
    }

    return $Context -join [Environment]::NewLine
}

Write-Host ""
Write-Host "Scanning Project Intelligence Hub..." -ForegroundColor Cyan
Write-Host "This is a read-only analysis of the existing project." -ForegroundColor DarkGray

$Files = Get-ChildItem -LiteralPath $ProjectPath -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        ($Extensions -contains $_.Extension.ToLowerInvariant()) -and
        (-not (Test-ExcludedPath -FullName $_.FullName))
    }

$Results = New-Object System.Collections.Generic.List[object]

foreach ($File in $Files) {
    try {
        $Lines = @(Get-Content -LiteralPath $File.FullName -ErrorAction Stop)
    }
    catch {
        continue
    }

    for ($Index = 0; $Index -lt $Lines.Count; $Index++) {
        $Line = [string]$Lines[$Index]
        $MatchedPatterns = New-Object System.Collections.Generic.List[string]

        foreach ($Pattern in $StrongPatterns) {
            if ($Line -match $Pattern) {
                $MatchedPatterns.Add($Pattern)
            }
        }

        foreach ($Pattern in $OutputPatterns) {
            if ($Line -match $Pattern) {
                $MatchedPatterns.Add($Pattern)
            }
        }

        if ($MatchedPatterns.Count -gt 0) {
            $Category = "Possible report reference"
            $Score = 1

            if ($Line -match "(generate|create|build|render|export|download|save|write|produce)") {
                $Category = "Report generation or export"
                $Score += 3
            }

            if ($Line -match "(Output Studio|output_studio|output studio)") {
                $Category = "Output Studio"
                $Score += 5
            }

            if ($Line -match "\.(pdf|docx|xlsx|xls|pptx|html|htm|csv|svg|png|jpg|jpeg)") {
                $Category = "Generated report or output format"
                $Score += 2
            }

            if ($Line -match "(def |class |function |async function|=>)") {
                $Score += 2
            }

            $RelativePath = $File.FullName.Substring($ProjectPath.Length).TrimStart("\")

            $Results.Add([PSCustomObject]@{
                Score           = $Score
                Category        = $Category
                File            = $RelativePath
                FullPath        = $File.FullName
                LineNumber      = $Index + 1
                SuggestedRange  = ("{0}-{1}" -f ([Math]::Max(1, $Index - 2)), ([Math]::Min($Lines.Count, $Index + 9)))
                MatchedPattern  = ($MatchedPatterns | Select-Object -Unique) -join "; "
                Code            = $Line.Trim()
                Context         = Get-ContextText -Lines $Lines -LineIndex $Index
            })
        }
    }
}

$SortedResults = @(
    $Results |
    Sort-Object `
        @{ Expression = "Score"; Descending = $true }, `
        @{ Expression = "File"; Descending = $false }, `
        @{ Expression = "LineNumber"; Descending = $false }
)

$SortedResults |
    Select-Object Score, Category, File, FullPath, LineNumber, SuggestedRange, MatchedPattern, Code |
    Export-Csv -LiteralPath $CsvFile -NoTypeInformation -Encoding UTF8

$Builder = New-Object System.Text.StringBuilder

[void]$Builder.AppendLine("PROJECT INTELLIGENCE HUB - REPORT GENERATOR AUDIT")
[void]$Builder.AppendLine(("Generated: {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss")))
[void]$Builder.AppendLine(("Project:   {0}" -f $ProjectPath))
[void]$Builder.AppendLine("")
[void]$Builder.AppendLine("PURPOSE")
[void]$Builder.AppendLine("Identify files, reports, functions and code lines associated with Output Studio report generation.")
[void]$Builder.AppendLine("")
[void]$Builder.AppendLine(("Source files scanned: {0}" -f $Files.Count))
[void]$Builder.AppendLine(("Matching code lines:  {0}" -f $SortedResults.Count))
[void]$Builder.AppendLine("")

[void]$Builder.AppendLine("============================================================")
[void]$Builder.AppendLine("PRIORITY FILES MOST LIKELY RESPONSIBLE FOR REPORT GENERATION")
[void]$Builder.AppendLine("============================================================")
[void]$Builder.AppendLine("")

$PriorityFiles = @(
    $SortedResults |
    Group-Object FullPath |
    ForEach-Object {
        [PSCustomObject]@{
            File         = $_.Name
            HighestScore = ($_.Group | Measure-Object Score -Maximum).Maximum
            Matches      = $_.Count
            Lines        = ($_.Group.LineNumber | Sort-Object -Unique) -join ", "
        }
    } |
    Sort-Object `
        @{ Expression = "HighestScore"; Descending = $true }, `
        @{ Expression = "Matches"; Descending = $true }
)

foreach ($Item in $PriorityFiles) {
    [void]$Builder.AppendLine(("FILE: {0}" -f $Item.File))
    [void]$Builder.AppendLine(("Priority score: {0} | Matches: {1}" -f $Item.HighestScore, $Item.Matches))
    [void]$Builder.AppendLine(("Relevant lines: {0}" -f $Item.Lines))
    [void]$Builder.AppendLine("")
}

[void]$Builder.AppendLine("============================================================")
[void]$Builder.AppendLine("DETAILED REPORT-BY-REPORT AND LINE-BY-LINE MAP")
[void]$Builder.AppendLine("============================================================")
[void]$Builder.AppendLine("")

foreach ($Result in $SortedResults) {
    [void]$Builder.AppendLine(("CATEGORY: {0}" -f $Result.Category))
    [void]$Builder.AppendLine(("SCORE:    {0}" -f $Result.Score))
    [void]$Builder.AppendLine(("FILE:     {0}" -f $Result.FullPath))
    [void]$Builder.AppendLine(("LINE:     {0}" -f $Result.LineNumber))
    [void]$Builder.AppendLine(("RANGE:    {0}" -f $Result.SuggestedRange))
    [void]$Builder.AppendLine(("MATCH:    {0}" -f $Result.MatchedPattern))
    [void]$Builder.AppendLine("CODE CONTEXT:")
    [void]$Builder.AppendLine($Result.Context)
    [void]$Builder.AppendLine("")
    [void]$Builder.AppendLine("------------------------------------------------------------")
    [void]$Builder.AppendLine("")
}

if ($SortedResults.Count -eq 0) {
    [void]$Builder.AppendLine("No recognizable report-generation references were found.")
    [void]$Builder.AppendLine("The project may use different naming conventions or binary files.")
}

[System.IO.File]::WriteAllText(
    $TxtFile,
    $Builder.ToString(),
    [System.Text.UTF8Encoding]::new($true)
)

Write-Host ""
Write-Host "ANALYSIS COMPLETED SUCCESSFULLY" -ForegroundColor Green
Write-Host ""
Write-Host "Main readable analysis:" -ForegroundColor Cyan
Write-Host $TxtFile -ForegroundColor White
Write-Host ""
Write-Host "Detailed Excel-compatible line map:" -ForegroundColor Cyan
Write-Host $CsvFile -ForegroundColor White
Write-Host ""

Start-Process explorer.exe -ArgumentList "/select,`"$TxtFile`""
