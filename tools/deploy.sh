#!/bin/bash
# פריסת VetShifts לשרת. מיועד להרצה כ-root דרך: ssh host 'bash -s' < deploy.sh
# אידמפוטנטי — אפשר להריץ שוב אחרי עדכון קוד.
set -euo pipefail

REPO_URL="https://github.com/vetrinarbatyam-dotcor/vetshifts.git"
ROOT=/var/www/shifts
HOST=shifts.claudevet.com
ZONE=95b0d7acda75a9819ebb15491a108875
CF_INI=/home/claude-user/vetime/.cloudflare.ini

say() { printf '\n== %s\n' "$1"; }

say "1. DNS"
TOK=$(grep -oP 'dns_cloudflare_api_token\s*=\s*\K\S+' "$CF_INI")
EXIST=$(curl -s -H "Authorization: Bearer $TOK" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?name=$HOST" \
  | python3 -c 'import sys,json; r=json.load(sys.stdin)["result"]; print(r[0]["id"] if r else "")')
BODY='{"type":"A","name":"shifts","content":"167.86.69.208","proxied":true,"ttl":1}'
if [ -n "$EXIST" ]; then
  curl -s -X PUT -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$EXIST" -d "$BODY" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print("updated" if d["success"] else d["errors"])'
else
  curl -s -X POST -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" -d "$BODY" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print("created" if d["success"] else d["errors"])'
fi

say "2. code"
if [ -d "$ROOT/.git" ]; then
  git -C "$ROOT" fetch --quiet origin && git -C "$ROOT" reset --hard --quiet origin/master
else
  rm -rf "$ROOT"; git clone --quiet "$REPO_URL" "$ROOT"
fi
git -C "$ROOT" log --oneline -1
# Cloudflare דורס Cache-Control של .js ומגיש max-age=14400, ולכן כותרות מהמקור
# אינן מספיקות: index.html חדש נטען עם solver.js ישן והציור נשבר באמצע.
# URL עם ה-SHA הוא URL אחר גם ל-CF וגם לדפדפן.
SHA=$(git -C "$ROOT" rev-parse --short HEAD)
sed -i "s|solver\.js?v=[A-Za-z0-9]*|solver.js?v=$SHA|g" "$ROOT/index.html"
# בלי head: סגירת הצינור מפילה את grep, ועם pipefail זה מפיל את כל הפריסה
grep -o -m1 'solver\.js?v=[A-Za-z0-9]*' "$ROOT/index.html" || echo 'WARNING: version stamp missing'

say "3. log format"
cat > /etc/nginx/conf.d/vetshifts-log.conf <<'NGX'
# לוג נפרד ל-VetShifts, כדי לא לזהם את מוני ההשקה של VetPrices.
log_format vetshifts '$remote_addr $host [$time_local] "$request" $status '
                     '$body_bytes_sent "$http_referer" "$http_user_agent"';
NGX

say "4. vhost"
cat > /etc/nginx/sites-available/shifts.claudevet.com <<'NGX'
# shifts.claudevet.com — VetShifts (static, repo vetshifts). HTTPS via Cloudflare proxy.
server {
    listen 80;
    server_name shifts.claudevet.com;
    root /var/www/shifts;
    index index.html;
    include /etc/nginx/snippets/cloudflare-realip.conf;
    access_log /var/log/nginx/shifts.access.log vetshifts;

    location ~ /(tools|promo|\.git) { return 404; }
    # index ו-config תמיד טריים, אחרת עדכון גרסה לא מגיע ומוני הכניסות משקרים
    location = /index.html { add_header Cache-Control "no-cache, no-store, must-revalidate"; }
    location = /config.json { add_header Cache-Control "no-cache, no-store, must-revalidate"; }
    # no-store ולא no-cache: index.html ו-solver.js חייבים להתעדכן יחד.
    # solver ישן מהקאש מול index חדש מפיל את ציור הלוח באמצע.
    location = /solver.js  { add_header Cache-Control "no-store"; }
}
NGX
ln -sf /etc/nginx/sites-available/shifts.claudevet.com /etc/nginx/sites-enabled/shifts.claudevet.com
nginx -t && systemctl reload nginx

say "5. logrotate"
cat > /etc/logrotate.d/vetshifts <<'ROT'
/var/log/nginx/shifts.access.log {
  daily
  rotate 60
  compress
  delaycompress
  missingok
  notifempty
  create 0640 www-data adm
  sharedscripts
  postrotate
    [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
  endscript
}
ROT

say "6. stats"
cat > /usr/local/bin/vetshifts-stats <<'STAT'
#!/bin/bash
# משפך VetShifts מתוך לוג ה-vhost.
#   הגיעו לדף  - /index.html מוגש no-store, ולכן כל טעינה מגיעה לשרת.
#   עברו את השער - solver.js נטען עם הדף, אבל config.json נקרא לפני השער;
#                  מה שמעיד על מעבר בשער הוא הורדת תמונה/עותק — שאינה נרשמת.
#                  לכן המדד כאן הוא כניסות בלבד, וזה מכוון: אין אנליטיקס בדף.
# כניסה = IP × יום. Cloudflare מטמין, ולכן ביקורים חוזרים בחסר.
DAYS=${1:-7}
BOT='bot|crawl|spider|slurp|curl|wget|HeadlessChrome|python-requests|facebookexternalhit'
PAGE='GET /(index\.html)?(\?[^ ]*)? '

logs() {
  cat /var/log/nginx/shifts.access.log 2>/dev/null
  cat /var/log/nginx/shifts.access.log.1 2>/dev/null
  zcat /var/log/nginx/shifts.access.log.*.gz 2>/dev/null
}

echo "VetShifts — $DAYS ימים אחרונים"
echo "יום         כניסות  בקשות"
for i in $(seq $((DAYS-1)) -1 0); do
  D=$(date -d "-$i day" '+%d/%b/%Y')
  L=$(logs | grep -F "[$D" | grep -Ev "$BOT" || true)
  HITS=$(echo "$L" | grep -Ec "$PAGE" || true)
  IPS=$(echo "$L" | grep -E "$PAGE" | awk '{print $1}' | sort -u | wc -l)
  printf '%s  %6s  %6s\n' "$(date -d "-$i day" '+%Y-%m-%d')" "$IPS" "$HITS"
done
echo
echo "סה\"כ IP ייחודיים בטווח:"
logs | grep -Ev "$BOT" | grep -E "$PAGE" | awk '{print $1}' | sort -u | wc -l
STAT
chmod +x /usr/local/bin/vetshifts-stats

say "7. verify"
curl -sS -o /dev/null -w 'origin  /index.html  %{http_code}\n' -H "Host: $HOST" http://127.0.0.1/index.html
curl -sS -o /dev/null -w 'origin  /solver.js   %{http_code}\n' -H "Host: $HOST" http://127.0.0.1/solver.js
curl -sS -o /dev/null -w 'origin  /config.json %{http_code}\n' -H "Host: $HOST" http://127.0.0.1/config.json
curl -sS -o /dev/null -w 'origin  /.git/config %{http_code}\n' -H "Host: $HOST" http://127.0.0.1/.git/config
curl -sS -o /dev/null -w 'origin  /tools/deploy.sh %{http_code}\n' -H "Host: $HOST" http://127.0.0.1/tools/deploy.sh
echo "SHA: $(git -C "$ROOT" rev-parse --short HEAD)"
