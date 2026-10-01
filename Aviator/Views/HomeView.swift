import SwiftUI

@MainActor struct HomeView: View {
    @ObservedObject var model: SearchViewModel
    @ObservedObject var favorites: FavoritesViewModel
    let airports: [Airport]
    let mode: String
    let analytics: any AnalyticsService
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var chooseAirport = false
    @State private var showResults = false
    @State private var showCredits = false
    private var airport: Airport? { airports.first { $0.iata == model.query.origin } }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    DestinationPhoto(name: "hero").frame(height: textSize.isAccessibilitySize ? 560 : 320).overlay {
                        LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom)
                    }.overlay(alignment: .bottomLeading) {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Aviator").font(.headline)
                            Text("Куда улететь дешево?").font(.largeTitle.bold()).fixedSize(horizontal: false, vertical: true)
                            Text("Больше мира за меньшие деньги").font(.subheadline)
                        }.foregroundStyle(.white).padding(24).padding(.bottom, 24)
                    }
                    VStack(alignment: .leading, spacing: 24) {
                        Text(mode == "MOCK" ? "DEMO · путешествие начинается с идеи" : "LIVE · найденные цены").font(.caption.bold()).foregroundStyle(Color.aviatorBlue)
                        Button { chooseAirport = true } label: {
                            HStack {
                                Image(systemName: "airplane.departure")
                                VStack(alignment: .leading, spacing: 4) { Text("Откуда").font(.caption).foregroundStyle(.secondary); Text(airport?.label ?? model.query.origin).font(.headline) }
                                Spacer(); Image(systemName: "chevron.down")
                            }.foregroundStyle(.primary).frame(minHeight: 44)
                        }.accessibilityIdentifier("originPicker")
                        Divider()
                        Picker("Когда", selection: $model.query.month) {
                            ForEach(TravelDates.months(now: model.clock.now, zone: airport?.timezone ?? "Europe/Moscow"), id: \.self) { month in
                                Text(TravelDates.monthLabel(month)).tag(month)
                            }
                        }.pickerStyle(.menu).accessibilityIdentifier("monthPicker")
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Бюджет").font(.caption).foregroundStyle(.secondary)
                            Text(Money.format(model.query.maxBudgetMinor)).font(.title.bold()).accessibilityIdentifier("budgetValue")
                            Slider(value: Binding(get: { Double(model.query.maxBudgetMinor / 100) }, set: { model.query.maxBudgetMinor = Int($0) * 100 }), in: 5000...100000, step: 1000).accessibilityLabel("Бюджет в рублях")
                            Text("Билеты туда-обратно на одного").font(.footnote).foregroundStyle(.secondary)
                        }
                        Toggle("Только прямые рейсы", isOn: $model.query.directOnly).accessibilityIdentifier("directToggle")
                        PrimaryButton(title: "Найти варианты →") { model.start(); showResults = true }.disabled(model.state == .loading).accessibilityIdentifier("searchButton")
                    }.padding(20).background(.white, in: RoundedRectangle(cornerRadius: 24)).shadow(color: .black.opacity(0.08), radius: 18, y: 6).padding(.horizontal, 20).padding(.top, -24)
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Выходные за пределами привычного", systemImage: "sun.max").font(.headline)
                        Text("Пятница — воскресенье, пятница — понедельник или суббота — понедельник. Проживание и багаж не включены в обещания цены.").font(.footnote).foregroundStyle(.secondary)
                        Button("Источники фотографий") { showCredits = true }.font(.footnote).frame(minHeight: 44)
                    }.padding(24)
                }
            }.background(Color(.systemGroupedBackground)).toolbar(.hidden, for: .navigationBar)
                .navigationDestination(isPresented: $showResults) { ResultsView(model: model, favorites: favorites, analytics: analytics) }
                .sheet(isPresented: $chooseAirport) { AirportPicker(airports: airports, selection: $model.query.origin) }
                .sheet(isPresented: $showCredits) { CreditsView() }
                .onChange(of: model.query.origin) { _, _ in
                    let months = TravelDates.months(now: model.clock.now, zone: airport?.timezone ?? "Europe/Moscow")
                    if !months.contains(model.query.month) { model.query.month = months[0] }
                }
        }
    }
}

struct AirportPicker: View {
    let airports: [Airport]
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    private var matches: [Airport] { airports.filter { text.isEmpty || $0.city.localizedCaseInsensitiveContains(text) || $0.iata.localizedCaseInsensitiveContains(text) || $0.name.localizedCaseInsensitiveContains(text) } }
    var body: some View {
        NavigationStack {
            List(matches) { airport in
                Button { selection = airport.iata; dismiss() } label: {
                    VStack(alignment: .leading, spacing: 4) { Text(airport.label).font(.headline); Text(airport.name).font(.subheadline).foregroundStyle(.secondary) }.foregroundStyle(.primary).padding(.vertical, 4)
                }
            }.searchable(text: $text, prompt: "Город или IATA-код").navigationTitle("Аэропорт вылета")
                .toolbar { Button("Готово") { dismiss() } }
        }
    }
}
struct CreditsView: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView { Text(credits).textSelection(.enabled).padding(20) }.navigationTitle("Фотографии").toolbar { Button("Готово") { dismiss() } }
        }
    }
    private var credits: String {
        guard let url = Bundle.main.url(forResource: "credits", withExtension: "md"), let text = try? String(contentsOf: url, encoding: .utf8) else { return "Источники: Wikimedia Commons" }
        return text
    }
}
