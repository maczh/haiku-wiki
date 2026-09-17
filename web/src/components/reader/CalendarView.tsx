import { useMemo } from 'react'
import CalendarBoard from '../calendar/CalendarBoard'
import { parseCalendarJSON } from '../../lib/calendar'

/** 工作日历阅读视图：复用日历面板，仅关闭所有变更入口。 */
export default function CalendarView({ content }: { content: string }) {
  const parsed = useMemo(() => parseCalendarJSON(content), [content])
  return (
    <div style={{ paddingTop: 8 }}>
      <CalendarBoard value={parsed.data} readOnly />
    </div>
  )
}
