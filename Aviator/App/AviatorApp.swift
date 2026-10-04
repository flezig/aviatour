import SwiftUI
import SwiftData

@main @MainActor struct AviatorApp: App {
    private let bootstrap: Result<AppDependencies, Error>
    init() { bootstrap = Result { try AppDependencies() } }
    var body: some Scene {
        WindowGroup {
            switch bootstrap {
            case .success(let dependencies): RootView(dependencies: dependencies)
            case .failure(let error): StatusPanel(symbol: "exclamationmark.triangle", title: "Не удалось открыть Aviator", message: "Ошибка локальных данных: \(error.localizedDescription). Перезапустите приложение.")
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
    init() throws {
        airports = try Catalog.load()
        airportIndex = AirportIndex(airports: airports)
        let isSmoke = ProcessInfo.processInfo.arguments.contains("--ui-smoke")
        clock = isSmoke ? FixedClock(now: ISO8601DateFormatter().date(from: "2026-10-01T09:00:00Z")!) : SystemClock()
        analytics = LocalAnalytics()
        mode = isSmoke ? "MOCK" : ((Bundle.main.object(forInfoDictionaryKey: "AVIATOR_MODE") as? String) ?? "MOCK").uppercased()
        let service: any SearchService
        if mode == "MOCK" { service = MockSearchService(airports: airports, clock: clock) }
        else if mode == "LIVE" { service = LiveSearchService(baseURL: URL(string: Bundle.main.object(forInfoDictionaryKey: "AVIATOR_BASE_URL") as? String ?? "")) }
        else { throw SearchFailure.configuration }
        let container = try ModelContainer(for: FavoriteSnapshot.self, configurations: ModelConfiguration(isStoredInMemoryOnly: isSmoke))
        favorites = FavoritesViewModel(store: SwiftDataFavoritesStore(container: container), clock: clock, analytics: analytics)
        search = SearchViewModel(service: service, clock: clock, analytics: analytics)
        analytics.record(.appOpen)
    }
}
@MainActor struct RootView: View {
    let dependencies: AppDependencies
    @ObservedObject private var favorites: FavoritesViewModel
    init(dependencies: AppDependencies) { self.dependencies = dependencies; self.favorites = dependencies.favorites }
    var body: some View {
        TabView {
            HomeView(model: dependencies.search, favorites: dependencies.favorites, airports: dependencies.airports, airportIndex: dependencies.airportIndex, mode: dependencies.mode, analytics: dependencies.analytics)
                .tabItem { Label("Поиск", systemImage: "magnifyingglass") }
            FavoritesView(favorites: dependencies.favorites, clock: dependencies.clock, analytics: dependencies.analytics)
                .tabItem { Label("Избранное", systemImage: "heart") }
        }.tint(.aviatorBlue).preferredColorScheme(.light)
            .alert("Избранное", isPresented: Binding(get: { favorites.error != nil }, set: { if !$0 { favorites.error = nil } })) {
                Button("Понятно", role: .cancel) {}
            } message: { Text(favorites.error ?? "") }
    }
}
