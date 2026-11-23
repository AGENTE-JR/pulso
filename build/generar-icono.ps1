# Genera build/icon.png (512) y build/icon.ico (256..16) con el logo de Pulso.
Add-Type -AssemblyName System.Drawing
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

function New-PulsoBitmap([int]$s) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.Clear([System.Drawing.Color]::Transparent)
  $r = [float]($s * 0.22); $m = [float]($s * 0.04); $w = [float]($s - 2 * $m)
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($m, $m, 2*$r, 2*$r, 180, 90); $path.AddArc($m+$w-2*$r, $m, 2*$r, 2*$r, 270, 90)
  $path.AddArc($m+$w-2*$r, $m+$w-2*$r, 2*$r, 2*$r, 0, 90); $path.AddArc($m, $m+$w-2*$r, 2*$r, 2*$r, 90, 90); $path.CloseFigure()
  $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF $s, $s), ([System.Drawing.Color]::FromArgb(255, 18, 22, 32)), ([System.Drawing.Color]::FromArgb(255, 8, 10, 15))
  $g.FillPath($bg, $path)
  $border = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 40, 48, 66)), ([float][Math]::Max(1, $s * 0.012))
  $g.DrawPath($border, $path)
  # Línea de pulso con degradado cian -> índigo -> naranja Claude
  $lg = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF ($s*0.08), 0), (New-Object System.Drawing.PointF ($s*0.92), 0), ([System.Drawing.Color]::FromArgb(255, 34, 211, 238)), ([System.Drawing.Color]::FromArgb(255, 217, 119, 87))
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend 3
  $blend.Colors = @([System.Drawing.Color]::FromArgb(255,34,211,238), [System.Drawing.Color]::FromArgb(255,129,140,248), [System.Drawing.Color]::FromArgb(255,217,119,87))
  $blend.Positions = @([float]0, [float]0.5, [float]1); $lg.InterpolationColors = $blend
  $pen = New-Object System.Drawing.Pen $lg, ([float]($s * 0.075))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $pts = @(@(0.16,0.55),@(0.34,0.55),@(0.43,0.28),@(0.56,0.76),@(0.65,0.46),@(0.84,0.46)) | ForEach-Object { New-Object System.Drawing.PointF ([float]($_[0]*$s)), ([float]($_[1]*$s)) }
  $g.DrawLines($pen, [System.Drawing.PointF[]]$pts)
  $g.Dispose(); return $bmp
}

$big = New-PulsoBitmap 512; $big.Save((Join-Path $dir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
$src = Join-Path $dir '..\src\icon.png'; Copy-Item (Join-Path $dir 'icon.png') $src -Force

# ICO con entradas PNG
$sizes = 256, 64, 48, 32, 16
$pngs = foreach ($z in $sizes) { $b = New-PulsoBitmap $z; $ms = New-Object System.IO.MemoryStream; $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); ,$ms.ToArray() }
$out = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $out
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $z = $sizes[$i]; $d = if ($z -ge 256) { 0 } else { $z }
  $bw.Write([byte]$d); $bw.Write([byte]$d); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$pngs[$i].Length); $bw.Write([UInt32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write([byte[]]$p) }
[System.IO.File]::WriteAllBytes((Join-Path $dir 'icon.ico'), $out.ToArray())
Write-Host 'Icono generado'
