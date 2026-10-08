import SwiftUI

@MainActor struct CityContextView: View {
    let city: CityRating
    let offer: Offer
    @EnvironmentObject private var profile: TravelerProfile
    @State private var evidence: CityInsightResponse?
    @State private var loading = false
    @State private var failure: String?
    @State private var refreshID = UUID()
    @State private var loadTicket = UUID()
    private var guide: CityGuide? { CityGuide.all[city.id] }
    private var parameters: CityInsightRequest { CityInsightRequest(offer: offer, preferences: profile.preferences) }
    private var useLive: Bool { !ProcessInfo.processInfo.arguments.contains("--ui-smoke") && !offer.isDemo }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("О городе и вашей поездке").font(.title3.bold())
                Spacer()
                Button { profile.toggleCity(city.id) } label: {
                    Image(systemName: profile.savedCities.contains(city.id) ? "bookmark.fill" : "bookmark")
                }.accessibilityLabel(profile.savedCities.contains(city.id) ? "Убрать город из сохранённых" : "Сохранить город")
                    .frame(minWidth: 44, minHeight: 44).accessibilityIdentifier("city.save")
            }
            if let guide {
                Text(guide.summary)
                Text(guide.days).font(.caption).foregroundStyle(.secondary)
                if let match = guide.match(profile.preferences.interests) {
                    Text("Совпадение интересов: \(match)%").font(.headline).foregroundStyle(Color.aviatorBlue)
                    Text("Совпадение редакционных тегов, а не исчерпывающая оценка возможностей города.").font(.caption).foregroundStyle(.secondary)
                    Text("Совпали: " + profile.preferences.interests.filter { guide.tags.contains($0.rawValue) }.map(\.title).sorted().joined(separator: ", "))
                        .font(.caption).foregroundStyle(.secondary)
                } else { Text("Выберите интересы в профиле, чтобы сравнить направления под себя.").font(.caption) }
            } else { Text("Редакционное описание этого города ещё не подготовлено.").font(.caption) }
            DisclosureGroup("Почему подходит и что проверить") {
                VStack(alignment: .leading, spacing: 10) {
                    Text(offer.isDirect ? "Есть прямой перелёт в обе стороны." : "Проверьте пересадки и запас времени между рейсами.")
                    if let stay = offer.stayHours { Text("На месте примерно \(Int(stay)) ч, включая ночи. Трансферы, заселение и сон не вычтены.") }
                    if let road = offer.tripRating?.roadScore { Text("Дорога: \(road)/100 — длительность, пересадки и расписание.") }
                    Text("Аэропорты в найденных вариантах: " + Set(city.offers.map(\.destinationAirport)).sorted().joined(separator: ", ")).font(.caption)
                    Text("Трансфер из аэропорта, способы оплаты и местные транспортные тарифы: подтверждённых данных пока нет.")
                    Text("Полный бюджет включает жильё, питание и транспорт. Стоимость продуктовой корзины ниже — отдельный ориентир, не бюджет всей поездки.")
                }.font(.subheadline).padding(.top, 10)
            }
            if let guide {
                DisclosureGroup("Чем заняться и где остановиться") {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Идеи прогулок").font(.headline)
                        ForEach(guide.places, id: \.self) { Text("• " + $0) }
                        Text("Районы для изучения").font(.headline)
                        ForEach(guide.areas, id: \.self) { Text("• " + $0) }
                        Text("Редакционные идеи от \(guide.editorialUpdated). Доступность мест и транспорт уточните перед поездкой.").font(.caption).foregroundStyle(.secondary)
                        source("Официальный туристический портал", guide.tourismUrl)
                    }.padding(.top, 10)
                }
            }
            DisclosureGroup("Погода и сезон") {
                VStack(alignment: .leading, spacing: 10) {
                    if let weather = evidence?.weather, weather.status == "ok" {
                        Text(weather.kind == "forecast" ? "Прогноз на даты поездки" : "Сезонный ориентир: аналогичные даты прошлого года").font(.headline)
                        ForEach(weather.days) { day in
                            Text("\(day.date): \(day.low.formatted(.number.precision(.fractionLength(0))))…\(day.high.formatted(.number.precision(.fractionLength(0)))) °C · осадки \(day.rain.formatted()) мм").font(.caption)
                        }
                        Text(weather.note).font(.caption).foregroundStyle(.secondary)
                        source("Open-Meteo · CC BY 4.0", weather.sourceUrl)
                    } else { Text("Погодных данных нет. Сезонная история не заменяет прогноз.").font(.caption) }
                }.padding(.top, 10)
            }.accessibilityIdentifier("city.weather")
            DisclosureGroup("Средняя корзина в магазине") {
                VStack(alignment: .leading, spacing: 10) {
                    if let basket = evidence?.basket {
                        Text(basket.total.map { "Набор ≈ \($0) \(basket.currency)" } ?? "Полная сумма неизвестна: недостаточно наблюдений").font(.headline)
                        if basket.total == nil, let subtotal = basket.knownSubtotal {
                            Text("Только товары с достаточными данными: \(subtotal) \(basket.currency). Это не стоимость полной корзины.").font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(basket.items) { item in
                            VStack(alignment: .leading, spacing: 3) {
                                Text("\(item.name), \(item.quantity) \(unit(item.unit)): \(item.cost.map { $0 + " " + basket.currency } ?? "нет данных")")
                                Text("Наблюдений: \(item.observations) · магазинов: \(item.shops)").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if let from = basket.periodStart, let to = basket.periodEnd { Text("Период наблюдений: \(from) — \(to)").font(.caption) }
                        Text(basket.note).font(.caption).foregroundStyle(.secondary)
                        Text("Проверяется ограниченная выборка до 100 записей для упакованных и 100 для развесных товаров каждой категории. Ресторанное питание не включено.").font(.caption).foregroundStyle(.secondary)
                        source("Open Prices · ODbL", basket.sourceUrl)
                    } else { Text("Нет проверенных цен для корзины. Сумма не заменяется нулём.").font(.caption) }
                }.padding(.top, 10)
            }.accessibilityIdentifier("city.basket")
            DisclosureGroup("Безопасность и предупреждения") {
                VStack(alignment: .leading, spacing: 10) {
                    if let safety = evidence?.safety {
                        Text(safetyTitle(safety.status)).font(.headline).foregroundStyle(safety.alerts.isEmpty ? Color.primary : .red)
                        ForEach(safety.alerts, id: \.self) { Text(advisoryLabel($0)).font(.subheadline.bold()).foregroundStyle(.red) }
                        if let date = safety.updatedAt { Text("Источник обновлён: " + date).font(.caption) }
                        Text(safety.note).font(.caption).foregroundStyle(.secondary)
                        source("Официальные рекомендации FCDO · OGL v3", safety.sourceUrl)
                    } else { Text("Нет проверенных предупреждений. Это не означает отсутствие рисков.").font(.caption) }
                    Text("Сопоставимых данных о кражах и насильственных преступлениях в городе пока нет. Численный балл безопасности не вычисляется.").font(.caption).foregroundStyle(.secondary)
                }.padding(.top, 10)
            }.accessibilityIdentifier("city.safety")
            DisclosureGroup("Виза и въезд по вашему паспорту") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Гражданство: " + country(profile.preferences.citizenship)).font(.headline)
                    Text("Проживание: " + country(profile.preferences.residence)).font(.caption)
                    Text(evidence?.entry.note ?? "Персональные визовые требования не подтверждены. Проверьте паспорт, транзит и правила консульства.")
                    if let link = evidence?.entry.checkUrl { source("Проверить требования у Sherpa по выбранному паспорту", link) }
                    if let guide { source("Туристический портал страны / города", guide.tourismUrl) }
                    Text("Это ссылка для дальнейшей проверки, не подтверждение безвизового въезда. Для автоматической проверки нужен подключённый визовый поставщик.").font(.caption).foregroundStyle(.secondary)
                }.padding(.top, 10)
            }.accessibilityIdentifier("city.visa")
            DisclosureGroup("HDI — развитие страны") {
                VStack(alignment: .leading, spacing: 10) {
                    if let hdi = evidence?.hdi {
                        Text("\(hdi.value.formatted(.number.precision(.fractionLength(3)))) · данные за \(String(hdi.year)) год").font(.title3.bold())
                        Text(hdi.note).font(.caption)
                        Text("UNDP \(hdi.publication) · снимок \(hdi.retrieved)").font(.caption).foregroundStyle(.secondary)
                        source("UNDP · официальный набор данных", hdi.sourceUrl)
                    } else if let value = guide?.hdiValue, let year = guide?.hdiYear {
                        Text("\(value.formatted(.number.precision(.fractionLength(3)))) · данные за \(String(year)) год").font(.title3.bold())
                        Text("UNDP HDR 2025 · локальный снимок от 08.10.2026").font(.caption).foregroundStyle(.secondary)
                        source("UNDP · официальный набор данных", "https://hdr.undp.org/data-center/documentation-and-downloads")
                    } else { Text("Нет данных HDI для выбранной страны.").font(.caption) }
                    Text("Показывается как контекст; не подменяет безопасность и не повышает балл отдыха автоматически.").font(.caption).foregroundStyle(.secondary)
                }.padding(.top, 10)
            }.accessibilityIdentifier("city.hdi")
            if loading { ProgressView("Загружаем показатели города…") }
            if let failure { Text(failure).font(.caption).foregroundStyle(.secondary) }
            if !useLive { Text("DEMO: описания редакционные; живые цены, погода и предупреждения не загружаются.").font(.caption).foregroundStyle(.secondary) }
            else { Button("Повторить загрузку показателей") { refreshID = UUID() }.disabled(loading) }
        }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 20))
            .task(id: parameters) { await load() }.task(id: refreshID) { if evidence != nil || failure != nil { await load() } }
    }
    private func load() async {
        guard useLive else { return }
        let ticket = UUID(); loadTicket = ticket
        let captured = parameters
        loading = true; failure = nil; evidence = nil
        defer { if loadTicket == ticket { loading = false } }
        do {
            let service = CityInsightService(baseURL: URL(string: Bundle.main.object(forInfoDictionaryKey: "AVIATOR_BASE_URL") as? String ?? ""))
            let response = try await service.load(captured)
            try Task.checkCancellation(); guard loadTicket == ticket else { return }; evidence = response
        } catch is CancellationError { return }
        catch { if !Task.isCancelled && loadTicket == ticket { failure = "Не удалось получить показатели. Перелёты и редакционное описание доступны; попробуйте ещё раз." } }
    }
    private func source(_ label: String, _ address: String) -> some View {
        Group { if let url = URL(string: address), url.scheme == "https" { Link(label, destination: url).font(.caption).frame(minHeight: 44) } }
    }
    private func unit(_ value: String) -> String { value == "unit" ? "шт" : value == "l" ? "л" : "кг" }
    private func country(_ code: String?) -> String { code.flatMap { Locale(identifier: "ru_RU").localizedString(forRegionCode: $0) } ?? "не указано" }
    private func safetyTitle(_ value: String) -> String {
        switch value { case "warning": return "У источника есть предупреждения"; case "published": return "Рекомендации опубликованы — изучите перед поездкой"; case "review": return "Требуется проверка предупреждения в источнике"; default: return "Источник временно недоступен" }
    }
    private func advisoryLabel(_ value: String) -> String {
        switch value {
        case "avoid_all_travel", "avoid_all_travel_to_whole_country": return "FCDO рекомендует отказаться от всех поездок"
        case "avoid_all_travel_to_parts": return "FCDO рекомендует отказаться от поездок в отдельные районы"
        case "avoid_all_but_essential_travel", "avoid_all_but_essential_travel_to_whole_country": return "FCDO рекомендует только необходимые поездки"
        case "avoid_all_but_essential_travel_to_parts": return "FCDO рекомендует только необходимые поездки в отдельные районы"
        default: return "Проверьте предупреждение в первоисточнике"
        }
    }
}
