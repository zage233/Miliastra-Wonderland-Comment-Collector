$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /platform:x64 /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/reference:$PSScriptRoot\Microsoft.Web.WebView2.Core.dll" "/reference:$PSScriptRoot\Microsoft.Web.WebView2.WinForms.dll" "/out:$PSScriptRoot\Miliastra Session Bridge.exe" (Join-Path $PSScriptRoot 'SessionBridge.cs')
if ($LASTEXITCODE -ne 0) { throw 'Session bridge compilation failed.' }
$check = Start-Process -FilePath (Join-Path $PSScriptRoot 'Miliastra Session Bridge.exe') -ArgumentList '--self-test' -WindowStyle Hidden -PassThru -Wait
if ($check.ExitCode -ne 0) { throw 'Session bridge validation failed.' }
