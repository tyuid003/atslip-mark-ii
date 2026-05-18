Resolve-DnsName -Name "atslip-backend.tyuid003.workers.dev" -Server "8.8.8.8" 2>&1 | Format-List
Write-Host "---"
Resolve-DnsName -Name "tyuid003.workers.dev" -Server "8.8.8.8" 2>&1 | Format-List
