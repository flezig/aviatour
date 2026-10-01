import XCTest
final class AviatorUITests: XCTestCase {
    func testMockJourney() {
        let app = XCUIApplication();app.launchArguments=["--ui-smoke"];app.launch()
        XCTAssertTrue(app.buttons["originPicker"].waitForExistence(timeout:5))
        app.buttons["searchButton"].tap()
        let card=app.buttons["offer.LED"]
        // SwiftUI NavigationLink can expose either link or button depending on SDK.
        let destination=app.descendants(matching:.any)["offer.LED"]
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
        XCTAssertTrue(app.descendants(matching:.any)["offer.LED"].waitForExistence(timeout:5))
    }
}
