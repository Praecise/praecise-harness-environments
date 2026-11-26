// The computer control helper for macOS. PROTOCOL.md says what it answers.
//
// Elements are read through the Accessibility API and a window is pictured through
// ScreenCaptureKit. An element is pressed by its own accessibility action, which moves
// no pointer and brings nothing to the front. Pointer and key events are posted to the
// app's process and to nothing else; an app that ignores events posted that way is not
// reached another way.
//
// Only public API is used.

import AppKit
import ApplicationServices
import Foundation
import ScreenCaptureKit

struct Failure: Error { let message: String }
func fail<T>(_ message: String) throws -> T { throw Failure(message: message) }

// MARK: Accessibility

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func text(_ element: AXUIElement, _ name: String) -> String? {
  guard let value = attribute(element, name) else { return nil }
  if let string = value as? String { return string.trimmingCharacters(in: .whitespacesAndNewlines) }
  if let number = value as? NSNumber { return number.stringValue }
  return nil
}
func flag(_ element: AXUIElement, _ name: String) -> Bool? { (attribute(element, name) as? NSNumber)?.boolValue }
func children(_ element: AXUIElement) -> [AXUIElement] { (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func frame(_ element: AXUIElement) -> CGRect? {
  guard let at = attribute(element, kAXPositionAttribute), let size = attribute(element, kAXSizeAttribute),
    CFGetTypeID(at) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
  else { return nil }
  var origin = CGPoint.zero
  var extent = CGSize.zero
  guard AXValueGetValue(at as! AXValue, .cgPoint, &origin), AXValueGetValue(size as! AXValue, .cgSize, &extent) else { return nil }
  return CGRect(origin: origin, size: extent)
}
func actions(_ element: AXUIElement) -> [String] {
  var names: CFArray?
  return AXUIElementCopyActionNames(element, &names) == .success ? (names as? [String]) ?? [] : []
}

/// The system's roles in the one vocabulary the protocol asks for.
let ROLES: [String: String] = [
  "AXButton": "button", "AXMenuButton": "button", "AXDisclosureTriangle": "button", "AXColorWell": "button",
  "AXLink": "link", "AXTextField": "textbox", "AXTextArea": "textbox", "AXDateField": "textbox",
  "AXComboBox": "combobox", "AXPopUpButton": "combobox", "AXCheckBox": "checkbox", "AXRadioButton": "radio",
  "AXSlider": "slider", "AXIncrementor": "spinbutton", "AXMenuItem": "menuitem", "AXMenuBarItem": "menuitem",
  "AXStaticText": "text", "AXHeading": "heading", "AXImage": "image", "AXRow": "row", "AXCell": "cell",
  "AXWindow": "window", "AXSheet": "dialog", "AXDialog": "dialog", "AXTabGroup": "tablist", "AXList": "list",
  "AXOutline": "tree", "AXTable": "table", "AXToolbar": "toolbar", "AXWebArea": "page", "AXMenu": "menu",
  "AXMenuBar": "menubar", "AXRadioGroup": "radiogroup", "AXProgressIndicator": "progressbar",
]
/// Roles that say only how a window is laid out. Unnamed, they are left out and what is in them is kept.
let LAYOUT: Set<String> = ["AXGroup", "AXScrollArea", "AXSplitGroup", "AXLayoutArea", "AXLayoutItem", "AXUnknown", "AXColumn", "AXGenericElement"]
/// Roles that are furniture of a scroll area or a split, and are never listed.
let FURNITURE: Set<String> = ["AXScrollBar", "AXSplitter", "AXGrowArea", "AXValueIndicator", "AXHandle", "AXRuler"]
let WORKED: Set<String> = ["button", "link", "textbox", "searchbox", "combobox", "checkbox", "switch", "radio", "tab", "slider", "spinbutton", "menuitem"]
let TYPED: Set<String> = ["textbox", "searchbox", "combobox"]

let WINDOW_BUTTONS: [String: String] = ["AXCloseButton": "Close", "AXMinimizeButton": "Minimize", "AXZoomButton": "Zoom", "AXFullScreenButton": "Full screen", "AXToolbarButton": "Toolbar"]

func role(_ element: AXUIElement) -> (system: String, said: String) {
  let system = text(element, kAXRoleAttribute) ?? "AXUnknown"
  let sub = text(element, kAXSubroleAttribute) ?? ""
  if sub == "AXSearchField" { return (system, "searchbox") }
  if sub == "AXSwitch" || sub == "AXToggle" { return (system, "switch") }
  if sub == "AXTabButton" { return (system, "tab") }
  if sub == "AXSecureTextField" { return (system, "textbox") }
  return (system, ROLES[system] ?? String(system.dropFirst(system.hasPrefix("AX") ? 2 : 0)).lowercased())
}
func name(_ element: AXUIElement, _ said: String) -> String {
  if said == "text" { return text(element, kAXValueAttribute) ?? text(element, kAXTitleAttribute) ?? "" }
  for each in [kAXTitleAttribute, kAXDescriptionAttribute] {
    if let found = text(element, each), !found.isEmpty { return found }
  }
  if let titled = attribute(element, kAXTitleUIElementAttribute), CFGetTypeID(titled) == AXUIElementGetTypeID() {
    let label = titled as! AXUIElement
    if let found = text(label, kAXValueAttribute) ?? text(label, kAXTitleAttribute), !found.isEmpty { return found }
  }
  if let placeholder = text(element, kAXPlaceholderValueAttribute), !placeholder.isEmpty { return placeholder }
  // A window's own buttons carry no title, only what each is for.
  return WINDOW_BUTTONS[text(element, kAXSubroleAttribute) ?? ""] ?? ""
}

// MARK: References

struct Held: Hashable {
  let element: AXUIElement
  static func == (a: Held, b: Held) -> Bool { CFEqual(a.element, b.element) }
  func hash(into hasher: inout Hasher) { hasher.combine(CFHash(element)) }
}
struct Known { let element: AXUIElement; let app: String; let role: String; let name: String }
var refs: [String: Known] = [:]
var named: [Held: String] = [:]
var counted = 0

func ref(for element: AXUIElement, app: String, role: String, name: String) -> String {
  // A long session does not keep every element it ever saw: past this, everything is read afresh.
  if named.count > 50_000 { named.removeAll(); refs.removeAll() }
  let held = Held(element: element)
  let ref: String
  if let had = named[held] { ref = had } else { counted += 1; ref = "e\(counted)"; named[held] = ref }
  refs[ref] = Known(element: element, app: app, role: role, name: name)
  return ref
}

// MARK: Apps and windows

struct Target { let id: String; let pid: pid_t; let app: AXUIElement; let window: AXUIElement; let frame: CGRect }

func running(_ id: String) -> NSRunningApplication? {
  NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == id && !$0.isTerminated }
}

func target(_ params: [String: Any]) throws -> Target {
  guard let id = params["app"] as? String, !id.isEmpty else { return try fail("`app` is the app's id, from `apps`") }
  guard AXIsProcessTrusted() else { return try fail("Accessibility is not allowed for this program; allow it in System Settings, Privacy & Security, Accessibility") }
  guard let process = running(id) else { return try fail("\(id) is not running; open it first") }
  let app = AXUIElementCreateApplication(process.processIdentifier)
  AXUIElementSetMessagingTimeout(app, 3)
  let found = (attribute(app, kAXMainWindowAttribute) ?? attribute(app, kAXFocusedWindowAttribute)).flatMap { CFGetTypeID($0) == AXUIElementGetTypeID() ? ($0 as! AXUIElement) : nil }
  let listed = (attribute(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
  guard let window = found ?? listed.first, let box = frame(window), box.width >= 1, box.height >= 1 else {
    return try fail("\(process.localizedName ?? id) has no window; open one first")
  }
  return Target(id: id, pid: process.processIdentifier, app: app, window: window, frame: box)
}

func states(_ element: AXUIElement, _ said: String) -> [String] {
  var states: [String] = []
  // Only of something that is worked: a pane that is not enabled or not expanded says nothing an agent can use.
  let worked = WORKED.contains(said) || ["row", "treeitem", "option", "cell"].contains(said)
  if worked, flag(element, kAXEnabledAttribute) == false { states.append("disabled") }
  if flag(element, kAXFocusedAttribute) == true { states.append("focused") }
  if ["checkbox", "switch", "radio", "tab"].contains(said), let value = attribute(element, kAXValueAttribute) as? NSNumber {
    if value.intValue == 1 { states.append(said == "tab" ? "selected" : "checked") } else if value.intValue == 2 { states.append("partly checked") }
  }
  if flag(element, kAXSelectedAttribute) == true, !states.contains("selected") { states.append("selected") }
  if worked, let expanded = flag(element, kAXExpandedAttribute) { states.append(expanded ? "expanded" : "collapsed") }
  return states
}

func describe(_ element: AXUIElement, in target: Target) -> [String: Any] {
  let (_, said) = role(element)
  let called = name(element, said)
  var out: [String: Any] = ["ref": ref(for: element, app: target.id, role: said, name: called), "role": said]
  if !called.isEmpty { out["name"] = called }
  if said != "text", !["checkbox", "switch", "radio", "tab"].contains(said), let value = text(element, kAXValueAttribute), !value.isEmpty, value != called {
    out["value"] = String(value.prefix(2_000))
  }
  let held = states(element, said)
  if !held.isEmpty { out["states"] = held }
  if let box = frame(element) {
    out["box"] = ["x": box.minX - target.frame.minX, "y": box.minY - target.frame.minY, "width": box.width, "height": box.height]
  }
  return out
}

/// The most elements one reading visits, so a window with an endless table is still answered.
let VISITS = 6_000

func read(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  let interactive = params["filter"] as? String == "interactive"
  let depth = (params["depth"] as? NSNumber)?.intValue
  var root = target.window
  if let from = params["ref"] as? String {
    guard let known = refs[from], known.app == target.id else { return try fail("\(from) is not a reference this window has given; read it again") }
    root = try live(from, in: target)
  }
  var visits = 0
  var flat: [[String: Any]] = []

  func walk(_ element: AXUIElement, _ level: Int, _ within: String) -> [[String: Any]] {
    visits += 1
    if visits > VISITS { return [] }
    let (system, said) = role(element)
    if FURNITURE.contains(system) { return [] }
    let called = name(element, said)
    // A button named for its label holds that label again inside it; once is enough.
    if said == "text", !within.isEmpty, within.contains(called) { return [] }
    let kept = !(LAYOUT.contains(system) && called.isEmpty) && !(said == "text" && called.isEmpty)
    func below(_ next: Int, _ inside: String) -> [[String: Any]] { children(element).flatMap { walk($0, next, inside) } }
    if !kept { return below(level, within) }
    var out = describe(element, in: target)
    if interactive {
      if WORKED.contains(said) { flat.append(out) }
      _ = below(level + 1, called)
      return []
    }
    if depth == nil || level < depth! {
      let inside = below(level + 1, said == "window" ? "" : called)
      if !inside.isEmpty { out["children"] = inside }
    }
    return [out]
  }
  let tree = walk(root, 1, "")
  return interactive ? flat : tree
}

/// The element a reference names, as it is now. One that has gone or become something else is refused.
func live(_ ref: String, in target: Target) throws -> AXUIElement {
  guard let known = refs[ref], known.app == target.id else { return try fail("\(ref) is not a reference this window has given; read it again") }
  var value: CFTypeRef?
  let answered = AXUIElementCopyAttributeValue(known.element, kAXRoleAttribute as CFString, &value)
  guard answered == .success else { return try fail("\(ref) is no longer in the window; read it again") }
  let (_, said) = role(known.element)
  let called = name(known.element, said)
  guard said == known.role, called == known.name else {
    return try fail("\(ref) is no longer in the window (it is now \(said)\(called.isEmpty ? "" : " \"\(called)\"")); read it again")
  }
  return known.element
}

func locate(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  guard let ref = params["ref"] as? String else { return try fail("`ref` is the element") }
  let element = try live(ref, in: target)
  if actions(element).contains("AXScrollToVisible") { AXUIElementPerformAction(element, "AXScrollToVisible" as CFString) }
  let out = describe(element, in: target)
  guard let box = frame(element), box.width >= 1, box.height >= 1, out["box"] != nil else { return try fail("\(ref) takes up no room in the window; read it again") }
  return out
}

func activate(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  guard let ref = params["ref"] as? String else { return try fail("`ref` is the element") }
  let element = try live(ref, in: target)
  if flag(element, kAXEnabledAttribute) == false { return try fail("\(ref) is disabled") }
  let can = actions(element)
  if can.contains(kAXPressAction as String) {
    let did = AXUIElementPerformAction(element, kAXPressAction as CFString)
    // An app that opens a sheet in answer may not reply in time, and has still been pressed.
    guard did == .success || did == .cannotComplete else { return try fail("\(ref) could not be pressed (\(did.rawValue))") }
    return NSNull()
  }
  var settable: DarwinBoolean = false
  if AXUIElementIsAttributeSettable(element, kAXFocusedAttribute as CFString, &settable) == .success, settable.boolValue {
    guard AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else { return try fail("\(ref) could not be given the focus") }
    return NSNull()
  }
  return try fail("\(ref) cannot be pressed without the pointer; click where it is")
}

func fill(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  guard let ref = params["ref"] as? String, let value = params["value"] as? String else { return try fail("`ref` is the field and `value` what it should hold") }
  let element = try live(ref, in: target)
  let (_, said) = role(element)
  guard TYPED.contains(said) else { return try fail("\(ref) is a \(said), which is not typed into; press it and choose") }
  if flag(element, kAXEnabledAttribute) == false { return try fail("\(ref) is disabled") }
  var settable: DarwinBoolean = false
  guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success, settable.boolValue else {
    return try fail("\(ref) does not take a value directly; click it and type")
  }
  guard AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString) == .success else { return try fail("\(ref) refused the value") }
  return NSNull()
}

// MARK: Pictures

func wait<T>(_ work: @escaping () async throws -> T) throws -> T {
  let done = DispatchSemaphore(value: 0)
  var result: Result<T, Error> = .failure(Failure(message: "no answer"))
  Task.detached {
    do { result = .success(try await work()) } catch { result = .failure(error) }
    done.signal()
  }
  done.wait()
  return try result.get()
}

func screenshot(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  guard CGPreflightScreenCaptureAccess() else { return try fail("Screen Recording is not allowed for this program; allow it in System Settings, Privacy & Security, Screen & System Audio Recording") }
  let width = Int(target.frame.width.rounded())
  let height = Int(target.frame.height.rounded())
  let image: CGImage = try wait {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let mine = content.windows.filter { $0.owningApplication?.processID == target.pid && $0.windowLayer == 0 }
    let near = mine.first { abs($0.frame.minX - target.frame.minX) < 2 && abs($0.frame.minY - target.frame.minY) < 2 && abs($0.frame.width - target.frame.width) < 2 }
    guard let window = near else { throw Failure(message: "the window is not on the screen to be pictured; it may be minimised or on another desktop") }
    let setup = SCStreamConfiguration()
    setup.width = width
    setup.height = height
    setup.showsCursor = false
    return try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: setup)
  }
  var shown = image
  if let region = params["region"] as? [String: Any],
    let x = (region["x"] as? NSNumber)?.doubleValue, let y = (region["y"] as? NSNumber)?.doubleValue,
    let w = (region["width"] as? NSNumber)?.doubleValue, let h = (region["height"] as? NSNumber)?.doubleValue, w >= 1, h >= 1
  {
    let sx = Double(image.width) / Double(width)
    let sy = Double(image.height) / Double(height)
    guard let part = image.cropping(to: CGRect(x: x * sx, y: y * sy, width: w * sx, height: h * sy)) else { return try fail("that region has no area in the window") }
    // Enlarged to fill the window's own size, and no further than is still a picture of something.
    let scale = max(1, min(4, Double(width) / w, Double(height) / h))
    let (ow, oh) = (Int(w * scale), Int(h * scale))
    guard let context = CGContext(data: nil, width: ow, height: oh, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
      return try fail("the region could not be enlarged")
    }
    context.interpolationQuality = .high
    context.draw(part, in: CGRect(x: 0, y: 0, width: ow, height: oh))
    guard let made = context.makeImage() else { return try fail("the region could not be enlarged") }
    shown = made
  }
  guard let png = NSBitmapImageRep(cgImage: shown).representation(using: .png, properties: [:]) else { return try fail("the picture could not be written") }
  return ["mime": "image/png", "data": png.base64EncodedString(), "name": params["region"] == nil ? "screenshot.png" : "zoom.png"]
}

