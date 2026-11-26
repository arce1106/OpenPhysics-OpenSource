import { useState, useEffect, useCallback } from 'react';
import TutorAssistantShell from './TutorAssistantShell';
import { apiUrl } from '../api/baseUrl';
import { getStudentId, getStudentToken } from '../api/studentIdentity';
import type { ChatMessage } from '../types';

interface Props {
  kpId: string;
  kpName: string;
}

const QUICK_PROMPTS = [
  '这个知识点怎么理解？',
  '换一种说法讲',
  '问我一道检查题',
  '这个知识点常错在哪？',
];

const MAX_STORED_MESSAGES = 30;
const CHAT_STORAGE_VERSION = 3;

function chatStorageKey(studentId: string, kpId: string): string {
  return `openphysics:learn-chat:v${CHAT_STORAGE_VERSION}:${studentId}:${kpId}`;
}

function readStoredMessages(studentId: string, kpId: string): ChatMessage[] | null {
  if (typeof window === 'undefined' || !studentId || !kpId) return null;
  try {
    const raw = window.localStorage.getItem(chatStorageKey(studentId, kpId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const messages = parsed.filter((item): item is ChatMessage => (
      item
      && (item.role === 'user' || item.role === 'assistant')
      && typeof item.content === 'string'
      && item.content.trim().length > 0
    ));
    return messages.length > 0 ? messages.slice(-MAX_STORED_MESSAGES) : null;
  } catch {
    return null;
  }
}

function writeStoredMessages(studentId: string, kpId: string, messages: ChatMessage[]) {
  if (typeof window === 'undefined' || !studentId || !kpId || messages.length === 0) return;
  try {
    window.localStorage.setItem(
      chatStorageKey(studentId, kpId),
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    );
  } catch {
    // localStorage can be full or unavailable; the chat still works in memory.
  }
}

export default function AITutorChat({ kpId }: Props) {
  const studentId = getStudentId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');

  useEffect(() => {
    setMessages(readStoredMessages(studentId, kpId) || []);
    setInput('');
    setStreamText('');
    setStreaming(false);
  }, [studentId, kpId]);

  useEffect(() => {
    writeStoredMessages(studentId, kpId, messages);
  }, [studentId, kpId, messages]);

  const sendMessage = useCallback(async (nextMessage?: string) => {
    const text = (nextMessage ?? input).trim();
    if (!text || streaming) return;
    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setStreamText('');

    try {
      const token = getStudentToken();
      const response = await fetch(apiUrl('/learn/chat'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          kp_id: kpId,
          message: text,
          history: messages.slice(-8).map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('无法读取回复流');

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              full += parsed.content || '';
              setStreamText(full);
            } catch { /* partial chunk */ }
          }
        }
      }
      setMessages(prev => [...prev, { role: 'assistant', content: full }]);
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `这次没有连上 AI 助教：${e.message || '连接失败'}。请稍后重试。`,
      }]);
    } finally {
      setStreamText('');
      setStreaming(false);
    }
  }, [input, kpId, messages, streaming]);

  return (
    <TutorAssistantShell
      ariaLabel="AI助教 · 当前知识点"
      inputLabel="输入当前知识点的问题"
      placeholder="有什么关于这个知识点的问题，都可以问我"
      prompts={QUICK_PROMPTS}
      messages={messages}
      input={input}
      loading={streaming}
      loadingText="助教正在梳理这个知识点..."
      streamText={streamText}
      onInputChange={setInput}
      onSend={sendMessage}
    />
  );
}
