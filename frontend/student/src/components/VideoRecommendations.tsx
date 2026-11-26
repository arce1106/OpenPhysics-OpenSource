import { useEffect, useState, type MouseEvent } from 'react';
import { resolveAssetUrl } from '../api/baseUrl';
import { api } from '../api/client';
import type { VideoRecommendationResponse } from '../types';
import { openExternalUrl } from '../utils/externalLinks';

interface Props {
  kpId: string;
}

export default function VideoRecommendations({ kpId }: Props) {
  const [data, setData] = useState<VideoRecommendationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api.getLearnVideos(kpId)
      .then(result => {
        if (alive) setData(result);
      })
      .catch((e: any) => {
        if (alive) setError(e.message || '视频推荐加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [kpId]);

  if (loading) return <div style={{ color: '#999', padding: 24, textAlign: 'center' }}>正在搜索相关视频...</div>;
  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return null;

  const experimentItems = data.experiments?.length
    ? data.experiments
    : (data.experiment ? [data.experiment] : []);

  const handleVideoClick = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    void openExternalUrl(url);
  };

  return (
    <div className="video-recommendations">
      <div className="video-recommendations-header">
        <div>
          <div className="video-recommendations-title">B站视频讲解</div>
          <div className="video-recommendations-subtitle">
            当前知识点最相关的一条讲解
          </div>
        </div>
      </div>

      <div className="video-list">
        {data.items.map(item => (
          <a
            key={item.id}
            className="video-card"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={event => handleVideoClick(event, item.url)}
          >
            {item.cover_url ? (
              <img src={resolveAssetUrl(item.cover_url)} alt="" className="video-cover" loading="lazy" decoding="async" />
            ) : (
              <div className="video-cover-placeholder">Bilibili</div>
            )}
            <div className="video-card-body">
              <div className="video-card-category">{item.category || (item.source === 'teacher_curated' ? '教师精选' : '相关讲解')}</div>
              <div className="video-card-title">{item.title}</div>
              <div className="video-card-meta">
                {item.uploader || (item.source === 'bilibili_search' ? 'B站搜索' : 'B站')}
                {item.duration ? ` · ${item.duration}` : ''}
                {item.play_count ? ` · ${item.play_count}播放` : ''}
              </div>
            </div>
          </a>
        ))}
      </div>

      {experimentItems.length > 0 && (
        <div className="video-experiment-section">
          <div className="video-experiment-title">演示实验</div>
          <div className="video-list">
            {experimentItems.map(item => (
              <a
                key={item.id}
                className="video-card video-card-experiment"
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={event => handleVideoClick(event, item.url)}
              >
                {item.cover_url ? (
                  <img src={resolveAssetUrl(item.cover_url)} alt="" className="video-cover" loading="lazy" decoding="async" />
                ) : (
                  <div className="video-cover-placeholder">实验</div>
                )}
                <div className="video-card-body">
                  <div className="video-card-category">{item.category || '演示实验'}</div>
                  <div className="video-card-title">{item.title}</div>
                  <div className="video-card-meta">
                    {item.uploader || 'B站'}
                    {item.duration ? ` · ${item.duration}` : ''}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
