import SwiftUI

extension Color { static let aviatorBlue = Color(red: 22/255, green: 119/255, blue: 242/255) }
struct DestinationPhoto: View {
    let name: String
    var body: some View {
        GeometryReader { proxy in
            if let image = UIImage(named: name) {
                Image(uiImage: image).resizable().scaledToFill().frame(width: proxy.size.width, height: proxy.size.height).clipped()
            } else {
                ZStack {
                    LinearGradient(colors: [.aviatorBlue.opacity(0.25), .cyan.opacity(0.12)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    Image(systemName: "airplane.circle").font(.system(size: 56)).foregroundStyle(Color.aviatorBlue)
                }
            }
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
                Text(offer.isDirect ? "Прямые туда и обратно" : "Условия пересадок — в карточке").font(.caption).foregroundStyle(.secondary)
                if let duration = offer.durationTo { Text("Туда: \(duration) мин").font(.caption) }
            }.padding([.horizontal, .bottom], 12)
        }.background(.white).clipShape(RoundedRectangle(cornerRadius: 20)).shadow(color: .black.opacity(0.06), radius: 12, y: 4)
    }
}
