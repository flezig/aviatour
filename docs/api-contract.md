# Контракт Aviator v1

POST /api/v1/search: JSON `{ "origin": "SVO", "month": "2026-10", "max_budget_minor": 2500000, "direct_only": false }`.
Аэропорт из GET /api/v1/airports; месяц вылета — текущий и следующие пять в зоне аэропорта. Бюджет 500000…10000000 копеек, целое; граница включительна. Валюта только RUB, один взрослый, эконом, туда-обратно.

Ответ: `{ "offers": [...], "received_at": "ISO8601 UTC", "incomplete": false, "warnings": [] }`.
Предложение: `id` (стабильный маршрут/даты/рейс/источник, без цены), `city_code`, `city`, `country_code`, `country`, `origin_airport`, `destination_airport`, `origin_city`, `origin_name`, `destination_name`, `departure_at`, `return_at` (ISO8601 с offset), `origin_timezone`, `destination_timezone`, `transfers`, `return_transfers`, `duration_to`, `duration_back` (минуты), `price_minor` (целые копейки), `currency` = RUB, `search_url`, `partner_url`, `source` = LIVE/MOCK, `received_at`.
Неизвестные необязательные значения — null. Отправления отображаются в зоне соответствующего аэропорта. Получение ответа не является временем обнаружения цены. Нет вымышленных found_at/expires_at. Клиент применяет дополнительные фильтры перед выбором минимального предложения города.

GET /health: `{ "status": "ok", "live_configured": false }`.
GET /api/v1/airports: массив объектов `iata, city_code, city, name, country_code, country, timezone` из локального снимка официального справочника.

Ошибка: `{ "error": { "code": "configuration|upstream_auth|upstream_http|upstream_json|upstream_failure|timeout|validation|rate_limit", "message": "русский текст" } }`. Статусы: 503 конфигурация; 502 источник; 504 timeout; 422 входные данные; 429 ограничение с Retry-After. Частично прочитанные страницы возвращаются с incomplete и причиной. Ошибка первой страницы никогда не становится пустым успехом.
