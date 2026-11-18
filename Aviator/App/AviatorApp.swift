import SwiftUI
import SwiftData

@main @MainActor struct AviatorApp: App {
    @State private var bootstrap: Result<AppDependencies, Error>?
    var body: some Scene {
        WindowGroup {
            Group {
                if let bootstrap {
                    switch bootstrap {
                    case .success(let dependencies): RootView(dependencies: dependencies)
                    case .failure(let error): StatusPanel(symbol: "exclamationmark.triangle", title: "Не удалось открыть Aviator", message: "Ошибка локальных данных: \(error.localizedDescription). Перезапустите приложение.")
                    }
                } else { ProgressView("Готовим поездки…") }
            }.task {
                guard bootstrap == nil else { return }
                do {
                    let prepared = try await Task.detached(priority: .userInitiated) {
                        let airports = try Catalog.load()
                        return (airports, AirportIndex(airports: airports))
                    }.value
                    bootstrap = .success(try AppDependencies(airports: prepared.0, airportIndex: prepared.1))
                } catch { bootstrap = .failure(error) }
            }
        }
    }
}

@MainActor final class AppDependencies {
    let airports: [Airport]
    let airportIndex: AirportIndex
    let clock: any AppClock
    let analytics: any AnalyticsService
    let mode: String
    let search: SearchViewModel
    let favorites: FavoritesViewModel
    let profile: TravelerProfile
    init(airports: [Airport], airportIndex: AirportIndex) throws {
        self.airports = airports
        self.airportIndex = airportIndex
        let isSmoke = ProcessInfo.processInfo.arguments.contains("--ui-smoke")
        let profileDefaults = isSmoke ? UserDefaults(suiteName: "aviator.ui-smoke.profile")! : .standard
        if isSmoke { profileDefaults.removePersistentDomain(forName: "aviator.ui-smoke.profile") }
        profile = TravelerProfile(defaults: profileDefaults)
        clock = isSmoke ? FixedClock(now: ISO8601DateFormatter().date(from: "2026-10-01T09:00:00Z")!) : SystemClock()
        analytics = LocalAnalytics()
        mode = isSmoke ? "MOCK" : ((Bundle.main.object(forInfoDictionaryKey: "AVIATOR_MODE") as? String) ?? "MOCK").uppercased()
        let service: any SearchService
        if mode == "MOCK" { service = MockSearchService(airports: airports, clock: clock) }
        else if mode == "LIVE" { service = LiveSearchService(baseURL: URL(string: Bundle.main.object(forInfoDictionaryKey: "AVIATOR_BASE_URL") as? String ?? "")) }
        else { throw SearchFailure.configuration }
        let mock = MockSearchService(airports: airports, clock: clock)
        let live = LiveSearchService(baseURL: URL(string: Bundle.main.object(forInfoDictionaryKey: "AVIATOR_BASE_URL") as? String ?? ""))
        let container = try ModelContainer(for: FavoriteSnapshot.self, configurations: ModelConfiguration(isStoredInMemoryOnly: isSmoke))
        favorites = FavoritesViewModel(store: SwiftDataFavoritesStore(container: container), clock: clock, analytics: analytics, services: ["MOCK": mock, "LIVE": live], preferences: profileDefaults)
        search = SearchViewModel(service: service, clock: clock, analytics: analytics, preferences: isSmoke ? nil : .standard)
        analytics.record(.appOpen)
    }
}
@MainActor struct RootView: View {
    let dependencies: AppDependencies
    @ObservedObject private var favorites: FavoritesViewModel
    @ObservedObject private var search: SearchViewModel
    @StateObject private var comparison = ComparisonModel()
    @ObservedObject private var profile: TravelerProfile
    @State private var discovery = "rating"
    @State private var showProfile = false
    @State private var ratingRequest: CityRatingRequest?
    @State private var selectedTab: String
    init(dependencies: AppDependencies) {
        self.profile = dependencies.profile
        self.dependencies = dependencies; self.favorites = dependencies.favorites; self.search = dependencies.search
        _selectedTab = State(initialValue: ProcessInfo.processInfo.arguments.contains("--ui-smoke") ? "search" : "discover")
    }
    var body: some View {
        TabView(selection: $selectedTab) {
            VStack(spacing: 0) {
                HStack {
                    Picker("Куда поехать", selection: $discovery) {
                        Text("Рейтинг").tag("rating")
                        Text("Подборки").tag("collections")
                    }.pickerStyle(.segmented).accessibilityIdentifier("discovery.section")
                    Button { showProfile = true } label: { Image(systemName: "person.crop.circle").font(.title2) }
                        .accessibilityLabel("Мой профиль").frame(minWidth: 44, minHeight: 44).accessibilityIdentifier("profile.open")
                }.padding(.horizontal, 16)
                ZStack {
                    CollectionsView(search: search, favorites: favorites, airports: dependencies.airports, index: dependencies.airportIndex, mode: dependencies.mode, analytics: dependencies.analytics)
                        .opacity(discovery == "collections" ? 1 : 0).allowsHitTesting(discovery == "collections").accessibilityHidden(discovery != "collections")
                    CityRatingsView(search: search, favorites: favorites, index: dependencies.airportIndex, analytics: dependencies.analytics, request: $ratingRequest, showConditions: { selectedTab = "search" })
                        .opacity(discovery == "rating" ? 1 : 0).allowsHitTesting(discovery == "rating").accessibilityHidden(discovery != "rating")
                }
            }.tabItem { Label("Куда поехать", systemImage: "sparkles") }.tag("discover")
            HomeView(model: dependencies.search, favorites: dependencies.favorites, airports: dependencies.airports, airportIndex: dependencies.airportIndex, mode: dependencies.mode, analytics: dependencies.analytics)
                .tabItem { Label("Поиск", systemImage: "magnifyingglass") }.tag("search")
            TripComparisonView(favorites: favorites, clock: dependencies.clock, analytics: dependencies.analytics)
                .tabItem { Label(comparison.offers.isEmpty ? "Сравнение" : "Сравнение (\(comparison.offers.count))", systemImage: "rectangle.split.2x1") }.tag("comparison")
            FavoritesView(favorites: dependencies.favorites, airports: dependencies.airports, clock: dependencies.clock, analytics: dependencies.analytics)
                .tabItem { Label("Избранное", systemImage: "heart") }.tag("favorites")
        }.environment(\.openCityRating, { offer in
            ratingRequest = CityRatingRequest(offer: offer); discovery = "rating"; selectedTab = "discover"
        }).environment(\.openSavedCity, { code in
            ratingRequest = CityRatingRequest(cityCode: code); discovery = "rating"; selectedTab = "discover"
        }).environmentObject(profile).sheet(isPresented: $showProfile) { ProfileView(airports: dependencies.airports).environmentObject(profile) }.environmentObject(comparison).environment(\.tripBudget, search.query.maxBudgetMinor)
            .onChange(of: favorites.offers) { _, offers in for offer in offers { comparison.update(offer) } }
            .alert("Сравнение", isPresented: Binding(get: { comparison.message != nil }, set: { if !$0 { comparison.message = nil } })) {
                Button("Понятно", role: .cancel) {}
            } message: { Text(comparison.message ?? "") }
            .tint(.aviatorBlue).preferredColorScheme(.light)
            .alert("Избранное", isPresented: Binding(get: { favorites.error != nil }, set: { if !$0 { favorites.error = nil } })) {
                Button("Понятно", role: .cancel) {}
            } message: { Text(favorites.error ?? "") }
    }
}
