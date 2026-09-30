param(
    [ValidateSet('all', '1', '2', '3', '4')]
    [string]$Company = 'all',
    [ValidateRange(1, 100)]
    [int]$MaxBatches = 20
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
$endpoint = 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx'
$action = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse'
$storage = Join-Path (Split-Path $PSScriptRoot -Parent) 'data\sefaz'
$companies = @(
    @{ Id = '1'; Name = 'MaxPlast'; Tail = '0170'; Uf = '33' },
    @{ Id = '2'; Name = 'MaxSafety'; Tail = '0141'; Uf = '33' },
    @{ Id = '3'; Name = 'MaxSupply'; Tail = '0145'; Uf = '33' },
    @{ Id = '4'; Name = 'MaxSupply · Filial ES'; Tail = '0226'; Uf = '32' }
)

# Impede duas instâncias locais de consultarem o mesmo cursor simultaneamente.
$mutex = New-Object -TypeName System.Threading.Mutex -ArgumentList $false, 'Local\MaxCompanyCrmSefazDistribution'
if (-not $mutex.WaitOne(0)) { Write-Output 'Consulta SEFAZ já em execução'; exit 0 }
try {

# Em execuções sem o provedor de certificados (por exemplo, coletor em segundo plano),
# trata a ausência como indisponibilidade operacional em vez de abortar todo o ciclo.
$certificates = if (Get-PSDrive -Name Cert -ErrorAction SilentlyContinue) {
    @(Get-ChildItem -Path Cert:\CurrentUser\My -ErrorAction SilentlyContinue)
} else {
    @()
}

function Save-State([string]$path, [hashtable]$state) {
    $temporary = "$path.tmp"
    [System.IO.File]::WriteAllText($temporary, ($state | ConvertTo-Json -Depth 4), [System.Text.Encoding]::UTF8)
    Move-Item -LiteralPath $temporary -Destination $path -Force
}

function Node-Text($node, [string]$name) {
    $child = $node.SelectSingleNode("*[local-name()='$name']")
    if ($child) { return $child.InnerText }
    return ''
}

foreach ($companyConfig in $companies) {
    if ($Company -ne 'all' -and $Company -ne $companyConfig.Id) { continue }
    $certificate = $certificates |
        Where-Object {
            $_.HasPrivateKey -and $_.NotBefore -le (Get-Date) -and $_.NotAfter -gt (Get-Date) -and
            $_.Subject -match ':(\d{14})' -and $Matches[1].EndsWith($companyConfig.Tail)
        } | Select-Object -First 1
    if (-not $certificate) {
        $existingFolder = Get-ChildItem -LiteralPath $storage -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d{14}$' -and $_.Name.EndsWith($companyConfig.Tail) } | Select-Object -First 1
        if ($existingFolder) {
            $existingStatePath = Join-Path $existingFolder.FullName 'state.json'
            $missingState = @{}
            if (Test-Path -LiteralPath $existingStatePath) {
                $savedMissingState = Get-Content -LiteralPath $existingStatePath -Raw | ConvertFrom-Json
                foreach ($property in $savedMissingState.PSObject.Properties) {
                    $missingState[$property.Name] = $property.Value
                }
            }
            $missingState.LastError = 'Certificado empresarial válido não encontrado nesta conta Windows.'
            $missingState.LastAttemptAt = [DateTimeOffset]::UtcNow.ToString('o')
            Save-State $existingStatePath $missingState
        }
        Write-Output "$($companyConfig.Name): certificado válido não encontrado no repositório do Windows"
        continue
    }
    $cnpj = [regex]::Match($certificate.Subject, ':(\d{14})').Groups[1].Value
    $folder = Join-Path $storage $cnpj
    $null = New-Item -ItemType Directory -Force -Path $folder
    $statePath = Join-Path $folder 'state.json'
    $state = @{}
    if (Test-Path -LiteralPath $statePath) {
        $stateJson = Get-Content -LiteralPath $statePath -Raw
        $savedState = $stateJson | ConvertFrom-Json
        foreach ($property in $savedState.PSObject.Properties) {
            $state[$property.Name] = $property.Value
        }
        $nextAllowedMatch = [regex]::Match($stateJson, '"NextAllowedAt"\s*:\s*"([^"]+)"')
        $nextAllowedAt = if ($nextAllowedMatch.Success) {
            [DateTimeOffset]::Parse(
                $nextAllowedMatch.Groups[1].Value,
                [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::RoundtripKind
            )
        } else {
            $null
        }
    } else {
        $state = @{ LastNsu = '000000000000000'; NextAllowedAt = $null; LastStatus = 'never' }
        $nextAllowedAt = $null
    }
    if ($nextAllowedAt -and $nextAllowedAt -gt [DateTimeOffset]::UtcNow) {
        Write-Output "$($companyConfig.Name): aguardando janela da SEFAZ até $($state.NextAllowedAt)"
        continue
    }
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.UseProxy = $false
    $null = $handler.ClientCertificates.Add($certificate)
    $client = New-Object -TypeName System.Net.Http.HttpClient -ArgumentList $handler
    $client.Timeout = [TimeSpan]::FromSeconds(45)
    try {
        for ($batch = 0; $batch -lt $MaxBatches; $batch++) {
            $lastNsu = if ($state.LastNsu -match '^\d{15}$') { $state.LastNsu } else { '000000000000000' }
            $body = '<distDFeInt versao="1.01" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>1</tpAmb><cUFAutor>' + $companyConfig.Uf + '</cUFAutor><CNPJ>' + $cnpj + '</CNPJ><distNSU><ultNSU>' + $lastNsu + '</ultNSU></distNSU></distDFeInt>'
            $soap = '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg>' + $body + '</nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>'
            $request = New-Object -TypeName System.Net.Http.HttpRequestMessage -ArgumentList ([System.Net.Http.HttpMethod]::Post), $endpoint
            $request.Content = New-Object -TypeName System.Net.Http.StringContent -ArgumentList $soap, ([System.Text.Encoding]::UTF8), 'application/soap+xml'
            $actionParameter = New-Object -TypeName System.Net.Http.Headers.NameValueHeaderValue -ArgumentList 'action', ('"' + $action + '"')
            $request.Content.Headers.ContentType.Parameters.Add($actionParameter)
            try {
                $response = $client.SendAsync($request).GetAwaiter().GetResult()
                $reply = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                if (-not $response.IsSuccessStatusCode) {
                    throw "SEFAZ HTTP $([int]$response.StatusCode)"
                }
            } finally {
                $request.Dispose()
                if ($response) { $response.Dispose() }
            }
            [xml]$document = $reply
            $result = $document.SelectSingleNode("//*[local-name()='retDistDFeInt']")
            if (-not $result) { throw 'Resposta de distribuição sem retDistDFeInt' }
            $status = Node-Text $result 'cStat'
            $reason = Node-Text $result 'xMotivo'
            $returnedNsu = Node-Text $result 'ultNSU'
            $maxNsu = Node-Text $result 'maxNSU'
            $stored = 0
            if ($status -eq '138') {
                foreach ($zip in $result.SelectNodes(".//*[local-name()='docZip']")) {
                    $nsu = $zip.GetAttribute('NSU')
                    $schema = $zip.GetAttribute('schema') -replace '[^A-Za-z0-9._-]', '_'
                    if ($nsu -notmatch '^\d{15}$') { throw 'NSU inválido na resposta' }
                    $target = Join-Path $folder "nsu-$nsu-$schema.xml"
                    if (Test-Path -LiteralPath $target) { continue }
                    $compressed = [Convert]::FromBase64String($zip.InnerText)
                    $inputStream = New-Object -TypeName System.IO.MemoryStream -ArgumentList (,$compressed)
                    $gzip = New-Object -TypeName System.IO.Compression.GZipStream -ArgumentList $inputStream, ([System.IO.Compression.CompressionMode]::Decompress)
                    $outputStream = New-Object System.IO.MemoryStream
                    try {
                        $gzip.CopyTo($outputStream)
                        [System.IO.File]::WriteAllBytes($target, $outputStream.ToArray())
                        $stored++
                    } finally {
                        $outputStream.Dispose()
                        $gzip.Dispose()
                        $inputStream.Dispose()
                    }
                }
                if ($returnedNsu -notmatch '^\d{15}$') { throw 'Último NSU inválido' }
                $state.LastNsu = $returnedNsu
            }
            $state.LastStatus = $status
            $state.LastError = $null
            $state.UpdatedAt = [DateTimeOffset]::UtcNow.ToString('o')
            $state.MaxNsu = $maxNsu
            if ($status -in @('137', '656') -or ($status -eq '138' -and $returnedNsu -eq $maxNsu)) {
                $state.NextAllowedAt = [DateTimeOffset]::UtcNow.AddMinutes(65).ToString('o')
            } else {
                $state.NextAllowedAt = $null
            }
            Save-State $statePath $state
            Write-Output "$($companyConfig.Name): SEFAZ $status ($reason); $stored novos documentos; NSU $returnedNsu/$maxNsu"
            if ($status -ne '138' -or $returnedNsu -eq $maxNsu) { break }
        }
    } catch {
        $state.LastError = $_.Exception.GetBaseException().Message
        $state.LastAttemptAt = [DateTimeOffset]::UtcNow.ToString('o')
        $state.NextAllowedAt = [DateTimeOffset]::UtcNow.AddMinutes(5).ToString('o')
        Save-State $statePath $state
        Write-Output "$($companyConfig.Name): falha na consulta ($($_.Exception.Message))"
    } finally {
        $client.Dispose()
        $handler.Dispose()
    }
}
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
