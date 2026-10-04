import XCTest
final class AviatorUITests: XCTestCase {
    func testMockJourney() {
        let app = XCUIApplication();app.launchArguments=["--ui-smoke"];app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout:5))
        app.buttons["searchButton"].tap()
        let card=app.buttons["offer.LED"]
        // SwiftUI NavigationLink can expose either link or button depending on SDK.
        let destination=app.descendants(matching:.any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.LED.")).firstMatch
        XCTAssertTrue(destination.waitForExistence(timeout:5));destination.tap()
        XCTAssertTrue(app.buttons["aviasalesButton"].waitForExistence(timeout:5))
        app.buttons["favorite.LED"].tap()
        app.tabBars.buttons["Избранное"].tap()
        XCTAssertTrue(app.descendants(matching:.any)["saved.LED"].waitForExistence(timeout:5))
        _ = card
    }
    func testAccessibilityTextJourney() {
        let app=XCUIApplication();app.launchArguments=["--ui-smoke","-UIPreferredContentSizeCategoryName","UICTContentSizeCategoryAccessibilityXXXL"];app.launch()
        let search=app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        XCTAssertTrue(search.isHittable);search.tap()
        XCTAssertTrue(app.descendants(matching:.any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.LED.")).firstMatch.waitForExistence(timeout:5))
    }
    func testExactDatesFiltersAndFlightDetails() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 10))
        for _ in 0..<4 where !app.buttons["Конкретные даты"].isHittable { app.swipeUp() }
        app.buttons["Конкретные даты"].tap()
        XCTAssertTrue(app.datePickers["departureDatePicker"].exists)
        XCTAssertTrue(app.datePickers["returnDatePicker"].exists)
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        XCTAssertTrue(app.buttons["allFiltersButton"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["21 вариант"].exists)
        app.buttons["allFiltersButton"].tap()
        XCTAssertTrue(app.textFields["minPriceFilter"].waitForExistence(timeout: 5))
        app.textFields["minPriceFilter"].tap(); app.textFields["minPriceFilter"].typeText("9000")
        app.buttons["Готово"].tap()
        let count = app.staticTexts["20 вариантов"]
        XCTAssertTrue(count.waitForExistence(timeout: 5))
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.LED.")).firstMatch
        XCTAssertTrue(card.exists); card.tap()
        XCTAssertTrue(app.descendants(matching: .any)["route.outbound"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Выполняет: Aeroflot · DEMO"].firstMatch.exists)
    }

    func testTransferItinerary() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 10))
        let budget = app.sliders["Бюджет в рублях"]
        for _ in 0..<4 where !budget.isHittable { app.swipeUp() }
        budget.adjust(toNormalizedSliderPosition: 0.1)
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        let card = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "offer.TBS.")).firstMatch
        XCTAssertTrue(app.buttons["allFiltersButton"].waitForExistence(timeout: 5))
        for _ in 0..<12 where !card.exists || !card.isHittable { app.swipeUp() }
        XCTAssertTrue(card.exists)
        card.tap()
        let connection = app.staticTexts["Пересадка: Ереван"]
        for _ in 0..<6 where !connection.firstMatch.isHittable { app.swipeUp() }
        XCTAssertTrue(connection.firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Ожидание 45 мин"].firstMatch.exists)
        XCTAssertTrue(app.staticTexts["Выполняет: S7 Airlines · DEMO"].firstMatch.exists)
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = "Подробная пересадка"; image.lifetime = .keepAlways; add(image)
    }

    func testRegionalSearchAndPriceSort() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        let region = app.buttons["regionPicker"]
        XCTAssertTrue(region.waitForExistence(timeout: 10)); region.tap()
        app.buttons["Поездка в США"].tap()
        app.buttons["destinationPicker"].tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("JFK")
        XCTAssertTrue(app.buttons["airport.JFK"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["airport.CDG"].exists)
        app.buttons["airport.JFK"].tap()
        let budget = app.sliders["Бюджет в рублях"]
        for _ in 0..<4 where !budget.isHittable { app.swipeUp() }
        budget.adjust(toNormalizedSliderPosition: 0.3)
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        XCTAssertTrue(app.staticTexts["3 варианта"].waitForExistence(timeout: 10))
        let price = app.segmentedControls["priceSort"]
        XCTAssertTrue(price.exists); price.buttons["Сначала дороже"].tap()
        XCTAssertTrue(price.buttons["Сначала дороже"].isSelected)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "США и сортировка по цене"; screenshot.lifetime = .keepAlways; add(screenshot)
    }

    func testCityAndDestinationCatalogSearch() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-smoke"]; app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout: 10))
        app.buttons["originPicker"].tap()
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("MOW")
        let city = app.buttons["originCity.MOW"]
        XCTAssertTrue(city.waitForExistence(timeout: 5)); city.tap()
        XCTAssertTrue(app.staticTexts["Москва · все аэропорты"].waitForExistence(timeout: 5))
        app.buttons["destinationPicker"].tap()
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("LED")
        let airport = app.buttons["airport.LED"]
        XCTAssertTrue(airport.waitForExistence(timeout: 5))
        let pickerImage = XCTAttachment(screenshot: app.screenshot()); pickerImage.name = "Выбор направления"; pickerImage.lifetime = .keepAlways; add(pickerImage)
        airport.tap()
        let search = app.buttons["searchButton"]
        for _ in 0..<4 where !search.isHittable { app.swipeUp() }
        search.tap()
        XCTAssertTrue(app.staticTexts["3 варианта"].waitForExistence(timeout: 5))
        let resultsImage = XCTAttachment(screenshot: app.screenshot()); resultsImage.name = "Варианты поездок"; resultsImage.lifetime = .keepAlways; add(resultsImage)
    }

}
