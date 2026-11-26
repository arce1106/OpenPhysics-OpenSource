import { useRef, useState } from 'react';
import { api } from '../api/client';
import type { QuestionVideo } from '../types';
import './QuestionVideoEditor.css';

export function QuestionVideoBadge({ hasVideo, draft }: { hasVideo?: boolean; draft?: boolean }) {
  if (!hasVideo && !draft) return null;
  return <span className={`question-video-badge${hasVideo ? '' : ' question-video-badge--draft'}`}>
    {hasVideo ? '有视频讲解' : '视频待发布'}
  </span>;
}

export default function QuestionVideoEditor({ questionId, video, onChange }: {
  questionId: string;
  video?: QuestionVideo | null;
  onChange: (video: QuestionVideo) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(video?.title || '本题视频讲解');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try { await action(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : '视频操作失败，请重试');
    } finally { setBusy(false); }
  };

  return <section className="question-video-editor" aria-label="题目视频讲解">
    <div className="question-video-editor__heading">
      <h4>视频讲解</h4>
      <QuestionVideoBadge hasVideo={video?.status === 'approved'} draft={video?.status === 'draft'} />
    </div>
    {video ? <>
      <p>{video.title} · {Math.floor(video.duration_seconds / 60)}分{video.duration_seconds % 60}秒</p>
      <div className="question-video-editor__actions">
        <button disabled={busy} onClick={() => void run(async () => {
          const result = await api.previewQuestionVideo(questionId);
          setPreviewUrl(result.video_url);
        })}>{previewUrl ? '刷新预览' : '预览视频'}</button>
        <button disabled={busy} onClick={() => void run(async () => {
          const status = video.status === 'approved' ? 'draft' : 'approved';
          onChange(await api.reviewQuestionVideo(questionId, status));
          setMessage(status === 'approved' ? '视频已发布，学生完成作答后可以选择观看。' : '已暂停向学生提供此视频。');
        })}>{video.status === 'approved' ? '暂不发布' : '审核通过并发布'}</button>
        {previewUrl ? <button onClick={() => setPreviewUrl('')}>关闭预览</button> : null}
      </div>
      {previewUrl ? <video key={previewUrl} controls playsInline preload="metadata" src={previewUrl}
        aria-label="题目视频预览" onError={() => setError('视频暂时无法播放，请刷新预览后重试。')} /> : null}
    </> : <p>这道题尚未配视频。</p>}
    <form onSubmit={event => {
      event.preventDefault();
      if (!file) return;
      void run(async () => {
        const uploaded = await api.uploadQuestionVideo(questionId, file, title);
        setPreviewUrl('');
        onChange(uploaded);
        setFile(null);
        if (fileInput.current) fileInput.current.value = '';
        setMessage('上传完成。预览确认后，点击“审核通过并发布”。');
      });
    }}>
      <label>讲解标题
        <input value={title} maxLength={160} disabled={busy} onChange={event => setTitle(event.target.value)} />
      </label>
      <div className="question-video-editor__actions">
        <label className="question-video-editor__file">{video ? '选择替换视频' : '选择视频'}
          <input ref={fileInput} type="file" accept="video/mp4,.mp4" disabled={busy} onChange={event => {
            const selected = event.target.files?.[0] || null;
            setError('');
            if (selected && selected.size > 512 * 1024 * 1024) {
              setError('单个视频请控制在 512 MB 以内');
              setFile(null);
              event.target.value = '';
            } else setFile(selected);
          }} />
        </label>
        <button type="submit" disabled={!file || busy}>{busy ? '正在处理…' : video ? '上传替换视频' : '上传视频'}</button>
      </div>
      <p className="question-video-editor__hint">MP4，最大 512 MB。{video ? '替换后需再次审核发布。' : '上传后可预览并发布。'}发布后自动标记“有视频讲解”。</p>
    </form>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert" className="question-video-editor__error">{error}</p> : null}
  </section>;
}
