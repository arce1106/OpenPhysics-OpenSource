import { createElement, type HTMLAttributes, type ReactNode } from 'react';

type AppCardElement = 'div' | 'section' | 'article';
type AppCardVariant = 'default' | 'soft' | 'outlined' | 'highlight';
type AppCardPadding = 'sm' | 'md' | 'lg';

export interface AppCardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  className?: string;
  variant?: AppCardVariant;
  padding?: AppCardPadding;
  interactive?: boolean;
  as?: AppCardElement;
}

export default function AppCard({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
  interactive = false,
  as = 'div',
  ...rest
}: AppCardProps) {
  const classes = [
    'op-card',
    `op-card--${variant}`,
    `op-card--padding-${padding}`,
    interactive ? 'op-card--interactive' : '',
    className,
  ].filter(Boolean).join(' ');

  return createElement(as, { ...rest, className: classes }, children);
}
