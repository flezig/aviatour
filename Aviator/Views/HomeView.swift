import SwiftUI

@MainActor struct HomeView: View {
    @ObservedObject var model: SearchViewModel
    @ObservedObject var favorites: FavoritesViewModel
    let airports: [Airport]
    let airportIndex: AirportIndex
    let mode: String
    let analytics: any AnalyticsService
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var chooseAirport = false
    @State private var chooseDestination = false
    @State private var showResults = false
    @State private var showCredits = false
    private var airport: Airport? { airportIndex.byIATA[model.query.origin] }
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
                                VStack(alignment: .leading, spacing: 4) { Text("Откуда").font(.caption).foregroundStyle(.secondary); Text(model.query.originCityCode == nil ? (airport?.label ?? model.query.origin) : "\(airport?.city ?? model.query.origin) · все аэропорты").font(.headline) }
                                Spacer(); Image(systemName: "chevron.down")
                            }.foregroundStyle(.primary).frame(minHeight: 44)
                        }.accessibilityIdentifier("originPicker")
                        Divider()
                        Picker("Направление поездки", selection: $model.query.region) {
                            ForEach(TripRegion.allCases) { Text($0.title).tag($0) }
                        }.pickerStyle(.menu).accessibilityIdentifier("regionPicker")
                        if model.query.region != .any {
                            Text("Поиск по основным городам. Можно выбрать конкретный город ниже.").font(.caption).foregroundStyle(.secondary)
                        }
                        HStack {
                            Button { chooseDestination = true } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Куда").font(.caption).foregroundStyle(.secondary)
                                    Text(destinationLabel).font(.headline)
                                }.frame(maxWidth: .infinity, alignment: .leading).frame(minHeight: 44)
                            }.buttonStyle(.plain).accessibilityIdentifier("destinationPicker")
                            if model.query.destination != nil {
                                Button { model.query.destination = nil; model.query.destinationCityCode = nil } label: { Image(systemName: "xmark.circle.fill") }
                                    .frame(width: 44, height: 44).accessibilityLabel("Искать все направления")
                            }
                        }
                        Divider()
                        Picker("Выбор дат", selection: exactDates) {
                            Text("Месяц").tag(false)
                            Text("Конкретные даты").tag(true)
                        }.pickerStyle(.segmented).accessibilityIdentifier("dateMode")
                        if model.query.usesExactDates {
                            DatePicker("Туда", selection: dateBinding(returning: false), in: departureRange, displayedComponents: .date)
                                .accessibilityIdentifier("departureDatePicker")
                            DatePicker("Обратно", selection: dateBinding(returning: true), in: returnRange, displayedComponents: .date)
                                .accessibilityIdentifier("returnDatePicker")
                            Text("Даты вылета по местному времени каждого аэропорта").font(.caption).foregroundStyle(.secondary)
                        } else {
                            Picker("Когда", selection: $model.query.month) {
                                ForEach(TravelDates.months(now: model.clock.now, zone: zone), id: \.self) { month in
                                    Text(TravelDates.monthLabel(month)).tag(month)
                                }
                            }.pickerStyle(.menu).accessibilityIdentifier("monthPicker")
                            Toggle("Только короткие выходные", isOn: $model.query.weekendOnly)
                        }
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Бюджет").font(.caption).foregroundStyle(.secondary)
                            Text(Money.format(model.query.maxBudgetMinor)).font(.title.bold()).accessibilityIdentifier("budgetValue")
                            Slider(value: Binding(get: { Double(model.query.maxBudgetMinor / 100) }, set: { model.query.maxBudgetMinor = Int($0) * 100 }), in: 5000...500000, step: 1000).accessibilityLabel("Бюджет в рублях")
                            Text("Билеты туда-обратно на одного").font(.footnote).foregroundStyle(.secondary)
                        }
                        DisclosureGroup("Условия полного бюджета") {
                            Stepper("Взрослых: \(model.query.tripPreferences.travelers)", value: $model.query.tripPreferences.travelers, in: 1...8)
                            Picker("Проживание", selection: $model.query.tripPreferences.housing) {
                                Text("Бюджетное").tag("budget"); Text("Стандарт").tag("standard"); Text("Комфорт").tag("comfort")
                            }
                            Picker("Питание", selection: $model.query.tripPreferences.food) {
                                Text("Продукты").tag("groceries"); Text("Продукты и кафе").tag("mixed"); Text("Рестораны").tag("restaurants")
                            }
                            Toggle("Ограничить полный бюджет на человека", isOn: Binding(get: { model.query.tripPreferences.fullBudgetMinor != nil }, set: { model.query.tripPreferences.fullBudgetMinor = $0 ? 10_000_000 : nil })).accessibilityIdentifier("fullBudgetToggle")
                            if let limit = model.query.tripPreferences.fullBudgetMinor {
                                Text("Перелёт + жильё + питание + транспорт: " + Money.format(limit))
                                Slider(value: Binding(get: { Double(model.query.tripPreferences.fullBudgetMinor ?? 10_000_000) / 100 }, set: { model.query.tripPreferences.fullBudgetMinor = Int($0) * 100 }), in: 1000...1000000, step: 1000)
                                Text("Поездки с неизвестным полным бюджетом будут исключены. Данные доступны пока не для всех направлений.").font(.caption).foregroundStyle(.secondary)
                            }
                            Text("Билеты ищутся для одного взрослого. Полный бюджет на человека — оценка для группы с общим жильём.").font(.caption).foregroundStyle(.secondary)
                        }
                        Toggle("Только прямые рейсы", isOn: $model.query.directOnly).accessibilityIdentifier("directToggle")
                        PrimaryButton(title: "Найти варианты →") { model.start(); showResults = true }.disabled(model.state == .loading).accessibilityIdentifier("searchButton")
                    }.padding(20).background(.white, in: RoundedRectangle(cornerRadius: 24)).shadow(color: .black.opacity(0.08), radius: 18, y: 6).padding(.horizontal, 20).padding(.top, -24)
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Больше поездки — меньше дороги", systemImage: "sun.max").font(.headline)
                        Text("Aviator сравнивает не только цену билета, но и время в пункте назначения. Найдите выезд без отпуска или лучший бюджет за час поездки.").font(.footnote).foregroundStyle(.secondary)
                        Button("Источники фотографий") { showCredits = true }.font(.footnote).frame(minHeight: 44)
                    }.padding(24)
                }
            }.background(Color(.systemGroupedBackground)).toolbar(.hidden, for: .navigationBar)
                .navigationDestination(isPresented: $showResults) { ResultsView(model: model, favorites: favorites, analytics: analytics) }
                .sheet(isPresented: $chooseAirport) { AirportPicker(index: airportIndex, selection: $model.query.origin, citySelection: $model.query.originCityCode) }
                .sheet(isPresented: $chooseDestination) {
                    AirportPicker(index: AirportIndex(airports: airports.filter { model.query.region.includes($0.countryCode) }), selection: Binding(get: { model.query.destination ?? "LED" }, set: { model.query.destination = $0 }), citySelection: $model.query.destinationCityCode, title: "Куда летим")
                }
                .environment(\.timeZone, TravelDates.calendar(zone).timeZone)
                .sheet(isPresented: $showCredits) { CreditsView() }
                .onChange(of: model.query.region) { _, region in
                    if let code = model.query.destination, !region.includes(airportIndex.byIATA[code]?.countryCode) {
                        model.query.destination = nil; model.query.destinationCityCode = nil
                    }
                    if region != .any { model.query.weekendOnly = false }
                }
                .onChange(of: model.query.origin) { _, _ in
                    let months = TravelDates.months(now: model.clock.now, zone: airport?.timezone ?? "Europe/Moscow")
                    if !model.query.usesExactDates && !months.contains(model.query.month) { model.query.month = months[0] }
                }
        }
    }
    private var zone: String { airport?.timezone ?? "Europe/Moscow" }
    private var destinationLabel: String {
        guard let code = model.query.destination else { return model.query.region == .any ? "Куда угодно" : "Все основные города" }
        let selected = airportIndex.byIATA[code]
        return model.query.destinationCityCode == nil ? (selected?.label ?? code) : "\(selected?.city ?? code) · все аэропорты"
    }
    private var exactDates: Binding<Bool> {
        Binding(get: { model.query.usesExactDates }, set: { enabled in
            if enabled {
                let calendar = TravelDates.calendar(zone)
                let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: model.clock.now))!
                model.query.departureDate = TravelDates.dateKey(tomorrow, zone: zone)
                model.query.returnDate = TravelDates.dateKey(calendar.date(byAdding: .day, value: 2, to: tomorrow)!, zone: zone)
                model.query.month = TravelDates.month(tomorrow, zone: zone)
            } else { model.query.departureDate = nil; model.query.returnDate = nil }
        })
    }
    private var departureRange: ClosedRange<Date> {
        let calendar = TravelDates.calendar(zone)
        let first = calendar.startOfDay(for: model.clock.now)
        let month = calendar.date(from: calendar.dateComponents([.year, .month], from: first))!
        let end = calendar.date(byAdding: .day, value: -1, to: calendar.date(byAdding: .month, value: 6, to: month)!)!
        return first...end
    }
    private var returnRange: ClosedRange<Date> {
        let calendar = TravelDates.calendar(zone)
        let departure = TravelDates.parseDay(model.query.departureDate ?? "", zone: zone) ?? departureRange.lowerBound
        return calendar.date(byAdding: .day, value: 1, to: departure)!...calendar.date(byAdding: .day, value: 60, to: departure)!
    }
    private func dateBinding(returning: Bool) -> Binding<Date> {
        Binding(get: {
            TravelDates.parseDay((returning ? model.query.returnDate : model.query.departureDate) ?? "", zone: zone)
                ?? (returning ? returnRange.lowerBound : departureRange.lowerBound)
        }, set: { date in
            let key = TravelDates.dateKey(date, zone: zone)
            if returning { model.query.returnDate = key }
            else {
                model.query.departureDate = key; model.query.month = String(key.prefix(7))
                let oldReturn = TravelDates.parseDay(model.query.returnDate ?? "", zone: zone) ?? returnRange.lowerBound
                let clamped = min(max(oldReturn, returnRange.lowerBound), returnRange.upperBound)
                model.query.returnDate = TravelDates.dateKey(clamped, zone: zone)
            }
        })
    }

}

