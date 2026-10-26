param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$assetDir = Join-Path $projectDir 'assets'
New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
if (!$OutputPath) { $OutputPath = Join-Path (Split-Path -Parent $projectDir) 'Miliastra Wonderland Comment Collector.exe' }

# 使用本机 .NET Framework 编译器，不下载打包器或外部依赖。
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (!(Test-Path -LiteralPath $compiler)) { throw '找不到 .NET Framework C# 编译器。' }
Add-Type -AssemblyName System.Drawing

function New-AppBitmap([int]$Size) {
    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.ScaleTransform(($Size / 256.0), ($Size / 256.0))
    $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#152033'))
    $blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#a6baff'))
    $white = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#eef2ff'))
    $border = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml('#405377'), 3)
    $outline = [System.Drawing.Pen]::new($blue, 9)
    $outline.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $connector = [System.Drawing.Pen]::new($blue, 7)
    $shape = [System.Drawing.Drawing2D.GraphicsPath]::new()
    try {
        $shape.AddArc(8, 8, 96, 96, 180, 90)
        $shape.AddArc(152, 8, 96, 96, 270, 90)
        $shape.AddArc(152, 152, 96, 96, 0, 90)
        $shape.AddArc(8, 152, 96, 96, 90, 90)
        $shape.CloseFigure()
        $graphics.FillPath($background, $shape)
        $graphics.DrawPath($border, $shape)
        $outer = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(128,36),[System.Drawing.PointF]::new(220,128),[System.Drawing.PointF]::new(128,220),[System.Drawing.PointF]::new(36,128))
        $inner = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(128,82),[System.Drawing.PointF]::new(174,128),[System.Drawing.PointF]::new(128,174),[System.Drawing.PointF]::new(82,128))
        $core = [System.Drawing.PointF[]]@([System.Drawing.PointF]::new(128,108),[System.Drawing.PointF]::new(148,128),[System.Drawing.PointF]::new(128,148),[System.Drawing.PointF]::new(108,128))
        $graphics.DrawPolygon($outline, $outer)
        $graphics.FillPolygon($blue, $inner)
        $graphics.DrawLine($connector,128,36,128,82)
        $graphics.DrawLine($connector,220,128,174,128)
        $graphics.DrawLine($connector,128,220,128,174)
        $graphics.DrawLine($connector,36,128,82,128)
        $graphics.FillPolygon($white, $core)
    } finally {
        $graphics.Dispose(); $shape.Dispose(); $background.Dispose(); $blue.Dispose(); $white.Dispose()
        $border.Dispose(); $outline.Dispose(); $connector.Dispose()
    }
    return $bitmap
}

$sizes = @(16,24,32,48,64,128,256)
$frames = [System.Collections.Generic.List[byte[]]]::new()
foreach ($size in $sizes) {
    $bitmap = New-AppBitmap $size
    $stream = [System.IO.MemoryStream]::new()
    try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $frames.Add($stream.ToArray())
        if ($size -eq 256) { [System.IO.File]::WriteAllBytes((Join-Path $assetDir 'app-icon.png'), $stream.ToArray()) }
    } finally { $stream.Dispose(); $bitmap.Dispose() }
}
$ico = [System.IO.MemoryStream]::new()
$writer = [System.IO.BinaryWriter]::new($ico)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
        $offset += $frames[$i].Length
    }
    foreach ($frame in $frames) { $writer.Write([byte[]]$frame) }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes((Join-Path $assetDir 'app.ico'), $ico.ToArray())
} finally { $writer.Dispose(); $ico.Dispose() }

& $compiler /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 "/win32icon:$(Join-Path $assetDir 'app.ico')" "/win32manifest:$(Join-Path $PSScriptRoot 'app.manifest')" "/out:$OutputPath" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll (Join-Path $PSScriptRoot 'Program.cs')
if ($LASTEXITCODE -ne 0) { throw "编译失败：$LASTEXITCODE" }
Write-Output "已生成：$OutputPath"
