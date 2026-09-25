# Shows how the backfill on the VM is going: whether the loop is running, each unit's
# status, rows and cursor, disk and database size, and the last few log lines.
# Run from the project folder:
#
#   .\deploy\backfill-status.ps1
#
# To pause the loop:  .\deploy\backfill-status.ps1 -Stop
# To resume it:       .\deploy\backfill-status.ps1 -Start
#
# The work is done by deploy/backfill-status.sh on the VM; this only calls it.
param([switch]$Stop, [switch]$Start)
$ErrorActionPreference = "Stop"
$vm = "receipts-engine"
$zone = "australia-southeast1-b"

$arg = ""
if ($Stop) { $arg = " stop" }
if ($Start) { $arg = " start" }

gcloud compute ssh $vm --zone $zone --tunnel-through-iap --command "sudo bash /opt/receipts/deploy/backfill-status.sh$arg"