// MARK: Pointer and keys, posted to the app's process only

var pointer: [String: CGPoint] = [:]

func point(_ value: Any?, in target: Target) throws -> CGPoint {
  guard let given = value as? [String: Any], let x = (given["x"] as? NSNumber)?.doubleValue, let y = (given["y"] as? NSNumber)?.doubleValue else { return try fail("a position is { x, y } in pixels of the window") }
  guard x >= 0, y >= 0, x < target.frame.width, y < target.frame.height else { return try fail("[\(Int(x)), \(Int(y))] is outside the window") }
  pointer[target.id] = CGPoint(x: x, y: y)
  return CGPoint(x: target.frame.minX + x, y: target.frame.minY + y)
}

let HELD: [String: CGEventFlags] = [
  "shift": .maskShift, "ctrl": .maskControl, "control": .maskControl, "alt": .maskAlternate, "option": .maskAlternate,
  "cmd": .maskCommand, "command": .maskCommand, "super": .maskCommand, "meta": .maskCommand,
]
func flags(_ value: Any?) throws -> CGEventFlags {
  var out: CGEventFlags = []
  for each in (value as? [String]) ?? [] {
    guard let bit = HELD[each.lowercased()] else { return try fail("\"\(each)\" is not a key that can be held") }
    out.insert(bit)
  }
  return out
}

