#!/bin/sh
# Прогрев после выкладки: собирает подборки для больших городов вылета и страницы «Куда улететь», чтобы первые
# посетители не ждали сборку (4–8 с). Потом сервер держит готовую главную до 6 часов и обновляет её в фоне, CDN — сутки.
#   sh scripts/warm_home.sh [https://aviatour.vercel.app]
SITE=${1:-https://aviatour.vercel.app}
for origin in "SVO&fc=MOW" LED SVX KZN OVB KRR AER UFA KUF GOJ; do
  curl -s -o /dev/null -w "главная $origin %{http_code} %{time_total}s\n" "$SITE/api/v1/home?from=$origin" &
done
wait
for place in moskva sankt-peterburg ekaterinburg kazan novosibirsk krasnodar sochi ufa samara nizhniy-novgorod; do
  for page in do-5000 do-10000 do-15000 do-20000 na-vykhodnye na-prazdniki; do
    curl -s -o /dev/null -w "/kuda/$place/$page %{http_code} %{time_total}s\n" "$SITE/kuda/$place/$page" &
  done
  wait
done
