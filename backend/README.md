# Aviator backend

Python 3.12+, один процесс. Из корня репозитория:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
cd backend
../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Настоящий TRAVELPAYOUTS_API_TOKEN добавляется только в backend/.env. Без него health и справочник работают, LIVE возвращает 503 с понятным сообщением. Не публикуйте .env и не вставляйте токен в iOS.

```sh
curl http://127.0.0.1:8000/health
curl -X POST http://127.0.0.1:8000/api/v1/search -H 'Content-Type: application/json' -d '{"origin":"SVO","month":"2026-10","max_budget_minor":2500000,"direct_only":false}'
../.venv/bin/python -m pytest -q
```

TTL/LRU-кеш 900 секунд / 200 ключей и singleflight для одновременных одинаковых запросов. Успешный пустой ответ кешируется, ошибка не кешируется. Прошедшие предложения удаляются при выдаче кеша. Общий пользовательский лимит 10 запросов/минуту защищает один процесс без хранения IP или идентификаторов. Несколько workers не делят кеш и лимит; не запускайте их для этого MVP. Это локальный backend; публичное размещение с авторизацией и общим лимитером не входит в приёмку.

PARTNER_LINKS_FILE необязателен: путь к JSON точных ссылок, созданных официальным генератором. Токен/marker в URL не добавляется. См. docs/api-integration.md и docs/api-contract.md.
