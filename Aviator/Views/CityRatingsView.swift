import SwiftUI

@MainActor struct CityRatingsView: View {
    @EnvironmentObject private var profile: TravelerProfile
    @State private var savedOnly = false
    @State private var withinBudget = false
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
    private var parameters: SearchQuery { CityRatingsModel.parameters(request?.offer?.exactQuery() ?? search.query) }
    private var cities: [CityRating] { CityRanking.visible(model.cities.filter { (!savedOnly || profile.savedCities.contains($0.id)) && (!withinBudget || $0.minPriceMinor <= search.query.maxBudgetMinor) }, kind: kind, filters: filters, sort: sort, preferences: profile.preferences) }
    private var countries: [CityRating] {
        var seen = Set<String>()
        return model.cities.filter { guard let code = $0.countryCode else { return false }; return seen.insert(code).inserted }.sorted { ($0.country ?? "") < ($1.country ?? "") }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Ваш следующий город").font(.system(.title2, design: .rounded, weight: .bold))
                        Text("Сравните направления и выберите поездку под себя.").font(.subheadline).foregroundStyle(.secondary)
                    }.padding(.vertical, 8)
                    Button { request = nil; showConditions() } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "airplane.departure").font(.title2).foregroundStyle(Color.aviatorBlue)
                            VStack(alignment: .leading, spacing: 5) {
                                Text("ВАША ПОЕЗДКА").font(.caption2.bold()).tracking(1).foregroundStyle(.secondary)
                                Text(conditions).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "slider.horizontal.3").foregroundStyle(Color.aviatorBlue)
                        }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                            .background(.white, in: RoundedRectangle(cornerRadius: 22))
                    }.buttonStyle(.plain).accessibilityIdentifier("ratings.conditions")
                    TextField("Найти город или код аэропорта", text: $filters.text).padding(14).background(.white, in: RoundedRectangle(cornerRadius: 16)).autocorrectionDisabled().accessibilityIdentifier("ratings.search")
                    Picker("Модель рейтинга", selection: $kind) { ForEach(CityScoreKind.allCases) { Text($0.title).tag($0) } }.pickerStyle(.segmented).accessibilityIdentifier("ratings.kind")
                    DisclosureGroup("Как считается балл") {
                        Text(kind == .flight ? "Предварительный балл: цена билетов 65%, удобство дороги 35%. Без безопасности и стоимости отдыха." : "Полная поездка: бюджет 45%, дорога 25%, безопасность 20%, условия 10%. Если данных не хватает, балла нет.").font(.caption).foregroundStyle(.secondary).padding(.top, 8)
                        Text("Все поездки выбранного месяца или точных дат; фильтр коротких выходных здесь не применяется.").font(.caption).foregroundStyle(.secondary)
                    }.font(.subheadline).tint(Color.aviatorBlue)
                    Text("Для вас: " + profile.preferences.style.title + " · интересов выбрано: \(profile.preferences.interests.count)").font(.caption).foregroundStyle(.secondary)
                    if sort == .personal {
                        let weights = profile.preferences.style.weights
                        Text("В списке — балл подбора по предпочтениям. Цена \(weights.price)%, дорога \(weights.road)%, интересы \(weights.interests)%. Без стоимости отдыха, визы и безопасности; недостающие показатели не заменяются нулём.").font(.caption).foregroundStyle(.secondary)
                    }
                    DisclosureGroup("Фильтры направлений") {
                        VStack(alignment: .leading, spacing: 10) {
                            Picker("Страна", selection: $filters.countryCode) {
                                Text("Все страны").tag(Optional<String>.none)
                                ForEach(countries) { Text($0.country ?? $0.countryCode ?? "").tag($0.countryCode) }
                            }
                            Toggle("Есть билеты в пределах моего бюджета", isOn: $withinBudget)
                            Toggle("Только сохранённые города", isOn: $savedOnly)
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
                            Button("Сбросить фильтры") { filters = CityRankingFilters(); savedOnly = false; withinBudget = false }
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
        return "Вылет: \(origin) · \(q.originCityCode == nil ? q.origin : "все аэропорты") · \(dates) · билеты до " + Money.format(search.query.maxBudgetMinor)
    }
    private func openRequestedCity() {
        guard let request, request.id != openedRequest else { return }
        openedRequest = request.id
        if let offer = request.offer { selectedCity = CityRanking.build([offer], now: search.clock.now).first }
        else if let code = request.cityCode { filters.text = code; selectedCity = model.cities.first { $0.id == code } }
    }
    private func cityRow(_ city: CityRating, position: Int) -> some View {
        let score = sort == .personal ? city.personalScore(profile.preferences) : city.score(kind)
        return VStack(alignment: .leading, spacing: 0) {
            DestinationPhoto(name: city.id)
                .frame(height: 172)
                .overlay(LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom))
                .overlay(alignment: .topLeading) {
                    Text(String(format: "%02d", position)).font(.caption.bold()).monospacedDigit()
                        .padding(10).background(.ultraThinMaterial, in: Capsule()).padding(16)
                }
                .overlay(alignment: .topTrailing) {
                    if profile.savedCities.contains(city.id) {
                        Image(systemName: "bookmark.fill").foregroundStyle(.white).padding(10).background(.black.opacity(0.25), in: Circle()).padding(16)
                    }
                }
                .overlay(alignment: .bottomLeading) {
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(city.country ?? "Страна неизвестна").font(.caption.weight(.medium)).foregroundStyle(.white.opacity(0.8))
                            Text(city.city).font(.system(.title, design: .rounded, weight: .bold)).foregroundStyle(.white)
                        }
                        Spacer()
                        VStack(spacing: 2) {
                            Text(score.map(String.init) ?? "—").font(.title2.bold()).monospacedDigit()
                            Text(score == nil ? "нет балла" : "из 100").font(.caption2)
                        }.foregroundStyle(.white).padding(12).background(.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 16))
                    }.padding(18)
                }
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("СРЕДНИЙ ПЕРЕЛЁТ").font(.caption2.bold()).tracking(0.8).foregroundStyle(.secondary)
                        Text("≈ " + city.averagePriceLabel).font(.system(.title2, design: .rounded, weight: .bold))
                    }
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.headline).foregroundStyle(Color.aviatorBlue)
                        .padding(12).background(Color.aviatorBlue.opacity(0.08), in: Circle())
                }
                Text("Туда-обратно · на человека · " + OfferCount.label(city.offers.count)).font(.caption).foregroundStyle(.secondary)
                Divider()
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { cityMetrics(city) }
                    VStack(alignment: .leading, spacing: 8) { cityMetrics(city) }
                }
                if city.hasWarning { Label(city.avoid ? "Поездка не рекомендована" : "Есть предупреждение", systemImage: "exclamationmark.triangle.fill").font(.caption.bold()).foregroundStyle(.red) }
                Text(city.isDemo ? "DEMO · условные цены; балл не рассчитан" : score == nil ? "Недостаточно данных для выбранной модели" : sort == .personal ? "Подбор по предпочтениям · без визы, безопасности и полного бюджета" : "Балл лучшей найденной поездки").font(.caption2).foregroundStyle(.secondary)
            }.padding(18)
        }.background(.white, in: RoundedRectangle(cornerRadius: 24)).clipShape(RoundedRectangle(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).strokeBorder(Color.primary.opacity(0.04)))
    }
    @ViewBuilder private func cityMetrics(_ city: CityRating) -> some View {
        Label(city.roadScore.map { "Дорога \($0)" } ?? "Дорога —", systemImage: "airplane").font(.caption).foregroundStyle(.secondary)
        if let guide = CityGuide.all[city.id] {
            if let match = guide.match(profile.preferences.interests) {
                Label("Интересы \(match)%", systemImage: "sparkles").font(.caption).foregroundStyle(Color.aviatorBlue)
            }
            if let hdi = guide.hdiValue {
                Text("HDI " + hdi.formatted(.number.precision(.fractionLength(3)))).font(.caption).foregroundStyle(.secondary)
            }
        }

    }
}

