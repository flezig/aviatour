import SwiftUI

@MainActor struct CollectionsView: View {
    @ObservedObject var search: SearchViewModel
    @ObservedObject var favorites: FavoritesViewModel
    let airports: [Airport]
    let index: AirportIndex
    let mode: String
    let analytics: any AnalyticsService
    @StateObject private var model: SearchViewModel
    @State private var selected: TripCollection?
    @State private var showConditions = false
    @Environment(\.dynamicTypeSize) private var textSize
    init(search: SearchViewModel, favorites: FavoritesViewModel, airports: [Airport], index: AirportIndex, mode: String, analytics: any AnalyticsService) {
        self.search = search; self.favorites = favorites; self.airports = airports; self.index = index; self.mode = mode; self.analytics = analytics
        _model = StateObject(wrappedValue: SearchViewModel(service: search.service, clock: search.clock, analytics: analytics))
    }
    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    Text("Идея для следующей поездки").font(.largeTitle.bold())
                    Text("Выберите, что важнее: бюджет, время на месте или короткая дорога.").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 10) {
                        Text(conditions).font(.subheadline)
                        Text("До \(Money.format(search.query.maxBudgetMinor)) · только билеты туда-обратно на одного").font(.caption).foregroundStyle(.secondary)
                        Button("Изменить условия") { showConditions = true }.frame(minHeight: 44).accessibilityIdentifier("collection.conditions")
                    }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 20))
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: textSize.isAccessibilitySize ? 1 : 2), spacing: 12) {
                        ForEach(TripCollection.allCases) { collection in
                            Button { run(collection) } label: {
                                VStack(alignment: .leading, spacing: 10) {
                                    Image(systemName: collection.symbol).font(.title2).foregroundStyle(Color.aviatorBlue)
                                    Text(collection.title).font(.headline)
                                    Text(collection.subtitle).font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, minHeight: 145, alignment: .topLeading).padding(16)
                                    .background(selected == collection ? Color.aviatorBlue.opacity(0.1) : .white, in: RoundedRectangle(cornerRadius: 20))
                            }.buttonStyle(.plain).accessibilityIdentifier("collection.\(collection.id)")
                                .accessibilityAddTraits(selected == collection ? [.isSelected] : [])
                        }
                    }
                    if let selected {
                        VStack(alignment: .leading, spacing: 16) {
                            Text(selected.title).font(.title2.bold())
                            if let query = model.performedQuery {
                                Text("До \(Money.format(query.maxBudgetMinor)) · \(query.destinationCityCode ?? query.destination ?? query.region.title)").font(.caption).foregroundStyle(.secondary)
                            }
                            switch model.state {
                            case .loading: ProgressView("Собираем подборку…").frame(maxWidth: .infinity).padding(30)
                            case .offline: StatusPanel(symbol: "wifi.slash", title: "Нет связи", message: "Не удалось связаться с сервером.")
                            case .error(let message): StatusPanel(symbol: "exclamationmark.triangle", title: "Подборка не загружена", message: message)
                            case .success, .empty:
                                if model.isFiltering { ProgressView("Подбираем поездки…") }
                                if model.offers.isEmpty && !model.isFiltering {
                                    Text("В найденных данных нет поездок под эти условия. Измените даты, бюджет или направление; это не означает, что билетов нет.").foregroundStyle(.secondary)
                                }
                                ForEach(Array(model.offers.prefix(12))) { offer in
                                    VStack(alignment: .leading, spacing: 10) {
                                        Text(selected.reason(for: offer)).font(.subheadline.bold()).foregroundStyle(Color.aviatorBlue)
                                        NavigationLink { DetailView(offer: offer, favorites: favorites, clock: search.clock, analytics: analytics, budgetMinor: model.performedQuery?.maxBudgetMinor ?? search.query.maxBudgetMinor) } label: {
                                            OfferCard(offer: offer, favorites: favorites)
                                        }.buttonStyle(.plain).accessibilityIdentifier("collection.offer.\(offer.destinationAirport).\(offer.id)")
                                    }
                                }
                                if model.offers.count > 12 { Text("Показаны первые 12 направлений подборки").font(.caption).foregroundStyle(.secondary) }
                                if model.result.incomplete { Text("Подборка по части данных источника").font(.caption).foregroundStyle(.secondary) }
                                if selected == .noLeave { Text("Под обычный график пн–пт: проверьте личное расписание и запас на дорогу домой.").font(.caption).foregroundStyle(.secondary) }
                            case .idle: EmptyView()
                            }
                            Button("Обновить подборку") { run(selected) }.frame(minHeight: 44).disabled(model.state == .loading)
                                .accessibilityIdentifier("collection.refresh")
                        }.id("collection-results")
                    }
                    Text(mode == "MOCK" ? "DEMO: цены и расписание условные." : "Найденные цены кешированные. Окончательная цена и покупка — на Aviasales.").font(.footnote).foregroundStyle(.secondary)
                }.padding(20)
            }.background(Color(.systemGroupedBackground)).navigationTitle("Подборки").navigationBarTitleDisplayMode(.inline)
                .sheet(isPresented: $showConditions) {
                    VStack(spacing: 0) {
                        HStack { Spacer(); Button("Готово") { showConditions = false }.padding() }
                        HomeView(model: search, favorites: favorites, airports: airports, airportIndex: index, mode: mode, analytics: analytics)
                    }
                }
                .onChange(of: selected) { _, collection in
                    if collection != nil { Task { await Task.yield(); withAnimation { proxy.scrollTo("collection-results", anchor: .top) } } }
                }
                .onChange(of: search.query) { _, _ in selected = nil; model.reset() }
            }
        }
    }
    private var conditions: String {
        let airport = index.byIATA[search.query.origin]
        let origin = airport?.city ?? search.query.origin
        let dates = search.query.usesExactDates ? "\(search.query.departureDate ?? "") → \(search.query.returnDate ?? "")" : TravelDates.monthLabel(search.query.month)
        return "\(origin) · \(search.query.originCityCode == nil ? search.query.origin : "все аэропорты") · \(dates)"
    }
    private func run(_ collection: TripCollection) {
        selected = collection
        let parameters = collection.parameters(search.query, airports: index.byIATA)
        model.query = parameters.0
        model.start(filters: parameters.1, sort: parameters.2)
    }
}
