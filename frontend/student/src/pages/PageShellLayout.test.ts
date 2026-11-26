import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match?.[1] || '';
}

function groupedCssRule(selector: string): string {
  const match = css
    .split('}')
    .find(rule => rule.includes(selector) && rule.includes('{'));
  return match ? `${match}}` : '';
}

describe('student page shell layout', () => {
  it('keeps the primary student pages on the same centered learning width', () => {
    const shellRule = groupedCssRule('.student-page-shell');

    expect(shellRule).toContain('max-width: var(--learning-page-max-width)');
    expect(shellRule).toContain('width: 100%');
    expect(shellRule).toContain('.container.home-dashboard');
    expect(shellRule).toContain('.container.sync-page');
    expect(shellRule).toContain('.container.train-entry-workspace');
    expect(shellRule).toContain('.container.review-workspace');
  });

  it('reserves scrollbar space so route changes do not move the visual center', () => {
    const htmlRule = cssRule('html');

    expect(htmlRule).toContain('scrollbar-gutter: stable');
  });

  it('keeps sync and consolidation workspaces on the same compact panel height', () => {
    const rootRule = cssRule(':root');
    const syncLayoutRule = cssRule('.sync-map-layout');
    const trainLayoutRule = cssRule('.train-entry-grid');
    const syncGraphBoardRule = cssRule('.sync-route-wrap .sync-graph-board');

    expect(rootRule).toContain('--learning-workspace-panel-height: min(560px, calc(100vh - 118px))');
    expect(rootRule).toContain('--learning-graph-board-min-height: 430px');
    expect(syncLayoutRule).toContain('min-height: var(--learning-workspace-panel-height)');
    expect(trainLayoutRule).toContain('min-height: var(--learning-workspace-panel-height)');
    expect(syncGraphBoardRule).toContain('min-height: var(--learning-graph-board-min-height)');
  });

  it('lets the Gaokao workbench content grow inside its internal scroll container', () => {
    const workbenchRule = cssRule('.gaokao-workbench-panel');
    const topicCardRule = cssRule('.gaokao-workbench-content > .gaokao-topic-route-card');

    expect(workbenchRule).toContain('overflow-y: auto');
    expect(topicCardRule).toContain('flex: 0 0 auto');
  });

  it('gives both review columns enough shared height for the complete review flow', () => {
    const reviewLayoutRule = cssRule('.review-tablet-grid');
    const reviewPoolRule = cssRule('.review-mistake-pool');

    expect(reviewLayoutRule).toContain('--review-workspace-panel-height: calc(var(--learning-workspace-panel-height) + 76px)');
    expect(reviewLayoutRule).toContain('height: var(--review-workspace-panel-height)');
    expect(reviewLayoutRule).toContain('min-height: var(--review-workspace-panel-height)');
    expect(reviewPoolRule).toContain('max-height: calc(var(--review-workspace-panel-height) - 92px)');
  });

  it('lets the Capacitor learning shell fill the WebView instead of using the browser max width', () => {
    const shellRule = cssRule('.student-app-shell.is-capacitor-learning-shell');
    const containerRule = groupedCssRule('.student-app-shell.is-capacitor-learning-shell .container');
    const historyRule = groupedCssRule('.student-app-shell.is-capacitor-learning-shell .history-workspace');
    const syncLayoutRule = cssRule('.student-app-shell.is-capacitor-learning-shell .sync-map-layout');
    const accountMenuRule = cssRule('.capacitor-account-menu');

    expect(shellRule).toContain('--learning-workspace-panel-height: calc(100dvh - 114px)');
    expect(shellRule).toContain('overflow: hidden');
    expect(containerRule).toContain('max-width: none');
    expect(containerRule).toContain('width: 100%');
    expect(containerRule).toContain('.student-app-shell.is-capacitor-learning-shell .question-session-workspace');
    expect(containerRule).toContain('.student-app-shell.is-capacitor-learning-shell .practice-result-page');
    expect(historyRule).toContain('max-width: none');
    expect(historyRule).toContain('width: 100%');
    expect(syncLayoutRule).toContain('height: var(--learning-workspace-panel-height)');
    expect(accountMenuRule).toContain('position: absolute');
  });

  it('uses a compact density for smaller landscape tablets without scaling the WebView', () => {
    const sectionStart = css.indexOf('/* -- Compact Capacitor tablet landscape -- */');
    const sectionEnd = css.indexOf('/* -- End compact Capacitor tablet landscape -- */');
    const compactTabletCss = css.slice(sectionStart, sectionEnd);

    expect(sectionStart).toBeGreaterThan(-1);
    expect(sectionEnd).toBeGreaterThan(sectionStart);
    expect(compactTabletCss).toContain('(min-width: 769px) and (max-width: 1100px)');
    expect(compactTabletCss).toContain('(min-width: 769px) and (max-height: 650px)');
    expect(compactTabletCss).toContain('.student-app-shell.is-capacitor-learning-shell .train-entry-grid');
    expect(compactTabletCss).toContain('grid-template-columns: clamp(280px, 30vw, 300px) minmax(0, 1fr)');
    expect(compactTabletCss).toContain('--learning-workspace-panel-height: calc(100dvh - 96px)');
    expect(compactTabletCss).not.toContain('zoom:');
    expect(compactTabletCss).not.toContain('transform: scale');
  });
});
