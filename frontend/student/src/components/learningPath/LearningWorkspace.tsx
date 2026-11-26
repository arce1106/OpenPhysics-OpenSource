import type { ReactNode } from 'react';

interface LearningWorkspaceProps {
  children: ReactNode;
  className?: string;
}

export default function LearningWorkspace({ children, className = '' }: LearningWorkspaceProps) {
  return (
    <div className={`learning-workspace${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}
