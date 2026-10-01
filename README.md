# Aviator

«Больше мира за меньшие деньги». Русское приложение для iPhone: аэропорт → месяц и бюджет → варианты поездок на выходные → детали → избранное → поиск на Aviasales. SwiftUI / MVVM / SwiftData, iOS 17+. Backend: Python 3.12+, FastAPI, httpx, Pydantic.

## Запуск MOCK

Нужен полный Xcode 15+ с iOS 17+ SDK и установленным iPhone Simulator. Откройте **Aviator.xcodeproj**, выберите общую схему **Aviator** и iPhone Simulator, нажмите Run. Подпись для Simulator не требуется. Для MOCK установите `AVIATOR_MODE = MOCK` в Debug.xcconfig. Debug сейчас настроен на LIVE по запросу пользователя; Release использует MOCK; backend, токен и сеть не нужны, кроме перехода на Aviasales.

Десять демонстрационных направлений из SVO. Бюджет по умолчанию 25 000 ₽ даёт семь направлений, быстрый фильтр 20 000 ₽ — пять при наличии будущих выходных в месяце. Условные цены и пересадки явно обозначены DEMO. Даты строятся относительно выбранного месяца. Другие аэропорты можно выбрать, но MOCK честно сообщает, что демонстрационных данных для них нет.

## Backend и LIVE

Инструкция: [backend/README.md](backend/README.md). Из корня:

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
cd backend
../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Добавьте настоящий токен только в `backend/.env`, поле `TRAVELPAYOUTS_API_TOKEN`. В `Aviator/Config/Debug.xcconfig` установите `AVIATOR_MODE = LIVE`; `AVIATOR_BASE_URL` по умолчанию — `http://127.0.0.1:8000` (в xcconfig двоеточие/слеш записаны с `$()` для защиты от синтаксиса комментария). Simulator обращается к серверу на Mac. Пересоберите приложение. При отсутствии токена backend работает, LIVE показывает ошибку конфигурации и не подмешивает MOCK.

Release принимает только HTTPS. Info-Release.plist не содержит исключений ATS. Для устройства потребуется достижимый HTTPS backend; публичный deployment не входит в MVP.

## Проверки

```sh
cd backend
../.venv/bin/python -m pytest -q
```

После установки Xcode выберите его активным (например, `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`), установите iOS runtime в Settings → Platforms и получите UUID Simulator:

```sh
xcrun simctl list devices available
xcodebuild -project Aviator.xcodeproj -scheme Aviator -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,id=SIMULATOR_UUID' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project Aviator.xcodeproj -scheme Aviator -destination 'platform=iOS Simulator,id=SIMULATOR_UUID' CODE_SIGNING_ALLOWED=NO test
```

Для проверок бизнес-логики на macOS 14+ из корня есть `swift run AviatorChecks` (57 проверок, не заменяет сборку и UI-проверку iPhone). `swift test` использует XCTest и также требует полный Xcode; тест сохранения SwiftData включён только в iOS target. Smoke tests используют `--ui-smoke` с фиксированным временем 01.10.2026 и временным хранилищем. Второй smoke test запрашивает увеличенный Dynamic Type. Вручную проверьте VoiceOver, размеры текста, переход и внешний поиск. Устойчивые accessibility identifiers присутствуют для поиска, карточек, избранного и перехода.

Фактический статус проверки обновляется в `docs/handoffs/aviator-mvp.md`. Simulator и iOS SDK на исходной машине не установлены; успешная iOS-сборка не заявляется. Реальный LIVE-запрос и партнёрская атрибуция без токена не проверены.

## Ограничения данных

Бюджет включает только билеты туда-обратно для одного взрослого в RUB. Денежный контракт — целые копейки (`price_minor`, `max_budget_minor`). Граница включительна. Возврат может попасть в следующий месяц/год. День отправления каждого плеча определяется локальной зоной соответствующего аэропорта; неизвестные пересадки не считаются прямым рейсом. Избранное хранит исходный снимок с отметкой MOCK/LIVE, не обновляет цены автоматически и блокирует переход для прошедших поездок.

Data API возвращает кешированные находки, не полный инвентарь и не подтверждение доступности. Ограничения 10 страниц/20 секунд или некорректные записи помечают выборку как неполную. Цена, багаж и класс тарифа должны быть проверены у партнёра. Endpoint не предоставляет документированной гарантии эконом-класса, поэтому LIVE предупреждает об этом. Обычная ссылка открывает эконом для одного взрослого; год отсутствует в документированном URL-формате и требует проверки у партнёра при переходе через год.

Партнёрские ссылки поддерживаются как заранее созданные в официальном кабинете точные ссылки через `PARTNER_LINKS_FILE`. Один MARKER ничего не активирует. Динамическое создание партнёрских ссылок и атрибуция не подтверждены. Подробности и источники: [интеграция](docs/api-integration.md), [контракт](docs/api-contract.md).

Фотографии и лицензии: [credits](Aviator/Resources/credits.md), доступны внутри приложения. Справочник аэропортов — локальный официальный снимок Travelpayouts от 01.10.2026; для будущих изменений требуется обновление. Локальный backend использует один процесс: кеш и лимитер не общие между workers.

## Совместная работа

Репозиторий `flezig/aviatour` не переименован. Общая память — GitHub Issues и Project; правила [AGENTS.md](AGENTS.md), [docs/collaboration.md](docs/collaboration.md). Без авторизации GitHub временный отчёт хранится в `docs/handoffs/`, затем переносится в issue. Существующие документы других участников не изменяются.
