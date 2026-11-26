import { useEffect, useRef, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { KnowledgePoint, KpWithStats, Question, QuestionImage, QuestionLabel } from '../types';
import { LatexSpan, renderLatexBlock, StemContent } from '../common/LatexSpan';
import {
  buildImageExtractedStructure,
  getDisplayWidthPercent,
  getImageScaleStyle,
  normalizeDisplayWidthPercent,
} from '../../../shared/questionImageDisplay';
import ConfirmDialog from './ConfirmDialog';
import PaginationBar from './PaginationBar';
import QuestionVideoEditor, { QuestionVideoBadge } from './QuestionVideoEditor';
import QuestionAnswerEditor from './QuestionAnswerEditor';
import {
  TYPE_LABELS, TIER_LABELS, TIER_COLORS, STATUS_LABELS, STATUS_COLORS,
  LABEL_TYPE_LABELS, ABILITY_LABELS, STRUCTURE_LABELS, SOLUTION_LABELS,
  MATH_LABELS, CORE_LITERACY_LABELS, PHYSICS_MODEL_LABELS, MISCONCEPTION_LABELS,
  LABEL_GROUPS, getLabelDisplayName, getLabelColor,
  TIER_ORDER,
} from '../common/labels';

type QuestionPatch = Partial<Question> & Pick<Question, 'id'>;

interface WorkspacePageProps {
  kps: KpWithStats[];
  selectedVolumeKey: string | null;
  selectedKpId: string | null;
  selectedChapterKey: string | null;
  selectedSectionKey: string | null;
  allQuestionsId: string;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  padding: '2px 6px', border: '1px solid #d9d9d9', borderRadius: 4, fontSize: 12,
  background: '#fff',
};

const tabBtnStyle: React.CSSProperties = {
  border: '1px solid #d9d9d9', borderRadius: 4, padding: '3px 12px',
  cursor: 'pointer', background: '#fff', fontSize: 12, color: '#666',
};

const PAGE_SIZE = 20;

function scaledMaxWidth(baseMm: number, img: QuestionImage) {
  return `calc(${baseMm}mm * ${getDisplayWidthPercent(img) / 100})`;
}

function imageTypeLabel(type?: string | null) {
  if (type === 'explanation') return '解析';
  if (type === 'option') return '选项';
  return '题干';
}

function imageTypeTone(type?: string | null) {
  if (type === 'explanation') return { background: '#fff0f6', color: '#c41d7f' };
  if (type === 'option') return { background: '#f6ffed', color: '#389e0d' };
  return { background: '#e6f7ff', color: '#0958d9' };
}

// ── Image Card (edit/delete) ────────────────────────────────────────────────

function ImageCard({ img, qId, allImages, onImagesChange }: {
  img: QuestionImage;
  qId: string;
  allImages: QuestionImage[];
  onImagesChange: (images: QuestionImage[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editDesc, setEditDesc] = useState(img.description || '');
  const [editType, setEditType] = useState(img.image_type || 'diagram');
  const [editWidthPercent, setEditWidthPercent] = useState(getDisplayWidthPercent(img));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const handleDelete = () => {
    setBusy(true);
    setImageError(null);
    api.deleteQuestionImage(qId, img.id).then(() => {
      onImagesChange(allImages.filter(im => im.id !== img.id));
      setConfirmDelete(false);
    }).catch(e => setImageError(`删除失败：${e.message}`))
      .finally(() => setBusy(false));
  };

  const handleSave = () => {
    const extractedStructure = buildImageExtractedStructure(img.extracted_structure, editWidthPercent);
    setBusy(true);
    setImageError(null);
    api.updateQuestionImage(qId, img.id, {
      description: editDesc || null,
      image_type: editType,
      extracted_structure: extractedStructure,
    }).then(() => {
      onImagesChange(allImages.map(im =>
        im.id === img.id
          ? { ...im, description: editDesc, image_type: editType, extracted_structure: extractedStructure }
          : im
      ));
      setEditing(false);
    }).catch(e => setImageError(`保存失败：${e.message}`))
      .finally(() => setBusy(false));
  };

  const displayWidthPercent = getDisplayWidthPercent(img);

  return (
    <div style={{
      maxWidth: 260, border: '1px solid #f0f0f0',
      borderRadius: 6, overflow: 'hidden', background: '#fff',
    }}>
      <img src={img.image_path}
        alt={img.description || '图片'}
        style={{ maxWidth: '100%', maxHeight: 180, display: 'block' }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <div style={{ padding: '6px 8px', background: '#fafafa' }}>
        {editing ? (
          <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <select value={editType} onChange={e => setEditType(e.target.value)}
              style={{ padding: '2px 4px', fontSize: 11, border: '1px solid #d9d9d9', borderRadius: 3 }}>
              <option value="diagram">题干配图</option>
              <option value="option">选项配图</option>
              <option value="explanation">解析配图</option>
            </select>
            <input value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="描述"
              style={{ padding: '2px 6px', fontSize: 11, border: '1px solid #d9d9d9', borderRadius: 3 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 6, alignItems: 'center' }}>
              <span style={{ color: '#666' }}>显示</span>
              <input
                type="range"
                min={50}
                max={180}
                step={5}
                value={editWidthPercent}
                onChange={e => setEditWidthPercent(normalizeDisplayWidthPercent(e.target.value))}
              />
              <span style={{ color: '#333', minWidth: 36, textAlign: 'right' }}>{editWidthPercent}%</span>
            </div>
            {editWidthPercent !== 100 && (
              <button
                type="button"
                onClick={() => setEditWidthPercent(100)}
                style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent', color: '#0d7377', fontSize: 11, cursor: 'pointer', padding: 0 }}
              >
                恢复默认大小
              </button>
            )}
            {imageError && <div role="alert" style={{ color: '#cf1322' }}>{imageError}</div>}
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={handleSave} disabled={busy}
                style={{ flex: 1, padding: '2px 0', fontSize: 11, cursor: 'pointer', border: '1px solid #0d7377', borderRadius: 3, background: '#e0f5f6', color: '#0d7377' }}>
                保存
              </button>
              <button onClick={() => setEditing(false)}
                style={{ flex: 1, padding: '2px 0', fontSize: 11, cursor: 'pointer', border: '1px solid #d9d9d9', borderRadius: 3, background: '#fff', color: '#666' }}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
              <span style={{
                fontSize: 10, padding: '0px 5px', borderRadius: 3,
                ...imageTypeTone(img.image_type),
              }}>
                {imageTypeLabel(img.image_type)}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={() => {
                setEditDesc(img.description || '');
                setEditType(img.image_type || 'diagram');
                setEditWidthPercent(getDisplayWidthPercent(img));
                setEditing(true);
              }}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: '#999' }}>
                编辑
              </button>
              <button onClick={() => setConfirmDelete(true)}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10, color: '#ff4d4f' }}>
                删除
              </button>
            </div>
            {img.description && (
              <div style={{ fontSize: 10, color: '#999' }}>{img.description}</div>
            )}
            {imageError && !confirmDelete && (
              <div role="alert" style={{ fontSize: 10, color: '#cf1322', marginTop: 2 }}>{imageError}</div>
            )}
            {displayWidthPercent !== 100 && (
              <div style={{ fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>显示宽度 {displayWidthPercent}%</div>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="删除图片"
        message={`确定删除图片 ${img.id}？\n这会从题目中移除图片引用，并尝试删除对应文件。`}
        confirmLabel="删除"
        tone="danger"
        busy={busy}
        error={imageError}
        onConfirm={handleDelete}
        onCancel={() => { setConfirmDelete(false); setImageError(null); }}
      />
    </div>
  );
}

// ── Full Question Card ──────────────────────────────────────────────────────

function QuestionCard({ q, kpMap, onEdit, onUpdate }: {
  q: Question;
  kpMap: Record<string, string>;
  onEdit: () => void;
  onUpdate: (updated: QuestionPatch) => void;
}) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [answerOpened, setAnswerOpened] = useState(false);
  const [showRelations, setShowRelations] = useState(false);

  const kpLabels = q.labels.filter(l => l.label_type === 'knowledge_point');
  const imageScaleStyles = q.images?.map(img => getImageScaleStyle(img));

  const tierColor = TIER_COLORS[q.difficulty_tier || ''] || '#d9d9d9';

  return (
    <div style={{
      border: '1px solid #e8e8e8', borderLeft: `4px solid ${tierColor}`,
      borderRadius: '0 8px 8px 0', background: '#fff',
      marginBottom: 10, overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
    }}>
      <div style={{ padding: '12px 16px' }}>
        {/* Top line: ID + badges */}
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: '"Source Code Pro", "Cascadia Code", monospace', fontSize: 10, color: '#bbb' }}>
            {q.id}
          </span>
          {q.question_type && (
            <span style={{ fontSize: 11, color: '#0d7377' }}>
              [{TYPE_LABELS[q.question_type] || q.question_type}]
            </span>
          )}
          {q.difficulty_tier && (
            <span style={{
              fontSize: 10, padding: '1px 5px', borderRadius: 3,
              background: tierColor, color: '#fff',
            }}>
              {TIER_LABELS[q.difficulty_tier] || q.difficulty_tier}
            </span>
          )}
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 3,
            background: STATUS_COLORS[q.quality_status] || '#999', color: '#fff',
          }}>
            {STATUS_LABELS[q.quality_status] || q.quality_status}
          </span>
          <QuestionVideoBadge hasVideo={q.has_video} draft={q.video?.status === 'draft'} />
          <div style={{ flex: 1 }} />
          <button onClick={onEdit} style={{
            border: '1px solid #d9d9d9', borderRadius: 4, padding: '2px 10px',
            cursor: 'pointer', background: '#fff', fontSize: 11, color: '#666',
          }}>
            编辑
          </button>
        </div>

        {/* Stem */}
        <div style={{ fontSize: 14, lineHeight: 1.8, color: '#222', marginBottom: 10 }}>
          <StemContent
            text={q.stem_text}
            imagePaths={q.images?.map((im: any) => im.image_path)}
            imageScaleStyles={imageScaleStyles}
          />
        </div>

        {/* Images — fallback block for stems without inline {{IMG:N}} placeholders */}
        {!q.stem_text.includes('{{IMG:') && q.images.filter((im: any) => im.image_type !== 'explanation' && im.image_type !== 'option').length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            {q.images.filter(im => im.image_type !== 'explanation' && im.image_type !== 'option').map((img, i) => (
              <div key={img.id || i} style={{ maxWidth: 260 }}>
                <img
                  src={img.image_path}
                  alt={img.description || `图 ${i + 1}`}
                  style={{ maxWidth: scaledMaxWidth(78, img), maxHeight: '44mm', borderRadius: 4, border: '1px solid #f0f0f0' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                {img.description && (
                  <div style={{ fontSize: 11, color: '#999', marginTop: 2, textAlign: 'center' }}>{img.description}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Options */}
        {q.options.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            {q.options.map(opt => (
              <span key={opt.label} style={{
                fontSize: 13, padding: '4px 10px', borderRadius: 4,
                background: '#fafafa', border: '1px solid #e8e8e8', color: '#333',
              }}>
                {opt.label}. <LatexSpan
                  text={opt.text}
                  imagePaths={q.images?.map(im => im.image_path)}
                  imageScaleStyles={imageScaleStyles}
                  imageClassName="admin-option-image"
                />
              </span>
            ))}
          </div>
        )}

        {/* Formulas */}
        {q.formulas.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            {q.formulas.map((fml, i) => (
              <div
                key={fml.id || i}
                style={{ fontSize: 13, padding: '4px 0', color: '#555' }}
                dangerouslySetInnerHTML={{ __html: renderLatexBlock(fml.latex) }}
              />
            ))}
          </div>
        )}

        {/* Bottom bar: answer + relations buttons */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          borderTop: '1px solid #f0f0f0', paddingTop: 8, gap: 6,
        }}>
          <button aria-expanded={showAnswer} onClick={() => { setAnswerOpened(true); setShowAnswer(!showAnswer); }} style={{
            background: '#fff', border: '1px solid #d9d9d9',
            borderRadius: 4, padding: '3px 12px', cursor: 'pointer', fontSize: 11,
            color: '#666',
          }}>
            答案解析
          </button>
          <button onClick={() => setShowRelations(!showRelations)} style={{
            background: '#fff', border: '1px solid #d9d9d9',
            borderRadius: 4, padding: '3px 12px', cursor: 'pointer', fontSize: 11,
            color: '#666',
          }}>
            关联
          </button>
        </div>
      </div>

      {/* Keep the editor mounted when collapsed so drafts survive the toggle. */}
      <div hidden={!showAnswer} style={{ padding: '0 16px 12px' }}>
        {answerOpened && <QuestionAnswerEditor key={q.id} q={q} onUpdate={onUpdate} />}
      </div>

      {/* Relations detail */}
      {showRelations && (
        <div style={{
          borderTop: '1px solid #f0f0f0', padding: '12px 16px',
          background: '#fafafa',
        }}>
          {kpLabels.length > 0 ? (
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#333', marginRight: 8 }}>关联知识点</span>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {kpLabels.map((lbl, i) => (
                  <span key={i} style={{
                    fontSize: 11, padding: '1px 8px', borderRadius: 10,
                    background: '#e0f5f6', color: '#0d7377', border: '1px solid #b3e5e8',
                  }}>
                    {kpMap[lbl.label_id] || lbl.label_id}
                    <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 4 }}>{lbl.role}</span>
                    {lbl.confidence != null && (
                      <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 4 }}>{(lbl.confidence * 100).toFixed(0)}%</span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: '#999' }}>暂无知识点关联</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Label ID selector (Chinese names, dynamic by type) ────────────────────

const LABEL_ID_OPTIONS: Record<string, Record<string, string>> = {
  question_type: TYPE_LABELS,
  ability_dimension: ABILITY_LABELS,
  question_structure: STRUCTURE_LABELS,
  core_literacy: CORE_LITERACY_LABELS,
  solution_strategy: SOLUTION_LABELS,
  math_prerequisite: MATH_LABELS,
  physics_model: PHYSICS_MODEL_LABELS,
  misconception: MISCONCEPTION_LABELS,
};

function IdSelect({ labelType, value, kpMap, onChange }: {
  labelType: string;
  value: string;
  kpMap: Record<string, KnowledgePoint>;
  onChange: (v: string) => void;
}) {
  if (labelType === 'knowledge_point') {
    const kps = Object.values(kpMap).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    return (
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ flex: 1, padding: '2px 6px', border: '1px solid #d9d9d9', borderRadius: 4, fontSize: 12, background: '#fff' }}>
        <option value="">选择知识点</option>
        {kps.map(kp => (
          <option key={kp.id} value={kp.id}>{kp.name}</option>
        ))}
      </select>
    );
  }
  const opts = LABEL_ID_OPTIONS[labelType];
  if (opts) {
    return (
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ flex: 1, padding: '2px 6px', border: '1px solid #d9d9d9', borderRadius: 4, fontSize: 12, background: '#fff' }}>
        <option value="">选择</option>
        {Object.entries(opts).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
    );
  }
  return (
    <input value={value} onChange={e => onChange(e.target.value)}
      placeholder="ID"
      style={{ flex: 1, padding: '2px 6px', border: '1px solid #d9d9d9', borderRadius: 4, fontSize: 12 }} />
  );
}

// ── Question Detail Panel ───────────────────────────────────────────────────

function QuestionDetail({ q, kpMap, onClose, onUpdate, onDelete }: {
  q: Question;
  kpMap: Record<string, KnowledgePoint>;
  onClose: () => void;
  onUpdate: (updated: QuestionPatch) => void;
  onDelete: (id: string) => void;
}) {
  const [showLabels, setShowLabels] = useState(true);
  const [editingStem, setEditingStem] = useState(false);
  const [editStemText, setEditStemText] = useState('');
  const [editingBasics, setEditingBasics] = useState(false);
  const [basicDraft, setBasicDraft] = useState({
    question_type: q.question_type || '',
    difficulty_tier: q.difficulty_tier || '',
    difficulty: q.difficulty?.toString() || '',
  });
  const [editingLabels, setEditingLabels] = useState(false);
  const [editingLabelData, setEditingLabelData] = useState<QuestionLabel[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savingStem, setSavingStem] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingLabels, setSavingLabels] = useState(false);
  const [savingBasics, setSavingBasics] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const imageScaleStyles = q.images?.map(img => getImageScaleStyle(img));

  const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteQuestion(q.id);
      setConfirmDelete(false);
      onDelete(q.id);
    } catch (e) {
      setDeleteError(errorText(e, '删除失败，请重试'));
    } finally {
      setDeleting(false);
    }
  };

  const saveStem = async () => {
    if (savingStem) return;
    if (editStemText === q.stem_text) {
      setEditingStem(false);
      return;
    }
    if (!editStemText.trim()) {
      setActionError('题干不能为空');
      return;
    }
    setSavingStem(true);
    setActionError(null);
    try {
      await api.updateQuestion(q.id, { stem_text: editStemText });
      onUpdate({ id: q.id, stem_text: editStemText });
      setEditingStem(false);
    } catch (e) {
      setActionError(`题干保存失败：${errorText(e, '请稍后重试')}。已保留编辑内容，可重试。`);
    } finally {
      setSavingStem(false);
    }
  };

  const changeStatus = async (newStatus: string) => {
    if (savingStatus || newStatus === q.quality_status) return;
    setSavingStatus(true);
    setActionError(null);
    try {
      await api.reviewQuestion(q.id, newStatus);
      onUpdate({ id: q.id, quality_status: newStatus });
    } catch (e) {
      setActionError(`审核状态未修改：${errorText(e, '请稍后重试')}`);
    } finally {
      setSavingStatus(false);
    }
  };

  const saveLabels = async () => {
    if (savingLabels) return;
    if (editingLabelData.some(label => !label.label_id.trim())) {
      setActionError('有标签还没选择具体内容，请选择或删除后再保存');
      return;
    }
    setSavingLabels(true);
    setActionError(null);
    try {
      await api.updateQuestionLabels(q.id, editingLabelData as unknown as Record<string, unknown>[]);
      const qtLabel = editingLabelData.find(l => l.label_type === 'question_type');
      onUpdate({
        id: q.id,
        labels: editingLabelData,
        question_type: qtLabel ? qtLabel.label_id : q.question_type,
      });
      setEditingLabels(false);
    } catch (e) {
      setActionError(`标签保存失败：${errorText(e, '请稍后重试')}。已保留编辑内容，可重试。`);
    } finally {
      setSavingLabels(false);
    }
  };

  const startBasicEdit = () => {
    setBasicDraft({
      question_type: q.question_type || '',
      difficulty_tier: q.difficulty_tier || '',
      difficulty: q.difficulty?.toString() || '',
    });
    setEditingBasics(true);
  };

  const saveBasics = async () => {
    if (savingBasics) return;
    const difficulty = basicDraft.difficulty.trim() === ''
      ? null
      : Number(basicDraft.difficulty);
    if (difficulty !== null && !Number.isFinite(difficulty)) {
      setActionError('难度数值需要是数字，例如 2.5；留空表示不设置');
      return;
    }
    setSavingBasics(true);
    setActionError(null);
    const patch = {
      question_type: basicDraft.question_type || null,
      difficulty_tier: basicDraft.difficulty_tier || null,
      difficulty: Number.isFinite(difficulty) ? difficulty : null,
    };
    try {
      await api.updateQuestion(q.id, patch as Record<string, unknown>);
      onUpdate({
        id: q.id,
        question_type: basicDraft.question_type || undefined,
        difficulty_tier: basicDraft.difficulty_tier || undefined,
        difficulty: difficulty !== null ? difficulty : undefined,
      });
      setEditingBasics(false);
    } catch (e) {
      setActionError(`基础信息保存失败：${errorText(e, '请稍后重试')}`);
    } finally {
      setSavingBasics(false);
    }
  };

  const handleClose = () => {
    const dirtyStem = editingStem && editStemText !== q.stem_text;
    if ((dirtyStem || editingLabels) && !window.confirm('有未保存的修改，确定返回列表吗？')) return;
    onClose();
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      {/* Back button */}
      <button onClick={handleClose} style={{
        border: 'none', background: 'transparent', cursor: 'pointer',
        color: '#0d7377', fontSize: 13, marginBottom: 16, padding: 0,
      }}>
        ← 返回列表
      </button>

      {actionError && (
        <div role="alert" style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 6,
          background: '#fff2f0', border: '1px solid #ffccc7', color: '#cf1322', fontSize: 13,
        }}>
          {actionError}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontFamily: '"Source Code Pro", "Cascadia Code", monospace', fontSize: 11, color: '#bbb' }}>
            {q.id}
          </span>
          <span style={{
            fontSize: 11, padding: '1px 6px', borderRadius: 3,
            background: STATUS_COLORS[q.quality_status] || '#999', color: '#fff',
          }}>
            {STATUS_LABELS[q.quality_status] || q.quality_status}
          </span>
          <QuestionVideoBadge hasVideo={q.has_video} draft={q.video?.status === 'draft'} />
          <select
            aria-label="审核状态"
            value={q.quality_status || 'draft'}
            disabled={savingStatus}
            onChange={e => { void changeStatus(e.target.value); }}
            style={{ ...selectStyle, fontSize: 11, width: 80 }}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          {q.question_type && (
            <span style={{ fontSize: 11, color: '#0d7377' }}>
              [{TYPE_LABELS[q.question_type] || q.question_type}]
            </span>
          )}
          {q.difficulty_tier && (
            <span style={{
              fontSize: 11, padding: '1px 5px', borderRadius: 3,
              background: TIER_COLORS[q.difficulty_tier] || '#999', color: '#fff',
            }}>
              {TIER_LABELS[q.difficulty_tier] || q.difficulty_tier}
            </span>
          )}
          · 来源: {q.source ?? '-'}
        </div>

        {/* Stem */}
        <div style={{ fontSize: 16, lineHeight: 1.8, fontWeight: 500, color: '#222', marginBottom: 12 }}>
          {editingStem ? (
            <textarea value={editStemText}
              onChange={e => setEditStemText(e.target.value)}
              style={{
                width: '100%', minHeight: 260, maxHeight: '62vh', padding: 12, border: '1px solid #0d7377',
                borderRadius: 4, fontSize: 14, lineHeight: 1.8, fontFamily: 'inherit',
                resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          ) : (
            <StemContent
              text={q.stem_text}
              imagePaths={q.images?.map((im: any) => im.image_path)}
              imageScaleStyles={imageScaleStyles}
            />
          )}
        </div>
        <button
          disabled={savingStem}
          onClick={() => {
            if (editingStem) {
              void saveStem();
            } else {
              setEditStemText(q.stem_text);
              setActionError(null);
              setEditingStem(true);
            }
          }}
          style={{ ...tabBtnStyle, fontSize: 11 }}>
          {editingStem ? (savingStem ? '保存中…' : '保存题干') : '编辑题干'}
        </button>
        {editingStem && (
          <button
            disabled={savingStem}
            onClick={() => { setEditingStem(false); setActionError(null); }}
            style={{ ...tabBtnStyle, fontSize: 11, marginLeft: 8 }}>
            取消
          </button>
        )}
        <button onClick={() => setConfirmDelete(true)}
          style={{ ...tabBtnStyle, fontSize: 11, marginLeft: 8, color: '#ff4d4f', borderColor: '#ffccc7' }}>
          删除
        </button>
      </div>

      <QuestionVideoEditor key={q.id} questionId={q.id} video={q.video}
        onChange={video => onUpdate({ id: q.id, video, has_video: video.status === 'approved' })} />

      {/* Options */}
      {q.options.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ marginBottom: 6, fontSize: 13 }}>选项</h4>
          {q.options.map((opt, i) => (
            <div key={i} style={{
              padding: '6px 12px', marginBottom: 4, borderRadius: 4,
              background: '#fafafa', border: '1px solid #f0f0f0', fontSize: 14,
            }}>
              <span style={{ fontWeight: 600, marginRight: 8 }}>{opt.label}.</span>
              <LatexSpan
                text={opt.text}
                imagePaths={q.images?.map(im => im.image_path)}
                imageScaleStyles={imageScaleStyles}
                imageClassName="admin-option-image"
              />
            </div>
          ))}
        </div>
      )}

      {/* Basic editable metadata */}
      <div style={{ marginBottom: 16, padding: 12, background: '#fff', border: '1px solid #f0f0f0', borderRadius: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <h4 style={{ margin: 0, fontSize: 13 }}>基础信息</h4>
          <button
            disabled={savingBasics}
            onClick={() => {
              if (editingBasics) void saveBasics();
              else startBasicEdit();
            }}
            style={{ ...tabBtnStyle, fontSize: 11 }}>
            {editingBasics ? (savingBasics ? '保存中…' : '保存') : '编辑'}
          </button>
          {editingBasics && (
            <button onClick={() => setEditingBasics(false)} style={{ ...tabBtnStyle, fontSize: 11 }}>
              取消
            </button>
          )}
        </div>
        {editingBasics ? (
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'start', fontSize: 12 }}>
            <span style={{ color: '#888' }}>题型</span>
            <select
              value={basicDraft.question_type}
              onChange={e => setBasicDraft({ ...basicDraft, question_type: e.target.value })}
              style={selectStyle}>
              <option value="">未设置</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span style={{ color: '#888' }}>难度层级</span>
            <select
              value={basicDraft.difficulty_tier}
              onChange={e => setBasicDraft({ ...basicDraft, difficulty_tier: e.target.value })}
              style={selectStyle}>
              <option value="">未设置</option>
              {Object.entries(TIER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span style={{ color: '#888' }}>难度数值</span>
            <input
              value={basicDraft.difficulty}
              onChange={e => setBasicDraft({ ...basicDraft, difficulty: e.target.value })}
              placeholder="如 2.5"
              style={selectStyle}
            />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 6, fontSize: 12, color: '#555' }}>
            <span style={{ color: '#888' }}>题型</span>
            <span>{q.question_type ? (TYPE_LABELS[q.question_type] || q.question_type) : '-'}</span>
            <span style={{ color: '#888' }}>难度层级</span>
            <span>{q.difficulty_tier ? (TIER_LABELS[q.difficulty_tier] || q.difficulty_tier) : '-'}</span>
            <span style={{ color: '#888' }}>难度数值</span>
            <span>{q.difficulty ?? '-'}</span>
          </div>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <QuestionAnswerEditor key={q.id} q={q} onUpdate={onUpdate} />
      </div>
      <button onClick={() => setShowLabels(!showLabels)} style={{ ...tabBtnStyle, marginBottom: 12 }}>
        {showLabels ? '收起标签' : '展开标签'}
      </button>

      {/* Labels */}
      {showLabels && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8, gap: 8 }}>
            <h4 style={{ margin: 0, fontSize: 13 }}>标签</h4>
            <button
              disabled={savingLabels}
              onClick={() => {
                if (editingLabels) {
                  void saveLabels();
                } else {
                  setEditingLabelData([...q.labels]);
                  setActionError(null);
                  setEditingLabels(true);
                }
              }}
              style={{ ...tabBtnStyle, fontSize: 11 }}>
              {editingLabels ? (savingLabels ? '保存中…' : '保存') : '编辑'}
            </button>
            {editingLabels && (
              <>
                <button onClick={() => {
                  setEditingLabelData([...editingLabelData, {
                    label_type: 'knowledge_point', label_id: '', role: '主要',
                    confidence: 1, source: 'human',
                  }]);
                }}
                style={{ ...tabBtnStyle, fontSize: 11 }}>+ 添加</button>
                <button onClick={() => setEditingLabels(false)}
                style={{ ...tabBtnStyle, fontSize: 11 }}>取消</button>
              </>
            )}
          </div>

          {editingLabels ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {LABEL_GROUPS.map(group => {
                const groupItems: { item: QuestionLabel; globalIdx: number }[] = [];
                editingLabelData.forEach((l, idx) => {
                  if (group.types.includes(l.label_type)) {
                    groupItems.push({ item: l, globalIdx: idx });
                  }
                });
                if (groupItems.length === 0) return null;
                return (
                  <div key={group.key}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 4 }}>
                      {group.title}
                    </div>
                    {groupItems.map(({ item: l, globalIdx }) => (
                      <div key={globalIdx} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                        <select value={l.label_type}
                          onChange={e => {
                            const next = [...editingLabelData];
                            // 换了标签类型，原来的 ID 属于旧类型，必须重新选择。
                            next[globalIdx] = { ...next[globalIdx], label_type: e.target.value, label_id: '', related_kp_id: undefined };
                            setEditingLabelData(next);
                          }}
                          style={{ ...selectStyle, width: 130 }}>
                          <option value="knowledge_point">知识点</option>
                          <option value="question_type">题型</option>
                          <option value="ability_dimension">能力维度</option>
                          <option value="physics_model">物理模型</option>
                          <option value="misconception">常见误区</option>
                          <option value="question_structure">题目结构</option>
                          <option value="core_literacy">核心素养</option>
                          <option value="solution_strategy">解法策略</option>
                          <option value="math_prerequisite">数学前置</option>
                        </select>
                        <IdSelect labelType={l.label_type} value={l.label_id} kpMap={kpMap}
                          onChange={v => {
                            const next = [...editingLabelData];
                            next[globalIdx] = { ...next[globalIdx], label_id: v };
                            setEditingLabelData(next);
                          }} />
                        <select value={l.role}
                          onChange={e => {
                            const next = [...editingLabelData];
                            next[globalIdx] = { ...next[globalIdx], role: e.target.value };
                            setEditingLabelData(next);
                          }}
                          style={{ ...selectStyle, width: 90 }}>
                          <option value="主要">主要</option>
                          <option value="辅助">辅助</option>
                          <option value="前置">前置</option>
                          <option value="detected">detected</option>
                        </select>
                        <button onClick={() => {
                          const next = editingLabelData.filter((_, idx) => idx !== globalIdx);
                          setEditingLabelData(next);
                        }}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ff4d4f', fontSize: 14 }}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
              {editingLabelData.length === 0 && (
                <p style={{ color: '#999', fontSize: 12 }}>暂无标签，点击"+ 添加"创建</p>
              )}
            </div>
          ) : q.labels.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {LABEL_GROUPS.map(group => {
                const groupLabels = group.types.flatMap(t =>
                  q.labels.filter(l => l.label_type === t)
                );
                if (groupLabels.length === 0) return null;
                return (
                  <div key={group.key}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 4 }}>
                      {group.title}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {groupLabels.map((l, i) => {
                        const relatedKp = l.label_type === 'misconception' && l.related_kp_id
                          ? kpMap[l.related_kp_id]?.name : null;
                        return (
                          <span key={i} style={{
                            display: 'inline-block', padding: '2px 8px', borderRadius: 3, fontSize: 12,
                            background: getLabelColor(l.label_type), color: '#333',
                          }}>
                            <span style={{ color: '#999', fontSize: 10 }}>
                              {LABEL_TYPE_LABELS[l.label_type] || l.label_type}:
                            </span>
                            {getLabelDisplayName(l, kpMap)}
                            <span style={{ color: '#999', marginLeft: 4, fontSize: 10 }}>({l.role})</span>
                            {relatedKp && (
                              <span style={{ color: '#999', marginLeft: 4, fontSize: 10 }}>→{relatedKp}</span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p style={{ color: '#999', fontSize: 12 }}>暂无标签</p>
          )}

          {/* Formulas */}
          {q.formulas.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ marginBottom: 4, fontSize: 13 }}>公式</h4>
              {q.formulas.map((f, i) => (
                <div key={i} style={{
                  padding: '4px 8px', marginBottom: 2, background: '#f9f0ff',
                  borderRadius: 3, fontSize: 13, fontFamily: 'monospace',
                }}>
                  {f.latex}
                </div>
              ))}
            </div>
          )}

          {/* Images */}
          {q.images.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ marginBottom: 4, fontSize: 13 }}>图片</h4>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {q.images.map((img, i) => (
                  <ImageCard key={img.id || i} img={img} qId={q.id}
                    allImages={q.images}
                    onImagesChange={(imgs) => onUpdate({ id: q.id, images: imgs })} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="删除题目"
        message={`确定删除题目 ${q.id}？\n这会删除题目及其选项、标签、公式和图片引用。已有学生作答或被试卷引用的题无法删除，请改为“已退役”。`}
        confirmLabel="删除"
        tone="danger"
        busy={deleting}
        error={deleteError}
        onConfirm={() => { void handleDelete(); }}
        onCancel={() => { setConfirmDelete(false); setDeleteError(null); }}
      />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function WorkspacePage({
  kps, selectedVolumeKey, selectedKpId, selectedChapterKey, selectedSectionKey, allQuestionsId,
}: WorkspacePageProps) {

  // Questions
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [questionPage, setQuestionPage] = useState(1);
  const questionListRef = useRef<HTMLDivElement>(null);
  const [totalQuestions, setTotalQuestions] = useState(0);

  // Filters (for all-questions mode)
  const [statusFilter, setStatusFilter] = useState('');
  const [videoFilter, setVideoFilter] = useState('');
  const [videoRevision, setVideoRevision] = useState(0);
  const [kpFilter, setKpFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  // 输入停顿 300ms 后再查询，避免每敲一个字就请求一次。
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchFilter(searchInput), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const [kpTypeFilter, setKpTypeFilter] = useState('all');
  const [kpTierFilter, setKpTierFilter] = useState('all');

  // Question detail selection
  const [selectedQ, setSelectedQ] = useState<Question | null>(null);
  const [batchResult, setBatchResult] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    tone?: 'default' | 'danger';
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  // ?q=<题号或关键词>：忽略左侧范围，在全库中查找（质量总览、教学工作台的“查看题目”会带上它）。
  const [urlParams, setUrlParams] = useSearchParams();
  const globalQuery = (urlParams.get('q') || '').trim();
  const clearGlobalQuery = () => {
    const next = new URLSearchParams(urlParams);
    next.delete('q');
    setUrlParams(next, { replace: true });
  };
  const startGlobalSearch = () => {
    const term = searchInput.trim();
    if (!term) return;
    const next = new URLSearchParams(urlParams);
    next.set('q', term);
    setUrlParams(next, { replace: true });
    setSearchInput('');
    setSelectedQ(null);
  };

  // Current selection mode
  const isAllMode = selectedKpId === allQuestionsId && !globalQuery;
  const isChapterMode = !!selectedChapterKey;
  const isSectionMode = !!selectedSectionKey;
  const isVolumeMode = !!selectedVolumeKey;
  const isAnyMode = Boolean(globalQuery) || isAllMode || isVolumeMode || !!selectedKpId || isChapterMode || isSectionMode;

  const scopeParams = useMemo<Record<string, string>>(() => {
    if (selectedSectionKey) {
      const [volume, chapter, section] = selectedSectionKey.split('||');
      const params: Record<string, string> = {};
      if (volume) params.volume = volume;
      if (chapter) params.chapter = chapter;
      if (section) params.section = section;
      return params;
    }
    if (selectedChapterKey) {
      const [volume, chapter] = selectedChapterKey.split('||');
      const params: Record<string, string> = {};
      if (volume) params.volume = volume;
      if (chapter) params.chapter = chapter;
      return params;
    }
    if (selectedKpId && selectedKpId !== allQuestionsId) {
      return { kp_id: selectedKpId };
    }
    if (selectedVolumeKey) {
      return { volume: selectedVolumeKey };
    }
    return {};
  }, [allQuestionsId, selectedChapterKey, selectedKpId, selectedSectionKey, selectedVolumeKey]);

  // 翻页后从新一页的第一题看起，否则滚动条停在上一页的底部
  const goToQuestionPage = (page: number) => {
    setQuestionPage(page);
    if (questionListRef.current) questionListRef.current.scrollTop = 0;
  };

  // Reset to first page when mode or filters change
  useEffect(() => {
    setQuestionPage(1);
  }, [
    selectedVolumeKey, selectedKpId, selectedChapterKey, selectedSectionKey,
    statusFilter, videoFilter, kpFilter, searchFilter,
    kpTypeFilter, kpTierFilter, globalQuery,
  ]);

  // 用户在左侧换了范围，说明不再需要全库搜索结果。直接打开带 ?q 的链接时，
  // 题库目录加载完才会自动选中默认分册，那次从“无范围”到有范围的变化不算换范围；
  // 比较范围值而不是“是否首次执行”，开发模式 StrictMode 重复执行 effect 时也不会误清。
  const scopeParts = [selectedVolumeKey, selectedKpId, selectedChapterKey, selectedSectionKey];
  const scopeKey = scopeParts.some(Boolean) ? scopeParts.join('||') : '';
  const lastScopeKey = useRef('');
  useEffect(() => {
    setSelectedQ(null);
    setBatchResult(null);
    const previous = lastScopeKey.current;
    lastScopeKey.current = scopeKey;
    if (previous && previous !== scopeKey && globalQuery) clearGlobalQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVolumeKey, selectedKpId, selectedChapterKey, selectedSectionKey]);

  // Load paged questions in all-questions mode
  useEffect(() => {
    if (!isAllMode) return;
    let cancelled = false;
    (async () => {
      setLoadingQuestions(true);
      setQuestionError(null);
      try {
        const page = await api.listQuestionsPaged({
          page: String(questionPage),
          page_size: String(PAGE_SIZE),
          ...(statusFilter && { status: statusFilter }),
          ...(videoFilter && { has_video: videoFilter }),
          ...(kpFilter && { kp_id: kpFilter }),
          ...(kpTierFilter !== 'all' && { difficulty_tier: kpTierFilter }),
          ...(kpTypeFilter !== 'all' && { question_type: kpTypeFilter }),
          ...(searchFilter.trim() && { search: searchFilter.trim() }),
        });
        if (cancelled) return;
        setAllQuestions(page.items);
        setTotalQuestions(page.total);
      } catch (e: unknown) {
        if (cancelled) return;
        setAllQuestions([]);
        setTotalQuestions(0);
        setQuestionError(e instanceof Error ? e.message : '加载题目失败');
      } finally {
        if (!cancelled) setLoadingQuestions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAllMode, questionPage, statusFilter, videoFilter, videoRevision, kpFilter, kpTierFilter, kpTypeFilter, searchFilter]);

  // Load paged questions when KP, chapter, or section is selected
  useEffect(() => {
    if (isAllMode) return;
    const hasScope = Boolean(scopeParams.kp_id || scopeParams.volume || scopeParams.chapter || scopeParams.section);
    if (!hasScope && !globalQuery) return;
    let cancelled = false;
    (async () => {
      setLoadingQuestions(true);
      setQuestionError(null);
      try {
        const page = await api.listQuestionsPaged({
          ...(globalQuery ? {} : scopeParams),
          page: String(questionPage),
          page_size: String(PAGE_SIZE),
          ...(statusFilter && { status: statusFilter }),
          ...(videoFilter && { has_video: videoFilter }),
          ...(kpTierFilter !== 'all' && { difficulty_tier: kpTierFilter }),
          ...(kpTypeFilter !== 'all' && { question_type: kpTypeFilter }),
          ...(globalQuery
            ? { search: globalQuery }
            : searchFilter.trim() ? { search: searchFilter.trim() } : {}),
        });
        if (cancelled) return;
        setQuestions(page.items);
        setTotalQuestions(page.total);
      } catch (e: unknown) {
        if (cancelled) return;
        setQuestions([]);
        setTotalQuestions(0);
        setQuestionError(e instanceof Error ? e.message : '加载题目失败');
      } finally {
        if (!cancelled) setLoadingQuestions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [
    isAllMode,
    globalQuery,
    questionPage,
    scopeParams,
    statusFilter,
    videoFilter,
    videoRevision,
    kpTypeFilter,
    kpTierFilter,
    searchFilter,
  ]);

  const kpNameMap = useMemo(
    () => Object.fromEntries(kps.map(k => [k.id, k.name])),
    [kps],
  );

  // Full KP map for label display (need description etc.)
  const kpFullMap: Record<string, KnowledgePoint> = useMemo(() => {
    const m: Record<string, KnowledgePoint> = {};
    kps.forEach(kp => { m[kp.id] = kp as unknown as KnowledgePoint; });
    return m;
  }, [kps]);

  // Filter questions
  const filteredQuestions = useMemo(() => {
    return isAllMode ? allQuestions : questions;
  }, [isAllMode, allQuestions, questions]);

  const totalPages = Math.max(1, Math.ceil(totalQuestions / PAGE_SIZE));
  const hasActiveFilter = Boolean(
    statusFilter || videoFilter || kpFilter || searchFilter.trim()
    || kpTypeFilter !== 'all' || kpTierFilter !== 'all',
  );

  // Available filter values from KP-specific questions
  const availableTypes = useMemo(
    () => Object.keys(TYPE_LABELS),
    [],
  );
  const availableTiers = useMemo(
    () => Object.keys(TIER_LABELS).sort(
      (a, b) => TIER_ORDER.indexOf(a as typeof TIER_ORDER[number]) - TIER_ORDER.indexOf(b as typeof TIER_ORDER[number])
    ) as string[],
    [],
  );

  // Reset filters when KP changes
  useEffect(() => {
    setKpTypeFilter('all');
    setKpTierFilter('all');
  }, [selectedVolumeKey, selectedKpId, selectedChapterKey, selectedSectionKey]);

  const handleQuestionUpdate = (updated: QuestionPatch) => {
    if ('video' in updated && updated.video !== selectedQ?.video) setVideoRevision(value => value + 1);
    setSelectedQ(prev => prev?.id === updated.id ? { ...prev, ...updated } : prev);
    setAllQuestions(prev => prev.map(q => q.id === updated.id ? { ...q, ...updated } : q));
    setQuestions(prev => prev.map(q => q.id === updated.id ? { ...q, ...updated } : q));
  };

  const handleQuestionDelete = (id: string) => {
    setSelectedQ(null);
    setAllQuestions(prev => prev.filter(q => q.id !== id));
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const approveCurrentPage = () => {
    const ids = filteredQuestions.filter(q => q.quality_status !== 'approved').map(q => q.id);
    setBatchResult(null);
    if (ids.length === 0) {
      setBatchResult({ tone: 'ok', text: '本页题目都已是“已通过”，无需操作。' });
      return;
    }
    setPendingConfirm({
      title: '本页通过',
      message: `将本页 ${ids.length} 道未通过的题标记为“已通过”？\n缺少答案等无法批改的题会被跳过，并列出原因。`,
      confirmLabel: '通过',
      onConfirm: async () => {
        const result = await api.batchReview(ids, 'approved');
        const failed = new Map(result.errors.map(item => [item.id, item.error]));
        const succeeded = new Set(ids.filter(id => !failed.has(id)));
        const markApproved = (q: Question) => succeeded.has(q.id) ? { ...q, quality_status: 'approved' } : q;
        setAllQuestions(prev => prev.map(markApproved));
        setQuestions(prev => prev.map(markApproved));
        setPendingConfirm(null);
        if (failed.size === 0) {
          setBatchResult({ tone: 'ok', text: `已通过 ${succeeded.size} 道题。` });
        } else {
          const detail = Array.from(failed.entries()).slice(0, 5).map(([id, reason]) => `${id}：${reason}`).join('；');
          setBatchResult({
            tone: 'error',
            text: `已通过 ${succeeded.size} 道，${failed.size} 道未通过（${detail}${failed.size > 5 ? ' 等' : ''}）。`,
          });
        }
      },
    });
  };

  return (
    <div style={{ height: '100%', width: '100%', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {isAnyMode ? (
          <>
            {/* ── Question List ──────────────────────────────────── */}
            {selectedQ ? (
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <QuestionDetail
                    key={selectedQ.id}
                    q={selectedQ}
                    kpMap={kpFullMap}
                    onClose={() => setSelectedQ(null)}
                    onUpdate={handleQuestionUpdate}
                    onDelete={handleQuestionDelete}
                  />
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '8px 20px', background: '#fff', borderBottom: '1px solid #e8e8e8' }}>
                    {globalQuery && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                        fontSize: 12, color: '#0d7377',
                      }}>
                        <span>全库搜索：<strong>{globalQuery}</strong>（不受左侧范围限制）</span>
                        <button type="button" onClick={clearGlobalQuery} style={{ ...tabBtnStyle, fontSize: 11 }}>
                          清除，回到当前范围
                        </button>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: '#667085', whiteSpace: 'nowrap' }}>
                        共 {totalQuestions} 题 · 第 {questionPage}/{totalPages} 页
                      </span>
                      <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                        style={selectStyle}>
                        <option value="">全部状态</option>
                        {Object.entries(STATUS_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                      <select aria-label="视频讲解筛选" value={videoFilter} onChange={e => setVideoFilter(e.target.value)}
                        style={selectStyle}>
                        <option value="">全部视频状态</option>
                        <option value="true">有视频讲解</option>
                        <option value="false">无已发布视频</option>
                      </select>
                      {isAllMode && (
                        <>
                          <select value={kpFilter} onChange={e => setKpFilter(e.target.value)}
                            style={selectStyle}>
                            <option value="">全部知识点</option>
                            {kps.map(kp => (
                              <option key={kp.id} value={kp.id}>{kp.name}</option>
                            ))}
                          </select>
                        </>
                      )}
                      <select value={kpTypeFilter} onChange={e => setKpTypeFilter(e.target.value)}
                        style={selectStyle}>
                        <option value="all">全部题型</option>
                        {availableTypes.map(type => (
                          <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
                        ))}
                      </select>
                      <select value={kpTierFilter} onChange={e => setKpTierFilter(e.target.value)}
                        style={selectStyle}>
                        <option value="all">全部难度</option>
                        {availableTiers.map(tier => (
                          <option key={tier} value={tier}>{TIER_LABELS[tier] || tier}</option>
                        ))}
                      </select>
                      <input
                        aria-label="搜索题目"
                        type="search"
                        value={searchInput}
                        onChange={e => setSearchInput(e.target.value)}
                        placeholder={globalQuery ? '清除全库搜索后可在范围内搜索' : '搜索题干 / ID / 答案'}
                        disabled={Boolean(globalQuery)}
                        style={{ ...selectStyle, minWidth: isAllMode ? 180 : 220, flex: '0 1 280px' }}
                      />
                      {!globalQuery && (
                        <button
                          type="button"
                          onClick={startGlobalSearch}
                          disabled={!searchInput.trim()}
                          title="不受左侧范围限制，在全部题目中查找"
                          style={{ ...tabBtnStyle, fontSize: 11 }}>
                          全库搜索
                        </button>
                      )}
                      <div style={{ flex: 1, minWidth: 8 }} />
                      <button onClick={approveCurrentPage}
                        style={{ ...tabBtnStyle, fontSize: 11, color: '#52796d', borderColor: '#b7dbce' }}>
                        本页通过
                      </button>
                    </div>
                    {batchResult && (
                      <div role="status" style={{
                        marginTop: 6, fontSize: 12, lineHeight: 1.6,
                        color: batchResult.tone === 'ok' ? '#389e0d' : '#cf1322',
                      }}>
                        {batchResult.text}
                      </div>
                    )}

                  </div>

                  {/* Question list */}
                  <div ref={questionListRef} data-testid="question-list" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 20px', boxSizing: 'border-box' }}>
                    {loadingQuestions ? (
                      <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>加载题目中...</div>
                    ) : questionError ? (
                      <div style={{ textAlign: 'center', color: '#ff4d4f', padding: 40, fontSize: 14 }}>
                        {questionError}
                      </div>
                    ) : filteredQuestions.length === 0 ? (
                      <div style={{ textAlign: 'center', color: '#ccc', padding: 40, fontSize: 14 }}>
                        {hasActiveFilter ? '没有匹配当前筛选条件的题目' : '暂无题目'}
                      </div>
                    ) : (
                      filteredQuestions.map(q => (
                        <QuestionCard
                          key={q.id}
                          q={q}
                          kpMap={kpNameMap}
                          onEdit={() => setSelectedQ(q)}
                          onUpdate={handleQuestionUpdate}
                        />
                      ))
                    )}
                  </div>
                  <PaginationBar
                    page={questionPage}
                    totalPages={totalPages}
                    total={totalQuestions}
                    pageSize={PAGE_SIZE}
                    loading={loadingQuestions}
                    onPageChange={goToQuestionPage}
                  />
                </div>
              )}

          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#bbb', fontSize: 15,
          }}>
            点击左侧目录查看对应题库
          </div>
        )}
        <ConfirmDialog
          open={pendingConfirm !== null}
          title={pendingConfirm?.title || ''}
          message={pendingConfirm?.message || ''}
          confirmLabel={pendingConfirm?.confirmLabel || '确认'}
          tone={pendingConfirm?.tone}
          busy={confirmBusy}
          error={confirmError}
          onConfirm={() => {
            if (!pendingConfirm) return;
            setConfirmBusy(true);
            setConfirmError(null);
            Promise.resolve(pendingConfirm.onConfirm())
              .catch(e => setConfirmError(e instanceof Error ? e.message : '操作失败，请重试'))
              .finally(() => setConfirmBusy(false));
          }}
          onCancel={() => { setPendingConfirm(null); setConfirmError(null); }}
        />
      </div>
  );
}
