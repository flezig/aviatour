import SwiftUI

@MainActor struct ResultsView: View {
    @ObservedObject var model: SearchViewModel
    @ObservedObject var favorites: FavoritesViewModel
    let analytics: any AnalyticsService
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var showFilters = false
    @State private var visibleLimit = 60
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let query = model.performedQuery {
                    Text(summary(query)).font(.subheadline).foregroundStyle(.secondary)
                }
                if !model.filters.isEmpty {
                    HStack {
                        Label(model.filters.activeLabels.joined(separator: " · "), systemImage: "line.3.horizontal.decrease.circle.fill").font(.caption)
                        Spacer()
                        Button("Сбросить") { model.filters = ExtraFilters() }.frame(minHeight: 44)
                    }
                }
                switch model.state {
                case .loading:
                    ProgressView("Ищем варианты поездки…").frame(maxWidth: .infinity).padding(48).accessibilityIdentifier("loadingState")
                case .error(let message):
                    StatusPanel(symbol: "exclamationmark.triangle", title: "Поиск не завершён", message: message)
                    PrimaryButton(title: "Попробовать ещё раз") { model.start() }
                case .offline:
                    StatusPanel(symbol: "wifi.slash", title: "Нет связи", message: "Не удалось связаться с сервером. Проверьте подключение.")
                    PrimaryButton(title: "Повторить поиск") { model.start() }
                case .idle: EmptyView()
                case .success, .empty:
                    Text("* Оценка перелёта — цена билетов и дорога; полный рейтинг и безопасность во вкладке «Рейтинг».").font(.caption).foregroundStyle(.secondary)
                    quickFilters
                    HStack {
                        Text(OfferCount.label(model.offers.count)).font(.headline).accessibilityIdentifier("resultsCount")
                        if model.isFiltering { ProgressView().accessibilityLabel("Применяем фильтры") }
                        Spacer()
                        Button { showFilters = true } label: {
                            Label(model.filters.activeCount == 0 ? "Фильтры" : "Фильтры · \(model.filters.activeCount)", systemImage: "slider.horizontal.3")
                        }.accessibilityIdentifier("allFiltersButton")
                    }
                    Picker("По цене", selection: Binding(get: { model.sort }, set: { model.sort = $0 })) {
                        Text("Сначала дешевле").tag(OfferSort.price)
                        Text("Сначала дороже").tag(OfferSort.priceDescending)
                        if model.sort != .price && model.sort != .priceDescending { Text("Другая сортировка").tag(model.sort) }
                    }.pickerStyle(.segmented).accessibilityIdentifier("priceSort")
                    Picker("Сортировка", selection: $model.sort) {
                        ForEach(OfferSort.allCases) { Text($0.title).tag($0) }
                    }.pickerStyle(.menu).accessibilityIdentifier("sortPicker")
                    if [.rating, .fullBudget, .road, .flightRating].contains(model.sort) {
                        Text("Варианты с неизвестной оценкой идут в конце. Полный рейтинг требует всех компонентов.").font(.caption).foregroundStyle(.secondary)
                    }
                    if model.sort == .stay || model.sort == .value || model.filters.minStayHours > 0 {
                        Text("Время на месте — от расчётного прилёта до обратного вылета, включая ночи. Дорога из аэропорта и ожидание не вычтены.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if model.result.incomplete {
                        Text("Источник вернул часть вариантов; выдача может быть неполной").font(.footnote).foregroundStyle(.secondary)
                        ForEach(model.result.warnings, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
                    }
                    if model.offers.isEmpty && !model.isFiltering {
                        StatusPanel(symbol: "paperplane", title: "Пока без вариантов", message: model.emptyMessage)
                        if !model.filters.isEmpty {
                            PrimaryButton(title: "Сбросить фильтры") { model.filters = ExtraFilters() }
                        } else {
                            if (model.performedQuery ?? model.query).tripPreferences.fullBudgetMinor != nil {
                                PrimaryButton(title: "Убрать предел полного бюджета") {
                                    model.query = model.performedQuery ?? model.query
                                    model.query.tripPreferences.fullBudgetMinor = nil
                                    model.start()
                                }
                            }
                            if (model.performedQuery ?? model.query).maxBudgetMinor < 50_000_000 {
                                PrimaryButton(title: "Увеличить бюджет на 10 000 ₽") { model.retryWithBudget() }
                            }
                            if (model.performedQuery ?? model.query).directOnly {
                                PrimaryButton(title: "Разрешить пересадки") { model.retryWithTransfers() }
                            }
                            Button("Изменить даты и направление") { dismiss() }.frame(minHeight: 44)
                        }
                    } else {
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: textSize.isAccessibilitySize ? 1 : 2), spacing: 20) {
                            ForEach(Array(model.offers.prefix(visibleLimit))) { offer in
                                NavigationLink { DetailView(offer: offer, favorites: favorites, clock: model.clock, analytics: analytics, budgetMinor: model.performedQuery?.maxBudgetMinor ?? model.query.maxBudgetMinor) } label: {
                                    OfferCard(offer: offer, favorites: favorites)
                                }.buttonStyle(.plain).accessibilityIdentifier("offer.\(offer.destinationAirport).\(offer.id)")
                            }
                        }.accessibilityIdentifier("resultsGrid")
                        if visibleLimit < model.offers.count {
                            PrimaryButton(title: "Ещё варианты · \(model.offers.count - visibleLimit)") { visibleLimit += 60 }
                                .accessibilityIdentifier("moreOffersButton")
                        }
                    }
                }
                if showPrevious && !model.previousOffers.isEmpty {
                    Text("Предыдущие результаты").font(.headline)
                    if let query = model.previousQuery { Text(summary(query)).font(.caption).foregroundStyle(.secondary) }
                    Text("Сохранены на время нового запроса. Эти варианты относятся к предыдущим условиям.").font(.caption).foregroundStyle(.secondary)
                    ForEach(Array(model.previousOffers.prefix(12))) { offer in
                        NavigationLink { DetailView(offer: offer, favorites: favorites, clock: model.clock, analytics: analytics, budgetMinor: model.previousQuery?.maxBudgetMinor) } label: {
                            OfferCard(offer: offer, favorites: favorites)
                        }.buttonStyle(.plain)
                    }
                }
            }.padding(20)
        }.background(Color(.systemGroupedBackground)).navigationTitle("Варианты")
            .sheet(isPresented: $showFilters) { OfferFiltersView(model: model) }
            .onChange(of: model.filters) { _, _ in visibleLimit = 60 }
            .onChange(of: model.sort) { _, _ in visibleLimit = 60 }
            .onAppear { if model.state == .success || model.state == .empty { model.refresh() } }
    }
    private var showPrevious: Bool {
        switch model.state { case .loading, .offline, .error: return true; default: return false }
    }
    private func summary(_ query: SearchQuery) -> String {
        let origin = query.originCityCode.map { "\($0) · все аэропорты" } ?? query.origin
        let destination = query.destinationCityCode ?? query.destination ?? query.region.title
        let dates = query.usesExactDates ? "\(query.departureDate!) → \(query.returnDate!)" : TravelDates.monthLabel(query.month)
        return "\(origin) → \(destination) · \(dates) · до \(Money.format(query.maxBudgetMinor))"
    }
    private var quickFilters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip("Все", selected: model.filters.isEmpty) { model.filters = ExtraFilters() }
                chip("До 20 000 ₽", selected: model.filters.cheap) { model.filters.cheap.toggle() }
                chip("Прямые", selected: model.filters.direct) { model.filters.direct.toggle() }
                chip("Без отпуска", selected: model.filters.noLeave) { model.filters.noLeave.toggle() }
                if (model.performedQuery ?? model.query).region == .any { chip("Россия", selected: model.filters.russia) { model.filters.russia.toggle() } }
            }
        }
    }
    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(title).font(.subheadline.weight(.medium)).padding(.horizontal, 16).frame(minHeight: 44).background(selected ? Color.aviatorBlue : .white, in: Capsule()).foregroundStyle(selected ? .white : .primary) }
            .buttonStyle(.plain).accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

