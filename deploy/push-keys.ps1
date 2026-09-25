# Copies every variable in .env.local to /etc/receipts.env on the VM, so the nightly
# publish can use the same API keys as the dev machine. Run from the project folder
# in PowerShell:
#
#   .\deploy\push-keys.ps1
#
# Two short gcloud calls: upload the env file and a small shell script, then run the
# script as root. Nothing is typed on a long command line, so nothing wraps or breaks.
# Values are never printed; the script ends by listing the variable names on the VM.
$ErrorActionPreference = "Stop"
$vm = "receipts-engine"
$zone = "australia-southeast1-b"

if (-not (Test-Path ".env.local")) { throw "No .env.local in this folder. Run from the project root." }

# The shell script must reach the VM with Unix line endings, whatever git did on checkout.
$script = Join-Path $env:TEMP "vm-append-keys.sh"
$text = (Get-Content "deploy/vm-append-keys.sh" -Raw) -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($script, $text, (New-Object System.Text.UTF8Encoding($false)))

gcloud compute scp ".env.local" $script "${vm}:/tmp/" --zone $zone --tunnel-through-iap
if ($LASTEXITCODE -ne 0) { throw "Upload failed." }

gcloud compute ssh $vm --zone $zone --tunnel-through-iap --command "sudo sh /tmp/vm-append-keys.sh"
if ($LASTEXITCODE -ne 0) { throw "The VM script failed; see the output above." }

Remove-Item $script -ErrorAction SilentlyContinue
Write-Host "Done. The keys take effect at the next publish (04:30 Canberra time), or start one now with:"
Write-Host '  gcloud compute ssh receipts-engine --zone australia-southeast1-b --tunnel-through-iap --command "sudo systemctl start receipts-publish.service"'
