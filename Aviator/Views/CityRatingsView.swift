import SwiftUI

@MainActor struct CityRatingsView: View {
    @ObservedObject var search: SearchViewModel
    @ObservedObject var favorites: FavoritesViewModel
    let index: AirportIndex
    let analytics: any AnalyticsService
    @Binding var request: CityRatingRequest?
    let showConditions: () -> Void
    @StateObject private var model: CityRatingsModel
    @State private var kind: CityScoreKind = .flight
    @State private var sort: CityRankingSort = .score
    @State private var filters = CityRankingFilters()
    @State private var selectedCity: CityRating?
    @State private var openedRequest: UUID?
    init(search: SearchViewModel, favorites: FavoritesViewModel, index: AirportIndex, analytics: any AnalyticsService, request: Binding<CityRatingRequest?>, showConditions: @escaping () -> Void) {
        self.search = search; self.favorites = favorites; self.index = index; self.analytics = analytics
        _request = request; self.showConditions = showConditions
        _model = StateObject(wrappedValue: CityRatingsModel(service: search.service, clock: search.clock))
    }
    private var parameters: SearchQuery { CityRatingsModel.parameters(request?.offer.exactQuery() ?? search.query) }
    private var cities: [CityRating] { CityRanking.visible(model.cities, kind: kind, filters: filters, sort: sort) }
    private var countries: [CityRating] {
        var seen = Set<String>()
        return model.cities.filter { guard let code = $0.countryCode else { return false }; return seen.insert(code).inserted }.sorted { ($0.country ?? "") < ($1.country ?? "") }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Куда поехать из вашего города").font(.title2.bold())
                    Text("Рейтинг направлений по найденным поездкам. Балл зависит от города вылета и условий поездки.").font(.subheadline).foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(conditions).font(.headline)
                        Button("Изменить город вылета и даты") { request = nil; showConditions() }.frame(minHeight: 44).accessibilityIdentifier("ratings.conditions")
                    }.padding(16).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 18))
                    Text("Все поездки выбранного месяца или точных дат; фильтр коротких выходных из поиска здесь не применяется.").font(.caption).foregroundStyle(.secondary)
                    TextField("Найти город или код аэропорта", text: $filters.text).textFieldStyle(.roundedBorder).autocorrectionDisabled().accessibilityIdentifier("ratings.search")
                    Picker("Модель рейтинга", selection: $kind) { ForEach(CityScoreKind.allCases) { Text($0.title).tag($0) } }.pickerStyle(.segmented).accessibilityIdentifier("ratings.kind")
                    Text(kind == .flight ? "Предварительный балл: только цена билетов и удобство дороги. Без безопасности и стоимости отдыха." : "Полная поездка: бюджет 45%, дорога 25%, безопасность 20%, условия 10%. Если данных не хватает, балла нет.").font(.caption).foregroundStyle(.secondary)
                    DisclosureGroup("Фильтры направлений") {
                        VStack(alignment: .leading, spacing: 10) {
                            Picker("Страна", selection: $filters.countryCode) {
                                Text("Все страны").tag(Optional<String>.none)
                                ForEach(countries) { Text($0.country ?? $0.countryCode ?? "").tag($0.countryCode) }
                            }
                            Toggle("Есть прямой рейс туда и обратно", isOn: $filters.hasDirect)
                            Toggle("Есть данные о безопасности", isOn: $filters.knownSafety)
                            Picker("Средняя цена билетов", selection: $filters.maxAverageMinor) {
                                Text("Любая").tag(Optional<Int>.none)
                                ForEach([20000, 30000, 50000, 100000, 200000], id: \.self) { Text("До \($0.formatted()) ₽").tag(Optional($0 * 100)) }
                            }
                            Picker("Минимальный балл", selection: $filters.minScore) {
                                Text("Любой / неизвестно").tag(Optional<Int>.none)
                                ForEach([50, 70, 85], id: \.self) { Text("От \($0)").tag(Optional($0)) }
                            }
                            Button("Сбросить фильтры") { filters = CityRankingFilters() }
                        }.padding(.top, 8)
                    }.accessibilityIdentifier("ratings.filters")
                    Picker("Порядок", selection: $sort) { ForEach(CityRankingSort.allCases) { Text($0.title).tag($0) } }.accessibilityIdentifier("ratings.sort")
                    if model.loading { ProgressView("Собираем рейтинг направлений…").frame(maxWidth: .infinity).padding(24) }
                    else if let error = model.error {
                        StatusPanel(symbol: "wifi.exclamationmark", title: "Рейтинг не загружен", message: error)
                        PrimaryButton(title: "Повторить") { Task { await model.load(parameters, force: true) } }
                    } else {
                        Text("Направлений: \(cities.count)").font(.headline).accessibilityIdentifier("ratings.count")
                        if cities.isEmpty { Text(model.cities.isEmpty ? "Для выбранных условий нет найденных перелётов. Измените город вылета или даты." : "Нет городов под выбранные фильтры. Попробуйте другой запрос или сбросьте фильтры.").foregroundStyle(.secondary) }
                        LazyVStack(spacing: 14) {
                            ForEach(Array(cities.enumerated()), id: \.element.id) { position, city in
                                Button { selectedCity = city } label: { cityRow(city, position: position + 1) }.buttonStyle(.plain).accessibilityIdentifier("ratings.city.\(city.id)")
                            }
                        }
                    }
                    if model.incomplete { Label("Рейтинг по неполной выборке источника", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
                    ForEach(Array(model.warnings.enumerated()), id: \.offset) { _, warning in Text(warning).font(.caption).foregroundStyle(.secondary) }
                    Text("Средняя цена — по уникальным найденным предложениям туда-обратно на взрослого, до 500 000 ₽. Это выборка кешированных находок, а не рыночная средняя или подтверждение покупки. При поиске месяца даты и длительность поездок различаются.").font(.footnote).foregroundStyle(.secondary)
                    Button("Обновить рейтинг") { Task { await model.load(parameters, force: true) } }.disabled(model.loading).frame(minHeight: 44)
                }.padding(20)
            }.background(Color(.systemGroupedBackground)).navigationTitle("Рейтинг городов").navigationBarTitleDisplayMode(.inline)
                .navigationDestination(item: $selectedCity) { selected in
                    CityRatingDetailView(city: model.cities.first(where: { $0.id == selected.id }) ?? selected, kind: kind, favorites: favorites, clock: search.clock, analytics: analytics)
                }
                .task(id: parameters) { openRequestedCity(); await model.load(parameters) }
                .onChange(of: request?.id) { _, _ in openRequestedCity() }
                .onChange(of: search.query) { _, _ in request = nil; selectedCity = nil }
        }
    }
    private var conditions: String {
        let q = parameters
        let origin = index.byIATA[q.origin]?.city ?? q.origin
        let dates = q.usesExactDates ? "\(q.departureDate ?? "") → \(q.returnDate ?? "")" : TravelDates.monthLabel(q.month)
        return "Вылет: \(origin) · \(q.originCityCode == nil ? q.origin : "все аэропорты") · \(dates)"
    }
    private func openRequestedCity() {
        guard let request, request.id != openedRequest else { return }
        openedRequest = request.id
        selectedCity = CityRanking.build([request.offer], now: search.clock.now).first
    }
    private func cityRow(_ city: CityRating, position: Int) -> some View {
        let offer = city.best(kind)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Text("\(position)").font(.title3.bold()).foregroundStyle(.secondary).frame(width: 28)
                VStack(alignment: .leading, spacing: 4) { Text(city.city).font(.title3.bold()); Text(city.country ?? "Страна неизвестна").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Text(city.score(kind).map { "\($0)/100" } ?? "—").font(.title2.bold()).foregroundStyle(city.avoid ? Color.red : Color.aviatorBlue)
            }
            Text("Средний перелёт ≈ " + city.averagePriceLabel + " / человек").font(.subheadline.bold())
            Text("\(OfferCount.label(city.offers.count)) · от " + Money.format(city.minPriceMinor) + " до " + Money.format(city.maxPriceMinor)).font(.caption).foregroundStyle(.secondary)
            HStack { Text("Дорога: \(city.roadScore.map { "\($0)/100" } ?? "нет данных")"); Spacer(); Text("Безопасность: \(offer.tripRating?.safetyScore.map { "\($0)/100" } ?? "нет данных")") }.font(.caption)
            if city.hasWarning { Label(city.avoid ? "Поездка не рекомендована" : "Есть предупреждение", systemImage: "exclamationmark.triangle.fill").font(.caption.bold()).foregroundStyle(.red) }
            Text(city.isDemo ? "DEMO · условные цены; балл не рассчитан" : city.score(kind) == nil ? "Недостаточно данных для выбранной модели" : "Балл лучшей найденной поездки · остальные компоненты в деталях").font(.caption2).foregroundStyle(.secondary)
            HStack { Text("Обновлено " + TravelDates.display(city.updatedAt, zone: TimeZone.current.identifier, time: true)); Spacer(); Image(systemName: "chevron.right") }.font(.caption2).foregroundStyle(.secondary)
        }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 20))
    }
}