func mouse(_ type: CGEventType, _ at: CGPoint, _ button: CGMouseButton, _ held: CGEventFlags, clicks: Int64 = 1, to pid: pid_t) throws {
  guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: button) else { return try fail("the event could not be made") }
  event.flags = held
  event.setIntegerValueField(.mouseEventClickState, value: clicks)
  event.postToPid(pid)
}

func click(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  let at = try point(params["at"], in: target)
  let held = try flags(params["modifiers"])
  let which = params["button"] as? String ?? "left"
  let count = max(1, min(3, (params["count"] as? NSNumber)?.intValue ?? 1))
  let (down, up, button): (CGEventType, CGEventType, CGMouseButton) =
    which == "right" ? (.rightMouseDown, .rightMouseUp, .right) : which == "middle" ? (.otherMouseDown, .otherMouseUp, .center) : (.leftMouseDown, .leftMouseUp, .left)
  try mouse(.mouseMoved, at, button, held, to: target.pid)
  for nth in 1...count {
    try mouse(down, at, button, held, clicks: Int64(nth), to: target.pid)
    try mouse(up, at, button, held, clicks: Int64(nth), to: target.pid)
  }
  return NSNull()
}

func move(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  try mouse(.mouseMoved, try point(params["to"], in: target), .left, [], to: target.pid)
  return NSNull()
}

