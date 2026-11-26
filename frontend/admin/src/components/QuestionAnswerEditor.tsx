import { useId, useState } from 'react';
import { api } from '../api/client';
import { LatexSpan } from '../common/LatexSpan';
import type { Question } from '../types';
import { getImageScaleStyle } from '../../../shared/questionImageDisplay';
import './QuestionAnswerEditor.css';

export type QuestionAnswerUpdate = Pick<Question, 'id' | 'answer' | 'explanation'>;

function AnswerContent({ q, answer, explanation }: {
  q: Question;
  answer?: string;
  explanation?: string;
}) {
  const imagePaths = q.images.map(image => image.image_path);
  const imageScaleStyles = q.images.map(getImageScaleStyle);
  return (
    <div className="question-answer-content">
      <div>
        <div className="question-answer-label">答案</div>
        {answer ? <LatexSpan text={answer} imagePaths={imagePaths} imageScaleStyles={imageScaleStyles} />
          : <span className="question-answer-muted">暂无答案</span>}
      </div>
      <div>
        <div className="question-answer-label">解析</div>
        {explanation ? <LatexSpan text={explanation} imagePaths={imagePaths} imageScaleStyles={imageScaleStyles} />
          : <span className="question-answer-muted">暂无解析</span>}
      </div>
      {q.images.some(image => image.image_type === 'explanation') && (
        <div className="question-answer-images">
          {q.images.filter(image => image.image_type === 'explanation').map(image => (
            <figure key={image.id}>
              <img src={image.image_path} alt={image.description || '解析配图'} style={getImageScaleStyle(image)} />
              {image.description && <figcaption>{image.description}</figcaption>}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

export default function QuestionAnswerEditor({ q, onUpdate }: {
  q: Question;
  onUpdate: (updated: QuestionAnswerUpdate) => void;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState('');
  const [explanation, setExplanation] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = answer !== (q.answer ?? '') || explanation !== (q.explanation ?? '');

  function startEditing() {
    setAnswer(q.answer ?? '');
    setExplanation(q.explanation ?? '');
    setError(null);
    setSaved(false);
    setShowPreview(false);
    setEditing(true);
  }

  async function save() {
    if (saving || !changed) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.updateQuestion(q.id, {
        answer: answer.trim() ? answer : null,
        explanation: explanation.trim() ? explanation : null,
      });
      onUpdate({ id: q.id, answer: result.answer ?? undefined, explanation: result.explanation ?? undefined });
      setEditing(false);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="question-answer-editor" aria-labelledby={`${id}-title`}>
      <div className="question-answer-heading">
        <h4 id={`${id}-title`}>答案与解析</h4>
        {saved && <span className="question-answer-success" role="status">答案解析已保存</span>}
        {!editing && <button type="button" onClick={startEditing}>编辑答案解析</button>}
      </div>
      {editing ? (
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
          <label htmlFor={`${id}-answer`} className="question-answer-label">答案</label>
          <textarea id={`${id}-answer`} value={answer} rows={3} autoFocus disabled={saving}
            placeholder="填写答案；多个小问可分行填写" aria-describedby={`${id}-hint`}
            onChange={event => setAnswer(event.target.value)} />
          <label htmlFor={`${id}-explanation`} className="question-answer-label">解析</label>
          <textarea id={`${id}-explanation`} value={explanation} rows={8} disabled={saving}
            placeholder="填写解题思路、推导过程和关键步骤" aria-describedby={`${id}-hint`}
            onChange={event => setExplanation(event.target.value)} />
          <p id={`${id}-hint`} className="question-answer-hint">
            {'支持分行和公式，如 $F=ma$；清空后保存可移除对应内容。'}
            {q.images.length > 0 && ' 已有的 {{IMG:0}} 等配图标记可保留，预览可检查配图位置。'}
          </p>
          {error && <p className="question-answer-error" role="alert">保存失败：{error}。已保留编辑内容，可重试。</p>}
          <div className="question-answer-actions">
            <button type="submit" className="question-answer-primary" disabled={saving || !changed}>
              {saving ? '保存中…' : '保存答案解析'}
            </button>
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(null); }}>取消</button>
            <button type="button" aria-expanded={showPreview} aria-controls={`${id}-preview`}
              onClick={() => setShowPreview(value => !value)}>{showPreview ? '收起预览' : '预览效果'}</button>
          </div>
          {showPreview && <div id={`${id}-preview`} className="question-answer-preview">
            <div className="question-answer-label">效果预览</div>
            <AnswerContent q={q} answer={answer} explanation={explanation} />
          </div>}
        </form>
      ) : <AnswerContent q={q} answer={q.answer} explanation={q.explanation} />}
    </section>
  );
}
