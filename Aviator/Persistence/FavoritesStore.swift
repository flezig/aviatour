import Foundation
import SwiftData

@Model final class FavoriteSnapshot {
    @Attribute(.unique) var offerID: String
    var payload: Data
    var savedAt: Date
    init(offerID: String, payload: Data, savedAt: Date) { self.offerID = offerID; self.payload = payload; self.savedAt = savedAt }
}

@MainActor final class SwiftDataFavoritesStore: FavoritesStore {
    let container: ModelContainer
    private let context: ModelContext
    init(container: ModelContainer) { self.container = container; self.context = ModelContext(container) }
    func all() throws -> [Offer] {
        try context.fetch(FetchDescriptor<FavoriteSnapshot>(sortBy: [SortDescriptor(\.savedAt, order: .reverse)])).map {
            try JSONDecoder().decode(Offer.self, from: $0.payload)
        }
    }
    func add(_ offer: Offer, at date: Date) throws {
        // Snapshot identity is independent of current price; keep first saved price.
        let id = offer.id
        var descriptor = FetchDescriptor<FavoriteSnapshot>(predicate: #Predicate { $0.offerID == id })
        descriptor.fetchLimit = 1
        if try !context.fetch(descriptor).isEmpty { return }
        context.insert(FavoriteSnapshot(offerID: offer.id, payload: try JSONEncoder().encode(offer), savedAt: date))
        do { try context.save() } catch { context.rollback(); throw error }
    }
    @discardableResult func update(_ offer: Offer) throws -> Bool {
        let id = offer.id
        var descriptor = FetchDescriptor<FavoriteSnapshot>(predicate: #Predicate { $0.offerID == id })
        descriptor.fetchLimit = 1
        guard let snapshot = try context.fetch(descriptor).first else { return false }
        snapshot.payload = try JSONEncoder().encode(offer)
        do { try context.save(); return true } catch { context.rollback(); throw error }
    }
    func remove(id: String) throws {
        let descriptor = FetchDescriptor<FavoriteSnapshot>(predicate: #Predicate { $0.offerID == id })
        for snapshot in try context.fetch(descriptor) { context.delete(snapshot) }
        do { try context.save() } catch { context.rollback(); throw error }
    }
}
