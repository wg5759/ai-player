import React from 'react'

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen text-gray-400 text-center">
          <div>
            <p className="text-xl mb-2">出错了</p>
            <p className="text-sm">请重启应用</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
