const request = async (url: string, options: RequestInit): Promise<Response> => {
  if (url.includes('/tools/')) throw new Error('当前未配置在线素材或 AI 服务')
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  const contentType = response.headers.get('content-type')
  const isStreamResponse = contentType && (
    contentType.includes('text/event-stream') ||
    contentType.includes('application/octet-stream')
  )

  if (!isStreamResponse) {
    try {
      const jsonResponse = await response.json()
      return jsonResponse
    } 
    catch (err) {
      throw new Error('服务器返回了非流响应')
    }
  }

  return response
}

export default request
