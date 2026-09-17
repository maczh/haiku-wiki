import { useEffect } from 'react'
import { Card, Form, Input, Button, Divider, Typography, message } from 'antd'
import { me, updateMe } from '../api/auth'
import { useAuthStore } from '../stores/authStore'

/** 账号设置：修改昵称 / 密码 */
export default function SettingsPage() {
  const { user, setUser } = useAuthStore()
  const [nicknameForm] = Form.useForm()
  const [passwordForm] = Form.useForm()

  useEffect(() => {
    if (user) {
      me().then((u) => {
        setUser(u)
        nicknameForm.setFieldsValue({ nickname: u.nickname, email: u.email })
      })
    }
  }, [user?.id])

  async function saveNickname(values: { nickname: string }) {
    const u = await updateMe({ nickname: values.nickname })
    if ('nickname' in (u as object)) setUser(u as never)
    message.success('昵称已更新')
  }

  async function savePassword(values: { old_password: string; new_password: string }) {
    await updateMe({ old_password: values.old_password, new_password: values.new_password })
    message.success('密码已更新')
    passwordForm.resetFields()
  }

  return (
    <div style={{ maxWidth: 560, margin: '32px auto', padding: '0 16px' }}>
      <Typography.Title level={4}>账号设置</Typography.Title>

      <Card title="基本资料" style={{ marginTop: 16 }}>
        <Form form={nicknameForm} layout="vertical" onFinish={saveNickname}>
          <Form.Item label="邮箱">
            <Input value={user?.email} disabled />
          </Form.Item>
          <Form.Item
            label="昵称"
            name="nickname"
            rules={[{ required: true, message: '请输入昵称' }, { max: 64, message: '昵称过长' }]}
          >
            <Input placeholder="昵称" />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存
          </Button>
        </Form>
      </Card>

      <Divider />

      <Card title="修改密码">
        <Form form={passwordForm} layout="vertical" onFinish={savePassword}>
          <Form.Item label="旧密码" name="old_password" rules={[{ required: true, message: '请输入旧密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="new_password"
            rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '至少 6 位' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirm"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('new_password') === value) return Promise.resolve()
                  return Promise.reject(new Error('两次输入不一致'))
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            更新密码
          </Button>
        </Form>
      </Card>
    </div>
  )
}