@MainActor private struct CityRatingDetailView: View {
    @EnvironmentObject private var profile: TravelerProfile
    let city: CityRating
    let kind: CityScoreKind
    @ObservedObject var favorites: FavoritesViewModel
    let clock: any AppClock
    let analytics: any AnalyticsService
    var body: some View {
        let offer = city.best(kind)
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                DestinationPhoto(name: city.id).frame(height: 210)
                    .overlay(LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .center, endPoint: .bottom))
                    .overlay(alignment: .bottomLeading) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(city.country ?? "").font(.subheadline)
                            Text(city.city).font(.system(.largeTitle, design: .rounded, weight: .bold))
                        }.foregroundStyle(.white).padding(20)
                    }.clipShape(RoundedRectangle(cornerRadius: 26))
                Text("Вылет: \(offer.originCity)").font(.headline)
                Text("Средний перелёт ≈ " + city.averagePriceLabel + " / человек").font(.subheadline.bold())
                if city.hasWarning { Label(city.avoid ? "Есть серьёзное предупреждение: поездка не рекомендована" : "Есть действующее предупреждение", systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red) }
                if let personal = city.personalScore(profile.preferences) {
                    Text("Подбор под ваши предпочтения: \(personal)/100 · " + profile.preferences.style.title).font(.headline)
                    Text("Лучшая найденная поездка по цене, дороге и интересам. Без безопасности, визы и полного бюджета.").font(.caption).foregroundStyle(.secondary)
                }
                RatingDashboard(offer: offer, kind: kind, score: city.score(kind))
                VStack(alignment: .leading, spacing: 10) {
                    Text("Стоимость перелёта").font(.headline)
                    Text("Средняя цена туда-обратно ≈ " + city.averagePriceLabel).font(.title3.bold()).foregroundStyle(Color.aviatorBlue)
                    Text("Медиана: " + Money.format(city.medianPriceMinor)).font(.subheadline)
                    Text("\(OfferCount.label(city.offers.count)) в выборке · от " + Money.format(city.minPriceMinor) + " до " + Money.format(city.maxPriceMinor)).font(.caption)
                    Text("Среднее по найденным кешированным ценам, не гарантированная цена к покупке. Рейтинг и расходы относятся к лучшей найденной поездке, а не к среднему бюджету города.").font(.footnote).foregroundStyle(.secondary)
                }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 20))
                CityContextView(city: city, offer: offer)
                DisclosureGroup("Расходы, источники и методика") {
                    TripRatingView(offer: offer, detailed: true).padding(.top, 14)
                }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 20)).accessibilityIdentifier("ratings.sources")
                DisclosureGroup("Найденные поездки в этот город") {
                    ForEach(Array(city.offers.sorted { $0.priceMinor < $1.priceMinor }.prefix(5))) { variant in
                        VStack(alignment: .leading, spacing: 8) {
                            NavigationLink { DetailView(offer: variant, favorites: favorites, clock: clock, analytics: analytics) } label: {
                                Text(Money.format(variant.priceMinor) + " · " + TravelDates.display(variant.departureAt, zone: variant.originTimezone) + " → " + TravelDates.display(variant.returnAt, zone: variant.destinationTimezone))
                            }.frame(minHeight: 44)
                            CompareButton(offer: variant)
                        }
                    }
                    if city.offers.count > 5 { Text("Показаны пять самых дешёвых найденных вариантов").font(.caption) }
                }.padding(18).background(.white, in: RoundedRectangle(cornerRadius: 20))
                NavigationLink("Посмотреть выбранную поездку") { DetailView(offer: offer, favorites: favorites, clock: clock, analytics: analytics) }.frame(minHeight: 44)
            }.padding(20)
        }.background(Color(.systemGroupedBackground)).navigationTitle(city.city).navigationBarTitleDisplayMode(.inline).accessibilityIdentifier("ratings.detail")
    }
}
