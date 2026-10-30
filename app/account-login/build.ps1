$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '.NET Framework x64 compiler is unavailable.' }
& $compiler /nologo /target:winexe /platform:x64 /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/reference:$PSScriptRoot\Microsoft.Web.WebView2.Core.dll" "/reference:$PSScriptRoot\Microsoft.Web.WebView2.WinForms.dll" "/out:$PSScriptRoot\Miliastra Official Login.exe" (Join-Path $PSScriptRoot 'LoginWindow.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compilation failed.' }
foreach ($checkArg in @('--self-test', '--smoke', '--activation-smoke')) {
    $checkProcess = Start-Process -FilePath (Join-Path $PSScriptRoot 'Miliastra Official Login.exe') -ArgumentList $checkArg -WindowStyle Hidden -Wait -PassThru
    if ($checkProcess.ExitCode -ne 0) { throw "$checkArg failed with exit code $($checkProcess.ExitCode)." }
    Write-Output "$checkArg passed"
}
