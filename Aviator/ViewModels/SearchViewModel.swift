import Foundation
import Combine

struct FilterChoice: Identifiable { let id: String; let title: String }

@MainActor final class SearchViewModel: ObservableObject {
    enum State: Equatable { case idle, loading, success, empty, error(String), offline }
    @Published var query: SearchQuery {
        didSet {
            if let preferences, let data = try? JSONEncoder().encode(query) { preferences.set(data, forKey: "search.conditions") }
        }
    }
    @Published private(set) var previousOffers: [Offer] = []
    @Published private(set) var previousQuery: SearchQuery?
    private let preferences: UserDefaults?
    @Published private(set) var performedQuery: SearchQuery?
    @Published private(set) var state: State = .idle
    @Published var filters = ExtraFilters() { didSet { if filters != oldValue { refresh() } } }
    @Published var sort: OfferSort = .price { didSet { if sort != oldValue { refresh() } } }
    @Published private(set) var offers: [Offer] = []
    @Published private(set) var isFiltering = false
    @Published private(set) var airlines: [FilterChoice] = []
    @Published private(set) var countries: [FilterChoice] = []
    private var facts: [OfferFacts] = []
    private var filterTask: Task<Void, Never>?
    private var filterGeneration = UUID()
    @Published private(set) var result = SearchResult(offers: [], incomplete: false, warnings: [])
    let service: any SearchService
    let clock: any AppClock
    private let analytics: any AnalyticsService
    private var task: Task<Void, Never>?
    private var generation = UUID()
    init(service: any SearchService, clock: any AppClock, analytics: any AnalyticsService, preferences: UserDefaults? = nil) {
        self.service = service; self.clock = clock; self.analytics = analytics
        self.preferences = preferences
        var restored = preferences?.data(forKey: "search.conditions").flatMap { try? JSONDecoder().decode(SearchQuery.self, from: $0) } ?? SearchQuery(month: TravelDates.month(clock.now))
        if !TravelDates.months(now: clock.now, zone: "Europe/Moscow").contains(restored.month) {
            restored.month = TravelDates.month(clock.now); restored.departureDate = nil; restored.returnDate = nil
        }
        if let date = restored.departureDate, date < TravelDates.dateKey(clock.now, zone: "UTC") { restored.departureDate = nil; restored.returnDate = nil }
        query = restored
    }
    func reset() {
        task?.cancel(); generation = UUID()
        filterTask?.cancel(); filterGeneration = UUID()
        previousOffers = []; previousQuery = nil
        isFiltering = false; state = .idle; offers = []; facts = []
        result = SearchResult(offers: [], incomplete: false, warnings: []); performedQuery = nil
    }
    func refresh() {
        filterTask?.cancel(); filterGeneration = UUID()
        let ticket = filterGeneration, source = facts, parameters = performedQuery ?? query
        let selected = filters, order = sort, now = clock.now
        isFiltering = true
        filterTask = Task {
            do { try await Task.sleep(nanoseconds: 80_000_000) } catch { return }
            let matched = await Task.detached(priority: .userInitiated) {
                SearchRules.options(source, query: parameters, now: now, filters: selected, sort: order)
            }.value
            guard !Task.isCancelled, filterGeneration == ticket else { return }
            offers = matched; isFiltering = false
        }
    }
    var emptyMessage: String {
        if (performedQuery ?? query).tripPreferences.fullBudgetMinor != nil && !result.offers.isEmpty {
            return "Найденные билеты не прошли условие полного бюджета: сумма превышает предел или данных о расходах недостаточно. Уберите предел полного бюджета, чтобы увидеть билеты."
        }
        if !filters.isEmpty { return "Дополнительные фильтры скрыли найденные варианты. Сбросьте их, чтобы увидеть результаты исходного поиска." }
        let direct = (performedQuery ?? query).directOnly ? " Попробуйте разрешить пересадки." : ""
        return "В кеше цен нет подходящих поездок для выбранных дат и бюджета. Это не означает, что билетов нет. Увеличьте бюджет или выберите другой месяц." + direct
    }
    func retryWithBudget() {
        query = performedQuery ?? query
        query.maxBudgetMinor = min(50_000_000, query.maxBudgetMinor + 1_000_000)
        start()
    }
    func retryWithTransfers() {
        query = performedQuery ?? query; query.directOnly = false; start()
    }
    func start(filters initialFilters: ExtraFilters = ExtraFilters(), sort initialSort: OfferSort = .price) {
        if state == .success || state == .empty {
            previousOffers = offers; previousQuery = performedQuery
        }
        task?.cancel(); generation = UUID(); let ticket = generation; let parameters = query
        performedQuery = parameters; filters = initialFilters; sort = initialSort
        filterTask?.cancel(); filterGeneration = UUID(); isFiltering = false
        facts = []; offers = []; airlines = []; countries = []
        result = SearchResult(offers: [], incomplete: false, warnings: []); state = .loading
        analytics.record(.searchStarted)
        task = Task {
            do {
                let response = try await service.search(parameters)
                guard !Task.isCancelled, generation == ticket else { return }
                let now = clock.now
                let prepared = await Task.detached(priority: .userInitiated) {
                    let facts = response.offers.map(OfferFacts.init)
                    let choices = Dictionary(grouping: response.offers.filter { $0.countryCode != nil }, by: { $0.countryCode! })
                        .map { FilterChoice(id: $0.key, title: $0.value.first?.country ?? $0.key) }.sorted { $0.title < $1.title }
                    return (facts, SearchRules.options(facts, query: parameters, now: now, filters: initialFilters, sort: initialSort),
                            Dictionary(grouping: response.offers.filter { $0.airline != nil }, by: { $0.airline! })
                                .map { FilterChoice(id: $0.key, title: $0.value.first?.airlineLabel ?? $0.key) }.sorted { $0.title < $1.title }, choices)
                }.value
                guard !Task.isCancelled, generation == ticket else { return }
                result = response; facts = prepared.0; offers = prepared.1; airlines = prepared.2; countries = prepared.3
                state = offers.isEmpty ? .empty : .success
                if !filters.isEmpty || sort != .price { refresh() }
                analytics.record(.searchCompleted)
            } catch is CancellationError { return }
            catch {
                guard !Task.isCancelled, generation == ticket else { return }
                if let failure = error as? SearchFailure, case .offline = failure { state = .offline }
                else { state = .error(error.localizedDescription) }
            }
        }
    }
}
