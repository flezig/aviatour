import SwiftUI

@MainActor struct RouteCard: View {
    let offer: Offer
    let outbound: Bool
    @Environment(\.dynamicTypeSize) private var typeSize
    private var segments: [FlightSegment] { (outbound ? offer.outboundSegments : offer.inboundSegments) ?? [] }
    private var transfers: Int? { outbound ? offer.transfers : offer.returnTransfers }
    private var duration: Int? { outbound ? offer.durationTo : offer.durationBack }
    private var from: String { outbound ? offer.originCity : offer.city }
    private var to: String { outbound ? offer.city : offer.originCity }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Label(outbound ? "Туда" : "Обратно", systemImage: outbound ? "airplane.departure" : "airplane.arrival")
                    .font(.subheadline.bold()).foregroundStyle(Color.aviatorBlue)
                Spacer()
                if let duration { Text(Self.duration(duration) + " в пути").font(.caption).foregroundStyle(.secondary) }
            }
            Text(from + " → " + to).font(.title3.bold()).fixedSize(horizontal: false, vertical: true)
            if !segments.isEmpty {
                ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                    segmentView(segment)
                    if index + 1 < segments.count { connectionView(segment.connection(to: segments[index + 1])) }
                }
                Text("Время местное для каждого аэропорта").font(.caption).foregroundStyle(.secondary)
            } else {
                summary
            }
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 24))
            .accessibilityIdentifier(outbound ? "route.outbound" : "route.inbound")
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 16) {
            carrier(name: outbound ? offer.airlineLabel : "Обратный перевозчик не указан", flight: outbound ? offer.flightNumber : nil)
            endpoint(date: outbound ? offer.departureAt : offer.returnAt,
                     city: from, airport: outbound ? offer.originName : offer.destinationName,
                     code: outbound ? offer.originAirport : offer.destinationAirport,
                     zone: outbound ? offer.originTimezone : offer.destinationTimezone, estimated: false)
            endpoint(date: outbound ? offer.arrivalAt : offer.returnArrivalAt,
                     city: to, airport: outbound ? offer.destinationName : offer.originName,
                     code: outbound ? offer.destinationAirport : offer.originAirport,
                     zone: outbound ? offer.destinationTimezone : offer.originTimezone, estimated: true)
            VStack(alignment: .leading, spacing: 8) {
                Label(transfers.map { $0 == 0 ? "Без пересадок" : "Пересадок: \($0)" } ?? "Количество пересадок неизвестно",
                      systemImage: transfers == 0 ? "checkmark.circle" : "arrow.triangle.swap")
                    .font(.subheadline.bold())
                if transfers != 0 {
                    Text("Источник не сообщил аэропорты пересадок, время ожидания и перевозчиков отдельных участков. Полный маршрут уточните на Aviasales.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if outbound { Text("Указана авиакомпания из найденной цены. Фактический оператор каждого участка не подтверждён.").font(.caption).foregroundStyle(.secondary) }
            }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.systemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
            Text("Прилёт ≈ рассчитан по длительности. Время местное.").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func carrier(name: String, flight: String?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "airplane").foregroundStyle(Color.aviatorBlue).frame(width: 40, height: 40)
                .background(Color.aviatorBlue.opacity(0.08), in: Circle()).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(name).font(.headline).fixedSize(horizontal: false, vertical: true)
                if let flight { Text("Рейс \(flight)").font(.caption).foregroundStyle(.secondary) }
            }
        }
    }

    private func segmentView(_ segment: FlightSegment) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            carrier(name: segment.operatingAirline.map { "Выполняет: " + $0 } ?? "Фактический перевозчик не указан", flight: segment.flightNumber)
            if let marketing = segment.marketingAirline, marketing != segment.operatingAirline {
                Text("Продаёт рейс: " + marketing).font(.caption).foregroundStyle(.secondary)
            }
            Text(Self.duration(segment.durationMinutes) + " в полёте").font(.caption).foregroundStyle(.secondary)
            VStack(spacing: 0) {
                endpoint(date: segment.departureAt, city: segment.originCity, airport: segment.originName,
                         code: segment.originAirport, zone: segment.originTimezone, estimated: false)
                HStack { Rectangle().fill(Color.gray.opacity(0.35)).frame(width: 2, height: 24).padding(.leading, 6); Spacer() }.accessibilityHidden(true)
                endpoint(date: segment.arrivalAt, city: segment.destinationCity, airport: segment.destinationName,
                         code: segment.destinationAirport, zone: segment.destinationTimezone, estimated: false)
            }
        }
    }

    private func endpoint(date: Date?, city: String, airport: String, code: String, zone: String, estimated: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Circle().stroke(Color.gray, lineWidth: 3).frame(width: 14, height: 14).padding(.top, 5).accessibilityHidden(true)
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 8) {
                    time(date, zone: zone, estimated: estimated)
                    place(city: city, airport: airport, code: code)
                }
            } else {
                HStack(alignment: .top, spacing: 14) {
                    time(date, zone: zone, estimated: estimated).frame(width: 82, alignment: .leading)
                    place(city: city, airport: airport, code: code).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private func time(_ date: Date?, zone: String, estimated: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(date.map { (estimated ? "≈ " : "") + TravelDates.time($0, zone: zone) } ?? "—").font(.title3.bold())
            if let date { Text(TravelDates.display(date, zone: zone)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            else { Text("Время не указано").font(.caption).foregroundStyle(.secondary) }
        }
    }

    private func place(city: String, airport: String, code: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(city).font(.headline).fixedSize(horizontal: false, vertical: true)
            Text(airport + ", " + code).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func connectionView(_ connection: FlightConnection) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Пересадка: " + connection.arrival.destinationCity, systemImage: "arrow.triangle.swap").font(.headline)
            Text("Ожидание " + Self.duration(connection.minutes)).font(.subheadline)
            if connection.changesAirport {
                Label("Смена аэропорта: \(connection.arrival.destinationAirport) → \(connection.departure.originAirport)", systemImage: "figure.walk")
                    .font(.subheadline.bold()).foregroundStyle(.orange)
                Text("Проверьте время на дорогу и получение багажа.").font(.caption).foregroundStyle(.secondary)
            }
            if connection.crossesLocalDate {
                Label("Следующий вылет в другой день", systemImage: "moon.stars").font(.subheadline).foregroundStyle(Color.aviatorBlue)
            }
        }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.systemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private static func duration(_ minutes: Int) -> String {
        let days = minutes / 1440, hours = (minutes % 1440) / 60, rest = minutes % 60
        return (days > 0 ? "\(days) д " : "") + (hours > 0 ? "\(hours) ч " : "") + "\(rest) мин"
    }
}
