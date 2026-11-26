import { usePracticeSubmissionActivity } from './PracticeExitGuard';
import { useContext, useState, useRef } from 'react';
import {PracticeAttemptContext,TeacherPaperAttemptContext,TopicSubmissionContext,optionalPaperSubmissionScope} from './PracticeAttemptContext';
import { api } from '../api/client';
import { getStudentId } from '../api/studentIdentity';
import type { SubmitResult } from '../types';
import {
  ANSWER_IMAGE_MAX_BYTES,
  ANSWER_IMAGE_MAX_SOURCE_BYTES,
  compressAnswerImageFile,
} from '../utils/imageCompression';

export interface PhotoUploadDraft {
  file: File;
  previewUrl: string;
}

interface Props {
  questionId: string;
  targetKnowledgePointId?: string | null;
  onResult: (result: SubmitResult) => void;
  disabled?: boolean;
  getTimeSpentMs?: () => number;
  draft?: PhotoUploadDraft | null;
  onDraftChange?: (draft: PhotoUploadDraft | null) => void;
  deferUpload?: boolean;
}

const ACCENT = '#14919b';

export default function PhotoUpload({
  questionId,
  targetKnowledgePointId,
  onResult,
  disabled,
  getTimeSpentMs,
  draft,
  onDraftChange,
  deferUpload = false,
}: Props) {
  const attemptScope=useContext(PracticeAttemptContext);
  const teacherPaperAttempt = useContext(TeacherPaperAttemptContext);
  const topicContext = useContext(TopicSubmissionContext);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  usePracticeSubmissionActivity(uploading);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedFile = draft?.file || localFile;
  const preview = draft?.previewUrl || localPreview;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    if (file.size > ANSWER_IMAGE_MAX_SOURCE_BYTES) {
      setError('图片过大，请选择 20MB 以内的图片');
      return;
    }
    setError(null);
    const compressedFile = await compressAnswerImageFile(file);
    if (compressedFile.size > ANSWER_IMAGE_MAX_BYTES) {
      setError('图片压缩后仍超过 5MB，请裁剪后重试');
      return;
    }
    const url = URL.createObjectURL(compressedFile);
    setLocalFile(compressedFile);
    setLocalPreview(url);
    onDraftChange?.({ file: compressedFile, previewUrl: url });
  };

  const handleUpload = async () => {
    if (!selectedFile || disabled || uploading) return;
    setUploading(true);
    setError(null);
    try {
      await teacherPaperAttempt?.beforeSubmit?.();
      const result = await api.submitPhoto(
        getStudentId(),
        selectedFile,
        questionId,
        getTimeSpentMs?.() ?? 0,
        targetKnowledgePointId,
        ...optionalPaperSubmissionScope(attemptScope, teacherPaperAttempt?.id, topicContext),
      );
      onResult(result);
      setLocalPreview(null);
      setLocalFile(null);
      onDraftChange?.(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      setError('上传或识别失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    setLocalPreview(null);
    setLocalFile(null);
    onDraftChange?.(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 8 }}>
        手写拍照上传
      </div>

      {!preview ? (
        <div
          onClick={() => !disabled && fileRef.current?.click()}
          style={{
            border: '2px dashed #d9d9d9',
            borderRadius: 8,
            padding: '24px 16px',
            textAlign: 'center',
            cursor: disabled ? 'default' : 'pointer',
            background: disabled ? '#f5f5f5' : '#fafbfc',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 6 }}>📷</div>
          <div style={{ fontSize: 13, color: '#888' }}>点击选择手写解答照片</div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
            支持 JPEG、PNG，自动压缩后最大 5MB
          </div>
        </div>
      ) : (
        <div className="photo-upload-preview">
          <div className="photo-upload-preview-image-wrap">
            <img
              src={preview}
              alt="手写解答预览"
              className="photo-upload-preview-image"
              loading="lazy"
              decoding="async"
            />
            <button
              type="button"
              className="photo-upload-remove"
              onClick={handleRemove}
              disabled={uploading}
              aria-label="移除已选图片"
              title="移除图片"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="photo-upload-preview-status">
            {deferUpload ? (
              <span>已选择，稍后统一批改</span>
            ) : (
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading || disabled}
                style={{
                  padding: '6px 16px',
                  borderRadius: 6,
                  border: 'none',
                  background: uploading || disabled ? '#d9d9d9' : ACCENT,
                  color: '#fff',
                  cursor: uploading || disabled ? 'default' : 'pointer',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                {uploading ? '识别中...' : '提交识别'}
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: '#ff4d4f', marginTop: 6 }}>{error}</div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}
