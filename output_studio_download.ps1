#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$ProjectRoot = $PSScriptRoot,
    [switch]$Apply,
    [switch]$OpenAudit
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Stage([string]$t){
    Write-Host ""
    Write-Host ("="*76) -ForegroundColor DarkCyan
    Write-Host ("  "+$t) -ForegroundColor Cyan
    Write-Host ("="*76) -ForegroundColor DarkCyan
}
function Ok([string]$t){ Write-Host "[OK] $t" -ForegroundColor Green }
function WarnLine([string]$t){ Write-Host "[WARN] $t" -ForegroundColor Yellow }
function ReadText([string]$p){ try{[IO.File]::ReadAllText($p)}catch{""} }
function SafeProp($o,[string]$n,$d=$null){
    if($null-eq$o){return$d}
    $p=$o.PSObject.Properties[$n]
    if($null-eq$p){return$d}
    return$p.Value
}
function IsNextApp([string]$f){
    $p=Join-Path $f "package.json"
    if(-not(Test-Path $p -PathType Leaf)){return $false}
    try{$j=(ReadText $p)|ConvertFrom-Json}catch{return $false}
    $d=SafeProp $j "dependencies"
    $dd=SafeProp $j "devDependencies"
    $hasNext=($null-ne$d -and $null-ne$d.PSObject.Properties["next"]) -or
             ($null-ne$dd -and $null-ne$dd.PSObject.Properties["next"])
    $hasRouter=(Test-Path (Join-Path $f "src\app") -PathType Container) -or
               (Test-Path (Join-Path $f "app") -PathType Container) -or
               (Test-Path (Join-Path $f "pages") -PathType Container)
    return $hasNext -and $hasRouter
}
function ResolveApp([string]$start){
    $r=(Resolve-Path $start).Path
    if(IsNextApp $r){return$r}
    $w=Join-Path $r "website"
    if(IsNextApp $w){return$w}
    $c=@(Get-ChildItem $r -Filter package.json -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object{$_.FullName-notmatch'\\(\.git|\.tmp|node_modules|\.next|dist|build|\.vercel)(\\|$)'})
    foreach($x in $c){if(IsNextApp $x.Directory.FullName){return$x.Directory.FullName}}
    throw "No valid Next.js app found under $r"
}
function Rel([string]$b,[string]$t){
    try{
        $bu=New-Object Uri(($b.TrimEnd("\")+"\"))
        $tu=New-Object Uri($t)
        [Uri]::UnescapeDataString($bu.MakeRelativeUri($tu).ToString().Replace("/","\"))
    }catch{$t}
}
function AddImport([string]$content,[string]$import){
    if($content.Contains($import)){return$content}
    $lines=$content-split"`r?`n"
    $last=-1
    for($i=0;$i-lt$lines.Count;$i++){if($lines[$i]-match'^\s*import\s'){$last=$i}}
    if($last-ge0){
        $a=@($lines[0..$last])
        $b=@()
        if($last+1-lt$lines.Count){$b=@($lines[($last+1)..($lines.Count-1)])}
        return(@($a)+$import+@($b))-join"`r`n"
    }
    return $import+"`r`n"+$content
}
function InsertButton([string]$content){
    if($content-match'<OutputStudioDownloadButton\s*/>'){
        return [pscustomobject]@{Success=$true;Content=$content;Method="Already present"}
    }
    $patterns=@(
        '(?<h><h1[^>]*>\s*Output Studio\s*</h1>)',
        '(?<h><h2[^>]*>\s*Output Studio\s*</h2>)',
        '(?<h><h3[^>]*>\s*Output Studio\s*</h3>)',
        '(?<h><div[^>]*>\s*Output Studio\s*</div>)',
        '(?<h><span[^>]*>\s*Output Studio\s*</span>)'
    )
    foreach($p in $patterns){
        $m=[regex]::Match($content,$p,[Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if($m.Success){
            $u=[regex]::Replace($content,$p,[Text.RegularExpressions.MatchEvaluator]{
                param($x)
                $x.Groups["h"].Value+"`r`n          <OutputStudioDownloadButton />"
            },1)
            return [pscustomobject]@{Success=$true;Content=$u;Method="Inserted after Output Studio heading"}
        }
    }
    return [pscustomobject]@{Success=$false;Content=$content;Method="No safe insertion point"}
}

Stage "1/6 Resolving application"
$AppRoot=ResolveApp $ProjectRoot
Ok "Application root: $AppRoot"

$src=Join-Path $AppRoot "src"
$audit=Join-Path $AppRoot "_OUTPUT_STUDIO_DOWNLOAD_AUDIT"
New-Item -ItemType Directory -Path $audit -Force|Out-Null

Stage "2/6 Checking Output Studio"
$files=@(Get-ChildItem $src -Recurse -File|Where-Object{$_.Extension-in@(".ts",".tsx",".js",".jsx")})
$output=@()
$viewers=@()
$downloads=@()

foreach($f in $files){
    $c=ReadText $f.FullName
    if($c-match'(?i)Output\s*Studio'){
        $output += [pscustomobject]@{
            File=$f.FullName
            RelativePath=Rel $AppRoot $f.FullName
            HasIframe=[bool]($c-match'(?i)<iframe')
            HasObject=[bool]($c-match'(?i)<object')
            HasEmbed=[bool]($c-match'(?i)<embed')
            HasDownload=[bool]($c-match'(?i)(download\s*=|download report|save report|export report)')
        }
    }
    if($c-match'(?i)(<iframe|<object|<embed|\.(html|pdf|xlsx|csv|docx|pptx|png|svg))'){
        $viewers += Rel $AppRoot $f.FullName
    }
    if($c-match'(?i)(download\s*=|download report|save report|export report)'){
        $downloads += Rel $AppRoot $f.FullName
    }
}
$output=@($output|Sort-Object RelativePath -Unique)
$viewers=@($viewers|Sort-Object -Unique)
$downloads=@($downloads|Sort-Object -Unique)

Ok "Output Studio files: $($output.Count)"
Ok "Report viewer candidates: $($viewers.Count)"
Ok "Existing download references: $($downloads.Count)"

Stage "3/6 Checking generated reports"
$public=Join-Path $AppRoot "public"
$ext=@(".html",".htm",".pdf",".xlsx",".xls",".csv",".docx",".doc",".pptx",".ppt",".png",".jpg",".jpeg",".svg")
$reports=@()
if(Test-Path $public){
    $reports=@(Get-ChildItem $public -Recurse -File|Where-Object{$ext-contains$_.Extension.ToLowerInvariant()}|ForEach-Object{
        $rel=Rel $public $_.FullName
        [pscustomobject]@{
            RelativePath=$rel
            PublicUrl="/"+$rel.Replace("\","/")
            SizeKB=[math]::Round($_.Length/1KB,2)
        }
    })
}
Ok "Generated reports: $($reports.Count)"

$now=Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$auditText=@"
# Output Studio Download Audit

Generated: $now
Application: $AppRoot
Mode: $(if($Apply){"Apply"}else{"Check only"})

## Summary

| Check | Result |
|---|---:|
| Output Studio files | $($output.Count) |
| Report viewer files | $($viewers.Count) |
| Existing download references | $($downloads.Count) |
| Generated reports | $($reports.Count) |

## Output Studio files
$(if($output.Count){($output|ForEach-Object{"- ``$($_.RelativePath)`` — iframe=$($_.HasIframe), object=$($_.HasObject), embed=$($_.HasEmbed), download=$($_.HasDownload)"})-join"`r`n"}else{"- None found."})

## Report viewer candidates
$(if($viewers.Count){($viewers|ForEach-Object{"- ``$_``"})-join"`r`n"}else{"- None found."})

## Existing download references
$(if($downloads.Count){($downloads|ForEach-Object{"- ``$_``"})-join"`r`n"}else{"- None found."})

## Generated reports
$(if($reports.Count){($reports|Select-Object -First 150|ForEach-Object{"- ``$($_.PublicUrl)`` — $($_.SizeKB) KB"})-join"`r`n"}else{"- None found."})

## Conclusion
$(if($output.Count-eq0){"No Output Studio source file was found."}elseif($output.Count-gt1){"Multiple Output Studio files were found. Review before applying."}elseif($output[0].HasDownload){"A download implementation already appears to exist."}else{"Exactly one Output Studio source file was found without a download control. Apply mode is eligible."})
"@

$auditPath=Join-Path $audit "Output_Studio_Download_Audit.md"
Set-Content $auditPath $auditText -Encoding UTF8
$output|Export-Csv (Join-Path $audit "Output_Studio_Files.csv") -NoTypeInformation -Encoding UTF8
$reports|Export-Csv (Join-Path $audit "Generated_Reports.csv") -NoTypeInformation -Encoding UTF8
Ok "Audit: $auditPath"

if(-not$Apply){
    Stage "4/6 Check complete — no source files changed"
    Write-Host ""
    Write-Host "REVIEW:" -ForegroundColor Yellow
    Write-Host $auditPath -ForegroundColor Cyan
    Write-Host ""
    Write-Host "APPLY COMMAND:" -ForegroundColor Yellow
    Write-Host ('& "'+$PSCommandPath+'" -ProjectRoot "'+$ProjectRoot+'" -Apply') -ForegroundColor Cyan
    if($OpenAudit){Start-Process $auditPath}
    exit 0
}

Stage "4/6 Validating apply conditions"
if($output.Count-eq0){throw "No Output Studio file found."}
if($output.Count-gt1){throw "Multiple Output Studio files found. Apply stopped."}
$target=$output[0].File
$targetRel=$output[0].RelativePath
Ok "Target: $targetRel"

Stage "5/6 Backing up and adding download component"
$stamp=Get-Date -Format "yyyyMMdd_HHmmss"
$backup=Join-Path $AppRoot ("_OUTPUT_STUDIO_BACKUP_"+$stamp)
New-Item -ItemType Directory -Path $backup -Force|Out-Null
$backupTarget=Join-Path $backup $targetRel
New-Item -ItemType Directory -Path (Split-Path $backupTarget -Parent) -Force|Out-Null
Copy-Item $target $backupTarget -Force

$componentDir=Join-Path $src "components"
New-Item -ItemType Directory -Path $componentDir -Force|Out-Null
$component=Join-Path $componentDir "OutputStudioDownloadButton.tsx"

$componentCode=@'
"use client";

import { useCallback, useState } from "react";

const REPORT_PATTERN =
  /\.(html?|pdf|xlsx?|csv|docx?|pptx?|png|jpe?g|svg)(?:\?.*)?$/i;

function visible(element: Element): boolean {
  const item = element as HTMLElement;
  const style = window.getComputedStyle(item);
  const rect = item.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || "1") > 0 &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function normalize(value: string | null): string | null {
  if (!value) return null;

  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return null;
  }
}

function findReportUrl(): string | null {
  const selectors = [
    "iframe[src]",
    "object[data]",
    "embed[src]",
    "a[href]",
  ];

  const candidates = Array.from(
    document.querySelectorAll(selectors.join(","))
  ).filter(visible);

  for (const candidate of candidates) {
    const raw =
      candidate.getAttribute("src") ??
      candidate.getAttribute("data") ??
      candidate.getAttribute("href");

    const url = normalize(raw);

    if (
      url &&
      (REPORT_PATTERN.test(url) ||
        url.includes("/generated/") ||
        url.includes("/reports/"))
    ) {
      return url;
    }
  }

  return null;
}

function fileName(url: string): string {
  try {
    return (
      new URL(url).pathname.split("/").filter(Boolean).pop() ||
      "output-studio-report.html"
    );
  } catch {
    return "output-studio-report.html";
  }
}

export default function OutputStudioDownloadButton() {
  const [status, setStatus] = useState("");

  const download = useCallback(async () => {
    setStatus("");

    const reportUrl = findReportUrl();

    if (!reportUrl) {
      setStatus("Open or select a report first.");
      return;
    }

    try {
      const response = await fetch(reportUrl, {
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const localUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = localUrl;
      link.download = fileName(reportUrl);
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
      setStatus("Download started.");
    } catch {
      const link = document.createElement("a");

      link.href = reportUrl;
      link.download = fileName(reportUrl);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();

      setStatus("Report opened for download.");
    }
  }, []);

  return (
    <div
      data-output-studio-download
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        flexWrap: "wrap",
        marginBlock: "0.75rem",
      }}
    >
      <button
        type="button"
        onClick={download}
        aria-label="Download the selected Output Studio report"
        style={{
          border: "1px solid rgba(59,130,246,.55)",
          borderRadius: "0.75rem",
          padding: "0.65rem 1rem",
          background:
            "linear-gradient(135deg, rgb(37,99,235), rgb(14,116,144))",
          color: "#fff",
          cursor: "pointer",
          fontWeight: 700,
          boxShadow: "0 8px 20px rgba(37,99,235,.22)",
        }}
      >
        Download Report
      </button>

      {status ? (
        <span role="status" aria-live="polite" style={{ fontSize: ".875rem" }}>
          {status}
        </span>
      ) : null}
    </div>
  );
}
'@

Set-Content $component $componentCode -Encoding UTF8
Ok "Component created: src\components\OutputStudioDownloadButton.tsx"
Ok "Backup: $backup"

Stage "6/6 Patching and verifying"
$content=ReadText $target
$import='import OutputStudioDownloadButton from "@/components/OutputStudioDownloadButton";'
$content=AddImport $content $import
$result=InsertButton $content
if(-not$result.Success){throw "No safe Output Studio heading insertion point was found. Backup: $backup"}
Set-Content $target $result.Content -Encoding UTF8

$updated=ReadText $target
$checks=@(
    [pscustomobject]@{Check="Import exists";Passed=$updated.Contains($import)},
    [pscustomobject]@{Check="Component rendered";Passed=[bool]($updated-match'<OutputStudioDownloadButton\s*/>')},
    [pscustomobject]@{Check="Component file exists";Passed=(Test-Path $component -PathType Leaf)},
    [pscustomobject]@{Check="Backup exists";Passed=(Test-Path $backupTarget -PathType Leaf)}
)
$verification=Join-Path $audit "Download_Implementation_Verification.csv"
$checks|Export-Csv $verification -NoTypeInformation -Encoding UTF8
$failed=@($checks|Where-Object{-not$_.Passed})
if($failed.Count){throw "Verification failed. Review $verification"}

Ok "Download button added and verified."
Write-Host ""
Write-Host "UPDATED:" -ForegroundColor Yellow
Write-Host $target -ForegroundColor Cyan
Write-Host "COMPONENT:" -ForegroundColor Yellow
Write-Host $component -ForegroundColor Cyan
Write-Host "BACKUP:" -ForegroundColor Yellow
Write-Host $backup -ForegroundColor Cyan
Write-Host ""
Write-Host "NEXT:" -ForegroundColor Yellow
Write-Host ('cd "'+$AppRoot+'"') -ForegroundColor Cyan
Write-Host "npm run build" -ForegroundColor Cyan
Write-Host "npm run dev" -ForegroundColor Cyan
