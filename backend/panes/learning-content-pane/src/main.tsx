import React from 'react';
import { createRoot } from 'react-dom/client';
import { LearningContentPane } from './LearningContentPane';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LearningContentPane />
  </React.StrictMode>,
);