@MainActor struct OfferFiltersView: View {
    @ObservedObject var model: SearchViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var draft: ExtraFilters
    @State private var minPriceText: String
    @State private var maxPriceText: String
    init(model: SearchViewModel) {
        self.model = model
        _draft = State(initialValue: model.filters)
        _minPriceText = State(initialValue: model.filters.minPriceMinor == 0 ? "" : String(model.filters.minPriceMinor / 100))
        _maxPriceText = State(initialValue: String((model.filters.maxPriceMinor ?? (model.performedQuery ?? model.query).maxBudgetMinor) / 100))
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Цена за билеты туда-обратно") {
                    HStack {
                        Text("От, ₽")
                        TextField("0", text: $minPriceText)
                            .keyboardType(.numberPad).multilineTextAlignment(.trailing).accessibilityIdentifier("minPriceFilter")
                    }
                    Toggle("Ограничить максимальную цену", isOn: Binding(get: { draft.maxPriceMinor != nil }, set: { draft.maxPriceMinor = $0 ? (model.performedQuery ?? model.query).maxBudgetMinor : nil }))
                    if draft.maxPriceMinor != nil {
                        HStack {
                            Text("До, ₽")
                            TextField("Бюджет", text: $maxPriceText)
                                .keyboardType(.numberPad).multilineTextAlignment(.trailing).accessibilityIdentifier("maxPriceFilter")
                        }
                    }
                    if price(minPriceText) > (draft.maxPriceMinor != nil ? price(maxPriceText) : (model.performedQuery ?? model.query).maxBudgetMinor) {
                        Text("Минимальная цена выше максимальной").foregroundStyle(.red)
                    }
                    Text("Найденные цены ограничены исходным бюджетом. Чтобы расширить его, измените условия поиска.").font(.caption)
                }
                Section("Направление") {
                    TextField("Город, аэропорт или страна", text: $draft.destinationText).accessibilityIdentifier("destinationTextFilter")
                    Picker("Страна", selection: $draft.countryCode) {
                        Text("Все страны").tag(Optional<String>.none)
                        ForEach(model.countries) { Text($0.title).tag(Optional($0.id)) }
                    }
                    if (model.performedQuery ?? model.query).region == .any { Toggle("Только Россия", isOn: $draft.russia) }
                    Toggle("Один лучший вариант на город", isOn: $draft.uniqueDestinations)
                }
                Section("Перелёт") {
                    Picker("Пересадки на каждом плече", selection: $draft.maxTransfers) {
                        Text("Любые / неизвестно").tag(Optional<Int>.none)
                        Text("Без пересадок").tag(Optional(0))
                        Text("Не более одной").tag(Optional(1))
                        Text("Не более двух").tag(Optional(2))
                    }
                    Toggle("Только прямые туда и обратно", isOn: $draft.direct)
                    Picker("Авиакомпания по данным источника", selection: $draft.airline) {
                        Text("Любая").tag(Optional<String>.none)
                        ForEach(model.airlines) { Text($0.title).tag(Optional($0.id)) }
                    }
                    Picker("Длительность каждого плеча", selection: $draft.maxFlightMinutes) {
                        Text("Любая / неизвестно").tag(Optional<Int>.none)
                        ForEach([120, 180, 240, 360, 480, 720], id: \.self) { Text("До \($0 / 60) ч").tag(Optional($0)) }
                    }
                }
                Section("Местное время рейсов") {
                    timePicker("Вылет туда", selection: $draft.outboundTime)
                    timePicker("Вылет обратно", selection: $draft.inboundTime)
                    timePicker("Прилёт туда · расчёт", selection: $draft.arrivalTime)
                    timePicker("Прилёт домой · расчёт", selection: $draft.returnArrivalTime)
                }
                Section("Время для поездки") {
                    Stepper("От \(draft.minDays) дней", value: $draft.minDays, in: 0...60)
                    Picker("Максимальная длительность", selection: $draft.maxDays) {
                        Text("Любая").tag(Optional<Int>.none)
                        ForEach([2, 3, 4, 7, 14, 30, 60], id: \.self) { Text("До \($0) дней").tag(Optional($0)) }
                    }
                    Picker("Время в пункте назначения", selection: $draft.minStayHours) {
                        Text("Не ограничивать").tag(0)
                        ForEach([24, 36, 48, 72, 120], id: \.self) { Text("Не менее \($0) ч").tag($0) }
                    }
                    Toggle("Выезд без отпуска", isOn: $draft.noLeave)
                    Text("Пятница после 18:00 или суббота; расчётный прилёт домой в воскресенье или в понедельник до 09:00. Проверьте запас времени на дорогу.").font(.caption)
                }
                Section {
                    Text("Фильтры применяются к найденной выдаче без нового запроса. Неизвестные сведения исключаются, когда соответствующий фильтр включён. Багаж, возвратность, класс тарифа и перевозчик каждого сегмента проверяются на Aviasales.").font(.footnote).foregroundStyle(.secondary)
                    Button("Сбросить все фильтры", role: .destructive) { draft = ExtraFilters(); minPriceText = ""; maxPriceText = String((model.performedQuery ?? model.query).maxBudgetMinor / 100) }
                }
            }.navigationTitle("Фильтры")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Готово") {
                    draft.minPriceMinor = price(minPriceText)
                    if draft.maxPriceMinor != nil { draft.maxPriceMinor = price(maxPriceText) }
                    model.filters = draft; dismiss()
                } } }
        }
    }
    private func price(_ value: String) -> Int { min(500000, max(0, Int(value.filter(\.isNumber)) ?? 0)) * 100 }
    private func timePicker(_ title: String, selection: Binding<FlightTime>) -> some View {
        Picker(title, selection: selection) { ForEach(FlightTime.allCases) { Text($0.title).tag($0) } }
    }
}
