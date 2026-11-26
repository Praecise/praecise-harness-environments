// The computer control helper for macOS. PROTOCOL.md says what it answers.
//
// Elements are read through the Accessibility API and a window is pictured through
// ScreenCaptureKit. An element is pressed by its own accessibility action, which moves
// no pointer and brings nothing to the front. Pointer and key events are posted to the
// app's process and to nothing else; an app that ignores events posted that way is not
// reached another way.
//
// Only public API is used.
//
// It runs three ways from the one program. As Praecise Control, an app in the menu bar:
// it holds the two permissions under its own name, answers on a socket only this user
// can open, says what an agent is using, and can be paused. With `connect`: it passes
// its input to that app and the app's answers back, which is how a harness reaches it.
// With `--stdio`, or built as a plain program: it answers on its own input and output,
// with the permissions of whatever started it.

import AVFoundation
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
let LAYOUT: Set<String> = ["AXMenu", "AXGroup", "AXScrollArea", "AXSplitGroup", "AXLayoutArea", "AXLayoutItem", "AXUnknown", "AXColumn", "AXGenericElement"]
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
// What the helper knows is one set, touched by one request at a time: every request is handled on the one
// queue (`work`) in the app, and on the one thread when it answers on its own input. Nothing below is
// guarded by more than that, which is what `nonisolated(unsafe)` says.
nonisolated(unsafe) var refs: [String: Known] = [:]
nonisolated(unsafe) var named: [Held: String] = [:]
nonisolated(unsafe) var counted = 0

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

// Handed to the thread that takes a picture, which reads its numbers and nothing else.
struct Target: @unchecked Sendable { let id: String; let pid: pid_t; let app: AXUIElement; let window: AXUIElement; let frame: CGRect }

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
  if said == "menuitem", let mark = text(element, kAXMenuItemMarkCharAttribute), !mark.isEmpty { states.append("checked") }
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
    // A menu item with no name is a line between the others.
    if said == "menuitem", called.isEmpty { return [] }
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
  var tree = walk(root, 1, "")
  // An app's menus are not in its window. They are listed beside it by name only: reading one by its
  // reference gives what is in it, and pressing an item there needs neither the pointer nor the app in front.
  if !interactive, params["ref"] == nil, let bar = attribute(target.app, kAXMenuBarAttribute), CFGetTypeID(bar) == AXUIElementGetTypeID() {
    let menus = children(bar as! AXUIElement).compactMap { each -> [String: Any]? in
      let called = name(each, "menuitem")
      return called.isEmpty || called == "Apple" ? nil : ["ref": ref(for: each, app: target.id, role: "menuitem", name: called), "role": "menuitem", "name": called]
    }
    if !menus.isEmpty { tree.append(["ref": ref(for: bar as! AXUIElement, app: target.id, role: "menubar", name: ""), "role": "menubar", "children": menus]) }
  }
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
  var out = describe(element, in: target)
  if ["menuitem", "menubar"].contains(out["role"] as? String ?? "") {
    // A menu and what is in it are pressed, never pointed at: they are given a place that is not in the window.
    out["box"] = ["x": -1, "y": -1, "width": 1, "height": 1]
    return out
  }
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

/// Somewhere to put an answer that is made on another thread and read once that thread has said it is done.
final class Slot<Value>: @unchecked Sendable {
  var value: Value
  init(_ value: Value) { self.value = value }
}

func wait<T>(_ work: @escaping @Sendable () async throws -> T) throws -> T {
  let done = DispatchSemaphore(value: 0)
  let slot = Slot<Result<T, Error>>(.failure(Failure(message: "no answer")))
  Task.detached {
    do { slot.value = .success(try await work()) } catch { slot.value = .failure(error) }
    done.signal()
  }
  done.wait()
  return try slot.value.get()
}

