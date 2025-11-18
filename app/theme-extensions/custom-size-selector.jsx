import React from 'react';
import { createRoot } from 'react-dom/client';
import { CustomSizeForm } from '../components/CustomSizeForm.client.jsx';

function initCustomSizeForm() {
  const rootElement = document.getElementById('custom-size-app-root');

  if (rootElement) {
    const productId = rootElement.dataset.productId;
    const root = createRoot(rootElement);

    root.render(
      <React.StrictMode>
        <CustomSizeForm productId={productId} />
      </React.StrictMode>
    );
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCustomSizeForm);
} else {
  initCustomSizeForm();
}