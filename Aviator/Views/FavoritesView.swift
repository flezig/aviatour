import SwiftUI

@MainActor struct FavoritesView: View {
    @ObservedObject var favorites: FavoritesViewModel
    let clock: any AppClock
    let analytics: any AnalyticsService
    var body: some View {
        NavigationStack {
            Group {
                if favorites.offers.isEmpty {
                    StatusPanel(symbol: "heart", title: "Сохраните мечту", message: "Нажмите на сердечко понравившегося варианта. Маршрут, даты и снимок цены останутся здесь без сети.")
                } else {
                    List {
                        ForEach(favorites.offers) { offer in
                            NavigationLink { DetailView(offer: offer, favorites: favorites, clock: clock, analytics: analytics) } label: {
                                HStack(spacing: 16) {
                                    DestinationPhoto(name: offer.imageName).frame(width: 72, height: 88).clipShape(RoundedRectangle(cornerRadius: 12))
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(offer.city).font(.headline)
                                        Text(Money.format(offer.priceMinor, currency: offer.currency)).foregroundStyle(Color.aviatorBlue)
                                        Text(offer.isDemo ? "DEMO · снимок цены" : "LIVE · снимок цены").font(.caption)
                                        if offer.departureAt <= clock.now { Text("Даты прошли").font(.caption).foregroundStyle(.secondary) }
                                    }
                                }.padding(.vertical, 4)
                            }.accessibilityIdentifier("saved.\(offer.destinationAirport)")
                                .swipeActions { Button("Удалить", role: .destructive) { favorites.toggle(offer) } }
                        }
                    }
                }
            }.navigationTitle("Избранное").onAppear { favorites.reload() }
        }
    }
}
