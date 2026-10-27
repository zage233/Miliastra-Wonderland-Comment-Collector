param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$appDirectory = Split-Path -Parent $PSScriptRoot
$sourceDirectory = Split-Path -Parent $appDirectory
if (!$OutputDirectory) {
    $OutputDirectory = Join-Path $sourceDirectory ('release\Miliastra-Wonderland-Comment-Collector-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Output directory already exists. Choose a new directory.' }
$executableName = 'Miliastra Wonderland Comment Collector.exe'
if (!(Test-Path -LiteralPath (Join-Path $sourceDirectory $executableName))) { throw 'Build the launcher first.' }
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
Copy-Item -LiteralPath $appDirectory -Destination (Join-Path $OutputDirectory 'app') -Recurse
foreach ($name in @('README.md','README.en.md',$executableName)) {
    Copy-Item -LiteralPath (Join-Path $sourceDirectory $name) -Destination $OutputDirectory
}
New-Item -ItemType Directory -Path (Join-Path $OutputDirectory 'config'),(Join-Path $OutputDirectory 'data') | Out-Null
Set-Content -LiteralPath (Join-Path $OutputDirectory 'config\games.json') -Value '{"games":[]}' -Encoding utf8
# GitHub web uploads may omit dotfiles. They must not be build prerequisites.
$ignoreFile = Join-Path $sourceDirectory '.gitignore'
if (Test-Path -LiteralPath $ignoreFile) {
    Copy-Item -LiteralPath $ignoreFile -Destination $OutputDirectory
} else {
    Set-Content -LiteralPath (Join-Path $OutputDirectory '.gitignore') -Encoding utf8 -Value @('/data/','/config/*','/games.json','/proxy.txt','/cookie.txt','*.log','*.tmp','/release/')
}
$licenseFile = Join-Path $sourceDirectory 'LICENSE'
if (Test-Path -LiteralPath $licenseFile) {
    Copy-Item -LiteralPath $licenseFile -Destination $OutputDirectory
}
$attributesFile = Join-Path $sourceDirectory '.gitattributes'
if (Test-Path -LiteralPath $attributesFile) {
    Copy-Item -LiteralPath $attributesFile -Destination $OutputDirectory
} else {
    Set-Content -LiteralPath (Join-Path $OutputDirectory '.gitattributes') -Encoding utf8 -Value '* -text'
}
# Static files are covered; mutable user directories are checked separately by --clean.
$manifestRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path.TrimEnd('\','/')
$manifestLines = foreach ($file in (Get-ChildItem -LiteralPath $OutputDirectory -File -Recurse -Force | Sort-Object FullName)) {
    $relative = $file.FullName.Substring($manifestRoot.Length + 1).Replace('\','/')
    if ($relative -eq 'app/docs/SHA256SUMS.txt' -or $relative -match '^(config|data|release|\.git)/') { continue }
    '{0}  {1}' -f (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
}
Set-Content -LiteralPath (Join-Path $OutputDirectory 'app\docs\SHA256SUMS.txt') -Value $manifestLines -Encoding utf8
$nodeRuntime = Get-Command node -ErrorAction Stop
& $nodeRuntime.Source (Join-Path $OutputDirectory 'app\launcher\verify-release.cjs') --clean
if ($LASTEXITCODE -ne 0) { throw 'Distribution verification failed. Do not upload this directory.' }
Write-Output $OutputDirectory
