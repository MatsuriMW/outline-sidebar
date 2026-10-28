// 切换输入法，给大纲树用：中文输入法开着时，字母键会被输入法拿去组字，到不了侧栏
// 用法：ascii-input，从标准输入读要切到的输入源 ID，没给就切到英文键盘 com.apple.keylayout.US
// 切之前用的输入源 ID 打到标准输出，切回去时再从标准输入传回来
// 不用命令行参数传：mod 里的命令得是固定文本，官方目录才认得出它只跑这一个程序；也不用环境变量传，免得被当成转发凭证
import Carbon

let given = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
let id = given.isEmpty ? "com.apple.keylayout.US" : given

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
