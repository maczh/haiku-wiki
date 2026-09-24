#!/usr/bin/env python3
"""把夹具文件内嵌进一段 JS，用于在页面内模拟「用户选中文件」：
用真实 File + DataTransfer 设置 input.files 并派发 change 事件。
这样走的是应用真实的 onChange → parseFile → 导入链路，仅替代了操作系统的文件选择器。

为什么不能用 agent-browser 的 upload：见 README「已知坑」——本机上它对 React 隐藏
input 会静默失效（命令返回成功但 input.files.length 仍为 0）。

用法：
    python3 tools/verify/gen-upload-js.py
环境变量（都有合理默认值）：
    UPLOAD_FIX     夹具目录，默认 <本脚本目录>/fixtures/import-fixtures
    UPLOAD_JS_OUT  输出 JS 路径，默认 $TMPDIR/imp-upload.js
"""
import base64
import os
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
FIX = pathlib.Path(os.environ.get('UPLOAD_FIX', HERE / 'fixtures' / 'import-fixtures'))
OUT = pathlib.Path(
    os.environ.get('UPLOAD_JS_OUT', os.path.join(os.environ.get('TMPDIR', '/tmp'), 'imp-upload.js'))
)

SPECS = [
    ('多工作表.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ('导入的Word文档.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ('导入的PDF文档.pdf', 'application/pdf'),
]

items = []
for name, mime in SPECS:
    path = FIX / name
    if not path.exists():
        sys.exit('缺少夹具 %s（目录 %s）' % (path, FIX))
    items.append((name, mime, base64.b64encode(path.read_bytes()).decode()))

# Markdown 包夹具（由 e2e-import.sh 运行时生成）：存在才注入，缺了不阻塞老用例
mdzip = FIX / '图文演示.md.zip'
if mdzip.exists():
    items.append(('图文演示.md.zip', 'application/zip', base64.b64encode(mdzip.read_bytes()).decode()))

js = """(function () {
  var SPECS = %s;
  // ImportDialog 本身就是 Drawer（标题「导入文档」）—— 不能再按「排除 .ant-drawer」筛，
  // 那会把唯一想要的 Dragger input 也排掉。改为：优先取「导入」抽屉内的 input，
  // 其次取抽屉外的可见 input，最后才退化到第一个。
  var all = [].slice.call(document.querySelectorAll('input[type=file]'));
  var inImport = all.filter(function (x) {
    var d = x.closest('.ant-drawer');
    return d && /导入文档|导入/.test(d.textContent || '');
  });
  var outside = all.filter(function (x) { return !x.closest('.ant-drawer'); });
  var input = inImport[0] || outside[0] || all[0];
  if (!input) return 'no-input';
  var dt = new DataTransfer();
  for (var n = 0; n < SPECS.length; n++) {
    var b = atob(SPECS[n][2]);
    var u = new Uint8Array(b.length);
    for (var k = 0; k < b.length; k++) u[k] = b.charCodeAt(k);
    dt.items.add(new File([u], SPECS[n][0], { type: SPECS[n][1] }));
  }
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'files=' + input.files.length;
})()
""" % (
    '['
    + ','.join(
        '["%s","%s","%s"]' % (n.replace('"', '\\"'), m, b) for n, m, b in items
    )
    + ']'
)

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(js, encoding='utf-8')
sys.stdout.write('生成 %s（%d 字节，内嵌 %d 个文件）\n' % (OUT, len(js), len(items)))