func screenshot(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  guard CGPreflightScreenCaptureAccess() else { return try fail("Screen Recording is not allowed for this program; allow it in System Settings, Privacy & Security, Screen & System Audio Recording") }
  let width = Int(target.frame.width.rounded())
  let height = Int(target.frame.height.rounded())
  capturingUntil = max(capturingUntil, Date().addingTimeInterval(3))
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

// MARK: Recording

/// What this program is called. An edition under another name is the same program with another Info.plist.
let NAME = Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Praecise Control"
/// The folder its files are kept under, which stays the same if an edition is given a new name.
let STORE = Bundle.main.object(forInfoDictionaryKey: "PraeciseControlStore") as? String ?? NAME
/// A line saying whose it is, for an edition that carries another name.
let BY = Bundle.main.object(forInfoDictionaryKey: "PraeciseControlBy") as? String

let RECORDINGS = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches/\(STORE)/recordings")
/// What recordings may take up together, and how long one is kept. Older ones go first.
let KEPT_BYTES = Int(ProcessInfo.processInfo.environment["PRAECISE_CONTROL_RECORDINGS_BYTES"] ?? "") ?? 2 * 1024 * 1024 * 1024
let KEPT_SECONDS: TimeInterval = 24 * 3600
let LONGEST = 600

/// One recording: what the window shows, written as it arrives. Its frames come on a queue of its own.
final class Recorder: NSObject, SCStreamOutput, @unchecked Sendable {
  let app: String
  let url: URL
  let started = Date()
  let limit: Int
  private let stream: SCStream
  private let writer: AVAssetWriter
  private let video: AVAssetWriterInput
  private let sound: AVAssetWriterInput?
  private let queue = DispatchQueue(label: "com.praecise.control.recording")
  private var begun = false
  private var ended = false

  init(app: String, url: URL, window: SCWindow, width: Int, height: Int, rate: Int, audio: Bool, limit: Int) throws {
    self.app = app
    self.url = url
    self.limit = limit
    let setup = SCStreamConfiguration()
    setup.width = width
    setup.height = height
    setup.showsCursor = false
    setup.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(rate))
    setup.capturesAudio = audio
    stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: setup, delegate: nil)
    writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    video = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height])
    video.expectsMediaDataInRealTime = true
    writer.add(video)
    if audio {
      let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128_000])
      input.expectsMediaDataInRealTime = true
      writer.add(input)
      sound = input
    } else {
      sound = nil
    }
    super.init()
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    if audio { try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue) }
    guard writer.startWriting() else { throw Failure(message: "the recording could not be started: \(writer.error?.localizedDescription ?? "the file could not be written")") }
  }

  func start() throws {
    try wait { try await self.stream.startCapture() }
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard !ended, buffer.isValid else { return }
    if type == .screen {
      // Only a frame that is a whole new picture. The others say nothing changed.
      guard let notes = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
        let state = notes.first?[.status] as? Int, state == SCFrameStatus.complete.rawValue
      else { return }
      if !begun {
        writer.startSession(atSourceTime: buffer.presentationTimeStamp)
        begun = true
      }
      if video.isReadyForMoreMediaData { video.append(buffer) }
    } else if type == .audio, begun, let sound, sound.isReadyForMoreMediaData {
      sound.append(buffer)
    }
  }

  /// End it and say how long it ran. What was written can then be played.
  func stop() throws -> Double {
    try? wait { try await self.stream.stopCapture() }
    let done = DispatchSemaphore(value: 0)
    queue.sync { ended = true }
    guard begun else {
      writer.cancelWriting()
      throw Failure(message: "nothing was recorded: the window showed no picture while it ran")
    }
    video.markAsFinished()
    sound?.markAsFinished()
    writer.finishWriting { done.signal() }
    done.wait()
    if writer.status != .completed { throw Failure(message: "the recording could not be finished: \(writer.error?.localizedDescription ?? "unknown")") }
    return min(Date().timeIntervalSince(started), Double(limit))
  }
}

nonisolated(unsafe) var recording: [String: Recorder] = [:]

/// Keep what is recorded within its bounds: nothing older than a day, and no more than the limit in all.
func prune() -> Int {
  let manager = FileManager.default
  let busy = Set(recording.values.map { $0.url.path })
  var kept: [(path: String, size: Int, at: Date)] = []
  for name in (try? manager.contentsOfDirectory(atPath: RECORDINGS.path)) ?? [] {
    let path = RECORDINGS.appendingPathComponent(name).path
    guard let known = try? manager.attributesOfItem(atPath: path), let at = known[.modificationDate] as? Date, let size = (known[.size] as? NSNumber)?.intValue else { continue }
    if !busy.contains(path), Date().timeIntervalSince(at) > KEPT_SECONDS { try? manager.removeItem(atPath: path) } else { kept.append((path, size, at)) }
  }
  var total = kept.reduce(0) { $0 + $1.size }
  for each in kept.sorted(by: { $0.at < $1.at }) where total > KEPT_BYTES && !busy.contains(each.path) {
    try? manager.removeItem(atPath: each.path)
    total -= each.size
  }
  return total
}

