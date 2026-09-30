# Installs or updates the publish timer and service on the VM and starts a publish straight away.
# Run from the project folder:
#
#   .\deploy\vm-install-publish.ps1
#
# The work is done by deploy/vm-install-publish.sh on the VM; this pulls the latest code there
# first (as the job user) so the script exists, then runs it.
$ErrorActionPreference = "Stop"
$vm = "receipts-engine"
$zone = "australia-southeast1-b"
$cmd = "sudo -u receipts git -C /opt/receipts pull --ff-only && sudo bash /opt/receipts/deploy/vm-install-publish.sh"
gcloud compute ssh $vm --zone $zone --tunnel-through-iap --command $cmd
