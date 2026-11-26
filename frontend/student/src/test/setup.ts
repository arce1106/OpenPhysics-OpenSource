import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import {flushPracticeDraftWrites} from '../utils/practicePersistence';

afterEach(async () => {
  cleanup();
  await flushPracticeDraftWrites();
  Object.keys(localStorage).filter(key=>key.startsWith('openphysics:practice') || key.startsWith('openphysics:pending-submission:'))
    .forEach(key=>localStorage.removeItem(key));
});
