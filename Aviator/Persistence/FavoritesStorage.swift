import Foundation

@MainActor protocol FavoritesStore {
    func all() throws -> [Offer]
    func add(_ offer: Offer, at date: Date) throws
    @discardableResult func update(_ offer: Offer) throws -> Bool
    func remove(id: String) throws
}
