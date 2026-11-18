import Foundation
import Combine

@MainActor final class ComparisonModel: ObservableObject {
    @Published private(set) var offers: [Offer] = []
    @Published var message: String?
    func contains(_ offer: Offer) -> Bool { offers.contains { $0.id == offer.id && $0.source == offer.source } }
    func toggle(_ offer: Offer) {
        if contains(offer) { offers.removeAll { $0.id == offer.id && $0.source == offer.source }; return }
        guard offers.count < 4 else { message = "Можно сравнить до четырёх поездок. Уберите одну, чтобы добавить другую."; return }
        offers.append(offer)
    }
    func clear() { offers = [] }
    func update(_ offer: Offer) {
        if let index = offers.firstIndex(where: { $0.id == offer.id && $0.source == offer.source }) { offers[index] = offer }
    }
}

@MainActor final class NearbyDatesViewModel: ObservableObject {
    @Published private(set) var options: [NearbyDateOption] = []
    @Published private(set) var isLoading = false
    @Published private(set) var completed = false
    private var generation = UUID()
    func load(offer: Offer, budget: Int, service: any SearchService, clock: any AppClock) async {
        guard !isLoading else { return }
        generation = UUID(); let ticket = generation
        isLoading = true; completed = false
        options = NearbyDates.options(for: offer, budget: budget, now: clock.now)
        let queries = options.compactMap(\.query)
        defer { if generation == ticket { isLoading = false } }
        do {
            let responses = try await service.searchBatch(queries)
            try Task.checkCancellation()
            guard generation == ticket, responses.count == queries.count else { throw SearchFailure.invalidData }
            var position = 0
            for index in options.indices where options[index].query != nil {
                let query = options[index].query!, response = responses[position]; position += 1
                options[index].error = response.error
                if let result = response.result {
                    options[index].incomplete = result.incomplete
                    options[index].best = SearchRules.sorted(result.offers.filter {
                        $0.source == offer.source && SearchRules.accepts($0, query: query, now: clock.now)
                    }).first
                }
            }
            completed = true
        } catch is CancellationError { return }
        catch {
            guard generation == ticket else { return }
            for index in options.indices where options[index].query != nil { options[index].error = error.localizedDescription }
            completed = true
        }
    }
}