func drag(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  let from = try point(params["from"], in: target)
  let to = try point(params["to"], in: target)
  let held = try flags(params["modifiers"])
  try mouse(.leftMouseDown, from, .left, held, to: target.pid)
  // By way of the middle: an app that starts a drag on movement needs to see some.
  try mouse(.leftMouseDragged, CGPoint(x: (from.x + to.x) / 2, y: (from.y + to.y) / 2), .left, held, to: target.pid)
  try mouse(.leftMouseDragged, to, .left, held, to: target.pid)
  try mouse(.leftMouseUp, to, .left, held, to: target.pid)
  return NSNull()
}

func scroll(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  let at = try point(params["at"], in: target)
  let by = params["by"] as? [String: Any] ?? [:]
  let dx = Int32((by["dx"] as? NSNumber)?.intValue ?? 0)
  let dy = Int32((by["dy"] as? NSNumber)?.intValue ?? 0)
  guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: -dy, wheel2: -dx, wheel3: 0) else { return try fail("the event could not be made") }
  event.location = at
  event.flags = try flags(params["modifiers"])
  event.postToPid(target.pid)
  return NSNull()
}

/// Keys with a name, by the virtual key each is on every Mac keyboard.
let KEYS: [String: CGKeyCode] = [
  "return": 36, "enter": 36, "kp_enter": 76, "tab": 48, "space": 49, "backspace": 51, "escape": 53, "esc": 53, "delete": 117,
  "home": 115, "end": 119, "pageup": 116, "page_up": 116, "prior": 116, "pagedown": 121, "page_down": 121, "next": 121,
  "left": 123, "arrowleft": 123, "right": 124, "arrowright": 124, "down": 125, "arrowdown": 125, "up": 126, "arrowup": 126,
  "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
  "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
  "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33,
  "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
]

