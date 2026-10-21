// 切换输入法，给大纲树用：中文输入法开着时，字母键会被输入法拿去组字，到不了侧栏
// 用法：ascii-input [输入源 ID]，默认切到英文键盘 com.apple.keylayout.US
// 切之前用的输入源 ID 打到标准输出，切回去时把它传回来
import Carbon

let id = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "com.apple.keylayout.US"

let current = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
if let raw = TISGetInputSourceProperty(current, kTISPropertyInputSourceID) {
  print(Unmanaged<CFString>.fromOpaque(raw).takeUnretainedValue() as String)
}

let filter = [kTISPropertyInputSourceID as String: id] as CFDictionary
guard let list = TISCreateInputSourceList(filter, false)?.takeRetainedValue() as? [TISInputSource], let source = list.first else {
  FileHandle.standardError.write("没有找到输入源 \(id)\n".data(using: .utf8)!)
  exit(1)
}
exit(TISSelectInputSource(source) == noErr ? 0 : 1)
