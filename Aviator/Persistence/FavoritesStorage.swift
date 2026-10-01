import Foundation

@MainActor protocol FavoritesStore {
    func all() throws -> [Offer]
    func add(_ offer: Offer, at date: Date) throws
    func remove(id: String) throws
}