func stroke(_ code: CGKeyCode, _ held: CGEventFlags, to pid: pid_t) throws {
  for down in [true, false] {
    guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { return try fail("the event could not be made") }
    event.flags = held
    event.postToPid(pid)
  }
}

func key(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  guard let combo = params["combo"] as? String, !combo.trimmingCharacters(in: .whitespaces).isEmpty else { return try fail("`combo` is the key to press") }
  var parts = combo.split(separator: "+", omittingEmptySubsequences: true).map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
  if combo.trimmingCharacters(in: .whitespaces).hasSuffix("+") { parts.append("+") }
  guard let last = parts.popLast() else { return try fail("`combo` is the key to press") }
  let held = try flags(parts)
  if let code = KEYS[last] {
    try stroke(code, held, to: target.pid)
  } else if last.count == 1, held.subtracting(.maskShift).isEmpty {
    // A character with no key of its own here is entered as the character it is.
    try enter(held.contains(.maskShift) ? last.uppercased() : last, to: target.pid)
  } else {
    return try fail("\"\(last)\" in \"\(combo)\" is not a key this helper knows")
  }
  return NSNull()
}

func enter(_ text: String, to pid: pid_t) throws {
  let units = Array(text.utf16)
  var at = 0
  while at < units.count {
    // An event carries a few characters at most, and a pair that makes one character is not split.
    var end = min(units.count, at + 16)
    if end < units.count, UTF16.isLeadSurrogate(units[end - 1]) { end -= 1 }
    let piece = Array(units[at..<end])
    for down in [true, false] {
      guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { return try fail("the event could not be made") }
      event.flags = []
      piece.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: piece.count, unicodeString: $0.baseAddress) }
      event.postToPid(pid)
    }
    at = end
  }
}

