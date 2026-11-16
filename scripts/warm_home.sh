#!/bin/sh
# Прогрев главной после выкладки: собирает подборки для больших городов вылета, чтобы первые посетители не ждали
# сборку (4–8 с). Потом сервер держит готовую главную до 6 часов и обновляет её в фоне, CDN — сутки.
#   sh scripts/warm_home.sh [https://aviatour.vercel.app]
SITE=${1:-https://aviatour.vercel.app}
for origin in "SVO&fc=MOW" LED SVX KZN OVB KRR AER UFA KUF GOJ; do
  curl -s -o /dev/null -w "$origin %{http_code} %{time_total}s\n" "$SITE/api/v1/home?from=$origin" &
done
wait
