// 生成导入测试夹具：一个含「空工作表」的多工作表 xlsx
const XLSX = require('xlsx')
const wb = XLSX.utils.book_new()
// 工作表 1：有内容
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['产品', '销量'], ['苹果', 3], ['香蕉', 5],
]), '产品')
// 工作表 2：完全空白（应被跳过，不产生子文档）
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['', ''], ['', '']]), '空白页')
// 工作表 3：有内容
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['区域', '负责人'], ['华东', '张三'], ['华南', '李四'],
]), '区域')
XLSX.writeFile(wb, '/home/macro/.workbuddy/tmp/import-fixtures/多工作表.xlsx')
console.log('已生成 多工作表.xlsx，工作表：', wb.SheetNames.join(' / '))
