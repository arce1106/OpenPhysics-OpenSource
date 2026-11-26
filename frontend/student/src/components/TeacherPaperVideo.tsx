import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { resolveAssetUrl } from '../api/baseUrl';
import { api } from '../api/client';
import type { QuestionLessonVideo, TeacherPaperQuestionVideo } from '../types';
import './TeacherPaperVideoCard.css';

export default function TeacherPaperVideo({ lesson, questionId, answerId, buttonClassName = 'page-back-button' }: {
  lesson?: QuestionLessonVideo | null; questionId: string; answerId?: number | null; buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [video, setVideo] = useState<TeacherPaperQuestionVideo | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnTop = useRef<number | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  useEffect(() => {
    if (!open) return;
    const previousFocus = trigger.current || document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const targets = dialog.current?.querySelectorAll<HTMLElement>('button, video[controls]');
      if (!targets?.length) return;
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (!previousFocus?.isConnected) return;
      previousFocus.focus({ preventScroll: true });
      if (returnTop.current !== null) {
        const offset = previousFocus.getBoundingClientRect().top - returnTop.current;
        if (Math.abs(offset) > 1) window.scrollBy({ top: offset, left: 0, behavior: 'instant' });
      }
    };
  }, [open]);

  const loadVideo = async () => {
    if (!open) returnTop.current = trigger.current?.getBoundingClientRect().top ?? null;
    setLoading(true);
    setError('');
    setFailed(false);
    try {
      if (!lesson?.available || !answerId) throw new Error(lesson?.locked_reason || '请先完成作答批改');
      const selected = await api.getQuestionLessonVideo(questionId, answerId);
      if (selected.question_id !== questionId) throw new Error('本题视频暂未准备好');
      setVideo(selected);
      setAttempt(current => current + 1);
      setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '讲解视频加载失败，请重试');
    } finally {
      setLoading(false);
    }
  };
  if (!lesson) return null;
  if (!lesson.available || !answerId) return <span className="lesson-video-locked">{lesson.locked_reason || '整套批改后可看视频讲解'}</span>;
  return (
    <>
      <button ref={trigger} type="button" className={buttonClassName} disabled={loading} onClick={() => void loadVideo()}>
        {loading ? '正在加载讲解...' : '视频讲解'}
      </button>
      {error ? <span role="alert">{error}</span> : null}
      {open && video ? createPortal(
        <div className="teacher-paper-video-overlay">
          <div ref={dialog} className="teacher-paper-video-dialog" role="dialog" aria-modal="true" aria-label={video.title} tabIndex={-1}>
            <div className="teacher-paper-video-heading">
              <div><strong>{video.title}</strong><p>本题讲解 · 可拖动进度观看</p></div>
              <button type="button" className="page-back-button" onClick={() => setOpen(false)}>关闭视频，返回题目</button>
            </div>
            <div className="teacher-paper-video-player">
              <video
                key={attempt}
                controls playsInline preload="metadata"
                src={resolveAssetUrl(video.video_url)}
                aria-label={`${video.title}讲解视频`}
                onTimeUpdate={event => { position.current = event.currentTarget.currentTime; }}
                onLoadedMetadata={event => { event.currentTarget.currentTime = position.current; }}
                onError={() => setFailed(true)}
              >当前浏览器无法播放此视频。</video>
              {failed ? (
                <div role="alert" className="teacher-paper-video-error">
                  <span>视频暂时无法加载，请检查网络后重试。</span>
                  <button type="button" disabled={loading} onClick={() => void loadVideo()}>重新加载</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>, document.body,
      ) : null}
    </>
  );
}