@MainActor private struct CityRatingDetailView: View {
    let city: CityRating
    let kind: CityScoreKind
    @ObservedObject var favorites: FavoritesViewModel
    let clock: any AppClock
    let analytics: any AnalyticsService
    var body: some View {
        let offer = city.best(kind)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                DestinationPhoto(name: city.id).frame(height: 120).clipShape(RoundedRectangle(cornerRadius: 20))
                Text("Вылет: \(offer.originCity)").font(.headline)
                Text("Средний перелёт ≈ " + city.averagePriceLabel + " / человек").font(.subheadline.bold())
                if city.hasWarning { Label(city.avoid ? "Есть серьёзное предупреждение: поездка не рекомендована" : "Есть действующее предупреждение", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                RatingDashboard(offer: offer, kind: kind, score: city.score(kind))
                VStack(alignment: .leading, spacing: 10) {
                    Text("Стоимость перелёта").font(.headline)
                    Text("Средняя цена туда-обратно ≈ " + city.averagePriceLabel).font(.title3.bold()).foregroundStyle(Color.aviatorBlue)
                    Text("\(OfferCount.label(city.offers.count)) в выборке · от " + Money.format(city.minPriceMinor) + " до " + Money.format(city.maxPriceMinor)).font(.caption)
                    Text("Среднее по найденным кешированным ценам, не гарантированная цена к покупке. Рейтинг и расходы относятся к лучшей найденной поездке, а не к среднему бюджету города.").font(.footnote).foregroundStyle(.secondary)
                }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 20))
                DisclosureGroup("Расходы, источники и методика") {
                    TripRatingView(offer: offer, detailed: true).padding(.top, 14)
                }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 20)).accessibilityIdentifier("ratings.sources")
                NavigationLink("Посмотреть выбранную поездку") { DetailView(offer: offer, favorites: favorites, clock: clock, analytics: analytics) }.frame(minHeight: 44)
            }.padding(20)
        }.background(Color(.systemGroupedBackground)).navigationTitle(city.city).navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("ratings.detail")
    }
}