func type(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  guard let text = params["text"] as? String else { return try fail("`text` is what to type") }
  let lines = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
  for (nth, line) in lines.enumerated() {
    if nth > 0 { try stroke(36, [], to: target.pid) }
    if !line.isEmpty { try enter(line, to: target.pid) }
  }
  return NSNull()
}

// MARK: The rest

func hello() -> Any {
  [
    "system": "macos",
    "user": NSUserName(),
    "host": ProcessInfo.processInfo.hostName,
    "can": ["activate", "fill"],
    "needs": [
      ["name": "Accessibility", "ok": AXIsProcessTrusted(), "fix": "Allow this program, or the one that starts it, in System Settings, Privacy & Security, Accessibility."],
      ["name": "Screen Recording", "ok": CGPreflightScreenCaptureAccess(), "fix": "Allow this program, or the one that starts it, in System Settings, Privacy & Security, Screen & System Audio Recording."],
    ],
  ] as [String: Any]
}

func apps() -> Any {
  var found: [String: String] = [:]
  for each in NSWorkspace.shared.runningApplications where each.activationPolicy == .regular {
    if let id = each.bundleIdentifier { found[id] = each.localizedName ?? id }
  }
  let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications").path
  for folder in ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities", home] {
    for item in (try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? [] where item.hasSuffix(".app") {
      if let id = Bundle(path: "\(folder)/\(item)")?.bundleIdentifier, found[id] == nil { found[id] = String(item.dropLast(4)) }
    }
  }
  return found.map { ["id": $0.key, "name": $0.value] }.sorted { ($0["name"] ?? "").localizedCaseInsensitiveCompare($1["name"] ?? "") == .orderedAscending }
}

