import { useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';
import { api } from '../api/client';
import type {
  KpWithStats,
  LearningResourceItem,
  LearningResourceReport,
  LearningVideoCuration,
  LearningVideoCurationPayload,
} from '../types';

const panelStyle: React.CSSProperties = {
  background: '#fffdf8',
  border: '1px solid #e8e0d2',
  borderRadius: 8,
  boxShadow: '0 1px 3px rgba(36, 30, 18, 0.04)',
};

interface LearningResourcesPageProps {
  kps: KpWithStats[];
  selectedVolumeKey: string | null;
  selectedKpId: string | null;
  selectedChapterKey: string | null;
  selectedSectionKey: string | null;
  allQuestionsId: string;
}

function splitKey(key: string | null | undefined): string[] {
  return key ? key.split('||') : [];
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div style={{ ...panelStyle, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#7b8794', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#1f2933', lineHeight: 1 }}>{value}</div>
      {hint && <div style={{ fontSize: 12, color: '#8a7458', marginTop: 8 }}>{hint}</div>}
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: 4,
      padding: '2px 7px',
      fontSize: 12,
      fontWeight: 700,
      background: ok ? '#e8f5ee' : '#fff1e6',
      color: ok ? '#2f7d4f' : '#c2410c',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function ResourceText({ item }: { item: LearningResourceItem }) {
  const demos = [
    ...item.simulations.local_demos,
    ...item.simulations.backend_simulations,
  ];
  if (item.simulations.learning_content) return <span>{item.simulations.learning_content.title}</span>;
  if (demos.length > 0) return <span>{demos.map(demo => demo.title).join('、')}</span>;
  return <span style={{ color: '#9ca3af' }}>待配置</span>;
}

/** 与学生端一致：只有 B 站视频页链接会展示给学生。 */
function isBilibiliVideoUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && (url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com'))
      && url.pathname.startsWith('/video/');
  } catch {
    return false;
  }
}

const emptyVideoForm = (kpId: string): LearningVideoCurationPayload => ({
  knowledge_point_id: kpId,
  video_type: 'lecture',
  title: '',
  url: '',
  uploader: '',
  reason: '',
  match_focus: '',
  priority: 1,
  enabled: true,
});

function VideoTypeLabel({ type }: { type: string }) {
  return <StatusBadge ok label={type === 'experiment' ? '演示实验' : '讲解视频'} />;
}

export default function LearningResourcesPage({
  kps,
  selectedVolumeKey,
  selectedKpId,
  selectedChapterKey,
  selectedSectionKey,
  allQuestionsId,
}: LearningResourcesPageProps) {
  const [report, setReport] = useState<LearningResourceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'missing_card' | 'missing_video' | 'missing_simulation'>('all');
  const [videoPanelKp, setVideoPanelKp] = useState<LearningResourceItem | null>(null);
  const [videoRows, setVideoRows] = useState<LearningVideoCuration[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [editingVideoId, setEditingVideoId] = useState<number | null>(null);
  const [videoForm, setVideoForm] = useState<LearningVideoCurationPayload | null>(null);
  const [videoSaving, setVideoSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LearningVideoCuration | null>(null);
  const videoPanelRef = useRef<HTMLDivElement>(null);

  const selectedKp = useMemo(
    () => selectedKpId && selectedKpId !== allQuestionsId
      ? kps.find(kp => kp.id === selectedKpId) || null
      : null,
    [allQuestionsId, kps, selectedKpId],
  );

  const scope = useMemo(() => {
    if (selectedKp) {
      return {
        params: { kp_id: selectedKp.id },
      };
    }
    if (selectedSectionKey) {
      const [volume, chapter, section] = splitKey(selectedSectionKey);
      const params: Record<string, string> = {};
      if (volume) params.volume = volume;
      if (chapter) params.chapter = chapter;
      if (section) params.section = section;
      return { params };
    }
    if (selectedChapterKey) {
      const [volume, chapter] = splitKey(selectedChapterKey);
      const params: Record<string, string> = {};
      if (volume) params.volume = volume;
      if (chapter) params.chapter = chapter;
      return { params };
    }
    if (selectedVolumeKey) {
      return { params: { volume: selectedVolumeKey } };
    }
    return {
      params: undefined,
    };
  }, [selectedChapterKey, selectedKp, selectedSectionKey, selectedVolumeKey]);

  // silent：保存视频后刷新统计时不切换成整页“加载中”，保留滚动位置。
  const load = async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      setReport(await api.getLearningResources(scope.params));
    } catch (e: any) {
      setError(e.message || '加载学习资源失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadVideos = async (item: LearningResourceItem, { reveal = false } = {}) => {
    setVideoPanelKp(item);
    // 面板在列表上方，点击下方某行时滚动过去，否则看不到发生了什么。
    if (reveal) window.requestAnimationFrame(() => videoPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    setVideoLoading(true);
    setVideoError(null);
    setEditingVideoId(null);
    setVideoForm(emptyVideoForm(item.kp_id));
    try {
      setVideoRows(await api.listLearningVideos(item.kp_id));
    } catch (e: any) {
      setVideoError(e.message || '加载视频失败');
    } finally {
      setVideoLoading(false);
    }
  };

  const saveVideo = async () => {
    if (!videoPanelKp || !videoForm) return;
    if (videoSaving) return;
    if (!videoForm.title?.trim() || !videoForm.url?.trim()) {
      setVideoError('标题和 B 站链接不能为空');
      return;
    }
    if (!isBilibiliVideoUrl(videoForm.url)) {
      setVideoError('请填写 B 站视频页链接，例如 https://www.bilibili.com/video/BV...；其他链接学生端不会显示');
      return;
    }
    setVideoSaving(true);
    setVideoError(null);
    const payload = {
      ...videoForm,
      knowledge_point_id: videoPanelKp.kp_id,
      priority: Number(videoForm.priority ?? 100),
    };
    try {
      if (editingVideoId) await api.updateLearningVideo(editingVideoId, payload);
      else await api.createLearningVideo(payload);
      await loadVideos(videoPanelKp);
      await load({ silent: true });
    } catch (e: any) {
      setVideoError(e.message || '保存视频失败');
    } finally {
      setVideoSaving(false);
    }
  };

  const editVideo = (row: LearningVideoCuration) => {
    setEditingVideoId(row.id);
    setVideoForm({
      knowledge_point_id: row.knowledge_point_id,
      video_type: row.video_type,
      title: row.title,
      url: row.url,
      uploader: row.uploader || '',
      reason: row.reason || '',
      match_focus: row.match_focus || '',
      priority: row.priority,
      enabled: row.enabled,
    });
  };

  const deleteVideo = async (row: LearningVideoCuration) => {
    if (!videoPanelKp) return;
    setVideoSaving(true);
    try {
      await api.deleteLearningVideo(row.id);
      setPendingDelete(null);
      await loadVideos(videoPanelKp);
      await load({ silent: true });
    } catch (e: any) {
      setPendingDelete(null);
      setVideoError(e.message || '删除视频失败');
    } finally {
      setVideoSaving(false);
    }
  };

  useEffect(() => {
    setFilter('all');
    void load();
  }, [scope.params?.chapter, scope.params?.kp_id, scope.params?.section, scope.params?.volume]);

  const items = useMemo(() => {
    const rows = report?.items || [];
    if (filter === 'missing_card') return rows.filter(item => !item.contents.card);
    if (filter === 'missing_video') return rows.filter(item => item.video.curated_count === 0);
    if (filter === 'missing_simulation') return rows.filter(item => !item.simulations.has_simulation);
    return rows;
  }, [filter, report]);

  if (loading) {
    return <div style={{ padding: 32, color: '#667085' }}>加载学习资源...</div>;
  }
  if (error || !report) {
    return (
      <div style={{ padding: 32 }}>
        <div style={{ color: '#b42318', marginBottom: 12 }}>{error || '暂无资源报告'}</div>
        <button onClick={() => { void load(); }} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff' }}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 14 }}>
        <MetricCard label="知识点" value={report.summary.kp_count} hint="当前范围" />
        <MetricCard label="知识卡片" value={report.summary.card_count} hint={`缺 ${report.summary.missing_card_count}`} />
        <MetricCard label="精选讲解" value={report.summary.video_count} hint={`缺 ${report.summary.missing_video_count}`} />
        <MetricCard label="互动模拟" value={report.summary.simulation_count} hint={`缺 ${report.summary.missing_simulation_count}`} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {([
          ['all', '全部'],
          ['missing_card', '缺知识卡片'],
          ['missing_video', '缺精选讲解'],
          ['missing_simulation', '缺互动模拟'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            style={{
              padding: '8px 14px',
              borderRadius: 6,
              border: filter === value ? '1px solid #0d7377' : '1px solid #d9d2c5',
              background: filter === value ? '#e0f5f6' : '#fffdf8',
              color: filter === value ? '#0d7377' : '#52606d',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {videoPanelKp && videoForm && (
        <div ref={videoPanelRef} style={{ ...panelStyle, padding: 16, marginBottom: 14, background: '#fff', scrollMarginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#1f2933' }}>视频维护：{videoPanelKp.kp_name}</div>
              <div style={{ fontSize: 12, color: '#697386', marginTop: 4 }}>
                添加后学生端优先显示教师精选；没有添加时仍使用 B 站搜索兜底。
              </div>
            </div>
            <button
              onClick={() => setVideoPanelKp(null)}
              style={{ border: '1px solid #d9d2c5', borderRadius: 6, background: '#fff', padding: '7px 11px', cursor: 'pointer' }}
            >
              收起
            </button>
          </div>

          {videoError && <div style={{ color: '#b42318', fontSize: 13, marginBottom: 10 }}>{videoError}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 1fr 90px', gap: 10, marginBottom: 10 }}>
            <select
              value={videoForm.video_type || 'lecture'}
              onChange={e => setVideoForm(prev => ({ ...prev!, video_type: e.target.value }))}
              style={{ border: '1px solid #d0d5dd', borderRadius: 6, padding: '8px 10px' }}
            >
              <option value="lecture">讲解视频</option>
              <option value="experiment">演示实验</option>
            </select>
            <input
              value={videoForm.title || ''}
              onChange={e => setVideoForm(prev => ({ ...prev!, title: e.target.value }))}
              placeholder="视频标题"
              style={{ border: '1px solid #d0d5dd', borderRadius: 6, padding: '8px 10px' }}
            />
            <input
              value={videoForm.uploader || ''}
              onChange={e => setVideoForm(prev => ({ ...prev!, uploader: e.target.value }))}
              placeholder="UP 主"
              style={{ border: '1px solid #d0d5dd', borderRadius: 6, padding: '8px 10px' }}
            />
            <input
              type="number"
              value={videoForm.priority ?? 100}
              onChange={e => setVideoForm(prev => ({ ...prev!, priority: Number(e.target.value) }))}
              placeholder="排序"
              style={{ border: '1px solid #d0d5dd', borderRadius: 6, padding: '8px 10px' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 10, marginBottom: 10 }}>
            <input
              value={videoForm.url || ''}
              onChange={e => setVideoForm(prev => ({ ...prev!, url: e.target.value }))}
              placeholder="B站视频链接，例如 https://www.bilibili.com/video/BV..."
              style={{ border: '1px solid #d0d5dd', borderRadius: 6, padding: '8px 10px' }}
            />
            <input
              value={videoForm.reason || ''}
              onChange={e => setVideoForm(prev => ({ ...prev!, reason: e.target.value }))}
              placeholder="推荐理由"
              style={{ border: '1px solid #d0d5dd', borderRadius: 6, padding: '8px 10px' }}
            />
            <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: '#52606d', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={videoForm.enabled !== false}
                onChange={e => setVideoForm(prev => ({ ...prev!, enabled: e.target.checked }))}
              />
              启用
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={saveVideo}
              disabled={videoSaving}
              style={{ border: '1px solid #0d7377', borderRadius: 6, background: '#0d7377', color: '#fff', padding: '8px 14px', cursor: videoSaving ? 'default' : 'pointer', fontWeight: 800, opacity: videoSaving ? 0.6 : 1 }}
            >
              {videoSaving ? '保存中…' : editingVideoId ? '保存修改' : '添加视频'}
            </button>
            {editingVideoId && (
              <button
                onClick={() => { setEditingVideoId(null); setVideoForm(emptyVideoForm(videoPanelKp.kp_id)); }}
                style={{ border: '1px solid #d9d2c5', borderRadius: 6, background: '#fff', padding: '8px 14px', cursor: 'pointer' }}
              >
                取消编辑
              </button>
            )}
          </div>

          {videoLoading ? (
            <div style={{ color: '#667085', fontSize: 13 }}>加载视频...</div>
          ) : videoRows.length === 0 ? (
            <div style={{ color: '#667085', fontSize: 13 }}>当前没有人工精选视频，学生端会继续使用搜索兜底。</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {videoRows.map(row => (
                <div key={row.id} style={{ border: '1px solid #edf2f7', borderRadius: 8, padding: 10, display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                      <VideoTypeLabel type={row.video_type} />
                      {!row.enabled && <StatusBadge ok={false} label="停用" />}
                      <span style={{ fontWeight: 800, color: '#1f2933' }}>{row.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#52606d', lineHeight: 1.6 }}>
                      {[row.uploader, row.reason].filter(Boolean).join(' · ') || '未填写说明'}
                    </div>
                    <a href={row.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#0d7377', wordBreak: 'break-all' }}>{row.url}</a>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'start' }}>
                    <button onClick={() => editVideo(row)} style={{ border: '1px solid #d0d5dd', borderRadius: 6, background: '#fff', padding: '6px 10px', cursor: 'pointer' }}>编辑</button>
                    <button onClick={() => setPendingDelete(row)} style={{ border: '1px solid #f3b4a5', borderRadius: 6, background: '#fff7f4', color: '#b42318', padding: '6px 10px', cursor: 'pointer' }}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ ...panelStyle, overflow: 'hidden' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(160px, 0.8fr) minmax(180px, 0.9fr) minmax(220px, 1fr) 90px',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid #eee4d7',
          fontSize: 12,
          fontWeight: 800,
          color: '#697386',
          background: '#faf4ea',
        }}>
          <div>知识点</div>
          <div>知识卡片</div>
          <div>讲解视频</div>
          <div>互动模拟</div>
          <div>题量</div>
        </div>
        {items.length === 0 ? (
          <div style={{ padding: 24, color: '#667085' }}>当前筛选下没有资源缺口</div>
        ) : items.map(item => (
          <div
            key={item.kp_id}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(160px, 0.8fr) minmax(180px, 0.9fr) minmax(220px, 1fr) 90px',
              gap: 12,
              padding: '13px 16px',
              borderBottom: '1px solid #f2eadf',
              alignItems: 'start',
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#1f2933' }}>{item.kp_name}</div>
              <div style={{ fontSize: 12, color: '#697386', marginTop: 4 }}>
                {[item.volume, item.chapter, item.section].filter(Boolean).join(' · ')}
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#98a2b3', marginTop: 4 }}>{item.kp_id}</div>
            </div>
            <div>
              <StatusBadge ok={Boolean(item.contents.card)} label={item.contents.card ? '已配置' : '缺卡片'} />
              <div style={{ fontSize: 12, color: '#52606d', marginTop: 6, lineHeight: 1.5 }}>
                {item.contents.card?.title || '学生学习页缺少高质量知识卡片'}
              </div>
            </div>
            <div>
              <StatusBadge ok={item.video.curated_count > 0} label={item.video.curated_count > 0 ? '已精选' : '待精选'} />
              <div style={{ fontSize: 12, color: '#52606d', marginTop: 6, lineHeight: 1.5 }}>
                {item.video.top_title || '当前仅依赖搜索兜底'}
              </div>
              <button
                onClick={() => loadVideos(item, { reveal: true })}
                style={{
                  marginTop: 8,
                  border: '1px solid #d9d2c5',
                  borderRadius: 6,
                  background: videoPanelKp?.kp_id === item.kp_id ? '#e0f5f6' : '#fff',
                  color: '#0d7377',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 800,
                  padding: '5px 9px',
                }}
              >
                管理视频
              </button>
            </div>
            <div>
              <StatusBadge ok={item.simulations.has_simulation} label={item.simulations.has_simulation ? '有模拟' : '待配置'} />
              <div style={{ fontSize: 12, color: '#52606d', marginTop: 6, lineHeight: 1.5 }}>
                <ResourceText item={item} />
              </div>
            </div>
            <div style={{ fontSize: 13, color: '#1f2933', fontWeight: 800 }}>{item.question_count}</div>
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除精选视频"
        message={pendingDelete ? `删除「${pendingDelete.title}」？删除后学生端不再显示这条推荐。` : ''}
        confirmLabel="删除"
        tone="danger"
        busy={videoSaving}
        onConfirm={() => { if (pendingDelete) void deleteVideo(pendingDelete); }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
