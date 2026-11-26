import { useState, type ReactNode } from 'react';
import { api } from '../api/client';
import TutorAssistantShell from './TutorAssistantShell';
import type { ChatMessage, ProcessGrading } from '../types';

interface QuestionTutorChatProps {
  questionId: string;
  givenAnswer: string;
  processGrading?: ProcessGrading | null;
  sideActions?: ReactNode;
  inlineTrigger?: boolean;
}

const QUICK_PROMPTS = [
  '我第一步错在哪？',
  '为什么这个答案不对？',
  '给我一道类似题',
];

export default function QuestionTutorChat({ questionId, givenAnswer, processGrading, sideActions, inlineTrigger }: QuestionTutorChatProps) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const send = async (nextMessage?: string) => {
    const message = (nextMessage ?? input).trim();
    if (!message || loading) return;
    const previousHistory = history;
    setHistory(prev => [...prev, { role: 'user', content: message }]);
    setInput('');
    setLoading(true);
    try {
      const data = await api.questionTutorChat({
        question_id: questionId,
        given_answer: givenAnswer,
        message,
        history: previousHistory,
        process_grading: processGrading || undefined,
      });
      setHistory(prev => [...prev, { role: 'assistant', content: data.text }]);
    } catch {
      setHistory(prev => [...prev, { role: 'assistant', content: '这道题的追问暂时没有生成成功，请稍后再试。' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <TutorAssistantShell
      inlineTrigger={inlineTrigger}
      ariaLabel="AI助教 · 本题"
      inputLabel="输入对这道题的追问"
      placeholder="有什么关于这道题的问题，都可以问我"
      prompts={QUICK_PROMPTS}
      messages={history}
      input={input}
      loading={loading}
      loadingText="助教正在看这道题..."
      sideActions={sideActions}
      onInputChange={setInput}
      onSend={send}
    />
  );
}