func recordStart(_ params: [String: Any]) throws -> Any {
  let target = try target(params)
  guard CGPreflightScreenCaptureAccess() else { return try fail("Screen Recording is not allowed for this program; allow it in System Settings, Privacy & Security, Screen & System Audio Recording") }
  if recording.values.contains(where: { $0.app == target.id }) { return try fail("\(target.id) is already being recorded; stop that first") }
  try FileManager.default.createDirectory(at: RECORDINGS, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  if prune() >= KEPT_BYTES { return try fail("the recordings kept here have reached their limit and none can be removed; stop one that is running") }
  let limit = max(1, min(LONGEST, (params["seconds"] as? NSNumber)?.intValue ?? 60))
  let rate = max(1, min(30, (params["fps"] as? NSNumber)?.intValue ?? 10))
  // A picture's sides have to be even for the usual way of encoding one.
  let width = Int(target.frame.width.rounded()) / 2 * 2
  let height = Int(target.frame.height.rounded()) / 2 * 2
  let window: SCWindow = try wait {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    let mine = content.windows.filter { $0.owningApplication?.processID == target.pid && $0.windowLayer == 0 }
    guard let near = mine.first(where: { abs($0.frame.minX - target.frame.minX) < 2 && abs($0.frame.minY - target.frame.minY) < 2 && abs($0.frame.width - target.frame.width) < 2 }) else {
      throw Failure(message: "the window is not on the screen to be recorded; it may be minimised or on another desktop")
    }
    return near
  }
  let stamp = DateFormatter()
  stamp.dateFormat = "yyyyMMdd-HHmmss"
  let name = "\(stamp.string(from: Date()))-\(target.id.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." }.prefix(40))"
  let recorder = try Recorder(app: target.id, url: RECORDINGS.appendingPathComponent(name + ".mp4"), window: window, width: width, height: height, rate: rate, audio: params["audio"] as? Bool == true, limit: limit)
  try recorder.start()
  recording[name] = recorder
  capturingUntil = max(capturingUntil, Date().addingTimeInterval(Double(limit)))
  // It ends by itself at the length it was started with, and what it wrote is kept.
  work.asyncAfter(deadline: .now() + .seconds(limit)) {
    if let still = recording[name], still === recorder {
      recording[name] = nil
      _ = try? still.stop()
      if recording.isEmpty { capturingUntil = Date() }
    }
  }
  return ["recording": name, "seconds": limit, "width": width, "height": height] as [String: Any]
}

func recordStop(_ params: [String: Any]) throws -> Any {
  let name = params["recording"] as? String ?? ""
  guard let recorder = recording.removeValue(forKey: name) else {
    // One that ended by itself at its length is still there to be asked about.
    let kept = RECORDINGS.appendingPathComponent(name + ".mp4")
    if !name.isEmpty, let size = (try? FileManager.default.attributesOfItem(atPath: kept.path))?[.size] as? NSNumber {
      return ["recording": name, "path": kept.path, "mime": "video/mp4", "bytes": size.intValue] as [String: Any]
    }
    return try fail("\(name.isEmpty ? "that" : name) is not a recording that is running")
  }
  let seconds = try recorder.stop()
  if recording.isEmpty { capturingUntil = Date() }
  let size = ((try? FileManager.default.attributesOfItem(atPath: recorder.url.path))?[.size] as? NSNumber)?.intValue ?? 0
  return ["recording": name, "path": recorder.url.path, "mime": "video/mp4", "bytes": size, "seconds": (seconds * 10).rounded() / 10] as [String: Any]
}

