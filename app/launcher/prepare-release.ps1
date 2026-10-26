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
Write-Output $OutputDirectory
