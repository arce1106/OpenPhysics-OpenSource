import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { exposeStudentBuildInfo } from './buildInfo';
import './styles/tokens.css';
import './index.css';

exposeStudentBuildInfo();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