/// Pictures from a recording, spread evenly through it.
func frames(_ params: [String: Any]) throws -> Any {
  let name = ((params["recording"] as? String ?? "") as NSString).lastPathComponent.replacingOccurrences(of: ".mp4", with: "")
  let url = RECORDINGS.appendingPathComponent(name + ".mp4")
  guard !name.isEmpty, FileManager.default.fileExists(atPath: url.path) else { return try fail("there is no recording called \(name.isEmpty ? "that" : name) here") }
  let count = max(1, min(12, (params["count"] as? NSNumber)?.intValue ?? 4))
  let asset = AVURLAsset(url: url)
  let length: Double = try wait { try await asset.load(.duration).seconds }
  guard length > 0 else { return try fail("\(name) cannot be read as a recording") }
  let maker = AVAssetImageGenerator(asset: asset)
  maker.appliesPreferredTrackTransform = true
  maker.requestedTimeToleranceBefore = .zero
  maker.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
  var out: [[String: Any]] = []
  for nth in 0..<count {
    let at = length * (Double(nth) + 0.5) / Double(count)
    guard let image = try? maker.copyCGImage(at: CMTime(seconds: at, preferredTimescale: 600), actualTime: nil),
      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    else { continue }
    out.append(["mime": "image/png", "data": png.base64EncodedString(), "name": String(format: "frame-%.1fs.png", at), "at": (at * 10).rounded() / 10])
  }
  if out.isEmpty { return try fail("no picture could be taken from \(name)") }
  return ["recording": name, "seconds": (length * 10).rounded() / 10, "frames": out] as [String: Any]
}

// MARK: What is kept, and who is connected

/// One program connected to the app: when it joined, and the app it last asked about.
struct Session { let since: Date; var app = ""; var last = Date.distantPast }
nonisolated(unsafe) var sessions: [Int32: Session] = [:]
/// The connection whose request is being answered, or none when it answers on its own input.
nonisolated(unsafe) var asking: Int32 = -1

func kept() -> [(name: String, bytes: Int, at: Date)] {
  let manager = FileManager.default
  return ((try? manager.contentsOfDirectory(atPath: RECORDINGS.path)) ?? []).compactMap { name in
    guard let known = try? manager.attributesOfItem(atPath: RECORDINGS.appendingPathComponent(name).path), let at = known[.modificationDate] as? Date, let size = (known[.size] as? NSNumber)?.intValue else { return nil }
    return (name, size, at)
  }.sorted { $0.at > $1.at }
}

func storage() -> Any {
  let all = kept()
  return [
    "folder": RECORDINGS.path, "bytes": all.reduce(0) { $0 + $1.bytes }, "limit": KEPT_BYTES, "elements": refs.count,
    "recordings": all.map { ["name": $0.name, "bytes": $0.bytes, "at": Int($0.at.timeIntervalSince1970)] as [String: Any] },
  ] as [String: Any]
}

func connected() -> Any {
  sessions.values.sorted { $0.since < $1.since }.map { ["since": Int($0.since.timeIntervalSince1970), "app": $0.app, "last": $0.last == .distantPast ? 0 : Int($0.last.timeIntervalSince1970)] as [String: Any] }
}

/// Remove what is kept. A recording that is still running is left alone.
func clear(_ params: [String: Any]) throws -> Any {
  switch params["what"] as? String {
  case "recordings":
    let busy = Set(recording.values.map { $0.url.lastPathComponent })
    var removed = 0
    for each in kept() where !busy.contains(each.name) {
      if (try? FileManager.default.removeItem(at: RECORDINGS.appendingPathComponent(each.name))) != nil { removed += 1 }
    }
    return ["removed": removed]
  case "cache":
    let removed = refs.count
    refs.removeAll()
    named.removeAll()
    pointer.removeAll()
    return ["removed": removed]
  default:
    return try fail("`what` is recordings or cache")
  }
}

// MARK: Pointer and keys, posted to the app's process only

nonisolated(unsafe) var pointer: [String: CGPoint] = [:]

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
    "can": ["activate", "fill", "record"],
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
  let failed = Slot<String?>(nil)
  NSWorkspace.shared.openApplication(at: url, configuration: setup) { _, error in
    failed.value = error?.localizedDescription
    done.signal()
  }
  guard done.wait(timeout: .now() + 20) == .success else { return try fail("the app did not start in time") }
  if let failed = failed.value { return try fail("the app could not be started: \(failed)") }
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
  case "record_start": return try recordStart(params)
  case "record_stop": return try recordStop(params)
  case "frames": return try frames(params)
  case "storage": return storage()
  case "sessions": return connected()
  case "clear": return try clear(params)
  default: return try fail("this helper cannot \(method)")
  }
}

// MARK: Answering

