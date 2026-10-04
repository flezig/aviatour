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
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Авиакомпания по данным источника:")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Прилёт туда ≈")).firstMatch.exists)
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
