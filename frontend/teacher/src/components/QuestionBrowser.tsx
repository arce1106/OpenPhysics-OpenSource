import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { TIER_COLORS } from '../catalog';
import { DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, percent, tierLabel, typeLabel } from '../labels';
import type { BankQuestion, QuestionFilters, QuestionPage } from '../types';
import { withUnplacedFigures } from '../questionFigures';
import type { CatalogScope } from './CatalogTree';
import RichText from './RichText';

const PAGE_SIZE = 10;

export function QuestionMeta({ question, showHistory = true }: { question: BankQuestion; showHistory?: boolean }) {
  return (
    <span className="question-meta">
      {typeLabel(question.question_type)} · {tierLabel(question.difficulty_tier)}
      {question.primary_kp && ` · ${question.primary_kp.name}`}
      {showHistory && <> · <ClassStat question={question} /></>}
    </span>
  );
}

function ClassStat({ question }: { question: BankQuestion }) {
  return question.class_attempted > 0 && question.class_correct_rate !== null
    ? <>{question.class_attempted} 名学生做过，正确率 {percent(question.class_correct_rate)}</>
    : <>学生未做过</>;
}

export function QuestionBody({ question }: { question: BankQuestion }) {
  return (
    <>
      <RichText text={withUnplacedFigures(question, 'stem')} imagePaths={question.image_paths} />
      {question.options.length > 0 && (
        <ol className="options">
          {question.options.map((option) => (
            <li key={option.label}>
              <span className="option-label">{option.label}.</span>
              <RichText text={option.text} imagePaths={question.image_paths} className="inline" />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

/** The reference answer and worked explanation, opened from a bank card as in the admin bank. */
export function QuestionAnswer({ question }: { question: BankQuestion }) {
  const explanation = withUnplacedFigures(question, 'explanation');
  return (
    <div className="bank-answer">
      <div><span className="muted">参考答案：</span>
        <RichText text={question.answer?.trim() || '未提供'} imagePaths={question.image_paths} className="inline" /></div>
      {explanation.trim() && <div><span className="muted">解析：</span>
        <RichText text={explanation} imagePaths={question.image_paths} /></div>}
    </div>
  );
}

function Chips({ label, options, value, onChange }: {
  label: string;
  options: Record<string, string>;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      <span className="chip-label">{label}：</span>
      <button type="button" className={!value ? 'on' : ''} onClick={() => onChange(undefined)}>全部</button>
      {Object.entries(options).map(([key, text]) => (
        <button key={key} type="button" className={value === key ? 'on' : ''} onClick={() => onChange(key)}>{text}</button>
      ))}
    </div>
  );
}

/** The question bank laid out in full, scoped by the catalogue on the left. */
export default function QuestionBrowser({
  classId,
  scope,
  scopeLabel,
  selectedIds,
  busy,
  onAdd,
  onRemove,
  preview = false,
}: {
  /** null: answer counts over all the teacher's classes. */
  classId: string | null;
  scope: CatalogScope;
  scopeLabel: string;
  selectedIds: Set<string>;
  busy: boolean;
  onAdd: (question: BankQuestion) => void;
  onRemove: (question: BankQuestion) => void;
  /** Personalized homework: the bank is only looked at, questions are drafted per student. */
  preview?: boolean;
}) {
  const [filters, setFilters] = useState<QuestionFilters>({ page: 1 });
  const [keyword, setKeyword] = useState('');
  const [result, setResult] = useState<QuestionPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [answersShown, setAnswersShown] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLElement>(null);

  function toggleAnswer(id: string) {
    setAnswersShown((shown) => {
      const next = new Set(shown);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  // 换范围或翻页后从第一题看起，否则滚动条停在上一页的底部
  function scrollToTop() {
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  useEffect(() => {
    setFilters((current) => ({ ...current, page: 1 }));
    scrollToTop();
  }, [scope]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.searchQuestions(classId, { ...filters, ...scope, page_size: PAGE_SIZE })
      .then((page) => active && setResult(page))
      .catch((err) => active && setError(err instanceof Error ? err.message : '加载题目失败'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [classId, filters, scope]);

  function update(next: QuestionFilters) {
    setFilters((current) => ({ ...current, ...next, page: next.page ?? 1 }));
  }

  function goToPage(next: number) {
    update({ page: next });
    scrollToTop();
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    update({ search: keyword.trim() || undefined });
  }

  const page = result?.page ?? 1;
  const pageCount = result ? Math.max(1, Math.ceil(result.total / result.page_size)) : 1;

  return (
    <section ref={listRef} className="bank" aria-label="题库选题">
      <div className="bank-filters">
        <Chips label="题型" options={QUESTION_TYPE_LABELS} value={filters.question_type}
          onChange={(value) => update({ question_type: value })} />
        <Chips label="难度" options={DIFFICULTY_LABELS} value={filters.difficulty_tier}
          onChange={(value) => update({ difficulty_tier: value })} />
        <div className="bank-search">
          <form onSubmit={submitSearch} className="search">
            <input aria-label="关键词" placeholder="搜索题干、题号或答案" value={keyword}
              onChange={(event) => setKeyword(event.target.value)} />
            <button type="submit">搜索</button>
          </form>
          <label className="toggle">
            <input type="checkbox" checked={Boolean(filters.exclude_attempted)}
              onChange={(event) => update({ exclude_attempted: event.target.checked || undefined })} />
            隐藏学生做过的题
          </label>
          <span className="muted small bank-count">
            {scopeLabel} · {loading ? '正在加载…' : `共 ${result?.total ?? 0} 道已审核题目`}
          </span>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <ul className="bank-list">
        {result?.items.map((question) => {
          const chosen = selectedIds.has(question.id);
          return (
            <li key={question.id} className={`bank-card${chosen ? ' chosen' : ''}`}
              style={{ borderLeftColor: TIER_COLORS[question.difficulty_tier ?? ''] ?? '#d9d9d9' }}>
              {/* The bank id stays out of sight (hover shows it): it means nothing to a teacher. */}
              <div className="bank-card-head" title={question.id}>
                <span className="type-tag">[{typeLabel(question.question_type)}]</span>
                {question.difficulty_tier && (
                  <span className="tier-tag" style={{ background: TIER_COLORS[question.difficulty_tier] ?? '#999' }}>
                    {tierLabel(question.difficulty_tier)}
                  </span>
                )}
                {question.primary_kp && <span className="kp-tag">{question.primary_kp.name}</span>}
              </div>
              <div className="bank-card-body"><QuestionBody question={question} /></div>
              {answersShown.has(question.id) && <QuestionAnswer question={question} />}
              <div className="bank-card-foot">
                <span className="muted small"><ClassStat question={question} /></span>
                <span className="bank-card-actions">
                <button type="button" className="answer-toggle" aria-expanded={answersShown.has(question.id)}
                  onClick={() => toggleAnswer(question.id)}>
                  {answersShown.has(question.id) ? '收起解析' : '答案解析'}
                </button>
                {preview ? null : chosen ? (
                  <span className="added-state">
                    <span className="chip draft">已在试卷中</span>
                    <button type="button" className="added-button" disabled={busy} onClick={() => onRemove(question)}
                      aria-label={`从试卷移出 ${question.id}`}>
                      移出
                    </button>
                  </span>
                ) : (
                  <button type="button" className="add-button" disabled={busy} onClick={() => onAdd(question)}
                    aria-label={`加入 ${question.id}`}>
                    ＋ 加入
                  </button>
                )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {result && result.items.length === 0 && !loading && <p className="muted">这个范围里没有符合条件的题目。</p>}
      {pageCount > 1 && (
        <div className="pager">
          <button type="button" disabled={page <= 1 || loading} onClick={() => goToPage(page - 1)}>上一页</button>
          <span className="muted small">{page} / {pageCount}</span>
          <button type="button" disabled={page >= pageCount || loading} onClick={() => goToPage(page + 1)}>下一页</button>
        </div>
      )}
    </section>
  );
}
