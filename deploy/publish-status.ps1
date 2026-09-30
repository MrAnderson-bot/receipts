# Shows how publishing on the VM is going: the timer and its next run, whether a publish is
# running, the last few runs with every step that failed, and the last run's error lines.
# Run from the project folder:
#
#   .\deploy\publish-status.ps1
#
# To start a publish right now as well:  .\deploy\publish-status.ps1 -Now
#
# The work is done by deploy/publish-status.sh on the VM; this only calls it.
param([switch]$Now)
$ErrorActionPreference = "Stop"
$vm = "receipts-engine"
$zone = "australia-southeast1-b"

$arg = ""
if ($Now) { $arg = " now" }

gcloud compute ssh $vm --zone $zone --tunnel-through-iap --command "sudo bash /opt/receipts/deploy/publish-status.sh$arg"
