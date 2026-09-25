$ErrorActionPreference = 'Stop'

$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'MaxCompany Falco CRM'

$action = New-ScheduledTaskAction -Execute $node -Argument 'server/server.js' -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'CRM Falco em http://localhost:3100; leitura de XMLs e sincronização SEFAZ' -Force | Out-Null
Write-Output "Tarefa instalada: $taskName ($account)"
Write-Output 'O servidor iniciará automaticamente ao entrar no Windows e continuará ativo após fechar o navegador.'