@MainActor final class FavoritesViewModel: ObservableObject {
    @Published private(set) var offers: [Offer] = []
    @Published private(set) var isRefreshing = false
    @Published private(set) var refreshSummary: String?
    @Published private(set) var priceDropAlerts: [String] = []
    @Published var priceDropAlertsEnabled: Bool = false {
        didSet {
            preferences.set(priceDropAlertsEnabled, forKey: "favorites.priceDrop.enabled")
            if priceDropAlertsEnabled && !oldValue {
                for offer in offers { lowestNotifiedPrice[alertKey(offer)] = offer.priceMinor }
                saveAlertState()
            }
        }
    }
    private let preferences: UserDefaults
    private var lowestNotifiedPrice: [String: Int] = [:]
    private var favoriteIDs = Set<String>()
    @Published var error: String?
    private let store: any FavoritesStore
    let clock: any AppClock
    private let analytics: any AnalyticsService
    let services: [String: any SearchService]
    init(store: any FavoritesStore, clock: any AppClock, analytics: any AnalyticsService, services: [String: any SearchService] = [:], preferences: UserDefaults = .standard) {
        self.store = store; self.clock = clock; self.analytics = analytics; self.services = services
        self.preferences = preferences
        lowestNotifiedPrice = preferences.dictionary(forKey: "favorites.priceDrop.lowest") as? [String: Int] ?? [:]
        priceDropAlerts = preferences.stringArray(forKey: "favorites.priceDrop.history") ?? []
        priceDropAlertsEnabled = preferences.bool(forKey: "favorites.priceDrop.enabled")
        reload()
    }
    func service(for offer: Offer) -> (any SearchService)? { services[offer.source] }
    func reload() {
        do { offers = try store.all(); favoriteIDs = Set(offers.map(\.id)) } catch { self.error = "Не удалось прочитать избранное: \(error.localizedDescription)" }
    }
    func contains(_ offer: Offer) -> Bool { favoriteIDs.contains(offer.id) }
    func current(_ offer: Offer) -> Offer { offers.first { $0.id == offer.id && $0.source == offer.source } ?? offer }
    func toggle(_ offer: Offer) {
        do {
            if contains(offer) {
                try store.remove(id: offer.id)
                lowestNotifiedPrice.removeValue(forKey: alertKey(offer)); saveAlertState()
            }
            else { try store.add(offer, at: clock.now); analytics.record(.destinationFavorited) }
            reload()
        } catch { self.error = "Не удалось сохранить изменение: \(error.localizedDescription)" }
    }
    func refresh(_ selected: [Offer]? = nil) async {
        guard !isRefreshing else { return }
        isRefreshing = true; refreshSummary = nil
        defer { isRefreshing = false }
        let snapshot = selected ?? offers
        var checked = 0, updated = 0
        for source in Set(snapshot.map(\.source)).sorted() {
            let candidates = snapshot.filter { $0.source == source }
            var queries: [SearchQuery] = []
            var groups: [SearchQuery: [Offer]] = [:]
            for saved in candidates {
                if saved.departureAt <= clock.now {
                    var past = saved; past.lastCheckedAt = clock.now; past.refreshStatus = .past
                    past.refreshMessage = "Даты прошли · цена не обновлялась"
                    persist(past); continue
                }
                let query = saved.exactQuery(refresh: true)
                if groups[query] == nil { queries.append(query) }
                groups[query, default: []].append(saved)
            }
            for start in stride(from: 0, to: queries.count, by: 7) {
                let batch = Array(queries[start..<min(start + 7, queries.count)])
                var responses: [BatchSearchItem]
                do {
                    try Task.checkCancellation()
                    guard let service = services[source] else { throw SearchFailure.configuration }
                    responses = try await service.searchBatch(batch)
                    guard responses.count == batch.count else { throw SearchFailure.invalidData }
                    try Task.checkCancellation()
                } catch is CancellationError { return }
                catch { responses = batch.map { _ in BatchSearchItem(result: nil, error: error.localizedDescription) } }
                for (query, response) in zip(batch, responses) {
                    for saved in groups[query] ?? [] {
                        guard favoriteIDs.contains(saved.id) else { continue }
                        var replacement = saved
                        replacement.lastCheckedAt = clock.now
                        checked += 1
                        if let result = response.result {
                            if var found = result.offers.filter({ $0.matchesSavedVariant(saved) && $0.canDisplay(at: clock.now) }).min(by: { $0.priceMinor < $1.priceMinor }) {
                                found.originalPriceMinor = saved.originalPriceMinor ?? saved.priceMinor
                                found.previousPriceMinor = saved.priceMinor
                                found.lastCheckedAt = clock.now; found.refreshStatus = .updated
                                found.refreshMessage = result.incomplete ? "Цена обновлена · выдача неполная" : "Цена обновлена из источника"
                                replacement = found
                            } else {
                                replacement.refreshStatus = .notFound
                                replacement.refreshMessage = result.incomplete
                                    ? "В неполной выдаче вариант не найден · сохранена прежняя цена"
                                    : "В новой выдаче вариант не найден · сохранена прежняя цена"
                            }
                        } else {
                            replacement.refreshStatus = .failed
                            replacement.refreshMessage = "Не удалось обновить: " + (response.error ?? "Некорректный ответ")
                        }
                        if persist(replacement) && replacement.refreshStatus == .updated {
                            updated += 1
                            recordPriceDrop(from: saved, to: replacement)
                        }
                    }
                }
            }
        }
        refreshSummary = "Проверено: \(checked) · цены обновлены: \(updated). Доступность билетов уточните на Aviasales."
    }
    func clearPriceDropAlerts() {
        priceDropAlerts = []; saveAlertState()
    }
    private func alertKey(_ offer: Offer) -> String { "\(offer.source)|\(offer.id)|\(offer.currency)" }
    private func saveAlertState() {
        preferences.set(lowestNotifiedPrice, forKey: "favorites.priceDrop.lowest")
        preferences.set(priceDropAlerts, forKey: "favorites.priceDrop.history")
    }
    private func recordPriceDrop(from saved: Offer, to updated: Offer) {
        guard priceDropAlertsEnabled else { return }
        let key = alertKey(saved)
        let baseline = min(lowestNotifiedPrice[key] ?? saved.priceMinor, saved.priceMinor)
        guard updated.priceMinor < baseline else { return }
        lowestNotifiedPrice[key] = updated.priceMinor
        let message = "\(updated.isDemo ? "DEMO · " : "")\(updated.city): снижение на \(Money.format(baseline - updated.priceMinor, currency: updated.currency)), теперь \(Money.format(updated.priceMinor, currency: updated.currency)). "
            + "Проверка: " + TravelDates.display(clock.now, zone: TimeZone.current.identifier, time: true)
        priceDropAlerts.insert(message, at: 0)
        priceDropAlerts = Array(priceDropAlerts.prefix(20))
        saveAlertState()
    }
    @discardableResult private func persist(_ offer: Offer) -> Bool {
        do { if try store.update(offer) { reload(); return true }; return false }
        catch { self.error = "Не удалось сохранить результат проверки: \(error.localizedDescription)"; return false }
    }
}
