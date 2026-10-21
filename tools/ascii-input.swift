// 切换输入法，给大纲树用：中文输入法开着时，字母键会被输入法拿去组字，到不了侧栏
// 用法：ascii-input，切到环境变量 ASCII_INPUT_TO 给的输入源，没给就切到英文键盘 com.apple.keylayout.US
// 切之前用的输入源 ID 打到标准输出，切回去时放进 ASCII_INPUT_TO 传回来
// 不用命令行参数传：mod 里的命令得是固定文本，官方目录才认得出它只跑这一个程序
import Carbon

let id = ProcessInfo.processInfo.environment["ASCII_INPUT_TO"] ?? "com.apple.keylayout.US"

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
