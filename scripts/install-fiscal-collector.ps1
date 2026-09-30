# Instalar no servidor MaxCompany; mantém a coleta independente de login e navegador.
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ne 'MAXCOMPANY') { throw 'Execute este instalador no servidor MaxCompany.' }
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = Join-Path $project 'data\runtime\node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw 'Runtime Node ausente em data\runtime\node.exe.' }
$version = & $node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v20\.') { throw 'Runtime Node 20 não iniciou no servidor.' }
$certificates = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and $_.Subject -match ':\d{14}' })
if (-not $certificates.Count) { throw 'Nenhum certificado empresarial disponível para a conta atual.' }
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'MaxCompany Fiscal Collector'
$script = Join-Path $project 'scripts\collect-fiscal.mjs'
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $script + '"') -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'CRM: coleta Falco/MASERP/SEFAZ e sincroniza Supabase sem login interativo.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Coletor instalado e iniciado no servidor. Tarefa S4U inicia com o Windows sem exigir login.'
