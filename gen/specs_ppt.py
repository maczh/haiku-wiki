# -*- coding: utf-8 -*-
"""PPT 模板场景定义。
每个模板：file / title / subtitle / slides[...] / closing_title / closing_subtitle。
幻灯片类型：agenda | section | bullets | two_col | image | stats | timeline。
标题页与结尾页由渲染器自动添加。
"""

PPT_TEMPLATES = [
    # ---------------- 企业通用 ----------------
    {"file": "01-公司介绍.pptx", "title": "公司介绍", "subtitle": "COMPANY PROFILE",
     "slides": [
        {"type": "agenda", "title": "目录", "kicker": "CONTENTS", "items": ["公司概况", "核心业务", "团队实力", "发展愿景"]},
        {"type": "section", "num": "01", "title": "公司概况"},
        {"type": "bullets", "title": "我们是谁", "kicker": "ABOUT US", "items": ["成立于 ____ 年，专注于 ____ 领域", "总部位于 ____，辐射 ____ 市场", "以 ____ 为使命，服务 ____ 客户"]},
        {"type": "stats", "title": "关键数据", "kicker": "BY THE NUMBERS", "stats": [("10+", "年行业沉淀"), ("500+", "服务客户"), ("30+", "城市覆盖"), ("98%", "客户满意度")]},
        {"type": "section", "num": "02", "title": "核心业务"},
        {"type": "two_col", "title": "业务矩阵", "left_title": "主营业务", "left": ["____ 产品/服务", "____ 解决方案", "____ 增值服务"], "right_title": "核心优势", "right": ["技术领先", "交付可靠", "成本可控"]},
        {"type": "image", "title": "产品/办公实景", "caption": "在此插入公司实景或产品图"},
        {"type": "section", "num": "03", "title": "团队实力"},
        {"type": "bullets", "title": "团队与资质", "items": ["核心团队来自 ____", "拥有 ____ 项专利/资质", "完善的培训与研发体系"]},
        {"type": "section", "num": "04", "title": "发展愿景"},
        {"type": "bullets", "title": "未来规划", "items": ["短期：____", "中期：____", "长期：____"]}]},

    {"file": "02-企业宣传册.pptx", "title": "企业宣传册", "subtitle": "CORPORATE BROCHURE",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["品牌理念", "产品服务", "案例展示", "联系我们"]},
        {"type": "bullets", "title": "品牌理念", "kicker": "BRAND", "items": ["使命：____", "愿景：____", "价值观：____"]},
        {"type": "image", "title": "品牌形象", "caption": "插入品牌主视觉"},
        {"type": "two_col", "title": "产品与服务", "left_title": "产品", "left": ["____", "____"], "right_title": "服务", "right": ["____", "____"]},
        {"type": "image", "title": "客户案例", "caption": "插入典型案例图片"},
        {"type": "bullets", "title": "联系方式", "items": ["官网：____", "电话：____", "邮箱：____", "地址：____"]}]},

    {"file": "03-企业文化.pptx", "title": "企业文化", "subtitle": "CORPORATE CULTURE",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["文化内核", "行为准则", "团队活动", "文化落地"]},
        {"type": "stats", "title": "文化关键词", "stats": [("诚信", "立身之本"), ("创新", "发展动力"), ("协作", "共赢基础"), ("担当", "价值体现")]},
        {"type": "bullets", "title": "行为准则", "items": ["客户第一，快速响应", "坦诚沟通，对事不对人", "持续学习，拥抱变化"]},
        {"type": "image", "title": "团队风貌", "caption": "插入团队活动照片"},
        {"type": "bullets", "title": "文化落地举措", "items": ["新人文化培训", "月度文化之星评选", "文化墙与内刊"]}]},

    {"file": "04-团队介绍.pptx", "title": "团队介绍", "subtitle": "OUR TEAM",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["团队概况", "核心成员", "组织架构", "协作机制"]},
        {"type": "bullets", "title": "团队概况", "items": ["____ 人规模，平均从业 ____ 年", "覆盖 ____、____、____ 等专业", "扁平化、高协作氛围"]},
        {"type": "image", "title": "核心成员", "caption": "插入成员照片与简介占位"},
        {"type": "bullets", "title": "组织架构", "items": ["管理层：____", "产研：____", "市场：____", "职能：____"]},
        {"type": "bullets", "title": "协作机制", "items": ["周会复盘", "跨部门项目制", "知识库沉淀"]}]},

    {"file": "05-年终总结.pptx", "title": "年终总结", "subtitle": "ANNUAL SUMMARY",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["年度业绩", "关键举措", "问题反思", "新年展望"]},
        {"type": "stats", "title": "年度关键指标", "stats": [("____", "营收"), ("____%", "增长"), ("____", "新客"), ("____", "项目")]},
        {"type": "bullets", "title": "关键举措", "items": ["举措一：____", "举措二：____", "举措三：____"]},
        {"type": "section", "num": "03", "title": "问题反思"},
        {"type": "bullets", "title": "不足与改进", "items": ["问题：____，根因 ____", "改进：____"]},
        {"type": "section", "num": "04", "title": "新年展望"},
        {"type": "timeline", "title": "年度节奏", "steps": [("Q1", "____"), ("Q2", "____"), ("Q3", "____"), ("Q4", "____")]}]},

    {"file": "06-年度汇报.pptx", "title": "年度工作汇报", "subtitle": "ANNUAL REPORT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["工作回顾", "成果展示", "数据透视", "规划展望"]},
        {"type": "bullets", "title": "工作回顾", "items": ["完成 ____ 项重点任务", "推进 ____ 项目落地"]},
        {"type": "bullets", "title": "成果展示", "items": ["亮点一：____", "亮点二：____"]},
        {"type": "stats", "title": "年度数据", "stats": [("____", "指标A"), ("____", "指标B"), ("____", "指标C"), ("____", "指标D")]},
        {"type": "bullets", "title": "规划展望", "items": ["方向一：____", "方向二：____"]}]},

    # ---------------- 商务汇报 ----------------
    {"file": "07-项目汇报.pptx", "title": "项目汇报", "subtitle": "PROJECT REPORT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["项目背景", "进展概览", "成果亮点", "风险与计划"]},
        {"type": "bullets", "title": "项目背景", "items": ["目标：____", "范围：____", "干系人：____"]},
        {"type": "timeline", "title": "里程碑", "steps": [("启动", "____"), ("设计", "____"), ("开发", "____"), ("上线", "____")]},
        {"type": "stats", "title": "阶段成果", "stats": [("____%", "进度"), ("____", "交付物"), ("____", "满意度")]},
        {"type": "two_col", "title": "风险与对策", "left_title": "风险", "left": ["____", "____"], "right_title": "对策", "right": ["____", "____"]}]},

    {"file": "08-工作周报.pptx", "title": "工作周报", "subtitle": "WEEKLY REPORT",
     "slides": [
        {"type": "agenda", "title": "本周概览", "items": ["完成情况", "进行中", "下周计划"]},
        {"type": "bullets", "title": "本周完成", "items": ["完成 ____", "推进 ____", "输出 ____"]},
        {"type": "bullets", "title": "进行中", "items": ["____ 预计 ____ 完成", "协调 ____ 资源"]},
        {"type": "bullets", "title": "下周计划", "items": ["重点：____", "启动：____"]}]},

    {"file": "09-季度汇报.pptx", "title": "季度工作汇报", "subtitle": "QUARTERLY REPORT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["季度业绩", "重点专项", "问题分析", "下季规划"]},
        {"type": "stats", "title": "季度指标", "stats": [("____", "营收"), ("____%", "达标率"), ("____", "新签"), ("____", "回款")]},
        {"type": "bullets", "title": "重点专项", "items": ["专项一：____", "专项二：____"]},
        {"type": "section", "num": "03", "title": "问题分析"},
        {"type": "two_col", "title": "问题与对策", "left_title": "问题", "left": ["____", "____"], "right_title": "对策", "right": ["____", "____"]},
        {"type": "bullets", "title": "下季规划", "items": ["____", "____"]}]},

    {"file": "10-销售业绩汇报.pptx", "title": "销售业绩汇报", "subtitle": "SALES REPORT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["业绩总览", "区域分析", "客户结构", "提升策略"]},
        {"type": "stats", "title": "业绩总览", "stats": [("____", "销售额"), ("____%", "同比"), ("____", "订单"), ("____", "客单价")]},
        {"type": "bullets", "title": "区域分析", "items": ["华东：____", "华南：____", "其他：____"]},
        {"type": "two_col", "title": "客户结构", "left_title": "新客", "left": ["____", "____"], "right_title": "老客", "right": ["____", "____"]},
        {"type": "bullets", "title": "提升策略", "items": ["渠道：____", "转化：____", "复购：____"]}]},

    {"file": "11-运营分析报告.pptx", "title": "运营分析报告", "subtitle": "OPERATION ANALYSIS",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["运营概况", "漏斗分析", "用户洞察", "优化建议"]},
        {"type": "stats", "title": "运营概况", "stats": [("____", "DAU"), ("____", "转化率"), ("____", "留存"), ("____", "GMV")]},
        {"type": "bullets", "title": "漏斗分析", "items": ["曝光→点击：____", "点击→注册：____", "注册→付费：____"]},
        {"type": "bullets", "title": "优化建议", "items": ["____", "____", "____"]}]},

    {"file": "12-述职汇报.pptx", "title": "述职汇报", "subtitle": "PERFORMANCE REVIEW",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["岗位职责", "业绩成果", "能力提升", "改进承诺"]},
        {"type": "bullets", "title": "岗位职责", "items": ["负责 ____", "统筹 ____"]},
        {"type": "stats", "title": "业绩成果", "stats": [("____", "KPI1"), ("____", "KPI2"), ("____", "KPI3")]},
        {"type": "bullets", "title": "能力提升", "items": ["____", "____"]},
        {"type": "bullets", "title": "改进承诺", "items": ["针对 ____ 提升 ____"]}]},

    # ---------------- 营销策划 ----------------
    {"file": "13-产品介绍.pptx", "title": "产品介绍", "subtitle": "PRODUCT INTRO",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["产品定位", "核心功能", "应用场景", "竞争优势"]},
        {"type": "bullets", "title": "产品定位", "items": ["面向 ____ 人群", "解决 ____ 痛点", "主打 ____ 价值"]},
        {"type": "image", "title": "产品展示", "caption": "插入产品图/界面截图"},
        {"type": "two_col", "title": "核心功能", "left_title": "功能", "left": ["____", "____", "____"], "right_title": "价值", "right": ["____", "____", "____"]},
        {"type": "bullets", "title": "竞争优势", "items": ["对比竞品：____", "壁垒：____"]}]},

    {"file": "14-营销策划方案.pptx", "title": "营销策划方案", "subtitle": "MARKETING PLAN",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["目标与人群", "策略创意", "渠道排期", "预算评估"]},
        {"type": "two_col", "title": "目标与人群", "left_title": "目标", "left": ["曝光____", "转化____"], "right_title": "人群", "right": ["____", "____"]},
        {"type": "bullets", "title": "策略创意", "items": ["主题：____", "主张：____", "形式：____"]},
        {"type": "timeline", "title": "节奏排期", "steps": [("预热", "____"), ("引爆", "____"), ("持续", "____"), ("收尾", "____")]},
        {"type": "stats", "title": "预算分配", "stats": [("____", "内容"), ("____", "投放"), ("____", "活动"), ("____", "预留")]}]},

    {"file": "15-品牌策划.pptx", "title": "品牌策划方案", "subtitle": "BRAND PLAN",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["品牌诊断", "定位策略", "视觉体系", "传播规划"]},
        {"type": "bullets", "title": "品牌诊断", "items": ["现状：____", "机会：____", "问题：____"]},
        {"type": "bullets", "title": "定位策略", "items": ["核心价值：____", "个性：____", "口号：____"]},
        {"type": "image", "title": "视觉体系", "caption": "插入Logo/VI示意"},
        {"type": "bullets", "title": "传播规划", "items": ["线上：____", "线下：____"]}]},

    {"file": "16-活动策划.pptx", "title": "活动策划方案", "subtitle": "EVENT PLAN",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["活动概况", "流程设计", "宣传推广", "预算风控"]},
        {"type": "bullets", "title": "活动概况", "items": ["主题：____", "时间：____", "规模：____ 人"]},
        {"type": "timeline", "title": "流程设计", "steps": [("签到", "____"), ("开场", "____"), ("主体", "____"), ("收尾", "____")]},
        {"type": "two_col", "title": "宣传推广", "left_title": "线上", "left": ["____", "____"], "right_title": "线下", "right": ["____", "____"]},
        {"type": "bullets", "title": "预算与风控", "items": ["预算：____", "风险：____，预案 ____"]}]},

    {"file": "17-招商方案.pptx", "title": "招商合作方案", "subtitle": "INVESTMENT PLAN",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["项目前景", "合作模式", "政策支持", "收益测算"]},
        {"type": "bullets", "title": "项目前景", "items": ["市场：____", "趋势：____"]},
        {"type": "two_col", "title": "合作模式", "left_title": "模式", "left": ["代理", "联营", "直营"], "right_title": "适合", "right": ["____", "____", "____"]},
        {"type": "stats", "title": "收益测算", "stats": [("____", "单店回收"), ("____%", "毛利率"), ("____", "回本周期")]},
        {"type": "bullets", "title": "政策支持", "items": ["培训支持", "营销支持", "供应链支持"]}]},

    {"file": "18-竞品分析.pptx", "title": "竞品分析报告", "subtitle": "COMPETITOR ANALYSIS",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["市场格局", "对手画像", "能力对比", "机会点"]},
        {"type": "bullets", "title": "市场格局", "items": ["头部：____", "腰部：____", "长尾：____"]},
        {"type": "two_col", "title": "对手画像", "left_title": "对手A", "left": ["优势____", "短板____"], "right_title": "对手B", "right": ["优势____", "短板____"]},
        {"type": "bullets", "title": "能力对比", "items": ["产品：____", "价格：____", "渠道：____"]},
        {"type": "bullets", "title": "机会点", "items": ["空白市场：____", "差异化：____"]}]},

    # ---------------- 融资路演 ----------------
    {"file": "19-商业计划书.pptx", "title": "商业计划书", "subtitle": "BUSINESS PLAN",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["痛点与机遇", "解决方案", "商业模式", "团队与财务"]},
        {"type": "bullets", "title": "痛点与机遇", "items": ["痛点：____", "市场：____", "机会：____"]},
        {"type": "bullets", "title": "解决方案", "items": ["产品：____", "差异化：____"]},
        {"type": "two_col", "title": "商业模式", "left_title": "收入", "left": ["____", "____"], "right_title": "成本", "right": ["____", "____"]},
        {"type": "stats", "title": "财务预测", "stats": [("Y1", "____"), ("Y2", "____"), ("Y3", "____")]},
        {"type": "bullets", "title": "团队与融资", "items": ["团队：____", "融资：____ 用于 ____"]}]},

    {"file": "20-融资路演.pptx", "title": "融资路演", "subtitle": "PITCH DECK",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["我们做什么", "为什么现在", "怎么赚钱", "融资需求"]},
        {"type": "bullets", "title": "我们做什么", "items": ["一句话：____", "为 ____ 提供 ____"]},
        {"type": "stats", "title": "为什么现在", "stats": [("____", "市场增速"), ("____", "窗口期")]},
        {"type": "bullets", "title": "怎么赚钱", "items": ["收入来源：____", "单位经济：____"]},
        {"type": "bullets", "title": "融资需求", "items": ["本轮 ____，估值 ____", "资金用于 ____"]}]},

    {"file": "21-创业路演.pptx", "title": "创业项目路演", "subtitle": "STARTUP PITCH",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["项目亮点", "产品Demo", "市场验证", "发展路线"]},
        {"type": "bullets", "title": "项目亮点", "items": ["创新点：____", "已验证：____"]},
        {"type": "image", "title": "产品 Demo", "caption": "插入产品截图/原型"},
        {"type": "stats", "title": "市场验证", "stats": [("____", "用户"), ("____%", "周留存"), ("____", "营收")]},
        {"type": "timeline", "title": "发展路线", "steps": [("MVP", "____"), ("增长", "____"), ("规模", "____")]}]},

    {"file": "22-投资分析.pptx", "title": "投资分析报告", "subtitle": "INVESTMENT ANALYSIS",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["标的概况", "行业研判", "财务评估", "投资建议"]},
        {"type": "bullets", "title": "标的概况", "items": ["业务：____", "地位：____"]},
        {"type": "bullets", "title": "行业研判", "items": ["空间：____", "格局：____"]},
        {"type": "stats", "title": "财务评估", "stats": [("____", "营收"), ("____%", "毛利"), ("____", "估值")]},
        {"type": "bullets", "title": "投资建议", "items": ["结论：____", "风险：____"]}]},

    # ---------------- 培训教育 ----------------
    {"file": "23-培训课件.pptx", "title": "培训课件", "subtitle": "TRAINING COURSEWARE",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["课程目标", "知识讲解", "案例演示", "互动练习"]},
        {"type": "bullets", "title": "课程目标", "items": ["理解 ____", "掌握 ____", "能应用 ____"]},
        {"type": "bullets", "title": "知识讲解", "items": ["概念：____", "原理：____", "方法：____"]},
        {"type": "image", "title": "案例演示", "caption": "插入案例图示"},
        {"type": "bullets", "title": "互动练习", "items": ["练习一：____", "练习二：____"]}]},

    {"file": "24-入职培训.pptx", "title": "新员工入职培训", "subtitle": "ONBOARDING",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["欢迎致辞", "公司认知", "制度规范", "职业发展"]},
        {"type": "bullets", "title": "欢迎致辞", "items": ["欢迎加入 ____", "期待共同成长"]},
        {"type": "bullets", "title": "公司认知", "items": ["发展历程", "组织架构", "业务版图"]},
        {"type": "two_col", "title": "制度规范", "left_title": "考勤", "left": ["____", "____"], "right_title": "福利", "right": ["____", "____"]},
        {"type": "bullets", "title": "职业发展", "items": ["双通道：____", "培养计划：____"]}]},

    {"file": "25-读书分享会.pptx", "title": "读书分享会", "subtitle": "BOOK SHARING",
     "slides": [
        {"type": "agenda", "title": "分享内容", "items": ["书籍简介", "核心观点", "金句摘录", "实践启发"]},
        {"type": "bullets", "title": "书籍简介", "items": ["书名：____", "作者：____", "主题：____"]},
        {"type": "bullets", "title": "核心观点", "items": ["观点一：____", "观点二：____"]},
        {"type": "bullets", "title": "金句摘录", "items": ["“____”", "“____”"]},
        {"type": "bullets", "title": "实践启发", "items": ["可应用于 ____", "行动计划 ____"]}]},

    {"file": "26-知识分享.pptx", "title": "知识分享", "subtitle": "KNOWLEDGE SHARING",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["主题背景", "核心内容", "实践案例", "总结答疑"]},
        {"type": "bullets", "title": "主题背景", "items": ["为什么分享 ____", "适用场景 ____"]},
        {"type": "bullets", "title": "核心内容", "items": ["要点一：____", "要点二：____"]},
        {"type": "image", "title": "实践案例", "caption": "插入实践截图"},
        {"type": "bullets", "title": "总结答疑", "items": ["小结：____", "Q&A"]}]},

    {"file": "27-时间管理.pptx", "title": "时间管理培训", "subtitle": "TIME MANAGEMENT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["为何管理", "方法工具", "实践演练", "习惯养成"]},
        {"type": "bullets", "title": "为何管理", "items": ["痛点：____", "价值：____"]},
        {"type": "two_col", "title": "方法工具", "left_title": "方法", "left": ["四象限", "番茄钟"], "right_title": "工具", "right": ["清单", "日历"]},
        {"type": "bullets", "title": "实践演练", "items": ["演练一：____", "演练二：____"]},
        {"type": "bullets", "title": "习惯养成", "items": ["每日复盘", "周计划"]}]},

    {"file": "28-高效沟通.pptx", "title": "高效沟通培训", "subtitle": "EFFECTIVE COMMUNICATION",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["沟通模型", "倾听技巧", "表达技巧", "冲突处理"]},
        {"type": "bullets", "title": "沟通模型", "items": ["编码-渠道-解码", "反馈闭环"]},
        {"type": "bullets", "title": "倾听技巧", "items": ["专注", "复述", "共情"]},
        {"type": "bullets", "title": "表达技巧", "items": ["结论先行", "结构化"]},
        {"type": "bullets", "title": "冲突处理", "items": ["对事不对人", "寻求共赢"]}]},

    # ---------------- 数据战略 ----------------
    {"file": "29-数据分析报告.pptx", "title": "数据分析报告", "subtitle": "DATA ANALYSIS",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["分析背景", "数据概览", "深度洞察", "行动建议"]},
        {"type": "bullets", "title": "分析背景", "items": ["目的：____", "数据来源：____"]},
        {"type": "stats", "title": "数据概览", "stats": [("____", "样本"), ("____", "均值"), ("____", "转化")]},
        {"type": "bullets", "title": "深度洞察", "items": ["发现一：____", "发现二：____"]},
        {"type": "bullets", "title": "行动建议", "items": ["建议一：____", "建议二：____"]}]},

    {"file": "30-市场调研报告.pptx", "title": "市场调研报告", "subtitle": "MARKET RESEARCH",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["调研说明", "市场容量", "用户画像", "结论建议"]},
        {"type": "bullets", "title": "调研说明", "items": ["样本 ____ 份", "方法 ____"]},
        {"type": "stats", "title": "市场容量", "stats": [("____", "规模"), ("____%", "增速")]},
        {"type": "bullets", "title": "用户画像", "items": ["人群：____", "需求：____"]},
        {"type": "bullets", "title": "结论建议", "items": ["结论：____", "建议：____"]}]},

    {"file": "31-战略规划.pptx", "title": "战略规划", "subtitle": "STRATEGY PLANNING",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["战略环境", "战略目标", "战略举措", "保障措施"]},
        {"type": "two_col", "title": "战略环境", "left_title": "机会", "left": ["____", "____"], "right_title": "挑战", "right": ["____", "____"]},
        {"type": "bullets", "title": "战略目标", "items": ["愿景：____", "三年目标：____"]},
        {"type": "bullets", "title": "战略举措", "items": ["举措一：____", "举措二：____"]},
        {"type": "bullets", "title": "保障措施", "items": ["组织：____", "资源：____"]}]},

    {"file": "32-数字化转型.pptx", "title": "数字化转型方案", "subtitle": "DIGITAL TRANSFORMATION",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["转型动因", "蓝图设计", "实施路径", "价值收益"]},
        {"type": "bullets", "title": "转型动因", "items": ["痛点：____", "趋势：____"]},
        {"type": "bullets", "title": "蓝图设计", "items": ["数据底座", "业务线上化", "智能决策"]},
        {"type": "timeline", "title": "实施路径", "steps": [("试点", "____"), ("推广", "____"), ("深化", "____")]},
        {"type": "stats", "title": "价值收益", "stats": [("____%", "效率"), ("____", "成本下降")]}]},

    {"file": "33-人力资源规划.pptx", "title": "人力资源规划", "subtitle": "HR PLANNING",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["现状盘点", "人才需求", "供给策略", "实施计划"]},
        {"type": "stats", "title": "现状盘点", "stats": [("____", "人数"), ("____", "流失率"), ("____", "空缺")]},
        {"type": "bullets", "title": "人才需求", "items": ["岗位：____", "数量：____"]},
        {"type": "bullets", "title": "供给策略", "items": ["招聘：____", "培养：____"]},
        {"type": "timeline", "title": "实施计划", "steps": [("Q1", "____"), ("Q2", "____"), ("Q3", "____")]}]},

    {"file": "34-财务分析.pptx", "title": "财务分析报告", "subtitle": "FINANCIAL ANALYSIS",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["经营成果", "盈利能力", "偿债运营", "风险预警"]},
        {"type": "stats", "title": "经营成果", "stats": [("____", "营收"), ("____", "利润"), ("____%", "增长")]},
        {"type": "bullets", "title": "盈利能力", "items": ["毛利率 ____", "净利率 ____"]},
        {"type": "bullets", "title": "偿债与运营", "items": ["流动比率 ____", "周转天数 ____"]},
        {"type": "bullets", "title": "风险预警", "items": ["关注 ____", "建议 ____"]}]},

    # ---------------- 活动庆典 ----------------
    {"file": "35-周年庆典.pptx", "title": "周年庆典", "subtitle": "ANNIVERSARY",
     "slides": [
        {"type": "agenda", "title": "庆典流程", "items": ["回顾历程", "荣誉时刻", "展望未来", "欢庆互动"]},
        {"type": "timeline", "title": "历程回顾", "steps": [("初创", "____"), ("成长", "____"), ("突破", "____"), ("今天", "____")]},
        {"type": "stats", "title": "荣誉时刻", "stats": [("____", "年"), ("____", "客户"), ("____", "奖项")]},
        {"type": "bullets", "title": "展望未来", "items": ["愿景：____", "承诺：____"]},
        {"type": "image", "title": "欢庆互动", "caption": "插入庆典照片"}]},

    {"file": "36-团建活动.pptx", "title": "团建活动策划", "subtitle": "TEAM BUILDING",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["活动目的", "方案设计", "行程安排", "预算安全"]},
        {"type": "bullets", "title": "活动目的", "items": ["增进默契", "释放压力"]},
        {"type": "two_col", "title": "方案设计", "left_title": "项目", "left": ["破冰", "协作"], "right_title": "意义", "right": ["____", "____"]},
        {"type": "timeline", "title": "行程安排", "steps": [("出发", "____"), ("活动", "____"), ("返程", "____")]},
        {"type": "bullets", "title": "预算与安全", "items": ["预算 ____", "安全员 ____"]}]},

    {"file": "37-节日活动策划.pptx", "title": "节日活动策划", "subtitle": "FESTIVAL EVENT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["活动主题", "氛围布置", "互动环节", "传播复盘"]},
        {"type": "bullets", "title": "活动主题", "items": ["主题：____", "口号：____"]},
        {"type": "image", "title": "氛围布置", "caption": "插入场景布置图"},
        {"type": "bullets", "title": "互动环节", "items": ["游戏：____", "礼品：____"]},
        {"type": "bullets", "title": "传播复盘", "items": ["渠道：____", "指标：____"]}]},

    {"file": "38-新品发布会.pptx", "title": "新品发布会", "subtitle": "PRODUCT LAUNCH",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["发布背景", "产品亮点", "价格权益", "上市节奏"]},
        {"type": "bullets", "title": "发布背景", "items": ["时机：____", "人群：____"]},
        {"type": "image", "title": "产品亮点", "caption": "插入新品图"},
        {"type": "stats", "title": "价格权益", "stats": [("____", "定价"), ("____", "首发价"), ("____", "赠品")]},
        {"type": "timeline", "title": "上市节奏", "steps": [("预热", "____"), ("首发", "____"), ("放量", "____")]}]},

    {"file": "39-客户答谢会.pptx", "title": "客户答谢会", "subtitle": "CLIENT APPRECIATION",
     "slides": [
        {"type": "agenda", "title": "流程", "items": ["致辞感恩", "成果回顾", "荣誉颁奖", "未来同行"]},
        {"type": "bullets", "title": "致辞感恩", "items": ["感谢 ____ 一路同行"]},
        {"type": "stats", "title": "成果回顾", "stats": [("____", "合作年"), ("____", "项目"), ("____", "成长")]},
        {"type": "bullets", "title": "荣誉颁奖", "items": ["奖项：____", "获奖：____"]},
        {"type": "bullets", "title": "未来同行", "items": ["承诺：____", "展望：____"]}]},

    # ---------------- 补充场景 ----------------
    {"file": "40-项目启动会.pptx", "title": "项目启动会", "subtitle": "KICKOFF MEETING",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["项目目标", "团队分工", "计划排期", "协作机制"]},
        {"type": "bullets", "title": "项目目标", "items": ["目标：____", "成功标准：____"]},
        {"type": "two_col", "title": "团队分工", "left_title": "角色", "left": ["PM", "开发", "测试"], "right_title": "职责", "right": ["____", "____", "____"]},
        {"type": "timeline", "title": "计划排期", "steps": [("启动", "____"), ("开发", "____"), ("上线", "____")]},
        {"type": "bullets", "title": "协作机制", "items": ["日站会", "周复盘"]}]},

    {"file": "41-项目复盘.pptx", "title": "项目复盘", "subtitle": "PROJECT RETROSPECTIVE",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["目标回顾", "结果对比", "原因剖析", "改进行动"]},
        {"type": "two_col", "title": "目标 vs 结果", "left_title": "目标", "left": ["____", "____"], "right_title": "结果", "right": ["____", "____"]},
        {"type": "bullets", "title": "原因剖析", "items": ["做得好：____", "待改进：____"]},
        {"type": "bullets", "title": "改进行动", "items": ["行动一：____ 负责人 ____", "行动二：____ 负责人 ____"]}]},

    {"file": "42-竞聘演讲.pptx", "title": "岗位竞聘演讲", "subtitle": "JOB COMPETITION",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["个人简介", "岗位理解", "履职规划", "承诺表态"]},
        {"type": "bullets", "title": "个人简介", "items": ["资历：____", "业绩：____"]},
        {"type": "bullets", "title": "岗位理解", "items": ["职责：____", "挑战：____"]},
        {"type": "bullets", "title": "履职规划", "items": ["短期：____", "长期：____"]},
        {"type": "bullets", "title": "承诺表态", "items": ["若能当选，将 ____"]}]},

    {"file": "43-学术汇报.pptx", "title": "学术研究报告", "subtitle": "ACADEMIC REPORT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["研究背景", "方法模型", "实验结果", "结论展望"]},
        {"type": "bullets", "title": "研究背景", "items": ["问题：____", "意义：____"]},
        {"type": "bullets", "title": "方法模型", "items": ["方法：____", "模型：____"]},
        {"type": "image", "title": "实验结果", "caption": "插入图表/结果图"},
        {"type": "bullets", "title": "结论展望", "items": ["结论：____", "展望：____"]}]},

    {"file": "44-毕业答辩.pptx", "title": "毕业设计答辩", "subtitle": "THESIS DEFENSE",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["选题背景", "研究内容", "创新点", "总结致谢"]},
        {"type": "bullets", "title": "选题背景", "items": ["来源：____", "意义：____"]},
        {"type": "bullets", "title": "研究内容", "items": ["章节一：____", "章节二：____"]},
        {"type": "bullets", "title": "创新点", "items": ["创新一：____", "创新二：____"]},
        {"type": "bullets", "title": "总结致谢", "items": ["总结：____", "感谢导师与评委"]}]},

    {"file": "45-课题研究.pptx", "title": "课题研究报告", "subtitle": "RESEARCH TOPIC",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["课题来源", "研究设计", "阶段成果", "后续计划"]},
        {"type": "bullets", "title": "课题来源", "items": ["立项背景：____"]},
        {"type": "bullets", "title": "研究设计", "items": ["思路：____", "方法：____"]},
        {"type": "stats", "title": "阶段成果", "stats": [("____", "论文"), ("____", "专利"), ("____", "应用")]},
        {"type": "bullets", "title": "后续计划", "items": ["____", "____"]}]},

    {"file": "46-创意提案.pptx", "title": "创意提案", "subtitle": "CREATIVE PROPOSAL",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["洞察机会", "创意概念", "执行方案", "预期效果"]},
        {"type": "bullets", "title": "洞察机会", "items": ["用户洞察：____", "空白：____"]},
        {"type": "bullets", "title": "创意概念", "items": ["Big Idea：____", "主张：____"]},
        {"type": "image", "title": "执行方案", "caption": "插入创意视觉"},
        {"type": "bullets", "title": "预期效果", "items": ["指标：____", "价值：____"]}]},

    {"file": "47-招聘宣讲.pptx", "title": "校园招聘宣讲", "subtitle": "CAMPUS RECRUITMENT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["走近公司", "业务舞台", "人才培养", "加入我们"]},
        {"type": "bullets", "title": "走近公司", "items": ["简介：____", "亮点：____"]},
        {"type": "bullets", "title": "业务舞台", "items": ["方向：____", "项目：____"]},
        {"type": "bullets", "title": "人才培养", "items": ["导师制", "轮岗", "晋升"]},
        {"type": "bullets", "title": "加入我们", "items": ["岗位：____", "投递：____"]}]},

    {"file": "48-招聘JD.pptx", "title": "岗位招聘说明", "subtitle": "JOB DESCRIPTION",
     "slides": [
        {"type": "agenda", "title": "岗位概览", "items": ["岗位职责", "任职要求", "薪酬福利", "应聘方式"]},
        {"type": "bullets", "title": "岗位职责", "items": ["职责一：____", "职责二：____"]},
        {"type": "bullets", "title": "任职要求", "items": ["学历/经验：____", "技能：____"]},
        {"type": "stats", "title": "薪酬福利", "stats": [("____", "月薪"), ("____", "奖金"), ("____", "福利")]},
        {"type": "bullets", "title": "应聘方式", "items": ["邮箱：____", "截止：____"]}]},

    {"file": "49-电商运营.pptx", "title": "电商运营方案", "subtitle": "E-COMMERCE OPS",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["店铺诊断", "货品策略", "流量运营", "转化提升"]},
        {"type": "bullets", "title": "店铺诊断", "items": ["现状：____", "问题：____"]},
        {"type": "two_col", "title": "货品策略", "left_title": "爆款", "left": ["____", "____"], "right_title": "利润", "right": ["____", "____"]},
        {"type": "bullets", "title": "流量运营", "items": ["搜索：____", "付费：____", "私域：____"]},
        {"type": "stats", "title": "转化提升", "stats": [("____%", "点击"), ("____%", "下单")]}]},

    {"file": "50-短视频运营.pptx", "title": "短视频运营方案", "subtitle": "SHORT VIDEO OPS",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["账号定位", "内容规划", "爆款逻辑", "数据复盘"]},
        {"type": "bullets", "title": "账号定位", "items": ["人设：____", "垂类：____"]},
        {"type": "bullets", "title": "内容规划", "items": ["栏目一：____", "栏目二：____"]},
        {"type": "image", "title": "爆款逻辑", "caption": "插入内容矩阵图"},
        {"type": "stats", "title": "数据复盘", "stats": [("____", "播放"), ("____%", "完播"), ("____", "涨粉")]}]},

    {"file": "51-私域运营.pptx", "title": "私域运营方案", "subtitle": "PRIVATE DOMAIN",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["私域价值", "引流沉淀", "社群运营", "转化裂变"]},
        {"type": "bullets", "title": "私域价值", "items": ["复购：____", "成本：____"]},
        {"type": "bullets", "title": "引流沉淀", "items": ["渠道：____", "钩子：____"]},
        {"type": "two_col", "title": "社群运营", "left_title": "内容", "left": ["____", "____"], "right_title": "活动", "right": ["____", "____"]},
        {"type": "stats", "title": "转化裂变", "stats": [("____", "GMV"), ("____%", "复购")]}]},

    {"file": "52-社会责任报告.pptx", "title": "社会责任报告", "subtitle": "CSR REPORT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["责任理念", "环境保护", "社会贡献", "员工关怀"]},
        {"type": "bullets", "title": "责任理念", "items": ["使命：____", "方针：____"]},
        {"type": "stats", "title": "环境保护", "stats": [("____", "减排"), ("____", "节能")]},
        {"type": "bullets", "title": "社会贡献", "items": ["公益：____", "帮扶：____"]},
        {"type": "bullets", "title": "员工关怀", "items": ["健康：____", "成长：____"]}]},

    {"file": "53-互联网+方案.pptx", "title": "互联网+ 解决方案", "subtitle": "INTERNET PLUS",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["行业痛点", "方案架构", "应用场景", "价值成效"]},
        {"type": "bullets", "title": "行业痛点", "items": ["痛点：____", "瓶颈：____"]},
        {"type": "bullets", "title": "方案架构", "items": ["平台：____", "连接：____", "数据：____"]},
        {"type": "two_col", "title": "应用场景", "left_title": "B端", "left": ["____", "____"], "right_title": "C端", "right": ["____", "____"]},
        {"type": "stats", "title": "价值成效", "stats": [("____%", "提效"), ("____", "覆盖")]}]},

    {"file": "54-工作汇报通用.pptx", "title": "工作汇报（通用）", "subtitle": "WORK REPORT",
     "slides": [
        {"type": "agenda", "title": "目录", "items": ["工作概览", "重点成果", "问题挑战", "下一步计划"]},
        {"type": "bullets", "title": "工作概览", "items": ["本期聚焦 ____", "完成 ____ 项任务"]},
        {"type": "stats", "title": "重点成果", "stats": [("____", "指标A"), ("____", "指标B"), ("____", "指标C")]},
        {"type": "bullets", "title": "问题挑战", "items": ["挑战：____", "应对：____"]},
        {"type": "timeline", "title": "下一步计划", "steps": [("近期", "____"), ("中期", "____"), ("远期", "____")]}]},
]
