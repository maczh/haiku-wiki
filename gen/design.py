# -*- coding: utf-8 -*-
"""设计系统：配色主题、字体方案与场景分类元数据。
供 Word / PPT 生成器共用的视觉基础。
"""

# 字体方案（中文优先微软雅黑，英文 Arial；正文可用宋体营造公文感）
FONT_CN_HEAD = "微软雅黑"
FONT_CN_BODY = "微软雅黑"
FONT_CN_SERIF = "宋体"
FONT_EN = "Arial"

# 十套专业配色主题。每套含主色/深色/强调色/浅底/点缀金/正文色。
THEMES = [
    {"key": "business-blue", "name": "商务蓝",
     "primary": "1F4E79", "dark": "133A5B", "accent": "2E75B6",
     "light": "DCE6F1", "gold": "C9A24B", "text": "222222", "muted": "5A6B7B"},
    {"key": "emerald", "name": "墨绿金",
     "primary": "1B5E4B", "dark": "103E31", "accent": "2E8B6F",
     "light": "D7EBE3", "gold": "C9A24B", "text": "222222", "muted": "4F6B5F"},
    {"key": "china-red", "name": "中国红",
     "primary": "B23A30", "dark": "7E261F", "accent": "D9534F",
     "light": "F6DDD9", "gold": "C9A24B", "text": "262626", "muted": "7A4A44"},
    {"key": "purple", "name": "典雅紫",
     "primary": "4A2E6F", "dark": "331F4E", "accent": "7D5BA6",
     "light": "E6DDF1", "gold": "C9A24B", "text": "222222", "muted": "5B4A70"},
    {"key": "orange", "name": "暖橙",
     "primary": "C25A12", "dark": "8A3F0C", "accent": "E67E22",
     "light": "FBE6D2", "gold": "8A5A2B", "text": "262626", "muted": "7A5638"},
    {"key": "teal", "name": "青碧",
     "primary": "0F6E6E", "dark": "0A4B4B", "accent": "17A2A2",
     "light": "D4EDED", "gold": "C9A24B", "text": "222222", "muted": "4A6B6B"},
    {"key": "gray", "name": "极简灰",
     "primary": "2C3E50", "dark": "1B2A38", "accent": "56708A",
     "light": "E3E8ED", "gold": "B08D57", "text": "262626", "muted": "5E6B78"},
    {"key": "indigo", "name": "靛蓝",
     "primary": "283593", "dark": "1A2470", "accent": "3F51B5",
     "light": "DDE1F5", "gold": "C9A24B", "text": "222222", "muted": "4A5480"},
    {"key": "rose", "name": "玫瑰红",
     "primary": "AD1457", "dark": "740E3A", "accent": "D81B60",
     "light": "F6D9E5", "gold": "C9A24B", "text": "262626", "muted": "7A3A5A"},
    {"key": "forest", "name": "森林绿",
     "primary": "33691E", "dark": "1F4211", "accent": "558B2F",
     "light": "E0ECCF", "gold": "C9A24B", "text": "222222", "muted": "4F6B3F"},
]

# Word 模板场景分类（用于文件命名与归类说明）
WORD_CATEGORIES = {
    "人事行政": ["个人简历", "求职信", "入职登记表", "转正申请", "辞职信", "员工请假单",
              "推荐信", "介绍信", "员工手册", "考勤表", "通讯录", "会议签到表"],
    "办公文书": ["通知", "备忘录", "邀请函", "感谢信", "发言稿", "新闻稿", "请假条", "日程安排表"],
    "工作报告": ["周报", "月报", "季报", "年报", "工作总结", "述职报告", "项目总结报告",
              "调研报告", "可行性研究报告", "市场分析报告", "测试报告"],
    "商务合同": ["劳动合同", "合作协议", "保密协议", "买卖合同", "服务合同", "租赁合同"],
    "财务单据": ["报价单", "销售发票", "费用报销单", "付款申请单", "预算表"],
    "方案策划": ["项目立项报告", "商业计划书", "营销策划方案", "活动策划方案", "培训方案"],
    "技术文档": ["需求分析报告", "项目验收报告", "产品说明书", "用户操作手册", "技术方案"],
}

# PPT 模板场景分类
PPT_CATEGORIES = {
    "企业通用": ["公司介绍", "企业宣传册", "企业文化", "团队介绍", "年终总结", "年度汇报"],
    "商务汇报": ["项目汇报", "工作周报", "季度汇报", "销售业绩汇报", "运营分析报告", "述职汇报"],
    "营销策划": ["产品介绍", "营销策划方案", "品牌策划", "活动策划", "招商方案", "竞品分析"],
    "融资路演": ["商业计划书", "融资路演", "创业路演", "投资分析"],
    "培训教育": ["培训课件", "入职培训", "读书分享会", "知识分享", "时间管理", "高效沟通"],
    "数据战略": ["数据分析报告", "市场调研报告", "战略规划", "数字化转型", "人力资源规划", "财务分析"],
    "活动庆典": ["周年庆典", "团建活动", "节日活动策划", "新品发布会", "客户答谢会"],
}


def theme(i):
    return THEMES[i % len(THEMES)]


def hex2rgb(h):
    h = h.strip("#")
    return tuple(int(h[j:j + 2], 16) for j in (0, 2, 4))


def rgb(h):
    from pptx.dml.color import RGBColor
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
