$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$sqlPath = Join-Path $root 'qa/commerce-chat-staging-activate.sql'
if (!(Test-Path -LiteralPath $sqlPath -PathType Leaf)) {
    throw 'Missing qa/commerce-chat-staging-activate.sql'
}

$hostname = (Read-Host 'Staging Session pooler host, or Enter for direct IPv6').Trim().ToLowerInvariant()
if ($hostname -and $hostname -notmatch '^[a-z0-9]+(?:-[a-z0-9]+)+\.pooler\.supabase\.com$') {
    throw 'Enter only the Session pooler hostname from Supabase Connect, without user or port'
}
$certPath = (Read-Host 'Path to the Supabase root certificate (.crt)').Trim().Trim('"')
$certFile = Get-Item -LiteralPath $certPath
if ($certFile.PSIsContainer) { throw 'Expected a root certificate file' }
$secret = Read-Host 'Database password for staging xnnxmhwvixrqenunhhbt' -AsSecureString
if ($secret.Length -eq 0) { throw 'Database password is required' }

$OutputEncoding = [Text.UTF8Encoding]::new($false)
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    @{
        host = $hostname
        caPath = $certFile.FullName
        password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    } | ConvertTo-Json -Compress | & node (Join-Path $PSScriptRoot 'activate-commerce-staging.mjs')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    $secret.Dispose()
}