func open(_ params: [String: Any]) throws -> Any {
  guard let id = params["app"] as? String, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { return try fail("there is no app with that id on this Mac") }
  let setup = NSWorkspace.OpenConfiguration()
  // Started behind what the person is doing, not in front of it.
  setup.activates = false
  let done = DispatchSemaphore(value: 0)
  var failed: String?
  NSWorkspace.shared.openApplication(at: url, configuration: setup) { _, error in
    failed = error?.localizedDescription
    done.signal()
  }
  guard done.wait(timeout: .now() + 20) == .success else { return try fail("the app did not start in time") }
  if let failed { return try fail("the app could not be started: \(failed)") }
  return NSNull()
}

func window(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  return ["width": Int(target.frame.width.rounded()), "height": Int(target.frame.height.rounded()), "title": text(target.window, kAXTitleAttribute) ?? ""] as [String: Any]
}

func cursor(_ params: [String: Any]) throws -> Any {
  let at = pointer[params["app"] as? String ?? ""] ?? .zero
  return ["x": Int(at.x), "y": Int(at.y)]
}

func answer(_ method: String, _ params: [String: Any]) throws -> Any {
  switch method {
  case "hello": return hello()
  case "apps": return apps()
  case "open": return try open(params)
  case "window": return try window(params)
  case "screenshot": return try screenshot(params)
  case "read": return try read(params)
  case "locate": return try locate(params)
  case "activate": return try activate(params)
  case "fill": return try fill(params)
  case "click": return try click(params)
  case "move": return try move(params)
  case "drag": return try drag(params)
  case "scroll": return try scroll(params)
  case "type": return try type(params)
  case "key": return try key(params)
  case "cursor": return try cursor(params)
  default: return try fail("this helper cannot \(method)")
  }
}

func say(_ line: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: line, options: [.withoutEscapingSlashes]) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
}

// A picture of a window needs a connection to the window server, which a program with no
// interface of its own does not have until it asks for one. It takes no place in the Dock.
NSApplication.shared.setActivationPolicy(.prohibited)

while let line = readLine(strippingNewline: true) {
  guard let data = line.data(using: .utf8), let asked = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let id = asked["id"] else { continue }
  let method = asked["method"] as? String ?? ""
  let params = asked["params"] as? [String: Any] ?? [:]
  do {
    say(["id": id, "result": try answer(method, params)])
  } catch let failure as Failure {
    say(["id": id, "error": failure.message])
  } catch {
    say(["id": id, "error": error.localizedDescription])
  }
}