/// Set from the menu. While it is, nothing but `hello` is answered.
nonisolated(unsafe) var paused = false
/// Until when a window is being recorded or was just pictured. The menu bar shows it for that long.
nonisolated(unsafe) var capturingUntil = Date.distantPast
/// The app an agent last asked about, and when, for the menu.
nonisolated(unsafe) var lastApp = ""
nonisolated(unsafe) var lastAsked = Date.distantPast

/// One line in, one line out. Everything a helper knows is touched from here and nowhere else at once.
func handle(_ line: String) -> String? {
  guard let data = line.data(using: .utf8), let asked = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let id = asked["id"] else { return nil }
  let method = asked["method"] as? String ?? ""
  let params = asked["params"] as? [String: Any] ?? [:]
  var answered: [String: Any] = ["id": id]
  do {
    if paused, method != "hello" { throw Failure(message: "\(NAME) is paused by the person at this machine") }
    if let app = params["app"] as? String, !app.isEmpty {
      lastApp = running(app)?.localizedName ?? app
      lastAsked = Date()
      if sessions[asking] != nil {
        sessions[asking]!.app = lastApp
        sessions[asking]!.last = lastAsked
      }
    }
    answered["result"] = try answer(method, params)
  } catch let failure as Failure {
    answered["error"] = failure.message
  } catch {
    answered["error"] = error.localizedDescription
  }
  guard let out = try? JSONSerialization.data(withJSONObject: answered, options: [.withoutEscapingSlashes]) else { return nil }
  return String(data: out, encoding: .utf8)
}

func stdio() {
  while let line = readLine(strippingNewline: true) {
    guard let answered = handle(line) else { continue }
    FileHandle.standardOutput.write(Data((answered + "\n").utf8))
  }
}

// MARK: The socket between the app and whatever connects to it

let SUPPORT = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/\(STORE)")
let SOCKET = SUPPORT.appendingPathComponent("control.sock").path

func address() -> sockaddr_un {
  var address = sockaddr_un()
  address.sun_family = sa_family_t(AF_UNIX)
  let path = Array(SOCKET.utf8)
  withUnsafeMutableBytes(of: &address.sun_path) { raw in
    for (at, byte) in path.prefix(raw.count - 1).enumerated() { raw[at] = byte }
  }
  return address
}

func dial() -> Int32? {
  let made = socket(AF_UNIX, SOCK_STREAM, 0)
  guard made >= 0 else { return nil }
  var to = address()
  let joined = withUnsafePointer(to: &to) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(made, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
  if joined != 0 { close(made); return nil }
  return made
}

/// Lines from a descriptor, each handed on as it completes.
func lines(from descriptor: Int32, _ each: (String) -> Void) {
  var held = Data()
  var buffer = [UInt8](repeating: 0, count: 65_536)
  while true {
    let count = read(descriptor, &buffer, buffer.count)
    if count <= 0 { return }
    held.append(buffer, count: count)
    while let end = held.firstIndex(of: 0x0A) {
      let line = String(data: held.subdata(in: held.startIndex..<end), encoding: .utf8) ?? ""
      held.removeSubrange(held.startIndex...end)
      each(line)
    }
  }
}

func send(_ text: String, to descriptor: Int32) {
  let bytes = Array((text + "\n").utf8)
  var sent = 0
  while sent < bytes.count {
    let wrote = bytes[sent...].withUnsafeBytes { write(descriptor, $0.baseAddress, $0.count) }
    if wrote <= 0 { return }
    sent += wrote
  }
}

/// One at a time: a helper's references and pointer are one set, whoever is asking.
let work = DispatchQueue(label: "com.praecise.control.work")

func serve() throws {
  try FileManager.default.createDirectory(at: SUPPORT, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  if let already = dial() { close(already); throw Failure(message: "\(NAME) is already running") }
  unlink(SOCKET)
  let listening = socket(AF_UNIX, SOCK_STREAM, 0)
  var at = address()
  let bound = withUnsafePointer(to: &at) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(listening, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) } }
  // Only this user can open it.
  guard listening >= 0, bound == 0, chmod(SOCKET, 0o600) == 0, listen(listening, 8) == 0 else { throw Failure(message: "\(NAME) could not listen at \(SOCKET)") }
  Thread.detachNewThread {
    while true {
      let joined = accept(listening, nil, nil)
      if joined < 0 { continue }
      Thread.detachNewThread {
        work.sync { sessions[joined] = Session(since: Date()) }
        lines(from: joined) { line in
          let answered: String? = work.sync {
            asking = joined
            defer { asking = -1 }
            return handle(line)
          }
          if let answered { send(answered, to: joined) }
        }
        work.sync { sessions[joined] = nil }
        close(joined)
      }
    }
  }
}

