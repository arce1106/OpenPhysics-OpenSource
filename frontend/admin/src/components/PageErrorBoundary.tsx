import { Component, type ErrorInfo, type ReactNode } from 'react';

/** 发版后旧页面再去加载已被替换的分包文件时，浏览器会报这类错误。 */
export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk .* failed/i.test(message);
}

interface Props {
  children: ReactNode;
}

interface State {
  error: unknown;
}

/**
 * 页面出错时显示可恢复的提示，而不是整页白屏。
 * 调用方用路由路径作为 key，切换页面时会自动重置。
 */
export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[admin] page crashed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleChunkError(error);
    return (
      <div role="alert" style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
        <div style={{
          maxWidth: 460, background: '#fffdf8', border: '1px solid #e8e0d2', borderRadius: 8,
          padding: 20, color: '#1f2933', lineHeight: 1.7,
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>
            {stale ? '管理端已更新' : '页面出错了'}
          </div>
          <div style={{ fontSize: 13, color: '#52606d', marginBottom: 14 }}>
            {stale
              ? '服务器上已有新版本，当前页面需要刷新后才能继续使用。未保存的编辑内容会丢失。'
              : '这个页面遇到意外错误，刷新后通常可以恢复。如果反复出现，请把出错时的操作告诉开发人员。'}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: 0, borderRadius: 6, background: '#0d7377', color: '#fff',
              padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}
