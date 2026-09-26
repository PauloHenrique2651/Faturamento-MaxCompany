# Executar somente após autorizar a instalação da tarefa no Windows.
# Use a conta com acesso ao compartilhamento e aos certificados empresariais.
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$certificates = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and $_.Subject -match ':\d{14}' })
if (-not $certificates.Count) { throw 'Instale no computador/conta que já possui os certificados empresariais A1. Nenhuma tarefa foi criada.' }
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'MaxCompany Fiscal Collector'
$script = Join-Path $project 'scripts\collect-fiscal.mjs'
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $script + '"') -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Atualização incremental do CRM e distribuição SEFAZ; DEPLOY somente leitura.' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Coletor instalado. Executa enquanto esta conta Windows está conectada; a máquina deve permanecer ligada.'
