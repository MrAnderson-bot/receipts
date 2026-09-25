# Shows how the backfill on the VM is going: whether the loop is running, each unit's
# status, rows and cursor, and the last few log lines. Run from the project folder:
#
#   .\deploy\backfill-status.ps1
#
# To pause the loop:  .\deploy\backfill-status.ps1 -Stop
# To resume it:       .\deploy\backfill-status.ps1 -Start
param([switch]$Stop, [switch]$Start)
$ErrorActionPreference = "Stop"
$vm = "receipts-engine"
$zone = "australia-southeast1-b"

$action = ""
if ($Stop) { $action = "sudo systemctl stop receipts-backfill.service; " }
if ($Start) { $action = "sudo systemctl start receipts-backfill.service; " }

$remote = $action + 'echo "loop: $(systemctl is-active receipts-backfill.service)"; ' +
  'echo "disk: $(df -h / | awk ''NR==2{print $3" used, "$4" free"}'')"; ' +
  'echo "database: $(ls -la /opt/receipts/data/receipts.db | awk ''{printf "%.0f MB", $5/1048576}'')"; ' +
  'cd /opt/receipts && node -e "' +
  'const {DatabaseSync}=require(\"node:sqlite\");' +
  'try{const db=new DatabaseSync(\"data/receipts.db\",{readOnly:true});' +
  'const rows=db.prepare(\"select unit,status,rows_added,calls,substr(coalesce(cursor,\"\"),1,10) cursor,substr(coalesce(finished,started,\"\"),1,16) at from backfill_progress order by started desc\").all();' +
  'console.log(\"units:\");for(const r of rows)console.log(\"  \"+r.unit+\"  \"+r.status+\"  \"+r.rows_added+\" rows  \"+r.calls+\" calls  cursor \"+r.cursor+\"  \"+r.at);' +
  'console.log(\"contract releases stored: \"+db.prepare(\"select count(*) n from contract_releases\").get().n);' +
  '}catch(e){console.log(\"no progress table yet: \"+e.message)}" 2>/dev/null; ' +
  'echo "log:"; sudo journalctl -u receipts-backfill --no-pager -n 6 -o cat'

gcloud compute ssh $vm --zone $zone --tunnel-through-iap --command $remote
