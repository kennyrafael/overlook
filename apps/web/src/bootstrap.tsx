import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PrimeReactProvider } from 'primereact/api';
import 'primeicons/primeicons.css';
import 'primeflex/primeflex.css';
import './theme/app.css';
import { ThemeProvider } from './theme/ThemeContext';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrimeReactProvider value={{ ripple: true }}>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </PrimeReactProvider>
  </React.StrictMode>,
);