/// Pass this program's input to the app and the app's answers back.
func relay() -> Never {
  var joined = dial()
  if joined == nil, Bundle.main.bundlePath.hasSuffix(".app") {
    // Started behind what the person is doing, and given a moment to listen.
    let start = Process()
    start.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    start.arguments = ["-g", Bundle.main.bundlePath]
    try? start.run()
    start.waitUntilExit()
    for _ in 0..<50 where joined == nil {
      usleep(100_000)
      joined = dial()
    }
  }
  guard let to = joined else {
    FileHandle.standardError.write(Data("\(NAME) is not running; open it from Applications\n".utf8))
    exit(69)
  }
  let answered = DispatchSemaphore(value: 0)
  Thread.detachNewThread {
    lines(from: to) { FileHandle.standardOutput.write(Data(($0 + "\n").utf8)) }
    answered.signal()
  }
  lines(from: 0) { send($0, to: to) }
  // Nothing more will be asked. What was asked is still answered before this ends.
  shutdown(to, SHUT_WR)
  answered.wait()
  exit(0)
}

// MARK: The app in the menu bar

final class Menu: NSObject, NSApplicationDelegate, NSMenuDelegate {
  var item: NSStatusItem!

  func applicationDidFinishLaunching(_ notification: Notification) {
    do { try serve() } catch {
      let alert = NSAlert()
      alert.messageText = (error as? Failure)?.message ?? error.localizedDescription
      alert.runModal()
      NSApp.terminate(nil)
      return
    }
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let menu = NSMenu()
    menu.delegate = self
    item.menu = menu
    picture()
    Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(sign), userInfo: nil, repeats: true)
    Route.shared.resume()
  }

  /// The Praecise mark in one colour, which the menu bar tints for itself: a square, its left half open.
  func picture() {
    // An edition brings its own mark, in one colour; without one it is the Praecise mark, drawn here.
    let own = Bundle.main.url(forResource: "menubar", withExtension: "png").flatMap { NSImage(contentsOf: $0) }
    own?.size = NSSize(width: 18, height: 18)
    let image = own ?? NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
      let box = NSRect(x: 2, y: 2, width: 14, height: 14)
      NSColor.black.setFill()
      box.fill()
      NSColor.clear.setFill()
      NSRect(x: box.minX + 1.5, y: box.minY + 1.5, width: box.width / 2 - 1.5, height: box.height - 3).fill(using: .copy)
      return true
    }
    image.isTemplate = true
    image.accessibilityDescription = paused ? "\(NAME), paused" : capturing ? "\(NAME), capturing a window" : "\(NAME)"
    item.button?.image = image
    // Red while a window is being recorded or pictured, so it is never done unseen.
    item.button?.contentTintColor = capturing ? .systemRed : nil
    item.button?.toolTip = capturing ? "\(NAME) is capturing a window" : "\(NAME)"
    // Dimmed while it is paused.
    item.button?.appearsDisabled = paused
  }

  var capturing = false

  @objc func sign() {
    let now = Date() < capturingUntil
    if now != capturing { capturing = now; picture() }
  }

  func add(_ title: String, _ action: Selector?, to menu: NSMenu, symbol: String? = nil) {
    let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
    entry.target = self
    if let symbol { entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) }
    menu.addItem(entry)
  }

  func size(_ bytes: Int) -> String { ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file) }
  func ago(_ date: Date) -> String {
    let passed = Int(Date().timeIntervalSince(date))
    return passed < 60 ? "just now" : passed < 3600 ? "\(passed / 60) min ago" : "\(passed / 3600) h ago"
  }

  /// Built as it is opened, so it says what is true now.
  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    let (joined, all, read): ([Session], [(name: String, bytes: Int, at: Date)], Int) = work.sync { (sessions.values.sorted { $0.since < $1.since }, kept(), refs.count) }

    // This computer on the public route, and what is allowed on it, where the app carries its runtime.
    if Route.shared.available { route(menu) }

    // Who is connected.
    menu.addItem(.sectionHeader(title: "Agents"))
    if capturing { add("Capturing a window now", nil, to: menu, symbol: "record.circle") }
    add(paused ? "Paused: agents are refused" : joined.isEmpty ? "No agent is connected" : joined.count == 1 ? "1 agent is connected" : "\(joined.count) agents are connected", nil, to: menu)
    for each in joined {
      add("    \(each.app.isEmpty ? "has not used an app yet" : "using \(each.app), \(ago(each.last))"), connected \(ago(each.since))", nil, to: menu)
    }
    add(paused ? "Resume" : "Pause", #selector(pause), to: menu, symbol: paused ? "play.circle" : "pause.circle")
    if !joined.isEmpty { add("Disconnect All", #selector(disconnect), to: menu, symbol: "xmark.circle") }

    // What is kept.
    menu.addItem(.sectionHeader(title: "Stored on This Mac"))
    add(all.isEmpty ? "No recordings are kept" : "\(all.count) recording\(all.count == 1 ? "" : "s") kept, \(size(all.reduce(0) { $0 + $1.bytes })) of \(size(KEPT_BYTES)) allowed", nil, to: menu)
    if !all.isEmpty {
      add("Show Recordings in Finder", #selector(reveal), to: menu, symbol: "folder")
      add("Delete All Recordings…", #selector(deleteRecordings), to: menu, symbol: "trash")
    }
    add(read == 0 ? "Nothing is remembered of any window" : "\(read) thing\(read == 1 ? "" : "s") remembered from windows", nil, to: menu)
    if read > 0 { add("Clear Cache", #selector(forget), to: menu, symbol: "eraser") }

    menu.addItem(.sectionHeader(title: "Permissions"))

    add(AXIsProcessTrusted() ? "Accessibility: allowed" : "Allow Accessibility…", AXIsProcessTrusted() ? nil : #selector(accessibility), to: menu, symbol: AXIsProcessTrusted() ? "checkmark.circle" : "accessibility")
    add(CGPreflightScreenCaptureAccess() ? "Screen Recording: allowed" : "Allow Screen Recording…", CGPreflightScreenCaptureAccess() ? nil : #selector(recording), to: menu, symbol: CGPreflightScreenCaptureAccess() ? "checkmark.circle" : "record.circle")
    menu.addItem(.separator())
    if let by = BY { add(by, nil, to: menu) }
    add("Quit \(NAME)", #selector(quit), to: menu, symbol: "power")
  }

  /// A menu inside the menu, for a list of things to choose among.
  func inner(_ title: String, symbol: String, in menu: NSMenu) -> NSMenu {
    let entry = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    entry.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
    let within = NSMenu()
    entry.submenu = within
    menu.addItem(entry)
    return within
  }
  func choice(_ title: String, _ action: Selector, _ carried: Any, on: Bool, in menu: NSMenu) {
    let entry = NSMenuItem(title: title, action: action, keyEquivalent: "")
    entry.target = self
    entry.representedObject = carried
    entry.state = on ? .on : .off
    menu.addItem(entry)
  }

  func route(_ menu: NSMenu) {
    let route = Route.shared
    menu.addItem(.sectionHeader(title: "This Computer"))
    add(route.status, nil, to: menu)
    add(route.wanted ? "Disconnect This Computer" : "Connect This Computer…", #selector(connect), to: menu, symbol: route.wanted ? "xmark.circle" : "link")

    // The apps an agent may be shown: those chosen, and those open now to choose from.
    let apps = inner("Apps", symbol: "macwindow.on.rectangle", in: menu)
    let picked = route.chosen("apps")
    let open = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.compactMap { $0.localizedName }.filter { $0 != NAME }
    for name in (picked + open.filter { !picked.contains($0) }.sorted()) { choice(name, #selector(app(_:)), name, on: picked.contains(name), in: apps) }

    let folders = inner("Folders", symbol: "folder", in: menu)
    for path in route.chosen("folders") { choice((path as NSString).abbreviatingWithTildeInPath, #selector(folder(_:)), path, on: true, in: folders) }
    add("Add a Folder…", #selector(addFolder), to: folders)
    let coding = inner("Folders for Coding Agents", symbol: "chevron.left.forwardslash.chevron.right", in: menu)
    for path in route.chosen("coding") { choice((path as NSString).abbreviatingWithTildeInPath, #selector(codingFolder(_:)), path, on: true, in: coding) }
    add("Add a Folder…", #selector(addCodingFolder), to: coding)

    choice("Camera", #selector(flip(_:)), "camera", on: route.on("camera"), in: menu)
    choice("Microphone", #selector(flip(_:)), "microphone", on: route.on("microphone"), in: menu)

    // What each may have done to it: looked at, worked on, or worked on and sent from.
    let listed = route.accounts
    if !listed.isEmpty {
      let modes = inner("What May Be Done", symbol: "hand.raised", in: menu)
      for each in listed {
        let one = inner(each.alias, symbol: "circle", in: modes)
        for (mode, title) in [("read", "Look Only"), ("draft", "Work In It"), ("act", "Work In It and Ask Before Sending")] {
          choice(title, #selector(mode(_:)), [each.alias, mode], on: each.mode == mode, in: one)
        }
      }
    }
  }

  @objc func connect() { Route.shared.connect(!Route.shared.wanted) }
  @objc func app(_ sender: NSMenuItem) { if let name = sender.representedObject as? String { Route.shared.toggle("apps", name) } }
  @objc func folder(_ sender: NSMenuItem) { if let path = sender.representedObject as? String { Route.shared.toggle("folders", path) } }
  @objc func codingFolder(_ sender: NSMenuItem) { if let path = sender.representedObject as? String { Route.shared.toggle("coding", path) } }
  @objc func flip(_ sender: NSMenuItem) { if let key = sender.representedObject as? String { Route.shared.flip(key) } }
  @objc func mode(_ sender: NSMenuItem) { if let pair = sender.representedObject as? [String], pair.count == 2 { Route.shared.mode(pair[0], pair[1]) } }
  /// The system's own way of choosing a folder.
  func pick() -> String? {
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.prompt = "Allow"
    NSApp.activate(ignoringOtherApps: true)
    return panel.runModal() == .OK ? panel.url?.path : nil
  }
  @objc func addFolder() { if let path = pick(), !Route.shared.chosen("folders").contains(path) { Route.shared.toggle("folders", path) } }
  @objc func addCodingFolder() { if let path = pick(), !Route.shared.chosen("coding").contains(path) { Route.shared.toggle("coding", path) } }

  @objc func pause() {
    work.sync { paused.toggle() }
    picture()
  }
  /// Closed from this end. A harness that is still wanted connects again by itself.
  @objc func disconnect() {
    work.sync { for joined in sessions.keys { shutdown(joined, SHUT_RDWR) } }
  }
  @objc func reveal() {
    try? FileManager.default.createDirectory(at: RECORDINGS, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    NSWorkspace.shared.open(RECORDINGS)
  }
  @objc func deleteRecordings() {
    let alert = NSAlert()
    alert.messageText = "Delete all recordings?"
    alert.informativeText = "They are removed from this Mac and cannot be brought back. A recording that is still running is kept."
    alert.addButton(withTitle: "Delete")
    alert.addButton(withTitle: "Cancel")
    alert.buttons.first?.hasDestructiveAction = true
    NSApp.activate(ignoringOtherApps: true)
    if alert.runModal() == .alertFirstButtonReturn { work.sync { _ = try? clear(["what": "recordings"]) } }
  }
  @objc func forget() {
    work.sync { _ = try? clear(["what": "cache"]) }
  }
  @objc func accessibility() {
    // The system's own question, which takes the person to the setting.
    _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
  }
  @objc func recording() {
    if !CGRequestScreenCaptureAccess(), let pane = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") { NSWorkspace.shared.open(pane) }
  }
  @objc func quit() {
    Route.shared.end()
    unlink(SOCKET)
    NSApp.terminate(nil)
  }
}

// MARK: Which way it was started

let asked = CommandLine.arguments.dropFirst().first
if asked == "connect" { relay() }

if asked != "--stdio", Bundle.main.bundlePath.hasSuffix(".app") {
  // An app with no window and no place in the Dock: it lives in the menu bar.
  let app = NSApplication.shared
  let menu = Menu()
  app.delegate = menu
  app.setActivationPolicy(.accessory)
  app.run()
} else {
  // A picture of a window needs a connection to the window server, which a program with no
  // interface of its own does not have until it asks for one. It takes no place in the Dock.
  NSApplication.shared.setActivationPolicy(.prohibited)
  stdio()
}
