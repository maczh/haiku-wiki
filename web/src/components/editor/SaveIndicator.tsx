import { CheckCircleOutlined, CloudUploadOutlined, EditOutlined } from '@ant-design/icons'
import { Space, Typography } from 'antd'

export type SaveStatus = 'editing' | 'saving' | 'saved'

/** 保存状态条：编辑中 / 保存中 / 已自动保存 HH:mm */
export default function SaveIndicator({ status, savedAt }: { status: SaveStatus; savedAt: string | null }) {
  if (status === 'saving') {
    return (
      <Space size={4} style={{ color: '#8a919f', fontSize: 12 }}>
        <CloudUploadOutlined spin />
        保存中…
      </Space>
    )
  }
  if (status === 'saved') {
    return (
      <Space size={4} style={{ color: '#52c41a', fontSize: 12 }}>
        <CheckCircleOutlined />
        已自动保存 {savedAt}
      </Space>
    )
  }
  return (
    <Space size={4} style={{ color: '#8a919f', fontSize: 12 }}>
      <EditOutlined />
      编辑中
    </Space>
  )
}

export function SaveTitle({ title }: { title: string }) {
  return <Typography.Text strong ellipsis style={{ maxWidth: 300 }}>{title}</Typography.Text>
}
