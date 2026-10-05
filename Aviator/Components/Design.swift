import SwiftUI

extension Color { static let aviatorBlue = Color(red: 22/255, green: 119/255, blue: 242/255) }
@MainActor private enum PhotoCache {
    static let images: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>(); cache.totalCostLimit = 32 * 1024 * 1024
        return cache
    }()
    static var inflight: [String: Task<UIImage?, Never>] = [:]
    static func load(_ name: String) async -> UIImage? {
        if let cached = images.object(forKey: name as NSString) { return cached }
        if let running = inflight[name] { return await running.value }
        let task = Task<UIImage?, Never> {
            guard let source = UIImage(named: name) else { return nil }
            return await source.byPreparingThumbnail(ofSize: CGSize(width: 1200, height: 900))
        }
        inflight[name] = task
        let image = await task.value
        inflight[name] = nil
        if let image { images.setObject(image, forKey: name as NSString, cost: Int(image.size.width * image.size.height * image.scale * image.scale * 4)) }
        return image
    }
}

@MainActor struct DestinationPhoto: View {
    let name: String
    @State private var photo: UIImage?
    var body: some View {
        GeometryReader { proxy in
            if let photo {
                Image(uiImage: photo).resizable().scaledToFill().frame(width: proxy.size.width, height: proxy.size.height).clipped()
            } else {
                ZStack {
                    LinearGradient(colors: [.aviatorBlue.opacity(0.25), .cyan.opacity(0.12)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    Image(systemName: "airplane.circle").font(.system(size: 56)).foregroundStyle(Color.aviatorBlue)
                }
            }
        }.task(id: name) {
            photo = nil
            let loaded = await PhotoCache.load(name)
            guard !Task.isCancelled else { return }
            photo = loaded
        }.accessibilityHidden(true)
    }
}
struct PrimaryButton: View {
    let title: String
    var action: () -> Void
    var body: some View {
        Button(action: action) { Text(title).font(.headline).frame(maxWidth: .infinity, minHeight: 52).padding(.horizontal, 8) }
            .buttonStyle(.plain).foregroundStyle(.white).background(Color.aviatorBlue, in: RoundedRectangle(cornerRadius: 16))
    }
}
struct StatusPanel: View {
    let symbol: String
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: symbol).font(.system(size: 48)).foregroundStyle(Color.aviatorBlue).accessibilityHidden(true)
            Text(title).font(.title2.bold())
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }.padding(32).frame(maxWidth: .infinity)
    }
}
@MainActor struct FavoriteButton: View {
    let offer: Offer
    @ObservedObject var favorites: FavoritesViewModel
    var body: some View {
        Button { favorites.toggle(offer) } label: {
            Image(systemName: favorites.contains(offer) ? "heart.fill" : "heart").foregroundStyle(Color.aviatorBlue).frame(width: 44, height: 44).background(.white, in: Circle())
        }.buttonStyle(.plain).accessibilityLabel(favorites.contains(offer) ? "Удалить из избранного" : "Добавить в избранное")
            .accessibilityIdentifier("favorite.\(offer.destinationAirport)")
    }
}
@MainActor struct OfferCard: View {
    let offer: Offer
    @ObservedObject var favorites: FavoritesViewModel
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            DestinationPhoto(name: offer.imageName).frame(height: 150).overlay(alignment: .topTrailing) { FavoriteButton(offer: offer, favorites: favorites).padding(8) }
            VStack(alignment: .leading, spacing: 8) {
                Text(offer.city).font(.headline).fixedSize(horizontal: false, vertical: true)
                Text(Money.format(offer.priceMinor, currency: offer.currency)).font(.title3.bold()).foregroundStyle(Color.aviatorBlue)
                Text("туда-обратно").font(.caption).foregroundStyle(.secondary)
                Text(TravelDates.display(offer.departureAt, zone: offer.originTimezone) + " — " + TravelDates.display(offer.returnAt, zone: offer.destinationTimezone)).font(.caption).fixedSize(horizontal: false, vertical: true)
                Text(offer.isDemo ? "DEMO · условная цена" : "LIVE · кешированная цена").font(.caption.bold()).foregroundStyle(.secondary)
                Text(offer.receivedLabel).font(.caption2).foregroundStyle(.secondary)
                Text(offer.isDirect ? "Прямые туда и обратно" : "Условия пересадок — в карточке").font(.caption).foregroundStyle(.secondary)
                Text(offer.airlineLabel).font(.caption)
                Text("Туда \(TravelDates.time(offer.departureAt, zone: offer.originTimezone)) → \(offer.arrivalAt.map { TravelDates.time($0, zone: offer.destinationTimezone) } ?? "—")*").font(.caption)
                Text("Обратно \(TravelDates.time(offer.returnAt, zone: offer.destinationTimezone)) → \(offer.returnArrivalAt.map { TravelDates.time($0, zone: offer.originTimezone) } ?? "—")*").font(.caption)
                Text("* Прилёт расчётный · местное время").font(.caption2).foregroundStyle(.secondary)
                if let hours = offer.stayHours {
                    Label("≈ \(Int(hours)) ч на месте", systemImage: "sun.max").font(.caption.bold()).foregroundStyle(Color.aviatorBlue)
                    if let cost = offer.costPerStayHourMinor { Text("\(Money.format(cost)) / час поездки").font(.caption) }
                }
                TripRatingView(offer: offer)
                CompareButton(offer: offer)
            }.padding([.horizontal, .bottom], 12)
        }.background(.white).clipShape(RoundedRectangle(cornerRadius: 20)).shadow(color: .black.opacity(0.06), radius: 12, y: 4)
    }
}
