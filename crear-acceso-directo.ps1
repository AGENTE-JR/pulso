# Crea un acceso directo "Pulso" en el Escritorio que abre la app sin consola.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron = Join-Path $dir 'node_modules\electron\dist\electron.exe'
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Pulso.lnk'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $electron
$s.Arguments = "`"$dir`""
$s.WorkingDirectory = $dir
$s.Description = 'Pulso - monitor de hardware'
$s.Save()
Write-Host "Acceso directo creado: $lnk"
