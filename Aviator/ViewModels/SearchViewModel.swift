import Foundation
import Combine

@MainActor final class SearchViewModel: ObservableObject {
    enum State: Equatable { case idle, loading, success, empty, error(String), offline }
    @Published var query: SearchQuery
    @Published private(set) var performedQuery: SearchQuery?
    @Published private(set) var state: State = .idle
    @Published var filters = ExtraFilters()
    @Published private(set) var result = SearchResult(offers: [], incomplete: false, warnings: [])
    private let service: any SearchService
    let clock: any AppClock
    private let analytics: any AnalyticsService
    private var task: Task<Void, Never>?
    private var generation = UUID()
    init(service: any SearchService, clock: any AppClock, analytics: any AnalyticsService) {
        self.service = service; self.clock = clock; self.analytics = analytics
        query = SearchQuery(month: TravelDates.month(clock.now))
    }
    var offers: [Offer] {
        SearchRules.destinations(result.offers, query: performedQuery ?? query, now: clock.now, filters: filters)
    }
    var emptyMessage: String {
        if !filters.isEmpty { return "Дополнительные фильтры скрыли найденные варианты. Сбросьте их, чтобы увидеть результаты исходного поиска." }
        let direct = (performedQuery ?? query).directOnly ? " Попробуйте разрешить пересадки." : ""
        return "В кеше цен нет подходящих поездок на выходные для выбранного месяца и бюджета. Это не означает, что билетов нет. Увеличьте бюджет или выберите другой месяц." + direct
    }
    func retryWithBudget() {
        query = performedQuery ?? query
        query.maxBudgetMinor = min(10_000_000, query.maxBudgetMinor + 1_000_000)
        start()
    }
    func retryWithTransfers() {
        query = performedQuery ?? query; query.directOnly = false; start()
    }
    func start() {
        task?.cancel(); generation = UUID(); let ticket = generation; let parameters = query
        performedQuery = parameters; filters = ExtraFilters(); result = SearchResult(offers: [], incomplete: false, warnings: []); state = .loading
        analytics.record(.searchStarted)
        task = Task {
            do {
                let response = try await service.search(parameters)
                guard !Task.isCancelled, generation == ticket else { return }
                result = response; state = offers.isEmpty ? .empty : .success; analytics.record(.searchCompleted)
            } catch is CancellationError { return }
            catch {
                guard !Task.isCancelled, generation == ticket else { return }
                if let failure = error as? SearchFailure, case .offline = failure { state = .offline }
                else { state = .error(error.localizedDescription) }
            }
        }
    }
}

@MainActor final class FavoritesViewModel: ObservableObject {
    @Published private(set) var offers: [Offer] = []
    @Published var error: String?
    private let store: any FavoritesStore
    private let clock: any AppClock
    private let analytics: any AnalyticsService
    init(store: any FavoritesStore, clock: any AppClock, analytics: any AnalyticsService) {
        self.store = store; self.clock = clock; self.analytics = analytics; reload()
    }
    func reload() {
        do { offers = try store.all() } catch { self.error = "Не удалось прочитать избранное: \(error.localizedDescription)" }
    }
    func contains(_ offer: Offer) -> Bool { offers.contains { $0.id == offer.id } }
    func toggle(_ offer: Offer) {
        do {
            if contains(offer) { try store.remove(id: offer.id) }
            else { try store.add(offer, at: clock.now); analytics.record(.destinationFavorited) }
            reload()
        } catch { self.error = "Не удалось сохранить изменение: \(error.localizedDescription)" }
    }
}