struct AirportPicker: View {
    let index: AirportIndex
    let title: String
    @Binding var selection: String
    @Binding var citySelection: String?
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var rows: [AirportIndex.Row]

    init(index: AirportIndex, selection: Binding<String>, citySelection: Binding<String?>, title: String = "Откуда летим") {
        self.index = index
        self.title = title
        _selection = selection
        _citySelection = citySelection
        _rows = State(initialValue: index.rows)
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(rows) { row in
                        AirportPickerRow(row: row, selection: $selection, citySelection: $citySelection)
                    }
                }
                if rows.isEmpty { ContentUnavailableView.search(text: text) }
            }.onChange(of: text) { _, value in rows = AirportIndex.rows(for: index.matching(value)) }
                .searchable(text: $text, prompt: "Город или IATA-код").navigationTitle(title)
                .toolbar { Button("Готово") { dismiss() } }
        }
    }
}

// One stable row per lazy child avoids disappearing nested ForEach content after search.
private struct AirportPickerRow: View {
    let row: AirportIndex.Row
    @Binding var selection: String
    @Binding var citySelection: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch row.kind {
            case .header(let city):
                Text(city.name).font(.headline).padding(.horizontal, 20).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemGroupedBackground)).accessibilityAddTraits(.isHeader)
            case .city(let city):
                Button { selection = city.representative.iata; citySelection = city.id; dismiss() } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Все аэропорты города").font(.headline)
                        Text(city.codes).font(.caption).foregroundStyle(.secondary)
                    }.foregroundStyle(.primary).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 20).padding(.vertical, 12).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("originCity.\(city.id)")
                Divider()
            case .airport(let airport):
                Button { selection = airport.iata; citySelection = nil; dismiss() } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(airport.label).font(.headline)
                        Text(airport.name).font(.subheadline).foregroundStyle(.secondary)
                    }.foregroundStyle(.primary).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 20).padding(.vertical, 8).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("airport.\(airport.iata)")
                Divider()
            }
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
